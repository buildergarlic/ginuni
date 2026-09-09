import { afterEach, describe, expect, it, vi } from 'vitest'
import { youtubeEmbedUrl } from '../src/renderer/src/App'
import { youtubeApiMessage } from '../src/renderer/src/youtube-seek'

afterEach(() => vi.unstubAllGlobals())

describe('YouTube iframe API transport', () => {
  // A wrong/missing channel prevents the actual YouTube player from responding.
  it('uses the widget channel and consistent player ID for both handshake and commands', () => {
    expect(JSON.parse(youtubeApiMessage({ event: 'listening' }))).toEqual({
      event: 'listening', id: 'screen-description-player', channel: 'widget'
    })
    expect(JSON.parse(youtubeApiMessage({ event: 'command', func: 'seekTo', args: [10.5, true] }))).toEqual({
      event: 'command', func: 'seekTo', args: [10.5, true], id: 'screen-description-player', channel: 'widget'
    })
  })

  // A fabricated web origin does not match the desktop file parent and blocks messages.
  it.each(['file://', 'null'])('omits origin restrictions for a desktop file parent with origin %s', (origin) => {
    vi.stubGlobal('window', { location: { protocol: 'file:', host: '', origin, href: 'file:///C:/app/index.html' } })
    const parameters = new URL(youtubeEmbedUrl('M7lc1UVf-VE')).searchParams
    expect(parameters.get('enablejsapi')).toBe('1')
    expect(parameters.has('origin')).toBe(false)
    expect(parameters.has('widget_referrer')).toBe(false)
  })

  it('restricts messages to the real HTTP parent origin in development', () => {
    vi.stubGlobal('window', { location: new URL('http://localhost:5173/review') })
    const parameters = new URL(youtubeEmbedUrl('M7lc1UVf-VE')).searchParams
    expect(parameters.get('origin')).toBe('http://localhost:5173')
  })
})
