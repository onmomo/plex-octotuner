import type { BridgeConfig } from './config'
import { loadBridgeConfig } from './config'
import { ChannelStore } from './channels/store'
import { fetchM3U } from './m3u-fetch'
import { probeDeviceIdCollision } from './discovery/device-id-probe'

type DiscoveryHandle = {
  stop: () => Promise<void> | void
}

export type BridgeLogger = {
  info(message: string, context?: unknown): void
  error(message: string, error?: unknown): void
}

export interface BridgeRuntime {
  config: BridgeConfig
  logger: BridgeLogger
  store: ChannelStore
  fetchPlaylist: (url: URL) => Promise<string>
  stop: () => Promise<void>
}

export interface CreateRuntimeOptions {
  env: Record<string, string | undefined>
  fetchPlaylist?: (url: URL) => Promise<string>
  logger: BridgeLogger
  startDiscovery?: (runtime: BridgeRuntime) => Promise<DiscoveryHandle>
  probeDeviceIdCollision?: (config: BridgeConfig) => Promise<boolean>
}

function logStartupConfig(logger: BridgeLogger, config: BridgeConfig): void {
  logger.info(`bridge startup config ${JSON.stringify({
    m3uUrl: config.m3uUrl.toString(),
    advertisedBaseUrl: config.advertisedBaseUrl.toString(),
    serverPort: config.serverPort,
    friendlyName: config.friendlyName,
    playlistRefreshSeconds: config.playlistRefreshSeconds,
    deviceId: config.deviceId
  })}`)
}

export async function createBridgeRuntime(options: CreateRuntimeOptions): Promise<BridgeRuntime> {
  const config = loadBridgeConfig(options.env)
  const fetchPlaylist = options.fetchPlaylist ?? fetchM3U

  logStartupConfig(options.logger, config)

  let hasCollision = false
  if (options.probeDeviceIdCollision) {
    hasCollision = await options.probeDeviceIdCollision(config)
  } else {
    try {
      hasCollision = await probeDeviceIdCollision(config)
    } catch (error) {
      options.logger.error('device id collision probe failed', error)
    }
  }

  if (hasCollision) {
    throw new Error('HDHR_DEVICE_ID collision on local network')
  }

  let rawPlaylist: string
  try {
    rawPlaylist = await fetchPlaylist(config.m3uUrl)
  } catch (error) {
    options.logger.error('playlist fetch failed', error)
    throw error
  }

  const store = new ChannelStore()
  store.replaceFromRaw(rawPlaylist)

  if (store.getChannels().length === 0) {
    throw new Error('zero valid channels')
  }

  options.logger.info(`loaded ${store.getChannels().length} channels`)

  let discoveryHandle: DiscoveryHandle | undefined

  const runtime: BridgeRuntime = {
    config,
    logger: options.logger,
    store,
    fetchPlaylist,
    stop: async () => {
      await discoveryHandle?.stop()
    }
  }

  if (options.startDiscovery) {
    discoveryHandle = await options.startDiscovery(runtime)
  }

  return runtime
}
