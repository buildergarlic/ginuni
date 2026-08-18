import { describe, expect, it } from 'vitest'
import {
  addYouTubeClientIdentity,
  isYouTubeEmbedFrameRequest,
  YOUTUBE_CLIENT_IDENTITY
} from '@main/services/youtube-client-identity'

describe('addYouTubeClientIdentity', () => {
  it('adds the desktop application identity when Referer is absent', () => {
    expect(addYouTubeClientIdentity({ Accept: 'text/html' })).toEqual({
      Accept: 'text/html',
      Referer: YOUTUBE_CLIENT_IDENTITY
    })
  })

  it('preserves an existing Referer regardless of header-name casing', () => {
    const headers = { referer: 'https://www.youtube-nocookie.com/embed/example' }
    expect(addYouTubeClientIdentity(headers)).toBe(headers)
  })

  it('replaces a local file Referer that YouTube cannot use as client identity', () => {
    expect(addYouTubeClientIdentity({ referer: 'file:///C:/Program%20Files/app/index.html' })).toEqual({
      Referer: YOUTUBE_CLIENT_IDENTITY
    })
  })

  it('does not mutate the original request headers', () => {
    const headers = { Accept: 'text/html' }
    addYouTubeClientIdentity(headers)
    expect(headers).toEqual({ Accept: 'text/html' })
  })

  it('limits identity injection to YouTube embed frame navigation', () => {
    expect(isYouTubeEmbedFrameRequest('https://www.youtube-nocookie.com/embed/Hlbw6q9SvnQ?enablejsapi=1', 'subFrame')).toBe(true)
    expect(isYouTubeEmbedFrameRequest('https://www.youtube.com/embed/Hlbw6q9SvnQ', 'subFrame')).toBe(true)
    expect(isYouTubeEmbedFrameRequest('https://www.youtube.com/youtubei/v1/player', 'xhr')).toBe(false)
    expect(isYouTubeEmbedFrameRequest('https://evil.example/embed/Hlbw6q9SvnQ', 'subFrame')).toBe(false)
  })
})
