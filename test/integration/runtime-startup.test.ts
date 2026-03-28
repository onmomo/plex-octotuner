import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createBridgeRuntime } from '../../server/lib/runtime'

const samplePlaylist = readFileSync(new URL('../fixtures/m3u/sample.m3u', import.meta.url), 'utf8')
const invalidOnlyPlaylist = readFileSync(new URL('../fixtures/m3u/invalid-only.m3u', import.meta.url), 'utf8')

const validEnv = {
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C'
}

describe('createBridgeRuntime', () => {
  it('loads startup config and initial channels', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    const runtime = await createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false
    })

    expect(runtime.store.getChannels()).toEqual([
      expect.objectContaining({ name: 'Quoted Comma Channel' }),
      expect.objectContaining({ name: 'Das Erste HD' }),
      expect.objectContaining({ name: 'ZDF HD' }),
      expect.objectContaining({ name: 'alpha Channel' }),
      expect.objectContaining({ name: 'Zulu Channel' }),
      expect.objectContaining({ name: 'Ärger Channel' })
    ])
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('bridge startup config'))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('loaded 6 channels'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped duplicate channel'))

    await runtime.stop()
  })

  it('fails fast on invalid config before fetching the playlist', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const fetchPlaylist = vi.fn(async () => samplePlaylist)

    await expect(createBridgeRuntime({
      env: { ...validEnv, M3U_URL: undefined },
      fetchPlaylist,
      logger
    })).rejects.toThrow(/M3U_URL/)

    expect(fetchPlaylist).not.toHaveBeenCalled()
  })

  it('logs and surfaces initial playlist fetch failures', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    await expect(createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => {
        throw new Error('fetch failed')
      },
      logger,
      probeDeviceIdCollision: async () => false
    })).rejects.toThrow(/fetch failed/)

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('playlist fetch failed'), expect.any(Error))
  })

  it('fails startup when the initial playlist produces zero valid channels', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    await expect(createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => invalidOnlyPlaylist,
      logger,
      probeDeviceIdCollision: async () => false
    })).rejects.toThrow(/zero valid channels/i)
  })

  it('fails startup when the configured device id collides on the local network', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    await expect(createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => true
    })).rejects.toThrow(/HDHR_DEVICE_ID/)
  })

  it('logs and aborts startup when the device id probe throws', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const probeError = new Error('bind EPERM 0.0.0.0')

    await expect(createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => {
        throw probeError
      }
    })).rejects.toThrow(/bind EPERM/)

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('device id collision probe failed'), probeError)
  })

  it('passes the created runtime into discovery startup and stop delegates safely', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const stop = vi.fn(async () => {})
    let startedRuntime: Awaited<ReturnType<typeof createBridgeRuntime>> | undefined

    const runtime = await createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false,
      startDiscovery: async (nextRuntime) => {
        startedRuntime = nextRuntime
        return { stop }
      }
    })

    expect(startedRuntime).toBe(runtime)
    expect(startedRuntime?.store.getChannels()).toHaveLength(6)

    await runtime.stop()
    await runtime.stop()

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('surfaces discovery startup failures after runtime setup is assembled', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const startError = new Error('discovery failed')
    const seenRuntime = vi.fn()

    await expect(createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false,
      startDiscovery: async (runtime) => {
        seenRuntime({
          deviceId: runtime.config.deviceId,
          channelCount: runtime.store.getChannels().length,
          logger: runtime.logger
        })
        throw startError
      }
    })).rejects.toThrow(/discovery failed/)

    expect(seenRuntime).toHaveBeenCalledWith({
      deviceId: '105A1B2C',
      channelCount: 6,
      logger
    })
  })

  it('cleans up partially initialized discovery resources when startup throws before returning a handle', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const cleanup = vi.fn(async () => {})
    const startError = new Error('discovery failed after allocation')

    await expect(createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false,
      startDiscovery: async (_runtime, registerCleanup) => {
        registerCleanup(cleanup)
        throw startError
      }
    })).rejects.toThrow(/discovery failed after allocation/)

    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
