import { createError, defineEventHandler, getRouterParam, sendRedirect, setResponseHeader } from 'h3'
import { getBridgeRuntime } from '../../plugins/runtime.server'

export default defineEventHandler(async (event) => {
  const runtime = await getBridgeRuntime()
  const slug = getRouterParam(event, 'slug')

  if (!slug?.startsWith('v')) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found' })
  }

  const channelId = slug.slice(1)
  const channel = runtime.store.getChannels().find((entry) => entry.id === channelId)

  if (!channel) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found' })
  }

  const upstreamUrl = new URL(channel.streamUrl)
  upstreamUrl.search = ''
  upstreamUrl.hash = ''

  runtime.logger.info('channel playback started', {
    channelId: channel.id,
    channelName: channel.name,
    upstreamUrl: upstreamUrl.toString()
  })

  setResponseHeader(event, 'cache-control', 'no-store')

  return sendRedirect(event, channel.streamUrl, 302)
})
