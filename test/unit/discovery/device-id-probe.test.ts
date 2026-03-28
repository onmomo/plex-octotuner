import { describe, expect, it } from 'vitest'
import { loadBridgeConfig } from '../../../server/lib/config'
import { probeDeviceIdCollision } from '../../../server/lib/discovery/device-id-probe'

const validEnv = {
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C'
}

describe('probeDeviceIdCollision', () => {
  it('returns true when a discovered device uses the configured device id', async () => {
    const config = loadBridgeConfig(validEnv)

    await expect(
      probeDeviceIdCollision(config, async () => [{ deviceId: '105A1B2C' }])
    ).resolves.toBe(true)
  })

  it('returns false when no discovered device matches the configured device id', async () => {
    const config = loadBridgeConfig(validEnv)

    await expect(
      probeDeviceIdCollision(config, async () => [{ deviceId: 'FFFFFFFF' }])
    ).resolves.toBe(false)
  })
})
