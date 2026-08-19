import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectDiarizationComponent } from '@main/services/diarization-bundle'

let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = ''
})

describe('화자 분리 구성 요소 무결성', () => {
  it('파일이 없으면 missing으로 판정한다', async () => {
    const result = await inspectDiarizationComponent({
      id: 'segmentation',
      name: 'test',
      files: [{ path: async () => 'Z:\\missing-model.onnx', bytes: 4, sha256: '0'.repeat(64) }]
    })
    expect(result).toMatchObject({ available: false, integrity: 'missing', sizeBytes: 0, expectedBytes: 4 })
  })

  it('크기 또는 SHA-256이 다르면 invalid로 판정한다', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'ginuni-diarization-integrity-'))
    const path = join(temporaryDirectory, 'model.onnx')
    await writeFile(path, 'model', 'utf8')
    const result = await inspectDiarizationComponent({
      id: 'embedding',
      name: 'test',
      files: [{ path: async () => path, bytes: 5, sha256: '0'.repeat(64) }]
    })
    expect(result).toMatchObject({ available: false, integrity: 'invalid', sizeBytes: 5 })
  })

  it('크기와 SHA-256이 모두 맞으면 valid로 판정한다', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'ginuni-diarization-integrity-'))
    const path = join(temporaryDirectory, 'model.onnx')
    const content = Buffer.from('model')
    await writeFile(path, content)
    const result = await inspectDiarizationComponent({
      id: 'embedding',
      name: 'test',
      files: [{ path: async () => path, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }]
    })
    expect(result).toMatchObject({ available: true, integrity: 'valid', sizeBytes: content.length })
  })
})
