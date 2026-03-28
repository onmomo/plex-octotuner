import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { startDiscoveryServer } from '../../server/lib/discovery/server'
import { createBridgeRuntime } from '../../server/lib/runtime'

const dgramMock = vi.hoisted(() => {
  type Handler = (...args: any[]) => void

  function createSocketRecord() {
    const handlers = new Map<string, Set<Handler>>()

    const addHandler = (event: string, handler: Handler): void => {
      const listeners = handlers.get(event) ?? new Set<Handler>()
      listeners.add(handler)
      handlers.set(event, listeners)
    }

    const removeHandler = (event: string, handler: Handler): void => {
      handlers.get(event)?.delete(handler)
    }

    const socket = {
      on: vi.fn((event: string, handler: Handler) => {
        addHandler(event, handler)
        return socket
      }),
      once: vi.fn((event: string, handler: Handler) => {
        const wrapped = (...args: any[]) => {
          removeHandler(event, wrapped)
          handler(...args)
        }

        addHandler(event, wrapped)
        return socket
      }),
      off: vi.fn((event: string, handler: Handler) => {
        removeHandler(event, handler)
        return socket
      }),
      bind: vi.fn((port: number, callback?: () => void) => {
        callback?.()
        return socket
      }),
      addMembership: vi.fn(),
      send: vi.fn((_message: string | Uint8Array, _port: number, _address: string, callback?: (error: Error | null) => void) => {
        callback?.(null)
        return socket
      }),
      close: vi.fn((callback?: () => void) => {
        callback?.()
      })
    }

    return { handlers, socket }
  }

  const state = {
    created: [] as ReturnType<typeof createSocketRecord>[],
    queue: [] as ReturnType<typeof createSocketRecord>[]
  }

  const reset = () => {
    state.created = []
    state.queue = [createSocketRecord(), createSocketRecord()]
  }

  reset()

  return {
    state,
    reset,
    createSocket: vi.fn(() => {
      const next = state.queue.shift()
      if (!next) {
        throw new Error('unexpected createSocket call')
      }

      state.created.push(next)
      return next.socket
    })
  }
})

vi.mock('node:dgram', () => ({
  createSocket: dgramMock.createSocket
}))

const samplePlaylist = readFileSync(new URL('../fixtures/m3u/sample.m3u', import.meta.url), 'utf8')
const invalidOnlyPlaylist = readFileSync(new URL('../fixtures/m3u/invalid-only.m3u', import.meta.url), 'utf8')

const validEnv = {
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C'
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

describe('createBridgeRuntime', () => {
  it('starts and stops the real discovery server within the runtime lifecycle', async () => {
    dgramMock.reset()

    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    const runtime = await createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false,
      startDiscovery: startDiscoveryServer
    })

    await runtime.stop()
    await runtime.stop()

    expect(dgramMock.createSocket).toHaveBeenCalledTimes(2)
    expect(dgramMock.state.created[0]?.socket.bind).toHaveBeenCalledWith(1900, expect.any(Function))
    expect(dgramMock.state.created[0]?.socket.addMembership).toHaveBeenCalledWith('239.255.255.250')
    expect(dgramMock.state.created[1]?.socket.bind).toHaveBeenCalledWith(65001, expect.any(Function))
    expect(dgramMock.state.created[0]?.socket.close).toHaveBeenCalledTimes(1)
    expect(dgramMock.state.created[1]?.socket.close).toHaveBeenCalledTimes(1)
  })

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

  it('stops the eventual discovery handle when stop is requested during discovery startup', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const startupGate = createDeferred<void>()
    const stop = vi.fn(async () => {})
    let stopDuringStartup: Promise<void> | undefined

    const runtimePromise = createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false,
      startDiscovery: async (nextRuntime) => {
        stopDuringStartup = nextRuntime.stop()
        await startupGate.promise
        return { stop }
      }
    })

    await Promise.resolve()
    startupGate.resolve()

    const runtime = await runtimePromise
    await stopDuringStartup

    expect(stop).toHaveBeenCalledTimes(1)

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

  it('runs multiple partial-startup cleanups in reverse order', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const cleanupOrder: string[] = []
    const startError = new Error('discovery failed after multiple allocations')
    const cleanupOne = vi.fn(async () => {
      cleanupOrder.push('one')
    })
    const cleanupTwo = vi.fn(async () => {
      cleanupOrder.push('two')
    })

    await expect(createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false,
      startDiscovery: async (_runtime, registerCleanup) => {
        registerCleanup(cleanupOne)
        registerCleanup(cleanupTwo)
        throw startError
      }
    })).rejects.toThrow(/discovery failed after multiple allocations/)

    expect(cleanupOrder).toEqual(['two', 'one'])
  })

  it('keeps the original discovery startup error when a cleanup callback also throws', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const cleanupOrder: string[] = []
    const startError = new Error('original discovery startup failure')
    const cleanupError = new Error('cleanup failed')
    const firstCleanup = vi.fn(async () => {
      cleanupOrder.push('first')
    })
    const secondCleanup = vi.fn(async () => {
      cleanupOrder.push('second')
      throw cleanupError
    })

    await expect(createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false,
      startDiscovery: async (_runtime, registerCleanup) => {
        registerCleanup(firstCleanup)
        registerCleanup(secondCleanup)
        throw startError
      }
    })).rejects.toThrow(/original discovery startup failure/)

    expect(cleanupOrder).toEqual(['second', 'first'])
  })
})
