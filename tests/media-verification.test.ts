import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScriptProject } from '@shared/types'

const processState = vi.hoisted(() => ({ runProcess: vi.fn() }))
vi.mock('@main/services/runtime', () => ({ runtimeExecutable: vi.fn(async (name: string) => name) }))
vi.mock('@main/services/process-runner', () => ({ runProcess: processState.runProcess }))

import { prepareMedia } from '@main/services/media'

let directory = ''

function project(source: ScriptProject['source']): ScriptProject {
  return {
    schemaVersion: 1, id: 'p', title: '작품', createdAt: '', updatedAt: '', status: 'draft',
    localDiarization: { mode: 'none', speakerCount: null }, source, media: { durationMs: 0 },
    segments: [], rows: [], runs: [], exports: []
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'media-verification-'))
  processState.runProcess.mockReset()
})

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('prepareMedia 검증', () => {
  it.each([
    ['오늘의 "특별한" 이야기', '오늘의 특별한 이야기'],
    ['“오늘”의 ”특별한“ 이야기', '오늘의 특별한 이야기'],
    ["작가의 '이야기' 1편!", "작가의 '이야기' 1편!"],
    ['  "“”"  ', '유튜브 영상']
  ])('유튜브 자동 프로젝트 제목의 큰따옴표를 제거한다: %s', async (videoTitle, expectedTitle) => {
    processState.runProcess.mockImplementation(async (executable: string, args: string[]) => {
      if (executable === 'yt-dlp' && args.includes('--dump-single-json')) {
        return { stdout: JSON.stringify({ id: 'video', title: videoTitle, duration: 60 }), stderr: '', exitCode: 0 }
      }
      if (executable === 'yt-dlp') await writeFile(join(directory, 'media', 'youtube-source.webm'), 'source')
      if (executable === 'ffmpeg') await writeFile(args.at(-1)!, 'encoded')
      return { stdout: JSON.stringify({ format: { duration: '60' }, streams: [{ codec_type: 'audio' }] }), stderr: '', exitCode: 0 }
    })
    const input = project({ kind: 'youtube', uri: 'https://youtu.be/video', displayName: '유튜브 영상' })
    input.title = '유튜브 영상' // The existing creation fallback when the title field is blank.

    const result = await prepareMedia({ project: input, projectDirectory: directory, engine: 'local', progress: () => undefined })

    expect(result.title).toBe(expectedTitle)
    expect(result.source.displayName).toBe(videoTitle) // Keep the original source metadata intact.
  })

  it('내려받은 유튜브 원본의 SHA-256을 인코딩 전에 기록한다', async () => {
    const sourceBytes = Buffer.from('downloaded-source')
    processState.runProcess.mockImplementation(async (executable: string, args: string[]) => {
      if (executable === 'yt-dlp' && args.includes('--dump-single-json')) {
        return { stdout: JSON.stringify({ id: 'video', title: '제목', duration: 60 }), stderr: '', exitCode: 0 }
      }
      if (executable === 'yt-dlp') {
        await writeFile(join(directory, 'media', 'youtube-source.webm'), sourceBytes)
        return { stdout: '', stderr: '', exitCode: 0 }
      }
      if (executable === 'ffmpeg') await writeFile(args.at(-1)!, Buffer.from('encoded'))
      return { stdout: JSON.stringify({ format: { duration: '60' }, streams: [{ codec_type: 'audio' }] }), stderr: '', exitCode: 0 }
    })

    const result = await prepareMedia({
      project: project({ kind: 'youtube', uri: 'https://youtu.be/video', displayName: 'video' }),
      projectDirectory: directory,
      engine: 'openai',
      progress: () => undefined
    })

    expect(result.source.sha256).toBe(createHash('sha256').update(sourceBytes).digest('hex'))
  })

  it('오디오 트랙이 없는 로컬 원본은 인코딩 전에 거부한다', async () => {
    const input = join(directory, 'silent.mp4')
    await writeFile(input, Buffer.from('video'))
    processState.runProcess.mockResolvedValue({
      stdout: JSON.stringify({ format: { duration: '60' }, streams: [{ codec_type: 'video', width: 1920, height: 1080 }] }),
      stderr: '', exitCode: 0
    })

    await expect(prepareMedia({
      project: project({ kind: 'local', uri: input, localMediaPath: input, displayName: 'silent.mp4' }),
      projectDirectory: directory,
      engine: 'local',
      progress: () => undefined
    })).rejects.toMatchObject({ code: 'FFPROBE_FAILED', stage: 'probe' })
    expect(processState.runProcess).toHaveBeenCalledTimes(1)
  })
})
