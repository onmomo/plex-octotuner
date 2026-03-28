import { describe, expect, it } from 'vitest'
import { buildDeviceXml } from '../../../server/lib/hdhr/device-xml'

describe('buildDeviceXml', () => {
  it('serializes the HDHomeRun device description XML contract', () => {
    const config = {
      friendlyName: 'octotuner',
      serialNumber: '105A1B2C',
      presentationUrl: new URL('http://192.168.1.50:34400'),
      udn: 'uuid:octotuner-105A1B2C'
    }

    expect(buildDeviceXml(config)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>octotuner</friendlyName>
    <manufacturer>Silicondust</manufacturer>
    <modelName>HDHomeRun DRI</modelName>
    <modelNumber>HDTC-2US</modelNumber>
    <serialNumber>105A1B2C</serialNumber>
    <UDN>uuid:octotuner-105A1B2C</UDN>
    <presentationURL>http://192.168.1.50:34400/</presentationURL>
  </device>
</root>
`)
  })

  it('escapes XML-sensitive characters in shared text fields', () => {
    const xml = buildDeviceXml({
      friendlyName: 'octo & <tuner>',
      serialNumber: '105A1B2C',
      presentationUrl: new URL('http://192.168.1.50:34400'),
      udn: 'uuid:octotuner-105A1B2C'
    })

    expect(xml).toContain('<friendlyName>octo &amp; &lt;tuner&gt;</friendlyName>')
    expect(xml).toContain('<manufacturer>Silicondust</manufacturer>')
    expect(xml).toContain('<modelName>HDHomeRun DRI</modelName>')
  })
})
