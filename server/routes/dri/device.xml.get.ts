import { createHash } from 'node:crypto'
import { defineEventHandler, setResponseHeader } from 'h3'
import { buildDeviceXml } from '../../lib/hdhr/device-xml'
import { getBridgeRuntime } from '../../plugins/runtime.server'

export function buildDeviceUdn(deviceId: string): string {
  const hash = createHash('sha256').update(`octotuner:${deviceId}`).digest('hex')
  const versioned = `5${hash.slice(13, 16)}`
  const variantNibble = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)
  const variant = `${variantNibble}${hash.slice(17, 20)}`

  return `uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${versioned}-${variant}-${hash.slice(20, 32)}`
}

export default defineEventHandler((event) => {
  const runtime = getBridgeRuntime()

  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')

  return buildDeviceXml({
    friendlyName: runtime.config.friendlyName,
    serialNumber: runtime.config.deviceId,
    presentationUrl: runtime.config.advertisedBaseUrl,
    udn: buildDeviceUdn(runtime.config.deviceId)
  })
})
