import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  DIARIZATION_EMBEDDING_BYTES,
  DIARIZATION_EMBEDDING_MODEL,
  DIARIZATION_EMBEDDING_SHA256,
  DIARIZATION_ENGINE_VERSION,
  DIARIZATION_SEGMENTATION_BYTES,
  DIARIZATION_SEGMENTATION_MODEL,
  DIARIZATION_SEGMENTATION_SHA256
} from '@shared/constants'
import type { DiarizationBundleComponentStatus, DiarizationBundleStatus } from '@shared/types'
import { diarizationModelPath, diarizationRuntimeLibraryPath, runtimeExecutable } from './runtime'

const RUNTIME_FILES = [
  { path: () => runtimeExecutable('sherpa-diarizer'), bytes: 286_208, sha256: 'd28626cb761e9c55917378ececebb9200068b502557877d88b6ce3fb715894bd' },
  { path: () => diarizationRuntimeLibraryPath('onnxruntime'), bytes: 13_860_352, sha256: '0b086b0dae785d85e2ef16d1db196852cfdfd5b0f01baa0b538b7111a375b1c0' },
  { path: () => diarizationRuntimeLibraryPath('providers'), bytes: 10_752, sha256: 'fda8cda01281a25f8472f1b77ff0ee42f292edd7b5840dc720f43019811a0db7' }
] as const

async function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function inspectDiarizationComponent(options: {
  id: DiarizationBundleComponentStatus['id']
  name: string
  files: Array<{ path: () => Promise<string>; bytes: number; sha256: string }>
}): Promise<DiarizationBundleComponentStatus> {
  let sizeBytes = 0
  let missing = false
  let invalid = false
  for (const file of options.files) {
    try {
      const path = await file.path()
      const details = await stat(path)
      sizeBytes += details.size
      if (details.size !== file.bytes || await fileSha256(path) !== file.sha256) invalid = true
    } catch {
      missing = true
    }
  }
  const expectedBytes = options.files.reduce((sum, file) => sum + file.bytes, 0)
  return {
    id: options.id,
    name: options.name,
    available: !missing && !invalid,
    integrity: missing ? 'missing' : invalid ? 'invalid' : 'valid',
    sizeBytes,
    expectedBytes
  }
}

export async function diarizationBundleStatus(): Promise<DiarizationBundleStatus> {
  const components = await Promise.all([
    inspectDiarizationComponent({ id: 'runtime', name: DIARIZATION_ENGINE_VERSION, files: [...RUNTIME_FILES] }),
    inspectDiarizationComponent({
      id: 'segmentation',
      name: DIARIZATION_SEGMENTATION_MODEL,
      files: [{ path: () => diarizationModelPath('segmentation'), bytes: DIARIZATION_SEGMENTATION_BYTES, sha256: DIARIZATION_SEGMENTATION_SHA256 }]
    }),
    inspectDiarizationComponent({
      id: 'embedding',
      name: DIARIZATION_EMBEDDING_MODEL,
      files: [{ path: () => diarizationModelPath('embedding'), bytes: DIARIZATION_EMBEDDING_BYTES, sha256: DIARIZATION_EMBEDDING_SHA256 }]
    })
  ])
  const integrity = components.some((component) => component.integrity === 'invalid')
    ? 'invalid'
    : components.some((component) => component.integrity === 'missing')
      ? 'missing'
      : 'valid'
  return {
    available: integrity === 'valid',
    integrity,
    engineVersion: DIARIZATION_ENGINE_VERSION,
    installedBytes: components.reduce((sum, component) => sum + component.sizeBytes, 0),
    expectedBytes: components.reduce((sum, component) => sum + component.expectedBytes, 0),
    components
  }
}
