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
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400'
    })

    expect(config.serverPort).toBe(34400)
    expect(config.friendlyName).toBe('octotuner')
    expect(config.playlistRefreshSeconds).toBe(300)
    expect(config.tunerCount).toBe(4)
    expect(config.deviceId).toBe('105A1B22')
    expect(config.deviceAuth).toBe('octotuner-105A1B22')
  })

  it('allows overriding the default HDHomeRun device id', () => {
    const config = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '10A1B2C7'
    })

    expect(config.deviceId).toBe('10A1B2C7')
    expect(config.deviceAuth).toBe('octotuner-10A1B2C7')
  })

  it('allows overriding the advertised HDHomeRun tuner count', () => {
    const config = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22',
      HDHR_TUNER_COUNT: '2'
    })

    expect(config.tunerCount).toBe(2)

    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22',
      HDHR_TUNER_COUNT: '0'
    })).toThrow(/HDHR_TUNER_COUNT/)
  })

  it('rejects tuner counts that cannot fit in the HDHomeRun discovery wire format', () => {
    const maxConfig = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22',
      HDHR_TUNER_COUNT: '255'
    })

    expect(maxConfig.tunerCount).toBe(255)

    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B2C',
      HDHR_TUNER_COUNT: '256'
    })).toThrow(/HDHR_TUNER_COUNT/)
  })

  it('rejects mismatched advertised and bind ports', () => {
    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      SERVER_PORT: '3000',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/SERVER_PORT/)
  })

  it('defaults DeviceAuth from DeviceID, honors explicit auth, and ignores friendly name', () => {
    const config = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22',
      HDHR_FRIENDLY_NAME: 'something-else'
    })

    expect(config.deviceAuth).toBe('octotuner-105A1B22')

    const explicitAuthConfig = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22',
      HDHR_DEVICE_AUTH: 'custom-auth',
      HDHR_FRIENDLY_NAME: 'something-else'
    })

    expect(explicitAuthConfig.deviceAuth).toBe('custom-auth')

    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: 'not-valid'
    })).toThrow(/HDHR_DEVICE_ID/)
  })

  it('rejects HDHomeRun device ids that fail the SiliconDust checksum', () => {
    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '10A1B2C3'
    })).toThrow(/HDHR_DEVICE_ID/)

    const config = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '10A1B2C7'
    })

    expect(config.deviceId).toBe('10A1B2C7')
  })

  it('rejects advertised base urls without an explicit port', () => {
    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/ADVERTISED_BASE_URL/)
  })

  it('rejects non-origin advertised base urls', () => {
    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://user:pass@192.168.1.50:34400/path?token=secret#frag',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/ADVERTISED_BASE_URL/)

    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: ' http://192.168.1.50:34400 ',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/ADVERTISED_BASE_URL/)
  })

  it('rejects unsupported url schemes', () => {
    expect(() => loadBridgeConfig({
      M3U_URL: 'ftp://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/M3U_URL/)

    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'ftp://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/ADVERTISED_BASE_URL/)
  })

  it('rejects non-strict numeric env values', () => {
    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      SERVER_PORT: '0x10',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/SERVER_PORT/)

    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      PLAYLIST_REFRESH_SECONDS: '1e3',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/PLAYLIST_REFRESH_SECONDS/)

    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      SERVER_PORT: ' 3000 ',
      HDHR_DEVICE_ID: '105A1B22'
    })).toThrow(/SERVER_PORT/)
  })

  it('rejects blank device auth overrides and accepts explicit non-empty auth', () => {
    expect(() => loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22',
      HDHR_DEVICE_AUTH: '   '
    })).toThrow(/HDHR_DEVICE_AUTH/)

    const config = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
      HDHR_DEVICE_ID: '105A1B22',
      HDHR_DEVICE_AUTH: 'custom-auth'
    })

    expect(config.deviceAuth).toBe('custom-auth')
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

  it('redacts embedded credentials and fragments in startup logs', () => {
    const logger = createLogger()
    logger.info('bridge startup config', {
      m3uUrl: 'http://user:pass@octopus.local/playlist.m3u#token',
      upstreamUrl: 'https://octopus.local/stream/channel/1?descramble=1#secret'
    })

    expect(logger.sink[0]).not.toContain('user:pass@')
    expect(logger.sink[0]).not.toContain('#token')
    expect(logger.sink[0]).not.toContain('#secret')
  })
})
