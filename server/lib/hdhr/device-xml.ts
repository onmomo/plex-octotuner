import { HDHR_DEVICE_PROFILE } from './profile'

export type DeviceXmlInput = {
  friendlyName: string
  serialNumber: string
  presentationUrl: URL
  udn: string
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildDeviceXml(input: DeviceXmlInput) {
  const baseUrl = input.presentationUrl.origin

  return `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <URLBase>${escapeXml(baseUrl)}</URLBase>
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>${escapeXml(input.friendlyName)}</friendlyName>
    <manufacturer>${escapeXml(HDHR_DEVICE_PROFILE.manufacturer)}</manufacturer>
    <modelName>${escapeXml(HDHR_DEVICE_PROFILE.modelName)}</modelName>
    <modelNumber>${escapeXml(HDHR_DEVICE_PROFILE.modelNumber)}</modelNumber>
    <serialNumber></serialNumber>
    <UDN>${escapeXml(input.udn)}</UDN>
  </device>
</root>
`
}
