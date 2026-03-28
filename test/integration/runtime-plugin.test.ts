import { describe, expect, it, vi } from 'vitest'
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

describe('runtime Nitro plugin', () => {
  it('creates and attaches the bridge runtime at startup and stops it on close', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), sink: [] }
    const stop = vi.fn(async () => {})
    const runtime = { stop } as BridgeRuntime
    let closeHook: (() => Promise<void>) | undefined

    createLoggerMock.mockReturnValue(logger)
    createBridgeRuntimeMock.mockResolvedValue(runtime)

    const nitroApp = {
      hooks: {
        hookOnce(name: string, handler: () => Promise<void>) {
          if (name === 'close') {
            closeHook = handler
          }
        }
      }
    }

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
})
