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
      bind: vi.fn((port: number, callback?: () => void) => {
        callback?.()
        return socket
      }),
      addMembership: vi.fn(),
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

const config = loadBridgeConfig({
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C'
})

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
      expect.stringContaining('ST: ssdp:all'),
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
      message: Buffer.from([0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      remoteAddress: '192.168.1.30',
      remotePort: 65001,
      send
    })

    expect(send).toHaveBeenCalledWith(
      buildHdhomerunDiscoveryReply(config),
      '192.168.1.30',
      65001
    )
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('hdhomerun discovery request'), {
      address: '192.168.1.30',
      port: 65001
    })
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

    const handle = await startDiscoveryServer(runtime)

    expect(dgramMock.createSocket).toHaveBeenCalledTimes(2)
    expect(dgramMock.state.created[0]?.socket.bind).toHaveBeenCalledWith(1900, expect.any(Function))
    expect(dgramMock.state.created[0]?.socket.addMembership).toHaveBeenCalledWith('239.255.255.250')
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
        Buffer.from([0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
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
})
