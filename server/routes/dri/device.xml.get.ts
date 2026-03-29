import { defineEventHandler, setResponseHeader } from 'h3'
import { buildDeviceXml } from '../../lib/hdhr/device-xml'
import { buildDeviceUdn } from '../../lib/hdhr/device-identity'
import { getBridgeRuntime } from '../../plugins/runtime.server'

export { buildDeviceUdn } from '../../lib/hdhr/device-identity'

export default defineEventHandler(async (event) => {
  const runtime = await getBridgeRuntime()

  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')

  return buildDeviceXml({
    friendlyName: runtime.config.friendlyName,
    serialNumber: runtime.config.deviceId,
    presentationUrl: runtime.config.advertisedBaseUrl,
    udn: buildDeviceUdn(runtime.config.deviceId)
  })
})
