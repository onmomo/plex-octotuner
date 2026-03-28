import { defineEventHandler } from 'h3'
import { buildLineup } from '../lib/hdhr/lineup'
import { getBridgeRuntime } from '../plugins/runtime.server'

export default defineEventHandler(() => {
  const runtime = getBridgeRuntime()
  runtime.logger.info('lineup request')

  return buildLineup(runtime.store.getChannels(), runtime.config.advertisedBaseUrl)
})
