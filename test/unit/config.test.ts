import { describe, expect, it } from 'vitest'
import { loadBridgeConfig } from '../../server/lib/config'
import { createLogger } from '../../server/lib/logger'

describe('loadBridgeConfig', () => {
  it('throws when required env vars are missing', () => {
    expect(() => loadBridgeConfig({})).toThrow(/M3U_URL/)
  })

  it('applies safe defaults', () => {
    const config = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B2C'
    })

    expect(config.serverPort).toBe(34400)
    expect(config.friendlyName).toBe('octotuner')
    expect(config.playlistRefreshSeconds).toBe(300)
  })

  it('rejects mismatched advertised and bind ports', () => {
    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      SERVER_PORT: '3000',
      HDHR_DEVICE_ID: '105A1B2C'
    })).toThrow(/SERVER_PORT/)
  })

  it('defaults DeviceAuth from DeviceID and rejects invalid ids', () => {
    const config = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B2C'
    })

    expect(config.deviceAuth).toBe('octotuner-105A1B2C')
    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: 'not-valid'
    })).toThrow(/HDHR_DEVICE_ID/)
  })

  it('redacts sensitive URLs in startup logs', () => {
    const logger = createLogger()
    logger.info('bridge startup config', {
      m3uUrl: 'http://octopus.local/playlist.m3u?token=secret',
      upstreamUrl: 'http://octopus.local/stream/channel/1?descramble=1'
    })

    expect(logger.sink[0]).not.toContain('token=secret')
    expect(logger.sink[0]).not.toContain('descramble=1')
  })
})
