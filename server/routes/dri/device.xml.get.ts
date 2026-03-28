import { defineEventHandler, setResponseHeader } from 'h3'
import { buildDeviceXml } from '../../lib/hdhr/device-xml'
import { getBridgeRuntime } from '../../plugins/runtime.server'

function buildDeviceUdn(deviceId: string): string {
  return `uuid:octotuner-${deviceId}`
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
