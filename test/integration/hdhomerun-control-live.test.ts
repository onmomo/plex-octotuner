import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBridgeConfig } from '../../server/lib/config'
import { startDiscoveryServer } from '../../server/lib/discovery/server'
import { encodeHdhomerunVarLength, readHdhomerunVarLength } from '../../server/lib/discovery/hdhomerun-tlv'

const HDHOMERUN_TYPE_GETSET_REQ = 0x0004
const HDHOMERUN_TYPE_GETSET_RPY = 0x0005
const HDHOMERUN_TAG_GETSET_NAME = 0x03
const HDHOMERUN_TAG_GETSET_VALUE = 0x04

const config = loadBridgeConfig({
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://127.0.0.1:34400',
  HDHR_DEVICE_ID: '105A1B22'
})

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

function encodeTag(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeHdhomerunVarLength(value.length), value])
}

function buildGetSetRequest(name: string): Buffer {
  const payload = encodeTag(HDHOMERUN_TAG_GETSET_NAME, Buffer.from(`${name}\0`, 'utf8'))
  const frame = Buffer.alloc(4)
  frame.writeUInt16BE(HDHOMERUN_TYPE_GETSET_REQ, 0)
  frame.writeUInt16BE(payload.length, 2)

  const packet = Buffer.concat([frame, payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(calculateCrc32(packet), 0)

  return Buffer.concat([packet, crc])
}

function decodeGetSetReply(packet: Buffer): { frameType: number, name: string | null, value: string | null } {
  const frameType = packet.readUInt16BE(0)
  const payloadLength = packet.readUInt16BE(2)
  const payload = packet.subarray(4, 4 + payloadLength)
  let offset = 0
  let name: string | null = null
  let value: string | null = null

  while (offset < payload.length) {
    const tag = payload[offset]
    offset += 1

    const length = readHdhomerunVarLength(payload, offset)
    if (!length) {
      break
    }

    offset += length.byteLength
    const body = payload.subarray(offset, offset + length.value)
    offset += length.value

    const text = body.toString('utf8').replace(/\0+$/, '')
    if (tag === HDHOMERUN_TAG_GETSET_NAME) {
      name = text
    }
    if (tag === HDHOMERUN_TAG_GETSET_VALUE) {
      value = text
    }
  }

  return { frameType, name, value }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function reserveTcpPort(): Promise<number> {
  const server = createServer()
  await listen(server, 0)
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

function tcpGetSet(port: number, name: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = new (require('node:net').Socket)()

    socket.setTimeout(1000)
    socket.once('error', reject)
    socket.once('timeout', () => reject(new Error('timed out waiting for control reply')))
    socket.connect(port, '127.0.0.1', () => {
      socket.write(buildGetSetRequest(name))
    })
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const packet = Buffer.concat(chunks)
      if (packet.length >= 8) {
        const payloadLength = packet.readUInt16BE(2)
        const frameLength = 4 + payloadLength + 4
        if (packet.length >= frameLength) {
          socket.end()
          resolve(packet.subarray(0, frameLength))
        }
      }
    })
  })
}

describe('hdhomerun control live tcp responder', () => {
  let serversToClose: Array<{ stop: () => Promise<void> | void }> = []

  afterEach(async () => {
    while (serversToClose.length > 0) {
      await serversToClose.pop()?.stop()
    }
  })

  it('accepts TCP control requests on the default control port and answers GETSET metadata queries', async () => {
    const ssdpPort = await reserveTcpPort()
    const hdhomerunPort = await reserveTcpPort()
    const controlPort = await reserveTcpPort()
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const runtime = {
      config,
      logger,
      store: { getChannels: () => [] },
      fetchPlaylist: vi.fn(),
      stop: vi.fn()
    }

    const server = await startDiscoveryServer(
      runtime,
      undefined,
      {
        bindAddress: '127.0.0.1',
        ssdpPort,
        hdhomerunPort,
        controlPort
      } as any
    )
    serversToClose.push(server)

    const reply = await tcpGetSet(controlPort, '/sys/model')
    const decoded = decodeGetSetReply(reply)

    expect(decoded.frameType).toBe(HDHOMERUN_TYPE_GETSET_RPY)
    expect(decoded.name).toBe('/sys/model')
    expect(decoded.value).toBe('HDTC-2US')
  })
})
