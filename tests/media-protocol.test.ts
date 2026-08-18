import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMediaProtocolHandler } from '@main/services/media-protocol'

describe('media protocol', () => {
  let directory: string
  let mediaPath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'screen-script-media-'))
    mediaPath = join(directory, '테스트 영상.MP4')
    await writeFile(mediaPath, Buffer.from('0123456789'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function handler() {
    return createMediaProtocolHandler(async (id) => {
      if (id !== 'project-1') throw new Error('missing')
      return { source: { kind: 'local', localMediaPath: mediaPath } }
    })
  }

  it('streams the full file with its media headers', async () => {
    const response = await handler()(new Request('media://project/project-1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-length')).toBe('10')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('0123456789')
  })

  it.each([
    ['bytes=2-5', 'bytes 2-5/10', '2345'],
    ['bytes=7-', 'bytes 7-9/10', '789'],
    ['bytes=-3', 'bytes 7-9/10', '789'],
    ['bytes=8-99', 'bytes 8-9/10', '89'],
    ['BYTES=0-0', 'bytes 0-0/10', '0']
  ])('serves one byte range: %s', async (requested, expectedRange, expectedBody) => {
    const response = await handler()(new Request('media://project/project-1', {
      headers: { Range: requested }
    }))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(expectedRange)
    expect(response.headers.get('content-length')).toBe(String(expectedBody.length))
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(expectedBody)
  })

  it.each([
    'bytes=10-',
    'bytes=5-2',
    'bytes=-0',
    'bytes=',
    'bytes=0-1,3-4',
    'items=0-1'
  ])('returns 416 for an unsatisfiable or unsupported range: %s', async (requested) => {
    const response = await handler()(new Request('media://project/project-1', {
      headers: { Range: requested }
    }))

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
    expect(response.headers.get('content-length')).toBe('0')
    expect(await response.text()).toBe('')
  })

  it('answers HEAD without opening a response body', async () => {
    const response = await handler()(new Request('media://project/project-1', { method: 'HEAD' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('10')
    expect(await response.text()).toBe('')
  })

  it('rejects unsupported methods and inaccessible projects', async () => {
    const post = await handler()(new Request('media://project/project-1', { method: 'POST' }))
    const missing = await handler()(new Request('media://project/missing'))
    const malformed = await handler()(new Request('media://project/a%2Fb'))

    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
    expect(missing.status).toBe(404)
    expect(malformed.status).toBe(404)
  })
})
