import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeRuntime } from '../../server/lib/runtime'

const {
  createBridgeRuntimeMock,
  createLoggerMock,
  mockNitroApp,
  startDiscoveryServerMock
} = vi.hoisted(() => ({
  createBridgeRuntimeMock: vi.fn(),
  createLoggerMock: vi.fn(),
  mockNitroApp: {} as { localRuntime?: BridgeRuntime },
  startDiscoveryServerMock: vi.fn()
}))

vi.mock('../../server/lib/runtime', () => ({
  createBridgeRuntime: createBridgeRuntimeMock
}))

vi.mock('../../server/lib/discovery/server', () => ({
  startDiscoveryServer: startDiscoveryServerMock
}))

vi.mock('../../server/lib/logger', () => ({
  createLogger: createLoggerMock
}))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: <T>(plugin: T) => plugin,
  useNitroApp: () => mockNitroApp
}))

import runtimePlugin from '../../server/plugins/runtime.server'
import { getBridgeRuntime } from '../../server/plugins/runtime.server'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

describe('runtime Nitro plugin', () => {
  beforeEach(() => {
    createBridgeRuntimeMock.mockReset()
    createLoggerMock.mockReset()
    startDiscoveryServerMock.mockReset()
    delete mockNitroApp.localRuntime
    delete (mockNitroApp as { localRuntimeReady?: Promise<BridgeRuntime> }).localRuntimeReady
    delete (mockNitroApp as { hooks?: unknown }).hooks
  })

  it('creates and attaches the bridge runtime at startup and stops it on close', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), sink: [] }
    const stop = vi.fn(async () => {})
    const runtime = { stop } as BridgeRuntime
    let closeHook: (() => Promise<void>) | undefined

    createLoggerMock.mockReturnValue(logger)
    createBridgeRuntimeMock.mockResolvedValue(runtime)

    const nitroApp = Object.assign(mockNitroApp, {
      hooks: {
        hookOnce(name: string, handler: () => Promise<void>) {
          if (name === 'close') {
            closeHook = handler
          }
        }
      }
    })

    await runtimePlugin(nitroApp as never)

    expect(createLoggerMock).toHaveBeenCalledTimes(1)
    expect(createBridgeRuntimeMock).toHaveBeenCalledWith({
      env: process.env,
      logger,
      startDiscovery: startDiscoveryServerMock
    })
    expect((nitroApp as { localRuntime?: BridgeRuntime }).localRuntime).toBe(runtime)

    await closeHook?.()

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('waits for runtime startup when a request asks for the bridge runtime early', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), sink: [] }
    const deferred = createDeferred<BridgeRuntime>()
    const runtime = { stop: vi.fn(async () => {}) } as BridgeRuntime

    createLoggerMock.mockReturnValue(logger)
    createBridgeRuntimeMock.mockReturnValue(deferred.promise)

    const nitroApp = Object.assign(mockNitroApp, {
      hooks: {
        hookOnce() {}
      }
    })

    const pluginPromise = runtimePlugin(nitroApp as never)
    const runtimePromise = getBridgeRuntime()

    let resolved = false
    void runtimePromise.then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    deferred.resolve(runtime)

    await expect(runtimePromise).resolves.toBe(runtime)
    await pluginPromise
    expect((nitroApp as { localRuntime?: BridgeRuntime }).localRuntime).toBe(runtime)
  })
})
