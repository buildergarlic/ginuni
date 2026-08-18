import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

interface MediaProject {
  source: {
    kind: string
    localMediaPath?: string
  }
}

export type MediaProjectLoader = (id: string) => Promise<MediaProject>

interface ByteRange {
  start: number
  end: number
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avi': 'video/x-msvideo',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm'
}

function contentType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function parseSingleByteRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || size <= 0) return null

  const [, startText, endText] = match
  if (!startText && !endText) return null

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(startText)
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null

  const requestedEnd = endText ? Number(endText) : size - 1
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function plainResponse(body: string, status: number, headers?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...headers
    }
  })
}

function notFound(): Response {
  return plainResponse('Not found', 404)
}

function projectIdFromRequest(request: Request): string | null {
  try {
    const url = new URL(request.url)
    if (url.protocol !== 'media:' || url.hostname !== 'project') return null
    const encodedId = url.pathname.replace(/^\//, '')
    if (!encodedId || encodedId.includes('/')) return null
    const id = decodeURIComponent(encodedId)
    return id && !id.includes('/') && !id.includes('\\') ? id : null
  } catch {
    return null
  }
}

/**
 * Creates an Electron `protocol.handle` callback for local project media.
 * The response deliberately implements byte ranges because Chromium seeks
 * through large MP4 files (and reads an end-of-file `moov` atom) with Range.
 */
export function createMediaProtocolHandler(loadProject: MediaProjectLoader): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plainResponse('Method not allowed', 405, { Allow: 'GET, HEAD' })
    }

    const id = projectIdFromRequest(request)
    if (!id) return notFound()

    let project: MediaProject
    try {
      project = await loadProject(id)
    } catch {
      return notFound()
    }

    const filePath = project.source.kind === 'local' ? project.source.localMediaPath : undefined
    if (!filePath) return notFound()

    let fileStats
    try {
      fileStats = await stat(filePath)
    } catch {
      return notFound()
    }
    if (!fileStats.isFile()) return notFound()

    const baseHeaders = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': contentType(filePath),
      'Last-Modified': fileStats.mtime.toUTCString()
    })
    const rangeHeader = request.headers.get('range')
    const range = rangeHeader ? parseSingleByteRange(rangeHeader, fileStats.size) : null

    if (rangeHeader && !range) {
      baseHeaders.set('Content-Range', `bytes */${fileStats.size}`)
      baseHeaders.set('Content-Length', '0')
      return new Response(null, { status: 416, headers: baseHeaders })
    }

    const start = range?.start ?? 0
    const end = range?.end ?? Math.max(0, fileStats.size - 1)
    const length = range ? end - start + 1 : fileStats.size
    baseHeaders.set('Content-Length', String(length))
    if (range) baseHeaders.set('Content-Range', `bytes ${start}-${end}/${fileStats.size}`)

    if (request.method === 'HEAD' || length === 0) {
      return new Response(null, { status: range ? 206 : 200, headers: baseHeaders })
    }

    const fileStream = createReadStream(filePath, { start, end })
    const body = Readable.toWeb(fileStream) as unknown as ReadableStream<Uint8Array>
    return new Response(body, { status: range ? 206 : 200, headers: baseHeaders })
  }
}
