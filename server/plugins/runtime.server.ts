import { defineNitroPlugin, useNitroApp } from 'nitropack/runtime'
import type { BridgeRuntime } from '../lib/runtime'

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

  nitroApp.hooks.hookOnce('close', async () => {
    await runtimeApp.localRuntime?.stop?.()
  })
})
