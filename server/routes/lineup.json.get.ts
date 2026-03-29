import { defineEventHandler } from 'h3'
import { buildLineup } from '../lib/hdhr/lineup'
import { getBridgeRuntime } from '../plugins/runtime.server'

export default defineEventHandler(async () => {
  const runtime = await getBridgeRuntime()

  return buildLineup(runtime.store.getChannels(), runtime.config.advertisedBaseUrl)
})
