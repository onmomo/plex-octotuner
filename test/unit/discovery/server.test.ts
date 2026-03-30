import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBridgeConfig } from '../../../server/lib/config'
import { buildHdhomerunDiscoveryReply } from '../../../server/lib/discovery/hdhomerun-packets'

const dgramMock = vi.hoisted(() => {
  type Handler = (...args: any[]) => void

  function createSocketRecord() {
    const handlers = new Map<string, Set<Handler>>()

    const addHandler = (event: string, handler: Handler): void => {
      const listeners = handlers.get(event) ?? new Set<Handler>()
      listeners.add(handler)
      handlers.set(event, listeners)
    }

    const removeHandler = (event: string, handler: Handler): void => {
      handlers.get(event)?.delete(handler)
    }

    const socket = {
      on: vi.fn((event: string, handler: Handler) => {
        addHandler(event, handler)
        return socket
      }),
      once: vi.fn((event: string, handler: Handler) => {
        const wrapped = (...args: any[]) => {
          removeHandler(event, wrapped)
          handler(...args)
        }

        addHandler(event, wrapped)
        return socket
      }),
      off: vi.fn((event: string, handler: Handler) => {
        removeHandler(event, handler)
        return socket
      }),
      bind: vi.fn((port: number, addressOrCallback?: string | (() => void), callback?: () => void) => {
        if (typeof addressOrCallback === 'function') {
          addressOrCallback()
        } else {
          callback?.()
        }
        return socket
      }),
      addMembership: vi.fn(),
      setMulticastInterface: vi.fn(),
      send: vi.fn((_message: string | Uint8Array, _port: number, _address: string, callback?: (error: Error | null) => void) => {
        callback?.(null)
        return socket
      }),
      close: vi.fn((callback?: () => void) => {
        callback?.()
      })
    }

    return { handlers, socket }
  }

  const state = {
    created: [] as ReturnType<typeof createSocketRecord>[],
    queue: [] as ReturnType<typeof createSocketRecord>[]
  }

  const reset = () => {
    state.created = []
    state.queue = [createSocketRecord(), createSocketRecord()]
  }

  reset()

  return {
    state,
    reset,
    createSocket: vi.fn(() => {
      const next = state.queue.shift()
      if (!next) {
        throw new Error('unexpected createSocket call')
      }

      state.created.push(next)
      return next.socket
    })
  }
})

vi.mock('node:dgram', () => ({
  createSocket: dgramMock.createSocket
}))

import {
  handleHdhomerunDiscoveryRequest,
  handleSsdpMessage,
  sendStartupNotify,
  startDiscoveryServer
} from '../../../server/lib/discovery/server'
import { encodeHdhomerunVarLength } from '../../../server/lib/discovery/hdhomerun-tlv'

const config = loadBridgeConfig({
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B22'
})

const HDHOMERUN_TYPE_DISCOVER_REQ = 0x0002
const HDHOMERUN_TAG_DEVICE_TYPE = 0x01
const HDHOMERUN_TAG_DEVICE_ID = 0x02
const HDHOMERUN_TAG_MULTI_TYPE = 0x2D
const HDHOMERUN_DEVICE_TYPE_WILDCARD = 0xFFFFFFFF
const HDHOMERUN_DEVICE_TYPE_TUNER = 0x00000001
const HDHOMERUN_DEVICE_TYPE_STORAGE = 0x00000005
const HDHOMERUN_DEVICE_ID_WILDCARD = 0xFFFFFFFF

function calculateCrc32(data: Buffer): number {
  let crc = 0xFFFFFFFF

  for (const byte of data) {
    crc ^= byte

    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 1) !== 0) {
        crc = (crc >>> 1) ^ 0xEDB88320
      } else {
        crc >>>= 1
      }
    }
  }

  return (crc ^ 0xFFFFFFFF) >>> 0
}

function encodeTag(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeHdhomerunVarLength(value.length), value])
}

function buildDiscoverRequest(options: { deviceTypes: number[], deviceId?: number }): Buffer {
  const typePayload = options.deviceTypes.length === 1
    ? encodeTag(HDHOMERUN_TAG_DEVICE_TYPE, Buffer.from([
      (options.deviceTypes[0]! >>> 24) & 0xFF,
      (options.deviceTypes[0]! >>> 16) & 0xFF,
      (options.deviceTypes[0]! >>> 8) & 0xFF,
      options.deviceTypes[0]! & 0xFF
    ]))
    : encodeTag(HDHOMERUN_TAG_MULTI_TYPE, Buffer.concat(options.deviceTypes.map((deviceType) => Buffer.from([
      (deviceType >>> 24) & 0xFF,
      (deviceType >>> 16) & 0xFF,
      (deviceType >>> 8) & 0xFF,
      deviceType & 0xFF
    ]))))

  const deviceIdPayload = options.deviceId === undefined
    ? []
    : [encodeTag(HDHOMERUN_TAG_DEVICE_ID, Buffer.from([
      (options.deviceId >>> 24) & 0xFF,
      (options.deviceId >>> 16) & 0xFF,
      (options.deviceId >>> 8) & 0xFF,
      options.deviceId & 0xFF
    ]))]

  const payload = Buffer.concat([typePayload, ...deviceIdPayload])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(HDHOMERUN_TYPE_DISCOVER_REQ, 0)
  header.writeUInt16BE(payload.length, 2)
  const packet = Buffer.concat([header, payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(calculateCrc32(packet), 0)
  return Buffer.concat([packet, crc])
}

describe('discovery server responders', () => {
  beforeEach(() => {
    dgramMock.reset()
    dgramMock.createSocket.mockClear()
  })

  it('sends startup SSDP NOTIFY packets to the multicast endpoint', async () => {
    const send = vi.fn()

    await sendStartupNotify({ config, send })

    expect(send).toHaveBeenCalledWith(expect.stringContaining('NTS: ssdp:alive'), '239.255.255.250', 1900)
  })

  it('replies to supported SSDP M-SEARCH targets and ignores unrelated searches', async () => {
    const send = vi.fn()
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    await handleSsdpMessage({
      config,
      logger,
      message: Buffer.from('M-SEARCH * HTTP/1.1\r\nST: upnp:rootdevice\r\n\r\n'),
      remoteAddress: '192.168.1.20',
      remotePort: 54545,
      send
    })
    await handleSsdpMessage({
      config,
      logger,
      message: Buffer.from('M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n'),
      remoteAddress: '192.168.1.21',
      remotePort: 54546,
      send
    })
    await handleSsdpMessage({
      config,
      logger,
      message: Buffer.from('M-SEARCH * HTTP/1.1\r\nST: urn:ignored\r\n\r\n'),
      remoteAddress: '192.168.1.22',
      remotePort: 54547,
      send
    })

    expect(send).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ST: upnp:rootdevice'),
      '192.168.1.20',
      54545
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ST: upnp:rootdevice'),
      '192.168.1.21',
      54546
    )
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('replies to HDHomeRun discovery probes with the encoded discovery response', async () => {
    const send = vi.fn()
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    await handleHdhomerunDiscoveryRequest({
      config,
      logger,
      message: buildDiscoverRequest({
        deviceTypes: [HDHOMERUN_DEVICE_TYPE_TUNER],
        deviceId: HDHOMERUN_DEVICE_ID_WILDCARD
      }),
      remoteAddress: '192.168.1.30',
      remotePort: 65001,
      send
    })

    expect(send).toHaveBeenCalledWith(
      buildHdhomerunDiscoveryReply(config),
      '192.168.1.30',
      65001
    )
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('ignores discovery probes for unsupported device types or a different explicit device id', async () => {
    const send = vi.fn()
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    await handleHdhomerunDiscoveryRequest({
      config,
      logger,
      message: buildDiscoverRequest({
        deviceTypes: [HDHOMERUN_DEVICE_TYPE_STORAGE],
        deviceId: HDHOMERUN_DEVICE_ID_WILDCARD
      }),
      remoteAddress: '192.168.1.31',
      remotePort: 65001,
      send
    })

    await handleHdhomerunDiscoveryRequest({
      config,
      logger,
      message: buildDiscoverRequest({
        deviceTypes: [HDHOMERUN_DEVICE_TYPE_TUNER],
        deviceId: 0x105A1B24
      }),
      remoteAddress: '192.168.1.32',
      remotePort: 65001,
      send
    })

    expect(send).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('replies to multi-type discovery probes when tuner support is requested', async () => {
    const send = vi.fn()
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    await handleHdhomerunDiscoveryRequest({
      config,
      logger,
      message: buildDiscoverRequest({
        deviceTypes: [HDHOMERUN_DEVICE_TYPE_STORAGE, HDHOMERUN_DEVICE_TYPE_TUNER],
        deviceId: Number.parseInt(config.deviceId, 16)
      }),
      remoteAddress: '192.168.1.33',
      remotePort: 65001,
      send
    })

    expect(send).toHaveBeenCalledWith(
      buildHdhomerunDiscoveryReply(config),
      '192.168.1.33',
      65001
    )
  })

  it('binds both discovery sockets, joins SSDP multicast, and closes both sockets on stop', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const runtime = {
      config,
      logger,
      store: { getChannels: () => [] },
      fetchPlaylist: vi.fn(),
      stop: vi.fn()
    }

    const handle = await startDiscoveryServer(runtime, undefined, { startControl: false })

    expect(dgramMock.createSocket).toHaveBeenCalledTimes(2)
    expect(dgramMock.state.created[0]?.socket.bind).toHaveBeenCalledWith(1900, expect.any(Function))
    expect(dgramMock.state.created[0]?.socket.addMembership).toHaveBeenCalledWith('239.255.255.250', '192.168.1.50')
    expect(dgramMock.state.created[0]?.socket.setMulticastInterface).toHaveBeenCalledWith('192.168.1.50')
    expect(dgramMock.state.created[0]?.socket.send).toHaveBeenCalledWith(
      expect.stringContaining('NOTIFY * HTTP/1.1'),
      1900,
      '239.255.255.250',
      expect.any(Function)
    )
    expect(dgramMock.state.created[1]?.socket.bind).toHaveBeenCalledWith(65001, expect.any(Function))

    dgramMock.state.created[0]?.handlers.get('message')?.forEach((handler) => {
      handler(
        Buffer.from('M-SEARCH * HTTP/1.1\r\nST: upnp:rootdevice\r\n\r\n'),
        { address: '192.168.1.40', port: 45678 }
      )
    })
    dgramMock.state.created[1]?.handlers.get('message')?.forEach((handler) => {
      handler(
        buildDiscoverRequest({
          deviceTypes: [HDHOMERUN_DEVICE_TYPE_TUNER],
          deviceId: HDHOMERUN_DEVICE_ID_WILDCARD
        }),
        { address: '192.168.1.41', port: 65001 }
      )
    })

    expect(dgramMock.state.created[0]?.socket.send).toHaveBeenLastCalledWith(
      expect.stringContaining('ST: upnp:rootdevice'),
      45678,
      '192.168.1.40',
      expect.any(Function)
    )
    expect(dgramMock.state.created[1]?.socket.send).toHaveBeenCalledWith(
      buildHdhomerunDiscoveryReply(config),
      65001,
      '192.168.1.41',
      expect.any(Function)
    )

    await handle.stop()
    await handle.stop()

    expect(dgramMock.state.created[0]?.socket.close).toHaveBeenCalledTimes(1)
    expect(dgramMock.state.created[1]?.socket.close).toHaveBeenCalledTimes(1)
  })

  it('uses the selected ipv4 interface for SSDP multicast membership and outbound notify', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const runtime = {
      config,
      logger,
      store: { getChannels: () => [] },
      fetchPlaylist: vi.fn(),
      stop: vi.fn()
    }

    const handle = await startDiscoveryServer(
      runtime,
      undefined,
      { bindAddress: '192.168.1.77', startControl: false }
    )

    expect(dgramMock.state.created[0]?.socket.addMembership).toHaveBeenCalledWith('239.255.255.250', '192.168.1.77')
    expect(dgramMock.state.created[0]?.socket.setMulticastInterface).toHaveBeenCalledWith('192.168.1.77')

    await handle.stop()
  })

  it('falls back to default multicast routing when no usable ipv4 interface can be derived', async () => {
    const hostnameConfig = loadBridgeConfig({
      M3U_URL: 'http://octopus.local/playlist.m3u',
      ADVERTISED_BASE_URL: 'http://octopus.local:34400',
      HDHR_DEVICE_ID: '105A1B22'
    })
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const runtime = {
      config: hostnameConfig,
      logger,
      store: { getChannels: () => [] },
      fetchPlaylist: vi.fn(),
      stop: vi.fn()
    }

    const handle = await startDiscoveryServer(runtime, undefined, { startControl: false })

    expect(dgramMock.state.created[0]?.socket.addMembership).toHaveBeenCalledWith('239.255.255.250')
    expect(dgramMock.state.created[0]?.socket.setMulticastInterface).not.toHaveBeenCalled()

    await handle.stop()
  })

  it('fails fast when SSDP multicast membership cannot join the selected interface', async () => {
    const firstSocketRecord = dgramMock.state.queue[0]!
    const interfaceError = Object.assign(new Error('addMembership ENODEV'), { code: 'ENODEV' })
    firstSocketRecord.socket.addMembership.mockImplementationOnce(() => {
      throw interfaceError
    })

    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const runtime = {
      config,
      logger,
      store: { getChannels: () => [] },
      fetchPlaylist: vi.fn(),
      stop: vi.fn()
    }

    await expect(startDiscoveryServer(runtime, undefined, { startControl: false })).rejects.toThrow(
      'ssdp multicast join failed on interface 192.168.1.50: addMembership ENODEV'
    )
  })

  it('fails fast when multicast membership is unavailable on the default route too', async () => {
    const firstSocketRecord = dgramMock.state.queue[0]!
    const fallbackError = Object.assign(new Error('addMembership ENODEV'), { code: 'ENODEV' })
    firstSocketRecord.socket.addMembership.mockImplementationOnce(() => {
      throw fallbackError
    })

    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const runtime = {
      config: loadBridgeConfig({
        M3U_URL: 'http://octopus.local/playlist.m3u',
        ADVERTISED_BASE_URL: 'http://octopus.local:34400',
        HDHR_DEVICE_ID: '105A1B22'
      }),
      logger,
      store: { getChannels: () => [] },
      fetchPlaylist: vi.fn(),
      stop: vi.fn()
    }

    await expect(startDiscoveryServer(runtime, undefined, { startControl: false })).rejects.toThrow(
      'ssdp multicast join failed: addMembership ENODEV'
    )
  })

  it('honors test-only bind and startup options for live socket coverage', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const runtime = {
      config,
      logger,
      store: { getChannels: () => [] },
      fetchPlaylist: vi.fn(),
      stop: vi.fn()
    }

    const handle = await startDiscoveryServer(
      runtime,
      undefined,
      {
        bindAddress: '127.0.0.1',
        ssdpPort: 1901,
        hdhomerunPort: 65002,
        joinSsdpMulticast: false,
        startControl: false,
        startupNotify: false
      }
    )

    expect(dgramMock.state.created[0]?.socket.bind).toHaveBeenCalledWith(1901, '127.0.0.1', expect.any(Function))
    expect(dgramMock.state.created[0]?.socket.addMembership).not.toHaveBeenCalled()
    expect(dgramMock.state.created[0]?.socket.send).not.toHaveBeenCalled()
    expect(dgramMock.state.created[1]?.socket.bind).toHaveBeenCalledWith(65002, '127.0.0.1', expect.any(Function))

    await handle.stop()
  })
})
