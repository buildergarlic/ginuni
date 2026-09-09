import { describe, expect, it } from 'vitest'
import { createYouTubeSeekController, type YouTubeCommand } from '../src/renderer/src/youtube-seek'

function player() {
  const commands: YouTubeCommand[] = []
  const times: number[] = []
  const failures: string[] = []
  let readyCount = 0
  const controller = createYouTubeSeekController({
    send: (command) => commands.push(command),
    onTime: (seconds) => times.push(seconds),
    onReady: () => { readyCount += 1 },
    onFailure: (message) => failures.push(message)
  })
  return { controller, commands, times, failures, readyCount: () => readyCount }
}

describe('YouTube row seeking', () => {
  // Losing a pending request before readiness would make this fail.
  it('keeps only the latest row click until the player is ready, even after a long load', () => {
    const { controller, commands } = player()
    controller.seek(12)
    controller.seek(31.25)
    for (let i = 0; i < 20; i++) controller.tick()
    expect(commands).toEqual([])
    controller.receive({ event: 'onReady' })
    expect(commands).toEqual([
      { event: 'command', func: 'seekTo', args: [31.25, true] },
      { event: 'command', func: 'pauseVideo', args: [] }
    ])
  })

  // Optimistic onTime or cached-time acknowledgement would make this fail.
  it('reports actual time and requires a fresh acknowledgement when seeking back to zero', () => {
    const { controller, commands, times } = player()
    controller.receive({ event: 'infoDelivery', info: { currentTime: 0, playerState: 2 } })
    controller.seek(0)
    expect(times).toEqual([0])
    controller.tick()
    expect(commands.filter((command) => command.func === 'seekTo')).toHaveLength(2)
    controller.receive({ event: 'infoDelivery', info: { currentTime: 0, playerState: 2 } })
    controller.tick()
    expect(commands.filter((command) => command.func === 'seekTo')).toHaveLength(2)
    controller.seek(20)
    expect(times).toEqual([0, 0])
    controller.receive({ event: 'infoDelivery', info: { currentTime: 20, playerState: 2 } })
    expect(times).toEqual([0, 0, 20])
  })

  // An unconditional pause command would interrupt playback here.
  it('allows an already playing video to continue playing when a row is clicked', () => {
    const { controller, commands } = player()
    controller.receive({ event: 'infoDelivery', info: { currentTime: 2, playerState: 1 } })
    controller.seek(12)
    expect(commands).toEqual([{ event: 'command', func: 'seekTo', args: [12, true] }])
  })

  // Ignoring state events would resume playback after a native pause.
  it('preserves a native pause reported separately from the time update', () => {
    const { controller, commands } = player()
    controller.receive({ event: 'infoDelivery', info: { currentTime: 2, playerState: 1 } })
    controller.receive({ event: 'onStateChange', info: 2 })
    controller.seek(12)
    expect(commands).toEqual([
      { event: 'command', func: 'seekTo', args: [12, true] },
      { event: 'command', func: 'pauseVideo', args: [] }
    ])
  })

  // Reusing the old pending target on a retry would make this fail.
  it('retries the latest request and surfaces a failure when no time acknowledgement arrives', () => {
    const { controller, commands, failures } = player()
    controller.receive({ event: 'onReady' })
    controller.seek(12)
    controller.seek(26)
    for (let i = 0; i < 10; i++) controller.tick()
    const targets = commands.filter((command) => command.func === 'seekTo').map((command) => command.args[0])
    expect(targets).toEqual([12, 26, 26, 26, 26])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('탐색')
  })

  // Clearing the pending request on an iframe fallback would drop a writer's click.
  it('replays an unconfirmed request after the iframe reloads', () => {
    const { controller, commands, readyCount } = player()
    controller.receive({ event: 'onReady' })
    controller.seek(14)
    controller.reset()
    controller.tick()
    expect(commands.filter((command) => command.func === 'seekTo')).toHaveLength(1)
    controller.receive({ event: 'initialDelivery', info: { currentTime: 0, playerState: -1 } })
    expect(commands.filter((command) => command.func === 'seekTo').map((command) => command.args[0])).toEqual([14, 14])
    expect(readyCount()).toBe(2)
  })
})
