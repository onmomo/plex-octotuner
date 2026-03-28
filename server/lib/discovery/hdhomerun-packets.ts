import type { BridgeConfig } from '../config'
import { encodeHdhomerunVarLength } from './hdhomerun-tlv'

const HDHOMERUN_TYPE_DISCOVER_RPY = 0x0003
const HDHOMERUN_TAG_DEVICE_TYPE = 0x01
const HDHOMERUN_TAG_DEVICE_ID = 0x02
const HDHOMERUN_TAG_TUNER_COUNT = 0x10
const HDHOMERUN_TAG_LINEUP_URL = 0x27
const HDHOMERUN_TAG_BASE_URL = 0x2A
const HDHOMERUN_DEVICE_TYPE_TUNER = 0x00000001

function encodeTag(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeHdhomerunVarLength(value.length), value])
}

function buildFrame(frameType: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header.writeUInt16BE(frameType, 0)
  header.writeUInt16BE(payload.length, 2)

  const packet = Buffer.concat([header, payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(calculateCrc32(packet), 0)

  return Buffer.concat([packet, crc])
}

function calculateCrc32(data: Buffer): number {
  let crc = 0xFFFFFFFF

  for (const byte of data) {
    const x = (crc ^ byte) & 0xFF
    crc >>>= 8

    if (x & 0x01) crc ^= 0x77073096
    if (x & 0x02) crc ^= 0xEE0E612C
    if (x & 0x04) crc ^= 0x076DC419
    if (x & 0x08) crc ^= 0x0EDB8832
    if (x & 0x10) crc ^= 0x1DB71064
    if (x & 0x20) crc ^= 0x3B6E20C8
    if (x & 0x40) crc ^= 0x76DC4190
    if (x & 0x80) crc ^= 0xEDB88320
  }

  return (crc ^ 0xFFFFFFFF) >>> 0
}

export function buildHdhomerunDiscoveryReply(config: BridgeConfig): Buffer {
  const baseUrl = config.advertisedBaseUrl.origin
  const deviceType = Buffer.alloc(4)
  deviceType.writeUInt32BE(HDHOMERUN_DEVICE_TYPE_TUNER, 0)

  const payload = Buffer.concat([
    encodeTag(HDHOMERUN_TAG_DEVICE_TYPE, deviceType),
    encodeTag(HDHOMERUN_TAG_DEVICE_ID, Buffer.from(config.deviceId, 'hex')),
    encodeTag(HDHOMERUN_TAG_BASE_URL, Buffer.from(baseUrl, 'utf8')),
    encodeTag(HDHOMERUN_TAG_LINEUP_URL, Buffer.from(`${baseUrl}/lineup.json`, 'utf8')),
    encodeTag(HDHOMERUN_TAG_TUNER_COUNT, Buffer.from([config.tunerCount]))
  ])

  return buildFrame(HDHOMERUN_TYPE_DISCOVER_RPY, payload)
}

export {
  HDHOMERUN_DEVICE_TYPE_TUNER,
  HDHOMERUN_TAG_BASE_URL,
  HDHOMERUN_TAG_DEVICE_ID,
  HDHOMERUN_TAG_DEVICE_TYPE,
  HDHOMERUN_TAG_LINEUP_URL,
  HDHOMERUN_TAG_TUNER_COUNT,
  HDHOMERUN_TYPE_DISCOVER_RPY
}
