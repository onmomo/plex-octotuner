import { defineEventHandler } from 'h3'
import { buildDiscoverJson } from '../lib/hdhr/discover-json'
import { getBridgeRuntime } from '../plugins/runtime.server'

const DEFAULT_TUNER_COUNT = 4

export default defineEventHandler(() => {
  const runtime = getBridgeRuntime()

  return buildDiscoverJson({
    friendlyName: runtime.config.friendlyName,
    deviceId: runtime.config.deviceId,
    deviceAuth: runtime.config.deviceAuth,
    advertisedBaseUrl: runtime.config.advertisedBaseUrl,
    tunerCount: DEFAULT_TUNER_COUNT
  })
})
