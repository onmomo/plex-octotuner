import { describe, expect, it } from 'vitest'
import { loadBridgeConfig } from '../../../server/lib/config'
import { buildDeviceUdn } from '../../../server/lib/hdhr/device-identity'
import {
  buildSsdpNotifyPackets,
  buildSsdpSearchResponses
} from '../../../server/lib/discovery/ssdp-packets'

const config = loadBridgeConfig({
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B22'
})

describe('SSDP packet builders', () => {
  it('builds a single root-device notify payload in the xTeVe shape', () => {
    const expectedUdn = buildDeviceUdn(config.deviceId)

    expect(buildSsdpNotifyPackets(config)).toEqual([
      [
        'NOTIFY * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'NT: upnp:rootdevice',
        'NTS: ssdp:alive',
        `USN: ${expectedUdn}::upnp:rootdevice`,
        'LOCATION: http://192.168.1.50:34400/device.xml',
        'SERVER: xTeVe',
        'CACHE-CONTROL: max-age=1800',
        '',
        ''
      ].join('\r\n')
    ])
  })

  it('builds a search response for upnp root-device lookups', () => {
    const expectedUdn = buildDeviceUdn(config.deviceId)

    expect(buildSsdpSearchResponses(config, 'upnp:rootdevice')).toEqual([[
      'HTTP/1.1 200 OK',
      'EXT:',
      'ST: upnp:rootdevice',
      `USN: ${expectedUdn}::upnp:rootdevice`,
      'LOCATION: http://192.168.1.50:34400/device.xml',
      'SERVER: xTeVe',
      'CACHE-CONTROL: max-age=1800',
      '',
      ''
    ].join('\r\n')])
  })

  it('builds an xTeVe-style search response for ssdp:all lookups using the root-device identity', () => {
    const expectedUdn = buildDeviceUdn(config.deviceId)

    expect(buildSsdpSearchResponses(config, 'ssdp:all')).toEqual([[
      'HTTP/1.1 200 OK',
      'EXT:',
      'ST: upnp:rootdevice',
      `USN: ${expectedUdn}::upnp:rootdevice`,
      'LOCATION: http://192.168.1.50:34400/device.xml',
      'SERVER: xTeVe',
      'CACHE-CONTROL: max-age=1800',
      '',
      ''
    ].join('\r\n')])
  })
})
