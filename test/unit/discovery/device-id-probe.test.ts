import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBridgeConfig } from '../../../server/lib/config'

const dgramMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>()
  const socket = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler)
      return socket
    }),
    bind: vi.fn((callback?: () => void) => {
      callback?.()
    }),
    setBroadcast: vi.fn(),
    send: vi.fn((_message: Buffer, _port: number, _host: string, callback?: (error?: Error | null) => void) => {
      callback?.(null)
    }),
    close: vi.fn((callback?: () => void) => {
      callback?.()
    })
  }

  return {
    handlers,
    socket,
    createSocket: vi.fn(() => socket)
  }
})

vi.mock('node:dgram', () => ({
  createSocket: dgramMock.createSocket
}))

import {
  discoverLanDevices,
  parseDeviceId,
  probeDeviceIdCollision
} from '../../../server/lib/discovery/device-id-probe'

const validEnv = {
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C'
}

function encodeVarLength(length: number): Buffer {
  if (length <= 0x7F) {
    return Buffer.from([length])
  }

  return Buffer.from([
    (length & 0x7F) | 0x80,
    length >> 7
  ])
}

function encodeTag(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeVarLength(value.length), value])
}

function buildDiscoveryPacket(deviceIdHex: string, precedingTags: Buffer[] = []): Buffer {
  const deviceIdBytes = Buffer.from(deviceIdHex, 'hex')
  const body = Buffer.concat([
    ...precedingTags,
    encodeTag(0x02, deviceIdBytes)
  ])
  const header = Buffer.from([0x00, 0x03, 0x00, body.length])
  return Buffer.concat([header, body])
}

describe('parseDeviceId', () => {
  it('extracts a device id from a discovery response packet', () => {
    expect(parseDeviceId(buildDiscoveryPacket('105A1B2C'))).toBe('105A1B2C')
  })

  it('returns null for truncated device id packets', () => {
    const packet = Buffer.from([0x00, 0x03, 0x00, 0x06, 0x02, 0x04, 0x10, 0x5A])

    expect(parseDeviceId(packet)).toBeNull()
  })

  it('extracts a device id after a preceding tag that uses a multi-byte var-length field', () => {
    const longBaseUrlTag = encodeTag(0x2A, Buffer.alloc(130, 0x61))

    expect(parseDeviceId(buildDiscoveryPacket('105A1B2C', [longBaseUrlTag]))).toBe('105A1B2C')
  })
})

describe('discoverLanDevices', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    dgramMock.handlers.clear()
    dgramMock.createSocket.mockClear()
    dgramMock.socket.on.mockClear()
    dgramMock.socket.bind.mockClear()
    dgramMock.socket.setBroadcast.mockClear()
    dgramMock.socket.send.mockClear()
    dgramMock.socket.close.mockClear()
    dgramMock.socket.send.mockImplementation((_message, _port, _host, callback) => {
      callback?.(null)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('listens on the udp socket and collects parsed device ids', async () => {
    const devicesPromise = discoverLanDevices(250)

    dgramMock.handlers.get('message')?.(buildDiscoveryPacket('105A1B2C'))
    dgramMock.handlers.get('message')?.(buildDiscoveryPacket('105A1B2C'))
    dgramMock.handlers.get('message')?.(Buffer.from([0x00, 0x03, 0x00, 0x01, 0xFF]))

    await vi.advanceTimersByTimeAsync(250)

    await expect(devicesPromise).resolves.toEqual([{ deviceId: '105A1B2C' }])
    expect(dgramMock.createSocket).toHaveBeenCalledWith('udp4')
    expect(dgramMock.socket.bind).toHaveBeenCalled()
    expect(dgramMock.socket.setBroadcast).toHaveBeenCalledWith(true)
    expect(dgramMock.socket.send).toHaveBeenCalledWith(expect.any(Buffer), 65001, '255.255.255.255', expect.any(Function))
    expect(dgramMock.socket.close).toHaveBeenCalled()
  })

  it('rejects when the udp socket reports an error', async () => {
    const devicesPromise = discoverLanDevices(250)
    const error = new Error('socket failed')

    dgramMock.handlers.get('error')?.(error)

    await expect(devicesPromise).rejects.toThrow(/socket failed/)
    expect(dgramMock.socket.close).toHaveBeenCalled()
  })
})

describe('probeDeviceIdCollision', () => {
  it('returns true when a discovered device uses the configured device id', async () => {
    const config = loadBridgeConfig(validEnv)

    await expect(
      probeDeviceIdCollision(config, async () => [{ deviceId: '105A1B2C' }])
    ).resolves.toBe(true)
  })

  it('returns false when no discovered device matches the configured device id', async () => {
    const config = loadBridgeConfig(validEnv)

    await expect(
      probeDeviceIdCollision(config, async () => [{ deviceId: 'FFFFFFFF' }])
    ).resolves.toBe(false)
  })
})
