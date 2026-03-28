import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createBridgeRuntime } from '../../server/lib/runtime'

const samplePlaylist = readFileSync(new URL('../fixtures/m3u/sample.m3u', import.meta.url), 'utf8')
const sampleUpdatedPlaylist = readFileSync(new URL('../fixtures/m3u/sample-updated.m3u', import.meta.url), 'utf8')

const validEnv = {
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C',
  PLAYLIST_REFRESH_SECONDS: '2'
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

describe('runtime refresh', () => {
  it('runs scheduled refreshes on the configured interval and keeps the last good lineup when a refresh fails', async () => {
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

    expect(fetchPlaylist).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchPlaylist).toHaveBeenCalledTimes(1)
    expect(runtime.store.getChannels()).toHaveLength(6)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPlaylist).toHaveBeenCalledTimes(2)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

    fetchPlaylist.mockRejectedValueOnce(new Error('upstream down'))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchPlaylist).toHaveBeenCalledTimes(3)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('playlist refresh failed'), expect.any(Error))

    await runtime.stop()
    vi.useRealTimers()
  })

  it('coalesces missed refresh ticks without backlogging them', async () => {
    vi.useFakeTimers()

    const slowRefresh = createDeferred<string>()
    const fetchPlaylist = vi.fn()
      .mockResolvedValueOnce(samplePlaylist)
      .mockImplementationOnce(() => slowRefresh.promise)
      .mockResolvedValueOnce(sampleUpdatedPlaylist)
      .mockResolvedValueOnce(sampleUpdatedPlaylist)
    const logger = { info: vi.fn(), error: vi.fn() }

    const runtime = await createBridgeRuntime({
      env: validEnv,
      fetchPlaylist,
      logger,
      probeDeviceIdCollision: async () => false
    })

    expect(fetchPlaylist).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchPlaylist).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(4_000)
    expect(fetchPlaylist).toHaveBeenCalledTimes(2)
    expect(runtime.store.getChannels()).toHaveLength(6)

    slowRefresh.resolve(sampleUpdatedPlaylist)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchPlaylist).toHaveBeenCalledTimes(3)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchPlaylist).toHaveBeenCalledTimes(3)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPlaylist).toHaveBeenCalledTimes(4)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

    await runtime.stop()
    vi.useRealTimers()
  })

  it('waits for an in-flight refresh to settle before stop resolves', async () => {
    vi.useFakeTimers()

    const slowRefresh = createDeferred<string>()
    const fetchPlaylist = vi.fn()
      .mockResolvedValueOnce(samplePlaylist)
      .mockImplementationOnce(() => slowRefresh.promise)
    const logger = { info: vi.fn(), error: vi.fn() }

    const runtime = await createBridgeRuntime({
      env: validEnv,
      fetchPlaylist,
      logger,
      probeDeviceIdCollision: async () => false
    })

    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchPlaylist).toHaveBeenCalledTimes(2)

    const stopPromise = runtime.stop()
    let stopSettled = false
    stopPromise.then(() => {
      stopSettled = true
    })

    await Promise.resolve()
    expect(stopSettled).toBe(false)

    await vi.advanceTimersByTimeAsync(4_000)
    expect(fetchPlaylist).toHaveBeenCalledTimes(2)

    slowRefresh.resolve(sampleUpdatedPlaylist)
    await stopPromise

    expect(stopSettled).toBe(true)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

    await vi.advanceTimersByTimeAsync(6_000)
    expect(fetchPlaylist).toHaveBeenCalledTimes(2)
    expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

    vi.useRealTimers()
  })

  it('does not arm the refresh loop after stop is called during startup', async () => {
    vi.useFakeTimers()

    const fetchPlaylist = vi.fn().mockResolvedValue(samplePlaylist)
    const stopDiscovery = vi.fn(async () => {})
    const logger = { info: vi.fn(), error: vi.fn() }

    const runtime = await createBridgeRuntime({
      env: validEnv,
      fetchPlaylist,
      logger,
      probeDeviceIdCollision: async () => false,
      startDiscovery: async (nextRuntime) => {
        void nextRuntime.stop()
        return { stop: stopDiscovery }
      }
    })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchPlaylist).toHaveBeenCalledTimes(1)

    await runtime.stop()
    expect(stopDiscovery).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
