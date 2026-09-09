export type YouTubeCommand = { event: 'command'; func: 'seekTo' | 'pauseVideo'; args: (number | boolean)[] }

export function youtubeApiMessage(message: object): string {
  // YouTube's widget transport adds the same ID and widget channel to listening
  // and command packets. Keep this envelope centralized for every iframe send.
  // Verified against https://www.youtube.com/s/player/8c3fda2d/www-widgetapi.vflset/www-widgetapi.js
  return JSON.stringify({ ...message, id: 'screen-description-player', channel: 'widget' })
}

interface YouTubeSeekCallbacks {
  send(command: YouTubeCommand): void
  onTime(seconds: number): void
  onReady(): void
  onFailure(message: string): void
}

export function createYouTubeSeekController(callbacks: YouTubeSeekCallbacks) {
  let ready = false
  let playing = false
  let pending: { seconds: number; attempts: number; keepPaused: boolean } | null = null

  const sendPending = (): void => {
    if (!ready || !pending) return
    pending.attempts += 1
    callbacks.send({ event: 'command', func: 'seekTo', args: [pending.seconds, true] })
    // seekTo starts playback from cued/unstarted/ended states. Preserve the
    // writer's playback choice, including a click made before the first play.
    if (pending.keepPaused) callbacks.send({ event: 'command', func: 'pauseVideo', args: [] })
  }

  return {
    seek(seconds: number): void {
      if (!Number.isFinite(seconds)) return
      pending = { seconds: Math.max(0, seconds), attempts: 0, keepPaused: !playing }
      sendPending()
    },
    receive(message: unknown): void {
      if (!message || typeof message !== 'object') return
      const data = message as { event?: string; info?: unknown }
      const info = data.info && typeof data.info === 'object' ? data.info as Record<string, unknown> : undefined
      const state = data.event === 'onStateChange' ? data.info : info?.playerState
      if (state === 1) playing = true
      else if (state === -1 || state === 0 || state === 2 || state === 5) playing = false
      const seconds = info?.currentTime
      const hasTime = typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
      if (hasTime) {
        callbacks.onTime(seconds)
        // Only a time report after sending the request can acknowledge it.
        // A cached timestamp (especially the initial zero) cannot do that.
        if (pending && pending.attempts > 0 && Math.abs(seconds - pending.seconds) <= 0.8) pending = null
      }
      if (!ready && (data.event === 'onReady' || data.event === 'initialDelivery' || hasTime)) {
        ready = true
        callbacks.onReady()
        sendPending()
      }
    },
    tick(): void {
      if (!ready || !pending) return
      if (pending.attempts >= 4) {
        pending = null
        callbacks.onFailure('영상 탐색을 확인하지 못했습니다. 잠시 후 행을 다시 눌러 보세요.')
        return
      }
      sendPending()
    },
    reset(): void {
      ready = false
      playing = false
      if (pending) pending.attempts = 0
    }
  }
}
