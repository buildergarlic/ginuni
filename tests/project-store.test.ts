import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROJECTS_DIRECTORY_NAME } from '@shared/constants'
import type { ScriptProject } from '@shared/types'

const electronState = vi.hoisted(() => ({ documentsPath: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronState.documentsPath } }))

import { loadProject } from '@main/services/project-store'

let tempDirectory = ''

afterEach(async () => {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
  tempDirectory = ''
})

describe('project store migrations', () => {
  it('기존 로컬 프로젝트의 자동 화자 표기를 project.json에도 영구 정리한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-project-store-'))
    electronState.documentsPath = tempDirectory
    const projectDirectory = join(tempDirectory, PROJECTS_DIRECTORY_NAME, 'Projects', 'legacy_local')
    await mkdir(projectDirectory, { recursive: true })
    const originalUpdatedAt = '2026-08-18T00:00:00.000Z'
    const project = {
      schemaVersion: 1,
      id: 'legacy-local',
      title: '기존 로컬 분석',
      createdAt: originalUpdatedAt,
      updatedAt: originalUpdatedAt,
      status: 'review',
      transcriptionEngine: 'local',
      source: { kind: 'local', uri: 'video.mp4', displayName: 'video.mp4' },
      media: { durationMs: 2_000 },
      segments: [{ id: 'segment', startMs: 0, endMs: 2_000, speakerId: '화자1', text: '대사' }],
      rows: [{
        id: 'row', kind: 'dialogue', startMs: 0, endMs: 2_000,
        speakers: ['화자1'], content: '[화자1] [화자1] 대사', sourceSegmentIds: ['segment'], reviewed: false
      }],
      runs: [{
        id: 'run', startedAt: originalUpdatedAt, completedAt: '2026-08-18T00:01:00.000Z',
        provider: 'local', model: 'test'
      }],
      exports: []
    } as unknown as ScriptProject
    const projectPath = join(projectDirectory, 'project.json')
    await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8')

    const loaded = await loadProject(project.id)
    const persisted = JSON.parse(await readFile(projectPath, 'utf8')) as ScriptProject

    expect(loaded.rows[0]).toMatchObject({ speakers: [], content: '대사' })
    expect(persisted.rows[0]).toMatchObject({ speakers: [], content: '대사' })
    expect(persisted.segments[0].speakerId).toBe('')
    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.localDiarization).toEqual({ mode: 'none', speakerCount: null })
    expect(persisted.updatedAt).toBe(originalUpdatedAt)
  })

  it('스키마 2 화자 분리 프로젝트의 화자 데이터는 다시 열어도 보존한다', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'screen-script-project-store-'))
    electronState.documentsPath = tempDirectory
    const projectDirectory = join(tempDirectory, PROJECTS_DIRECTORY_NAME, 'Projects', 'diarized_local')
    await mkdir(projectDirectory, { recursive: true })
    const project: ScriptProject = {
      schemaVersion: 2,
      id: 'diarized-local',
      title: '화자 분리 로컬 분석',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      status: 'review',
      transcriptionEngine: 'local',
      localDiarization: { mode: 'sherpa-onnx', speakerCount: null },
      source: { kind: 'local', uri: 'video.mp4', displayName: 'video.mp4' },
      media: { durationMs: 2_000 },
      segments: [{ id: 'segment', startMs: 0, endMs: 2_000, speakerId: '화자1', text: '대사' }],
      rows: [{
        id: 'row', kind: 'dialogue', startMs: 0, endMs: 2_000,
        speakers: ['화자1'], content: '[화자1] [화자1] 대사', sourceSegmentIds: ['segment'], reviewed: false
      }],
      runs: [{
        id: 'run', startedAt: '2026-08-20T00:00:00.000Z', completedAt: '2026-08-20T00:01:00.000Z',
        provider: 'local', model: 'test',
        diarization: {
          engine: 'sherpa-onnx', engineVersion: 'test', segmentationModel: 'test', embeddingModel: 'test',
          requestedSpeakerCount: null, detectedSpeakerCount: 1, unassignedWordCount: 0, status: 'succeeded'
        }
      }],
      exports: []
    }
    const projectPath = join(projectDirectory, 'project.json')
    await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8')

    const loaded = await loadProject(project.id)

    expect(loaded.segments[0].speakerId).toBe('화자1')
    expect(loaded.rows[0]).toMatchObject({ speakers: ['화자1'], content: '[화자1] [화자1] 대사' })
  })
})
