import type { BridgeConfig } from './config'
import { loadBridgeConfig } from './config'
import { ChannelStore } from './channels/store'
import { fetchM3U } from './m3u-fetch'
import { probeDeviceIdCollision } from './discovery/device-id-probe'

type DiscoveryHandle = {
  stop: () => Promise<void> | void
}

type CleanupRegistration = () => Promise<void> | void

export type BridgeLogger = {
  info(message: string, context?: unknown): void
  error(message: string, error?: unknown): void
  warn?(message: string, context?: unknown): void
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
  startDiscovery?: (
    runtime: BridgeRuntime,
    registerCleanup: (cleanup: CleanupRegistration) => void
  ) => Promise<DiscoveryHandle>
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

function createStoreLogger(logger: BridgeLogger): { warn(message: string): void } {
  return {
    warn(message: string) {
      if (logger.warn) {
        logger.warn(message)
        return
      }

      logger.error(message)
    }
  }
}

export function startRefreshLoop(runtime: BridgeRuntime): () => Promise<void> {
  let stopped = false
  let refreshQueue = Promise.resolve()

  const enqueueRefresh = (): void => {
    refreshQueue = refreshQueue.then(async () => {
      if (stopped) {
        return
      }

      try {
        await runtime.store.refresh(() => runtime.fetchPlaylist(runtime.config.m3uUrl))
      } catch (error) {
        runtime.logger.error('playlist refresh failed', error)
      }
    })
  }

  const timer = setInterval(enqueueRefresh, runtime.config.playlistRefreshSeconds * 1000)

  return async () => {
    stopped = true
    clearInterval(timer)
    await refreshQueue
  }
}

export async function createBridgeRuntime(options: CreateRuntimeOptions): Promise<BridgeRuntime> {
  const config = loadBridgeConfig(options.env)
  const fetchPlaylist = options.fetchPlaylist ?? fetchM3U

  logStartupConfig(options.logger, config)

  let hasCollision = false
  try {
    if (options.probeDeviceIdCollision) {
      hasCollision = await options.probeDeviceIdCollision(config)
    } else {
      hasCollision = await probeDeviceIdCollision(config)
    }
  } catch (error) {
    options.logger.error('device id collision probe failed', error)
    throw error
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

  const store = new ChannelStore(createStoreLogger(options.logger))
  store.replaceFromRaw(rawPlaylist)

  if (store.getChannels().length === 0) {
    throw new Error('zero valid channels')
  }

  options.logger.info(`loaded ${store.getChannels().length} channels`)

  let discoveryHandle: DiscoveryHandle | undefined
  let stopPromise: Promise<void> | undefined
  let stopRefreshLoop: (() => Promise<void>) | undefined
  const startupCleanups: CleanupRegistration[] = []

  const registerCleanup = (cleanup: CleanupRegistration): void => {
    startupCleanups.push(cleanup)
  }

  const runtime: BridgeRuntime = {
    config,
    logger: options.logger,
    store,
    fetchPlaylist,
    stop: async () => {
      if (!stopPromise) {
        stopPromise = Promise.resolve().then(async () => {
          await stopRefreshLoop?.()
          await discoveryHandle?.stop()
        })
      }

      await stopPromise
    }
  }

  if (options.startDiscovery) {
    try {
      discoveryHandle = await options.startDiscovery(runtime, registerCleanup)
      startupCleanups.length = 0
    } catch (error) {
      for (const cleanup of startupCleanups.reverse()) {
        try {
          await cleanup()
        } catch (cleanupError) {
          options.logger.error('discovery startup cleanup failed', cleanupError)
        }
      }
      throw error
    }
  }

  stopRefreshLoop = startRefreshLoop(runtime)

  return runtime
}
