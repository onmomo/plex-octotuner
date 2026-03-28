import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createBridgeRuntime } from '../../server/lib/runtime'

const samplePlaylist = readFileSync(new URL('../fixtures/m3u/sample.m3u', import.meta.url), 'utf8')
const sampleUpdatedPlaylist = readFileSync(new URL('../fixtures/m3u/sample-updated.m3u', import.meta.url), 'utf8')

const validEnv = {
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C'
}

describe('runtime refresh', () => {
  it('runs scheduled refreshes and keeps the last good lineup when a refresh fails', async () => {
    vi.useFakeTimers()

    const fetchPlaylist = vi.fn()
      .mockResolvedValueOnce(samplePlaylist)
      .mockResolvedValueOnce(sampleUpdatedPlaylist)
    const logger = { info: vi.fn(), error: vi.fn() }

    const runtime = await createBridgeRuntime({
      env: validEnv,
      fetchPlaylist,
      logger,
      probeDeviceIdCollision: async () => false
    })

    await vi.advanceTimersByTimeAsync(300_000)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

    fetchPlaylist.mockRejectedValueOnce(new Error('upstream down'))
    await vi.advanceTimersByTimeAsync(300_000)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('playlist refresh failed'), expect.any(Error))

    await runtime.stop()
    vi.useRealTimers()
  })
})
