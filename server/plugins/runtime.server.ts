import { defineNitroPlugin, useNitroApp } from 'nitropack/runtime'
import { createLogger } from '../lib/logger'
import type { BridgeRuntime } from '../lib/runtime'
import { createBridgeRuntime } from '../lib/runtime'

type NitroAppWithRuntime = ReturnType<typeof useNitroApp> & {
  localRuntime?: BridgeRuntime
}

export function getBridgeRuntime(): BridgeRuntime {
  const nitroApp = useNitroApp() as NitroAppWithRuntime

  if (!nitroApp.localRuntime) {
    throw new Error('bridge runtime unavailable')
  }

  return nitroApp.localRuntime
}

export default defineNitroPlugin(async (nitroApp) => {
  const runtimeApp = nitroApp as NitroAppWithRuntime
  const logger = createLogger()

  runtimeApp.localRuntime = await createBridgeRuntime({
    env: process.env,
    logger
  })

  nitroApp.hooks.hookOnce('close', async () => {
    await runtimeApp.localRuntime?.stop?.()
  })
})
