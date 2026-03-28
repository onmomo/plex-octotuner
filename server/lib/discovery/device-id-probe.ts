import { createSocket } from 'node:dgram'
import type { BridgeConfig } from '../config'
import { readHdhomerunVarLength } from './hdhomerun-tlv'

type DiscoveredDevice = {
  deviceId: string
}

const HDHOMERUN_DISCOVERY_PORT = 65001
const HDHOMERUN_DISCOVERY_REQUEST = Buffer.from([
  0x00, 0x02,
  0x00, 0x00,
  0x00, 0x00,
  0x00, 0x00
])
const HDHOMERUN_TAG_DEVICE_ID = 0x02
const HDHOMERUN_TAG_GETSET_NAME = 0x03
const DEFAULT_PROBE_TIMEOUT_MS = 250

function readPacketLength(packet: Buffer): number {
  if (packet.length < 4) {
    return -1
  }

  return packet.readUInt16BE(2)
}

function parseDeviceId(packet: Buffer): string | null {
  const bodyLength = readPacketLength(packet)
  if (bodyLength < 0 || packet.length < 4 + bodyLength) {
    return null
  }

  let offset = 4
  const limit = 4 + bodyLength
  while (offset + 2 <= limit) {
    const tag = packet[offset]
    const lengthInfo = readHdhomerunVarLength(packet, offset + 1)
    if (!lengthInfo) {
      return null
    }

    const valueOffset = offset + 1 + lengthInfo.byteLength
    const length = lengthInfo.value

    if (valueOffset + length > limit) {
      return null
    }

    if (tag === HDHOMERUN_TAG_DEVICE_ID && length === 4) {
      return packet.subarray(valueOffset, valueOffset + length).toString('hex').toUpperCase()
    }

    offset = valueOffset + length
  }

  return null
}

export async function discoverLanDevices(timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<DiscoveredDevice[]> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    const devices = new Map<string, DiscoveredDevice>()
    let settled = false

    const finish = (callback: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      socket.close(callback)
    }

    socket.on('error', (error) => {
      finish(() => reject(error))
    })

    socket.on('message', (message) => {
      const deviceId = parseDeviceId(message)
      if (!deviceId) {
        return
      }

      devices.set(deviceId, { deviceId })
    })

    socket.bind(() => {
      socket.setBroadcast(true)
      socket.send(HDHOMERUN_DISCOVERY_REQUEST, HDHOMERUN_DISCOVERY_PORT, '255.255.255.255', (error) => {
        if (error) {
          finish(() => reject(error))
          return
        }

        setTimeout(() => {
          finish(() => resolve([...devices.values()]))
        }, timeoutMs)
      })
    })
  })
}

export async function probeDeviceIdCollision(
  config: BridgeConfig,
  discoverDevices: () => Promise<DiscoveredDevice[]> = discoverLanDevices
): Promise<boolean> {
  const devices = await discoverDevices()
  return devices.some((device) => device.deviceId === config.deviceId)
}

export { parseDeviceId, type DiscoveredDevice, HDHOMERUN_TAG_DEVICE_ID, HDHOMERUN_TAG_GETSET_NAME }
