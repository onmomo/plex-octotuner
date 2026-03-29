import { defineEventHandler } from 'h3'
import { buildDiscoverJson } from '../lib/hdhr/discover-json'
import { getBridgeRuntime } from '../plugins/runtime.server'

export default defineEventHandler(async () => {
  const runtime = await getBridgeRuntime()

  return buildDiscoverJson({
    friendlyName: runtime.config.friendlyName,
    deviceId: runtime.config.deviceId,
    deviceAuth: runtime.config.deviceAuth,
    advertisedBaseUrl: runtime.config.advertisedBaseUrl,
    tunerCount: runtime.config.tunerCount
  })
})
