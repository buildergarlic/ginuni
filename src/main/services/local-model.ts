import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { join } from 'node:path'
import {
  LOCAL_MODEL_BYTES,
  LOCAL_MODEL_FILE,
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_SHA256,
  LOCAL_MODEL_URL
} from '@shared/constants'
import type { LocalModelStatus, ModelDownloadProgress } from '@shared/types'

let downloadInFlight: Promise<string> | null = null

function modelsDirectory(): string {
  return join(app.getPath('userData'), 'models', 'whisper')
}

export function localModelPath(): string {
  return join(modelsDirectory(), LOCAL_MODEL_FILE)
}

async function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function localModelStatus(): Promise<LocalModelStatus> {
  let sizeBytes = 0
  try {
    sizeBytes = (await stat(localModelPath())).size
  } catch {
    // 아직 모델이 설치되지 않았다.
  }
  return {
    installed: sizeBytes === LOCAL_MODEL_BYTES,
    sizeBytes,
    expectedBytes: LOCAL_MODEL_BYTES,
    modelName: LOCAL_MODEL_NAME
  }
}

function downloadFile(options: {
  url: string
  destination: string
  signal?: AbortSignal
  onProgress?: (progress: ModelDownloadProgress) => void
  redirects?: number
}): Promise<void> {
  const redirects = options.redirects ?? 0
  if (redirects > 6) return Promise.reject(new Error('로컬 모델 다운로드 주소를 확인할 수 없습니다.'))

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const request = httpsGet(options.url, { headers: { 'User-Agent': 'screen-description-script-maker/0.2' } }, (response) => {
      const location = response.headers.location
      if (location && response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume()
        options.signal?.removeEventListener('abort', abort)
        downloadFile({
          ...options,
          url: new URL(location, options.url).toString(),
          redirects: redirects + 1
        }).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        finish(new Error(`로컬 모델을 내려받지 못했습니다. (HTTP ${response.statusCode ?? 0})`))
        return
      }

      const totalBytes = Number(response.headers['content-length']) || LOCAL_MODEL_BYTES
      let downloadedBytes = 0
      const output = createWriteStream(options.destination)
      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        options.onProgress?.({
          percent: Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)),
          downloadedBytes,
          totalBytes,
          message: '로컬 음성인식 모델을 내려받고 있습니다.'
        })
      })
      response.on('error', (error) => output.destroy(error))
      output.on('error', finish)
      output.on('finish', () => output.close(() => finish()))
      response.pipe(output)
    })
    const abort = (): void => {
      request.destroy(new DOMException('모델 다운로드가 취소되었습니다.', 'AbortError'))
    }
    if (options.signal?.aborted) return abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    request.on('error', (error) => finish(error))
  })
}

export async function ensureLocalModel(options: {
  signal?: AbortSignal
  onProgress?: (progress: ModelDownloadProgress) => void
} = {}): Promise<string> {
  if ((await localModelStatus()).installed) return localModelPath()
  if (downloadInFlight) return downloadInFlight

  downloadInFlight = (async () => {
    const directory = modelsDirectory()
    const partialPath = `${localModelPath()}.download`
    await mkdir(directory, { recursive: true })
    await rm(localModelPath(), { force: true })
    await rm(partialPath, { force: true })
    try {
      await downloadFile({ url: LOCAL_MODEL_URL, destination: partialPath, ...options })
      const details = await stat(partialPath)
      if (details.size !== LOCAL_MODEL_BYTES || await fileSha256(partialPath) !== LOCAL_MODEL_SHA256) {
        throw new Error('내려받은 로컬 모델의 무결성 검사에 실패했습니다. 다시 시도하세요.')
      }
      await rename(partialPath, localModelPath())
      options.onProgress?.({
        percent: 100,
        downloadedBytes: LOCAL_MODEL_BYTES,
        totalBytes: LOCAL_MODEL_BYTES,
        message: '로컬 음성인식 모델 설치가 완료되었습니다.'
      })
      return localModelPath()
    } catch (error) {
      await rm(partialPath, { force: true })
      if (options.signal?.aborted) throw new DOMException('모델 다운로드가 취소되었습니다.', 'AbortError')
      throw error
    } finally {
      downloadInFlight = null
    }
  })()
  return downloadInFlight
}

export async function deleteLocalModel(): Promise<LocalModelStatus> {
  if (downloadInFlight) throw new Error('모델을 내려받는 중에는 삭제할 수 없습니다.')
  await rm(localModelPath(), { force: true })
  return localModelStatus()
}
