import { describe, expect, it } from 'vitest'
import { loadBridgeConfig } from '../../../server/lib/config'
import { HDHR_DEVICE_PROFILE } from '../../../server/lib/hdhr/profile'
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
    const serverHeader = `${HDHR_DEVICE_PROFILE.manufacturer}/${HDHR_DEVICE_PROFILE.firmwareVersion} UPnP/1.0 ${HDHR_DEVICE_PROFILE.modelNumber}/${HDHR_DEVICE_PROFILE.firmwareVersion}`

    expect(buildSsdpNotify(config)).toBe([
      'NOTIFY * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'NT: upnp:rootdevice',
      'NTS: ssdp:alive',
      'LOCATION: http://192.168.1.50:34400/dri/device.xml',
      'CACHE-CONTROL: max-age=1800',
      `SERVER: ${serverHeader}`,
      `USN: ${expectedUdn}::upnp:rootdevice`,
      '',
      ''
    ].join('\r\n'))
  })

  it('builds a search response for upnp root-device lookups', () => {
    const expectedUdn = buildDeviceUdn(config.deviceId)
    const serverHeader = `${HDHR_DEVICE_PROFILE.manufacturer}/${HDHR_DEVICE_PROFILE.firmwareVersion} UPnP/1.0 ${HDHR_DEVICE_PROFILE.modelNumber}/${HDHR_DEVICE_PROFILE.firmwareVersion}`

    expect(buildSsdpSearchResponse(config, 'upnp:rootdevice')).toBe([
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'EXT:',
      'LOCATION: http://192.168.1.50:34400/dri/device.xml',
      `SERVER: ${serverHeader}`,
      'ST: upnp:rootdevice',
      `USN: ${expectedUdn}::upnp:rootdevice`,
      '',
      ''
    ].join('\r\n'))
  })

  it('builds a search response for ssdp:all lookups using the same advertised device identity', () => {
    const expectedUdn = buildDeviceUdn(config.deviceId)
    const serverHeader = `${HDHR_DEVICE_PROFILE.manufacturer}/${HDHR_DEVICE_PROFILE.firmwareVersion} UPnP/1.0 ${HDHR_DEVICE_PROFILE.modelNumber}/${HDHR_DEVICE_PROFILE.firmwareVersion}`

    expect(buildSsdpSearchResponse(config, 'ssdp:all')).toBe([
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'EXT:',
      'LOCATION: http://192.168.1.50:34400/dri/device.xml',
      `SERVER: ${serverHeader}`,
      'ST: ssdp:all',
      `USN: ${expectedUdn}::upnp:rootdevice`,
      '',
      ''
    ].join('\r\n'))
  })
})
