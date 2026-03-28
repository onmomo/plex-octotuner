import { createSocket, type AddressInfo, type RemoteInfo, type Socket } from 'node:dgram'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBridgeConfig } from '../../server/lib/config'
import { buildHdhomerunDiscoveryReply } from '../../server/lib/discovery/hdhomerun-packets'
import { startDiscoveryServer } from '../../server/lib/discovery/server'

const config = loadBridgeConfig({
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://127.0.0.1:34400',
  HDHR_DEVICE_ID: '105A1B2C'
})

function bindSocket(socket: Socket, port = 0, address = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('error', onError)
      reject(error)
    }

    socket.once('error', onError)
    socket.bind(port, address, () => {
      socket.off('error', onError)
      resolve((socket.address() as AddressInfo).port)
    })
  })
}

function closeSocket(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.close(() => {
      resolve()
    })
  })
}

function reserveUdpPort(): Promise<number> {
  const socket = createSocket('udp4')

  return bindSocket(socket).then(async (port) => {
    await closeSocket(socket)
    return port
  })
}

function isPermissionError(error: unknown): boolean {
  return error instanceof Error && /\bEPERM\b|\bEACCES\b/.test(error.message)
}

async function canBindLoopbackUdp(): Promise<boolean> {
  const socket = createSocket('udp4')

  try {
    await bindSocket(socket)
    await closeSocket(socket)
    return true
  } catch (error) {
    try {
      await closeSocket(socket)
    } catch {
      // Ignore close failures while probing local UDP capability.
    }

    if (isPermissionError(error)) {
      return false
    }

    throw error
  }
}

const liveUdpIt = (await canBindLoopbackUdp()) ? it : it.skip

function sendMessage(socket: Socket, message: string | Uint8Array, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(message, port, '127.0.0.1', (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function waitForMessage(socket: Socket): Promise<{ message: Buffer, remote: RemoteInfo }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error('timed out waiting for UDP response'))
    }, 1000)

    const onMessage = (message: Buffer, remote: RemoteInfo) => {
      clearTimeout(timeout)
      socket.off('message', onMessage)
      resolve({ message, remote })
    }

    socket.on('message', onMessage)
  })
}

describe('discovery server live UDP responders', () => {
  const socketsToClose: Socket[] = []

  afterEach(async () => {
    while (socketsToClose.length > 0) {
      const socket = socketsToClose.pop()
      if (socket) {
        await closeSocket(socket)
      }
    }
  })

  liveUdpIt('responds to live SSDP and HDHomeRun discovery requests over UDP sockets', async () => {
    const ssdpPort = await reserveUdpPort()
    const hdhomerunPort = await reserveUdpPort()
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
        joinSsdpMulticast: false,
        startupNotify: false
      }
    )

    const ssdpClient = createSocket('udp4')
    socketsToClose.push(ssdpClient)
    await bindSocket(ssdpClient)
    const ssdpReply = waitForMessage(ssdpClient)

    await sendMessage(
      ssdpClient,
      Buffer.from('M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\nMAN: "ssdp:discover"\r\nMX: 1\r\n\r\n'),
      ssdpPort
    )

    const ssdpResponse = await ssdpReply
    expect(ssdpResponse.remote.port).toBe(ssdpPort)
    expect(ssdpResponse.message.toString('utf8')).toContain('HTTP/1.1 200 OK')
    expect(ssdpResponse.message.toString('utf8')).toContain('ST: ssdp:all')

    const hdhomerunClient = createSocket('udp4')
    socketsToClose.push(hdhomerunClient)
    await bindSocket(hdhomerunClient)
    const hdhomerunReply = waitForMessage(hdhomerunClient)

    await sendMessage(
      hdhomerunClient,
      Buffer.from([0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      hdhomerunPort
    )

    const hdhomerunResponse = await hdhomerunReply
    expect(hdhomerunResponse.remote.port).toBe(hdhomerunPort)
    expect(hdhomerunResponse.message).toEqual(buildHdhomerunDiscoveryReply(config))

    await server.stop()
  })
})
