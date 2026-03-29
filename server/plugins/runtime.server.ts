import { defineNitroPlugin, useNitroApp } from 'nitropack/runtime'
import { startDiscoveryServer } from '../lib/discovery/server'
import { createLogger } from '../lib/logger'
import type { BridgeRuntime } from '../lib/runtime'
import { createBridgeRuntime } from '../lib/runtime'

type NitroAppWithRuntime = ReturnType<typeof useNitroApp> & {
  localRuntime?: BridgeRuntime
  localRuntimeReady?: Promise<BridgeRuntime>
}

export async function getBridgeRuntime(): Promise<BridgeRuntime> {
  const nitroApp = useNitroApp() as NitroAppWithRuntime

  if (nitroApp.localRuntime) {
    return nitroApp.localRuntime
  }

  if (nitroApp.localRuntimeReady) {
    return nitroApp.localRuntimeReady
  }

  if (!nitroApp.localRuntime) {
    throw new Error('bridge runtime unavailable')
  }

  return nitroApp.localRuntime
}

export default defineNitroPlugin(async (nitroApp) => {
  const runtimeApp = nitroApp as NitroAppWithRuntime
  const logger = createLogger()

  runtimeApp.localRuntimeReady = createBridgeRuntime({
    env: process.env,
    logger,
    startDiscovery: startDiscoveryServer
  })
  runtimeApp.localRuntime = await runtimeApp.localRuntimeReady

  nitroApp.hooks.hookOnce('close', async () => {
    await runtimeApp.localRuntime?.stop?.()
  })
})
