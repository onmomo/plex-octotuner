export type DeviceXmlInput = {
  friendlyName: string
  manufacturer: string
  modelName: string
  modelNumber: string
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
  const presentationUrl = new URL('/', input.presentationUrl).toString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>${escapeXml(input.friendlyName)}</friendlyName>
    <manufacturer>${escapeXml(input.manufacturer)}</manufacturer>
    <modelName>${escapeXml(input.modelName)}</modelName>
    <modelNumber>${escapeXml(input.modelNumber)}</modelNumber>
    <serialNumber>${escapeXml(input.serialNumber)}</serialNumber>
    <UDN>${escapeXml(input.udn)}</UDN>
    <presentationURL>${escapeXml(presentationUrl)}</presentationURL>
  </device>
</root>
`
}
