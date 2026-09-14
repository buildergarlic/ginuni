import { access } from 'node:fs/promises'
import { MAX_DURATION_MS } from '@shared/constants'
import type { ScriptProject } from '@shared/types'
import { runtimeExecutable } from './runtime'
import { runProcess } from './process-runner'
import { fileSha256 } from './file-hash'
import { LocalProcessingError, classifyProcessFailure } from './processing-errors'

/** Subtitle and manual work needs a local timeline, not an audio transcription. */
export async function inspectLocalMedia(project: ScriptProject, signal?: AbortSignal): Promise<ScriptProject> {
  if (project.source.kind !== 'local') throw new Error('자막·직접 입력 작업은 로컬 영상 파일을 선택해 주세요.')
  const path = project.source.localMediaPath ?? project.source.uri
  try { await access(path) } catch { throw new LocalProcessingError({ code: 'MEDIA_NOT_FOUND', stage: 'media', message: '원본 파일을 찾을 수 없습니다.' }) }
  const ffprobe = await runtimeExecutable('ffprobe')
  let details: { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> }
  try {
    const { stdout } = await runProcess(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { signal })
    details = JSON.parse(stdout)
  } catch (error) {
    if (signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError')
    throw classifyProcessFailure(error, 'probe', 'FFPROBE_FAILED')
  }
  const durationMs = Math.round(Number(details.format?.duration) * 1000)
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error('영상 길이를 확인할 수 없습니다.')
  if (durationMs > MAX_DURATION_MS) throw new Error('현재는 3시간 이하 자료만 지원합니다.')
  if (!details.streams?.some(s => s.codec_type === 'video' || s.codec_type === 'audio')) throw new Error('재생 가능한 영상 또는 음성 트랙이 없습니다.')
  const video = details.streams.find(s => s.codec_type === 'video')
  const sha256 = await fileSha256(path, signal)
  if (project.source.sha256 && project.source.sha256 !== sha256 && (project.rows.length || project.segments.length || project.subtitleWorkspace?.assets.length)) {
    throw new Error('원본 영상이 변경되었습니다. 기존 대본을 보존했습니다. 새 프로젝트로 열어 주세요.')
  }
  const next = structuredClone(project)
  next.source.sha256 = sha256
  next.media = { ...next.media, durationMs, width: video?.width, height: video?.height }
  return next
}
