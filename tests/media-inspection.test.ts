import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import type { ScriptProject } from '@shared/types'
const state = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@main/services/runtime', () => ({ runtimeExecutable: async (name: string) => name }))
vi.mock('@main/services/process-runner', () => ({ runProcess: state.run }))
import { inspectLocalMedia } from '@main/services/media-inspection'

it('prepares silent local video without audio encoding or model downloads, preserves hash and timing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ginuni-inspect-'))
  try {
    const path = join(directory, '무성 영상.mp4')
    await writeFile(path, 'movie')
    state.run.mockResolvedValue({ stdout: JSON.stringify({ format: { duration: '5.125' }, streams: [{ codec_type: 'video', width: 1920, height: 1080 }] }) })
    const project = { source: { kind: 'local', uri: path }, media: { durationMs: 0 } } as ScriptProject
    const result = await inspectLocalMedia(project)
    expect(result.media).toMatchObject({ durationMs: 5125, width: 1920, height: 1080 })
    expect(result.source.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(state.run).toHaveBeenCalledTimes(1)
    expect(state.run.mock.calls[0][0]).toBe('ffprobe')
    expect(project.media.durationMs).toBe(0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
