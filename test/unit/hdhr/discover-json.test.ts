import { describe, expect, it } from 'vitest'
import { buildDiscoverJson, type DiscoverJsonInput } from '../../../server/lib/hdhr/discover-json'

describe('buildDiscoverJson', () => {
  it('serializes the HDHomeRun discovery contract', () => {
    const config: DiscoverJsonInput = {
      friendlyName: 'octotuner',
      deviceId: '105A1B22',
      deviceAuth: 'octotuner-105A1B22',
      advertisedBaseUrl: new URL('http://192.168.1.50:34400'),
      tunerCount: 4
    }

    expect(buildDiscoverJson(config)).toEqual({
      FriendlyName: 'octotuner',
      Manufacturer: 'Silicondust',
      ModelNumber: 'HDTC-2US',
      FirmwareName: 'hdhomeruntc_atsc',
      FirmwareVersion: '20150826',
      DeviceID: '105A1B22',
      DeviceAuth: 'octotuner-105A1B22',
      BaseURL: 'http://192.168.1.50:34400',
      LineupURL: 'http://192.168.1.50:34400/lineup.json',
      TunerCount: 4
    })
  })
})
