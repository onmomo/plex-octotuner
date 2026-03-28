import { describe, expect, it } from 'vitest'
import { buildDeviceXml } from '../../../server/lib/hdhr/device-xml'

describe('buildDeviceXml', () => {
  it('serializes the HDHomeRun device description XML contract', () => {
    const config = {
      friendlyName: 'octotuner',
      manufacturer: 'Silicondust',
      modelName: 'HDHomeRun DRI',
      modelNumber: 'HDTC-2US',
      serialNumber: '105A1B2C',
      presentationUrl: new URL('http://192.168.1.50:34400'),
      udn: 'uuid:octotuner-105A1B2C'
    }

    const xml = buildDeviceXml(config)

    expect(xml).toContain('<serialNumber>105A1B2C</serialNumber>')
    expect(xml).toContain('<friendlyName>octotuner</friendlyName>')
    expect(xml).toContain('<presentationURL>http://192.168.1.50:34400/</presentationURL>')
    expect(xml).toContain('<UDN>uuid:')
  })
})
