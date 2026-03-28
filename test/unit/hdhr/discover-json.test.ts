import { describe, expect, it } from 'vitest'
import { buildDiscoverJson } from '../../../server/lib/hdhr/discover-json'

describe('buildDiscoverJson', () => {
  it('serializes the HDHomeRun discovery contract', () => {
    const config = {
      friendlyName: 'octotuner',
      manufacturer: 'Silicondust',
      modelNumber: 'HDTC-2US',
      firmwareName: 'hdhomeruntc_atsc',
      firmwareVersion: '20150826',
      deviceId: '105A1B2C',
      deviceAuth: 'octotuner-105A1B2C',
      advertisedBaseUrl: new URL('http://192.168.1.50:34400'),
      tunerCount: 4
    }

    expect(buildDiscoverJson(config)).toMatchObject({
      FriendlyName: 'octotuner',
      Manufacturer: 'Silicondust',
      ModelNumber: 'HDTC-2US',
      FirmwareName: 'hdhomeruntc_atsc',
      FirmwareVersion: '20150826',
      DeviceID: '105A1B2C',
      DeviceAuth: 'octotuner-105A1B2C',
      BaseURL: 'http://192.168.1.50:34400',
      LineupURL: 'http://192.168.1.50:34400/lineup.json',
      TunerCount: 4
    })
  })
})
