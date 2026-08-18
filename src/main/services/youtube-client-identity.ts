import type { Session } from 'electron'
import { YOUTUBE_CLIENT_IDENTITY } from '@shared/constants'

/**
 * YouTube requires desktop/WebView embed clients to identify themselves with
 * an HTTP Referer. The public repository is a stable, non-secret identity for
 * this desktop application and does not expose a user's local file path.
 */
export { YOUTUBE_CLIENT_IDENTITY }

const YOUTUBE_REQUEST_FILTER = {
  urls: [
    'https://www.youtube.com/embed/*',
    'https://www.youtube-nocookie.com/embed/*'
  ]
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase()
  const headerName = Object.keys(headers).find((candidate) => candidate.toLowerCase() === lowerName)
  return headerName ? headers[headerName] : undefined
}

function isWebReferrer(value: string | undefined): boolean {
  if (!value) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function isYouTubeEmbedFrameRequest(url: string, resourceType: string): boolean {
  if (resourceType !== 'subFrame') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'www.youtube.com' || parsed.hostname === 'www.youtube-nocookie.com')
      && parsed.pathname.startsWith('/embed/')
  } catch {
    return false
  }
}

export function addYouTubeClientIdentity(headers: Record<string, string>): Record<string, string> {
  if (isWebReferrer(headerValue(headers, 'referer'))) return headers
  const withoutInvalidReferrer = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'referer')
  )
  return { ...withoutInvalidReferrer, Referer: YOUTUBE_CLIENT_IDENTITY }
}

export function installYouTubeClientIdentity(targetSession: Session): void {
  targetSession.webRequest.onBeforeSendHeaders(YOUTUBE_REQUEST_FILTER, (details, callback) => {
    if (!isYouTubeEmbedFrameRequest(details.url, details.resourceType)) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }
    callback({ requestHeaders: addYouTubeClientIdentity(details.requestHeaders) })
  })
}
