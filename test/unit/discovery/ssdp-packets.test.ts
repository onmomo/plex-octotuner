import { describe, expect, it } from 'vitest'
import { loadBridgeConfig } from '../../../server/lib/config'
import { buildDeviceUdn } from '../../../server/lib/hdhr/device-identity'
import { buildSsdpNotify, buildSsdpSearchResponse } from '../../../server/lib/discovery/ssdp-packets'

const config = loadBridgeConfig({
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C'
})

describe('SSDP packet builders', () => {
  it('builds a root-device notify payload with the required discovery headers', () => {
    const expectedUdn = buildDeviceUdn(config.deviceId)
    const packet = buildSsdpNotify(config)

    expect(packet).toContain('NOTIFY * HTTP/1.1')
    expect(packet).toContain('HOST: 239.255.255.250:1900')
    expect(packet).toContain('NT: upnp:rootdevice')
    expect(packet).toContain('NTS: ssdp:alive')
    expect(packet).toContain('CACHE-CONTROL: max-age=')
    expect(packet).toContain('SERVER: ')
    expect(packet).toContain(`USN: ${expectedUdn}::upnp:rootdevice`)
    expect(packet).toContain('LOCATION: http://192.168.1.50:34400/dri/device.xml')
  })

  it('builds a search response for upnp root-device lookups', () => {
    const expectedUdn = buildDeviceUdn(config.deviceId)
    const packet = buildSsdpSearchResponse(config, 'upnp:rootdevice')

    expect(packet).toContain('HTTP/1.1 200 OK')
    expect(packet).toContain('ST: upnp:rootdevice')
    expect(packet).toContain('CACHE-CONTROL: max-age=')
    expect(packet).toContain('SERVER: ')
    expect(packet).toContain(`USN: ${expectedUdn}::upnp:rootdevice`)
    expect(packet).toContain('LOCATION: http://192.168.1.50:34400/dri/device.xml')
  })

  it('builds a search response for ssdp:all lookups using the same advertised device identity', () => {
    const expectedUdn = buildDeviceUdn(config.deviceId)
    const packet = buildSsdpSearchResponse(config, 'ssdp:all')

    expect(packet).toContain('ST: ssdp:all')
    expect(packet).toContain(`USN: ${expectedUdn}::upnp:rootdevice`)
    expect(packet).toContain('LOCATION: http://192.168.1.50:34400/dri/device.xml')
  })
})
