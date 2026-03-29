import { describe, expect, it } from 'vitest'
import { buildDeviceXml } from '../../../server/lib/hdhr/device-xml'

describe('buildDeviceXml', () => {
  it('serializes the HDHomeRun device description XML contract', () => {
    const config = {
      friendlyName: 'octotuner',
      serialNumber: '105A1B22',
      presentationUrl: new URL('http://192.168.1.50:34400'),
      udn: 'uuid:105A1B22'
    }

    expect(buildDeviceXml(config)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <URLBase>http://192.168.1.50:34400</URLBase>
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>octotuner</friendlyName>
    <manufacturer>Silicondust</manufacturer>
    <modelName>HDTC-2US</modelName>
    <modelNumber>HDTC-2US</modelNumber>
    <serialNumber></serialNumber>
    <UDN>uuid:105A1B22</UDN>
  </device>
</root>
`)
  })

  it('escapes XML-sensitive characters in shared text fields', () => {
    const xml = buildDeviceXml({
      friendlyName: 'octo & <tuner>',
      serialNumber: '105A1B22',
      presentationUrl: new URL('http://192.168.1.50:34400'),
      udn: 'uuid:105A1B22'
    })

    expect(xml).toContain('<friendlyName>octo &amp; &lt;tuner&gt;</friendlyName>')
    expect(xml).toContain('<manufacturer>Silicondust</manufacturer>')
    expect(xml).toContain('<modelName>HDTC-2US</modelName>')
    expect(xml).not.toContain('<presentationURL>')
  })
})
