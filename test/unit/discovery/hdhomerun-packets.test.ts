import { describe, expect, it } from 'vitest'
import { loadBridgeConfig } from '../../../server/lib/config'
import { buildHdhomerunDiscoveryReply } from '../../../server/lib/discovery/hdhomerun-packets'

const HDHOMERUN_TYPE_DISCOVER_RPY = 0x0003
const HDHOMERUN_TAG_DEVICE_ID = 0x02
const HDHOMERUN_TAG_TUNER_COUNT = 0x10
const HDHOMERUN_TAG_LINEUP_URL = 0x27
const HDHOMERUN_TAG_BASE_URL = 0x2A

const config = loadBridgeConfig({
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C',
  HDHR_TUNER_COUNT: '4'
})

function readTagLength(packet: Buffer, offset: number) {
  const firstByte = packet[offset]
  if ((firstByte & 0x80) === 0) {
    return {
      byteLength: 1,
      value: firstByte
    }
  }

  return {
    byteLength: 2,
    value: (firstByte & 0x7F) | (packet[offset + 1] << 7)
  }
}

function decodeTags(packet: Buffer) {
  expect(packet.readUInt16BE(0)).toBe(HDHOMERUN_TYPE_DISCOVER_RPY)

  const payloadLength = packet.readUInt16BE(2)
  expect(packet.length).toBeGreaterThanOrEqual(4 + payloadLength)

  const decoded: Record<string, string | number> = {}
  let offset = 4
  const limit = 4 + payloadLength

  while (offset < limit) {
    const tag = packet[offset]
    const lengthInfo = readTagLength(packet, offset + 1)
    const valueOffset = offset + 1 + lengthInfo.byteLength
    const value = packet.subarray(valueOffset, valueOffset + lengthInfo.value)

    switch (tag) {
      case HDHOMERUN_TAG_DEVICE_ID:
        decoded.DeviceID = value.toString('hex').toUpperCase()
        break
      case HDHOMERUN_TAG_BASE_URL:
        decoded.BaseURL = value.toString('utf8')
        break
      case HDHOMERUN_TAG_LINEUP_URL:
        decoded.LineupURL = value.toString('utf8')
        break
      case HDHOMERUN_TAG_TUNER_COUNT:
        decoded.TunerCount = value.readUInt8(0)
        break
    }

    offset = valueOffset + lengthInfo.value
  }

  return decoded
}

describe('buildHdhomerunDiscoveryReply', () => {
  it('encodes the advertised discovery fields with HDHomeRun TLV framing', () => {
    const packet = buildHdhomerunDiscoveryReply(config)

    expect(decodeTags(packet)).toMatchObject({
      DeviceID: '105A1B2C',
      BaseURL: 'http://192.168.1.50:34400',
      LineupURL: 'http://192.168.1.50:34400/lineup.json',
      TunerCount: 4
    })
  })
})
