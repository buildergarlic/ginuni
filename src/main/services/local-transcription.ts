import { randomUUID } from 'node:crypto'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import type { TranscriptSegment, TranscriptionProvider, TranscriptionRequest } from '@shared/types'
import { runProcess } from './process-runner'
import { runtimeExecutable, whisperVadModelPath } from './runtime'

interface WhisperJsonToken {
  offsets?: { from?: number; to?: number }
  text?: string
}

interface WhisperJsonSegment {
  offsets?: { from?: number; to?: number }
  text?: string
  tokens?: WhisperJsonToken[]
}

interface WhisperJsonResult {
  transcription?: WhisperJsonSegment[]
}

export interface VadMapping {
  originalStartMs: number
  originalEndMs: number
  compressedStartMs: number
  compressedEndMs: number
}

export function parseVadMappings(value: string): VadMapping[] {
  const mappings: VadMapping[] = []
  const pattern = /vad_segment_info:\s*orig_start:\s*([\d.]+),\s*orig_end:\s*([\d.]+),\s*vad_start:\s*([\d.]+),\s*vad_end:\s*([\d.]+)/g
  for (const match of value.matchAll(pattern)) {
    mappings.push({
      originalStartMs: Math.round(Number(match[1]) * 1000),
      originalEndMs: Math.round(Number(match[2]) * 1000),
      compressedStartMs: Math.round(Number(match[3]) * 1000),
      compressedEndMs: Math.round(Number(match[4]) * 1000)
    })
  }
  return mappings
}

function transcriptionSegment(startMs: number, endMs: number, text: string): TranscriptSegment {
  // 로컬 Whisper는 화자 분리를 지원하지 않는다. 빈 값은 "화자 미확인"을 뜻하며
  // 대본 생성기가 근거 없는 화자 표기를 출력하지 않도록 한다.
  return { id: randomUUID(), startMs, endMs, speakerId: '', text: text.replace(/\s+/g, ' ').trim() }
}

function fromVadTokens(value: WhisperJsonResult, mappings: VadMapping[]): TranscriptSegment[] {
  const merged: Array<VadMapping & { mappingIndexes: number[] }> = []
  mappings.forEach((mapping, index) => {
    const previous = merged.at(-1)
    if (previous && mapping.originalStartMs - previous.originalEndMs < 2_000) {
      previous.originalEndMs = mapping.originalEndMs
      previous.compressedEndMs = mapping.compressedEndMs
      previous.mappingIndexes.push(index)
    } else {
      merged.push({ ...mapping, mappingIndexes: [index] })
    }
  })
  const groupByMapping = new Map<number, number>()
  merged.forEach((group, groupIndex) => group.mappingIndexes.forEach((mappingIndex) => groupByMapping.set(mappingIndex, groupIndex)))
  const textByGroup = merged.map(() => '')

  for (const token of (value.transcription ?? []).flatMap((segment) => segment.tokens ?? [])) {
    const text = token.text ?? ''
    if (!text || /^\[_.*\]$/.test(text)) continue
    const from = token.offsets?.from
    const to = token.offsets?.to
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    const midpoint = (from! + to!) / 2
    let mappingIndex = mappings.findIndex((mapping) => midpoint >= mapping.compressedStartMs && midpoint <= mapping.compressedEndMs)
    if (mappingIndex < 0) {
      mappingIndex = mappings.reduce((best, mapping, index) => {
        const distance = Math.min(Math.abs(midpoint - mapping.compressedStartMs), Math.abs(midpoint - mapping.compressedEndMs))
        const bestMapping = mappings[best]
        const bestDistance = Math.min(Math.abs(midpoint - bestMapping.compressedStartMs), Math.abs(midpoint - bestMapping.compressedEndMs))
        return distance < bestDistance ? index : best
      }, 0)
    }
    textByGroup[groupByMapping.get(mappingIndex) ?? 0] += text
  }

  for (let index = 1; index < textByGroup.length; index += 1) {
    const punctuation = textByGroup[index].match(/^\s*([.!?,。！？…]+)/)?.[1]
    if (punctuation) {
      textByGroup[index - 1] += punctuation
      textByGroup[index] = textByGroup[index].replace(/^\s*[.!?,。！？…]+\s*/, ' ')
    }
  }

  return merged
    .map((group, index) => transcriptionSegment(group.originalStartMs, group.originalEndMs, textByGroup[index]))
    .filter((segment) => segment.text && segment.endMs > segment.startMs)
}

export function parseWhisperJson(value: WhisperJsonResult, mappings: VadMapping[] = []): TranscriptSegment[] {
  if (mappings.length > 0 && value.transcription?.some((segment) => segment.tokens?.length)) {
    const vadSegments = fromVadTokens(value, mappings)
    if (vadSegments.length > 0) return vadSegments
  }
  return (value.transcription ?? [])
    .filter((segment) => Number.isFinite(segment.offsets?.from) && Number.isFinite(segment.offsets?.to) && segment.text?.trim())
    .map((segment) => transcriptionSegment(
      Math.max(0, Math.round(segment.offsets!.from!)),
      Math.max(0, Math.round(segment.offsets!.to!)),
      segment.text!
    ))
    .filter((segment) => segment.endMs > segment.startMs)
}

export class LocalWhisperTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly modelPath: string) {}

  async transcribe(request: TranscriptionRequest): Promise<TranscriptSegment[]> {
    const executable = await runtimeExecutable('whisper-cli')
    const vadModel = await whisperVadModelPath()
    const outputBase = join(dirname(request.audioPath), `whisper-result-${randomUUID()}`)
    const outputJson = `${outputBase}.json`
    const threads = Math.max(1, Math.min(8, cpus().length - 1))
    let progressBuffer = ''

    try {
      const result = await runProcess(executable, [
        '-m', this.modelPath,
        '-f', request.audioPath,
        '-l', request.language,
        '-t', String(threads),
        '-ojf',
        '-of', outputBase,
        '-pp',
        '-sow',
        '-sns',
        '--no-gpu',
        '--vad',
        '-vm', vadModel,
        '-vsd', '500',
        '-vp', '100',
        '-vmsd', '30'
      ], {
        signal: request.signal,
        onStderr: (value) => {
          progressBuffer = `${progressBuffer}${value}`.slice(-2_000)
          for (const match of progressBuffer.matchAll(/progress\s*=\s*(\d+)%/g)) {
            request.onProgress?.(Math.min(100, Number(match[1])))
          }
        }
      })
      const parsed = JSON.parse(await readFile(outputJson, 'utf8')) as WhisperJsonResult
      return parseWhisperJson(parsed, parseVadMappings(result.stderr))
    } catch (error) {
      if (request.signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError')
      if (error instanceof SyntaxError) throw new Error('로컬 음성인식 결과를 읽을 수 없습니다.')
      throw new Error('로컬 음성 분석에 실패했습니다. 모델을 다시 설치하거나 다른 영상을 확인하세요.')
    } finally {
      await rm(outputJson, { force: true })
    }
  }
}
