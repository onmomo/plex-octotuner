import { createServer, type Server, type Socket } from 'node:net'
import { createSocket, type Socket as DatagramSocket } from 'node:dgram'
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeRuntime } from '../../server/lib/runtime'
import { createBridgeRuntime } from '../../server/lib/runtime'
import autoRoute from '../../server/routes/auto/[slug].get'

const { mockNitroApp } = vi.hoisted(() => ({
  mockNitroApp: {} as { localRuntime?: BridgeRuntime }
}))

vi.mock('nitropack/runtime', async () => {
  return {
    defineNitroPlugin: <T>(plugin: T) => plugin,
    useNitroApp: () => mockNitroApp
  }
})

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

function bindUdpSocket(socket: DatagramSocket, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(port, '127.0.0.1', () => {
      socket.off('error', reject)
      const address = socket.address()
      resolve(typeof address === 'object' ? address.port : 0)
    })
  })
}

async function reserveUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  const port = await bindUdpSocket(socket)
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return port
}

function buildRtspResponse(cseq: string, extraHeaders: string[], body = ''): string {
  const lines = [
    'RTSP/1.0 200 OK',
    `CSeq: ${cseq}`,
    ...extraHeaders
  ]

  if (body !== '') {
    lines.push(`Content-Length: ${Buffer.byteLength(body)}`)
  }

  return `${lines.join('\r\n')}\r\n\r\n${body}`
}

function buildTsPacket(byte = 0x11): Buffer {
  const packet = Buffer.alloc(188, byte)
  packet[0] = 0x47
  return packet
}

function buildRtpPacket(payload: Buffer, sequenceNumber = 1): Buffer {
  const header = Buffer.alloc(12)
  header[0] = 0x80
  header[1] = 33
  header.writeUInt16BE(sequenceNumber, 2)
  header.writeUInt32BE(0, 4)
  header.writeUInt32BE(1, 8)

  return Buffer.concat([header, payload])
}

function buildInterleavedFrame(channel: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header[0] = 0x24
  header[1] = channel
  header.writeUInt16BE(payload.length, 2)
  return Buffer.concat([header, payload])
}

describe('rtsp relay playback', () => {
  let upstreamServer: Server | undefined
  let runtime: BridgeRuntime | undefined
  let localFetch: ((path: string, init?: RequestInit & { redirect?: RequestRedirect }) => Promise<Response>) | undefined
  let logger: { info: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn> }
  const requests: string[] = []
  const requestTargets: string[] = []
  const requestHeaders: Array<Map<string, string>> = []

  beforeEach(async () => {
    requests.length = 0
    requestHeaders.length = 0

    const rtspPort = await reserveTcpPort()
    const aggregateUrl = `rtsp://127.0.0.1:${rtspPort}/stream?freq=354&msys=dvbc&sr=6900&mtype=64qam&pids=0,16,17,18,20,44,711,712,713&x_pmt=44`
    const trackUrl = `${aggregateUrl}/track1`
    const tsPayload = buildTsPacket()

    upstreamServer = createServer((socket) => {
      let buffer = Buffer.alloc(0)
      let clientRtpPort: number | undefined

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])

        while (true) {
          const headerEnd = buffer.indexOf('\r\n\r\n')
          if (headerEnd < 0) {
            return
          }

          const requestText = buffer.subarray(0, headerEnd).toString('utf8')
          buffer = buffer.subarray(headerEnd + 4)

          const [requestLine, ...headerLines] = requestText.split('\r\n')
          const [method, target] = requestLine.split(' ')
          const headers = new Map<string, string>()
          for (const line of headerLines) {
            const separator = line.indexOf(':')
            if (separator > 0) {
              headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
            }
          }

          const cseq = headers.get('cseq') ?? '1'
          requests.push(method)
          requestTargets.push(target ?? '')
          requestHeaders.push(headers)

          if (method === 'DESCRIBE') {
            const sdp = [
              'v=0',
              'o=- 0 0 IN IP4 127.0.0.1',
              's=octopus',
              't=0 0',
              'a=control:*',
              'm=video 0 RTP/AVP 33',
              'c=IN IP4 0.0.0.0',
              'a=control:track1'
            ].join('\r\n')

            socket.write(buildRtspResponse(cseq, [
              'Content-Type: application/sdp'
            ], sdp))
            continue
          }

          if (method === 'SETUP') {
            const transport = headers.get('transport') ?? ''
            if (transport === 'RTP/AVP/TCP;unicast;interleaved=0-1') {
              socket.write([
                'RTSP/1.0 461 Unsupported Transport',
                `CSeq: ${cseq}`,
                '',
                ''
              ].join('\r\n'))
              continue
            }

            socket.write(buildRtspResponse(cseq, [
              'Session: 12345678',
              'Transport: RTP/AVP/TCP;interleaved=0-1'
            ]))
            continue
          }

          if (method === 'PLAY') {
            socket.write(buildRtspResponse(cseq, [
              'Session: 12345678',
              'RTP-Info: url=' + trackUrl
            ]))
            socket.write(buildInterleavedFrame(0, buildRtpPacket(tsPayload)))
            socket.end()
            continue
          }
        }
      })
    })

    await listen(upstreamServer, rtspPort)

    logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const playlist = `#EXTM3U
#EXTINF:-1 tvg-chno="201",SUPER RTL HD CH
${aggregateUrl}`

    runtime = await createBridgeRuntime({
      env: {
        M3U_URL: 'http://octopus.local/playlist.m3u',
        ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
        HDHR_DEVICE_ID: '105A1B22'
      },
      fetchPlaylist: async () => playlist,
      logger,
      probeDeviceIdCollision: async () => false
    })

    mockNitroApp.localRuntime = runtime

    const app = createApp()
    const router = createRouter()
      .get('/auto/:slug', autoRoute)

    app.use(router.handler)
    const appFetch = toWebHandler(app)
    localFetch = async (path, init = {}) => appFetch(new Request(new URL(path, 'http://test.local'), init))
  })

  afterEach(async () => {
    mockNitroApp.localRuntime = undefined
    await runtime?.stop()
    await new Promise<void>((resolve) => upstreamServer?.close(() => resolve()) ?? resolve())
  })

  it('relays RTSP MPEG-TS channels over HTTP for Plex playback', async () => {
    const channelId = runtime?.store.getChannels()[0]?.id
    const response = await localFetch?.(`/auto/v${channelId}`)

    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toContain('video/mp2t')

    const body = Buffer.from(await response!.arrayBuffer())
    expect(body).toEqual(buildTsPacket())
    expect(requests).toEqual(['DESCRIBE', 'SETUP', 'SETUP', 'PLAY'])
    expect(requestTargets[1]).toContain('freq=')
    expect(requestTargets[1]).toContain('x_pmt=')
    expect(requestTargets[2]).toContain('freq=')
    expect(requestTargets[2]).toContain('x_pmt=')
    expect(requestTargets[3]).toContain('freq=')
    expect(requestTargets[3]).toContain('x_pmt=')
    expect(requestHeaders[1]?.get('transport')).toContain('RTP/AVP/TCP;unicast;interleaved=0-1')
    expect(requestHeaders[2]?.get('transport')).toContain('RTP/AVP/TCP;interleaved=0-1')
    expect(logger.info).toHaveBeenCalledWith('rtsp relay media started', expect.objectContaining({
      transport: 'tcp',
      upstreamUrl: expect.stringContaining('freq=354')
    }))
  })
})

describe('rtsp relay playback over udp transport', () => {
  let upstreamServer: Server | undefined
  let runtime: BridgeRuntime | undefined
  let localFetch: ((path: string, init?: RequestInit & { redirect?: RequestRedirect }) => Promise<Response>) | undefined
  let udpSender: DatagramSocket | undefined
  let logger: { info: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn> }
  const requests: string[] = []
  const requestTargets: string[] = []
  const requestHeaders: Array<Map<string, string>> = []

  beforeEach(async () => {
    requests.length = 0
    requestHeaders.length = 0

    const rtspPort = await reserveTcpPort()
    const serverRtpPort = await reserveUdpPort()
    const serverRtcpPort = await reserveUdpPort()
    const aggregateUrl = `rtsp://127.0.0.1:${rtspPort}/stream?freq=354&msys=dvbc&sr=6900&mtype=64qam&pids=0,16,17,18,20,44,711,712,713&x_pmt=44`
    const trackUrl = `${aggregateUrl}/track1`
    const tsPayload = buildTsPacket(0x22)

    udpSender = createSocket('udp4')

    upstreamServer = createServer((socket) => {
      let buffer = Buffer.alloc(0)
      let clientRtpPort: number | undefined

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])

        while (true) {
          const headerEnd = buffer.indexOf('\r\n\r\n')
          if (headerEnd < 0) {
            return
          }

          const requestText = buffer.subarray(0, headerEnd).toString('utf8')
          buffer = buffer.subarray(headerEnd + 4)

          const [requestLine, ...headerLines] = requestText.split('\r\n')
          const [method, target] = requestLine.split(' ')
          const headers = new Map<string, string>()
          for (const line of headerLines) {
            const separator = line.indexOf(':')
            if (separator > 0) {
              headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
            }
          }

          const cseq = headers.get('cseq') ?? '1'
          requests.push(method)
          requestTargets.push(target ?? '')
          requestHeaders.push(headers)

          if (method === 'DESCRIBE') {
            const sdp = [
              'v=0',
              'o=- 0 0 IN IP4 127.0.0.1',
              's=octopus',
              't=0 0',
              'a=control:*',
              'm=video 0 RTP/AVP 33',
              'c=IN IP4 0.0.0.0',
              'a=control:track1'
            ].join('\r\n')

            socket.write(buildRtspResponse(cseq, [
              'Content-Type: application/sdp'
            ], sdp))
            continue
          }

          if (method === 'SETUP') {
            const transport = headers.get('transport') ?? ''
            if (transport.includes('RTP/AVP/TCP')) {
              socket.write([
                'RTSP/1.0 461 Unsupported Transport',
                `CSeq: ${cseq}`,
                '',
                ''
              ].join('\r\n'))
              continue
            }

            const clientPorts = transport.match(/client_port=(\d+)-(\d+)/)
            clientRtpPort = Number.parseInt(clientPorts?.[1] ?? '', 10)

            socket.write(buildRtspResponse(cseq, [
              'Session: 12345678',
              `Transport: RTP/AVP;unicast;client_port=${clientPorts?.[1]}-${clientPorts?.[2]};server_port=${serverRtpPort}-${serverRtcpPort}`
            ]))
            continue
          }

          if (method === 'PLAY') {
            socket.write(buildRtspResponse(cseq, [
              'Session: 12345678',
              'RTP-Info: url=' + trackUrl
            ]))
            if (Number.isFinite(clientRtpPort)) {
              setTimeout(() => {
                void new Promise<void>((resolve, reject) => {
                  udpSender?.send(buildRtpPacket(tsPayload), clientRtpPort, '127.0.0.1', (error) => {
                    if (error) {
                      reject(error)
                      return
                    }

                    resolve()
                  })
                })
              }, 750)
            }
            socket.end()
            continue
          }
        }
      })
    })

    await listen(upstreamServer, rtspPort)

    logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const playlist = `#EXTM3U
#EXTINF:-1 tvg-chno="202",UDP SATIP Channel
${aggregateUrl}`

    runtime = await createBridgeRuntime({
      env: {
        M3U_URL: 'http://octopus.local/playlist.m3u',
        ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
        HDHR_DEVICE_ID: '105A1B22'
      },
      fetchPlaylist: async () => playlist,
      logger,
      probeDeviceIdCollision: async () => false
    })

    mockNitroApp.localRuntime = runtime

    const app = createApp()
    const router = createRouter()
      .get('/auto/:slug', autoRoute)

    app.use(router.handler)
    const appFetch = toWebHandler(app)
    localFetch = async (path, init = {}) => appFetch(new Request(new URL(path, 'http://test.local'), init))
  })

  afterEach(async () => {
    mockNitroApp.localRuntime = undefined
    await runtime?.stop()
    await new Promise<void>((resolve) => udpSender?.close(() => resolve()) ?? resolve())
    await new Promise<void>((resolve) => upstreamServer?.close(() => resolve()) ?? resolve())
  })

  it('relays RTSP MPEG-TS channels when the server chooses UDP transport', async () => {
    const channelId = runtime?.store.getChannels()[0]?.id
    const response = await localFetch?.(`/auto/v${channelId}`)

    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toContain('video/mp2t')

    const reader = response?.body?.getReader()
    const chunk = await reader?.read()
    await reader?.cancel()

    expect(Buffer.from(chunk?.value ?? new Uint8Array())).toEqual(buildTsPacket(0x22))
    expect(requests).toEqual(['DESCRIBE', 'SETUP', 'SETUP', 'SETUP', 'PLAY'])
    expect(requestTargets[1]).toContain('freq=')
    expect(requestTargets[1]).toContain('x_pmt=')
    expect(requestTargets[2]).toContain('freq=')
    expect(requestTargets[2]).toContain('x_pmt=')
    expect(requestTargets[3]).toContain('freq=')
    expect(requestTargets[3]).toContain('x_pmt=')
    expect(requestTargets[4]).toContain('freq=')
    expect(requestTargets[4]).toContain('x_pmt=')
    expect(requestHeaders[1]?.get('transport')).toContain('RTP/AVP/TCP;unicast;interleaved=0-1')
    expect(requestHeaders[2]?.get('transport')).toContain('RTP/AVP/TCP;interleaved=0-1')
    const setupTransport = requestHeaders[3]?.get('transport') ?? ''
    const clientPorts = setupTransport.match(/client_port=(\d+)-(\d+)/)
    expect(clientPorts).not.toBeNull()
    const rtpPort = Number.parseInt(clientPorts?.[1] ?? '', 10)
    const rtcpPort = Number.parseInt(clientPorts?.[2] ?? '', 10)
    expect(Number.isFinite(rtpPort)).toBe(true)
    expect(rtcpPort).toBe(rtpPort + 1)
    expect(logger.warn).toHaveBeenCalledWith('rtsp relay fell back to UDP transport', expect.objectContaining({
      upstreamUrl: expect.stringContaining('freq=354'),
      reason: expect.stringContaining('status 461')
    }))
    expect(logger.info).toHaveBeenCalledWith('rtsp relay media started', expect.objectContaining({
      transport: 'udp'
    }))
  })

  it('reorders a short out-of-order RTP burst before streaming MPEG-TS', async () => {
    await new Promise<void>((resolve) => upstreamServer?.close(() => resolve()) ?? resolve())

    const rtspPort = await reserveTcpPort()
    const serverRtpPort = await reserveUdpPort()
    const serverRtcpPort = await reserveUdpPort()
    const aggregateUrl = `rtsp://127.0.0.1:${rtspPort}/stream?freq=354&msys=dvbc&sr=6900&mtype=64qam&pids=0,16,17,18,20,44,711,712,713&x_pmt=44`
    const trackUrl = `${aggregateUrl}/track1`
    const firstTsPayload = buildTsPacket(0x31)
    const secondTsPayload = buildTsPacket(0x32)
    const thirdTsPayload = buildTsPacket(0x33)

    upstreamServer = createServer((socket) => {
      let buffer = Buffer.alloc(0)
      let clientRtpPort: number | undefined

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])

        while (true) {
          const headerEnd = buffer.indexOf('\r\n\r\n')
          if (headerEnd < 0) {
            return
          }

          const requestText = buffer.subarray(0, headerEnd).toString('utf8')
          buffer = buffer.subarray(headerEnd + 4)

          const [requestLine, ...headerLines] = requestText.split('\r\n')
          const [method] = requestLine.split(' ')
          const headers = new Map<string, string>()
          for (const line of headerLines) {
            const separator = line.indexOf(':')
            if (separator > 0) {
              headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
            }
          }

          const cseq = headers.get('cseq') ?? '1'

          if (method === 'DESCRIBE') {
            const sdp = [
              'v=0',
              'o=- 0 0 IN IP4 127.0.0.1',
              's=octopus',
              't=0 0',
              'a=control:*',
              'm=video 0 RTP/AVP 33',
              'c=IN IP4 0.0.0.0',
              'a=control:track1'
            ].join('\r\n')

            socket.write(buildRtspResponse(cseq, [
              'Content-Type: application/sdp'
            ], sdp))
            continue
          }

          if (method === 'SETUP') {
            const transport = headers.get('transport') ?? ''
            if (transport.includes('RTP/AVP/TCP')) {
              socket.write([
                'RTSP/1.0 461 Unsupported Transport',
                `CSeq: ${cseq}`,
                '',
                ''
              ].join('\r\n'))
              continue
            }

            const clientPorts = transport.match(/client_port=(\d+)-(\d+)/)
            clientRtpPort = Number.parseInt(clientPorts?.[1] ?? '', 10)

            socket.write(buildRtspResponse(cseq, [
              'Session: 12345678',
              `Transport: RTP/AVP;unicast;client_port=${clientPorts?.[1]}-${clientPorts?.[2]};server_port=${serverRtpPort}-${serverRtcpPort}`
            ]))
            continue
          }

          if (method === 'PLAY') {
            socket.write(buildRtspResponse(cseq, [
              'Session: 12345678',
              'RTP-Info: url=' + trackUrl
            ]))

            if (Number.isFinite(clientRtpPort)) {
              setTimeout(() => {
                void udpSender?.send(buildRtpPacket(firstTsPayload, 1), clientRtpPort!, '127.0.0.1')
              }, 10)
              setTimeout(() => {
                void udpSender?.send(buildRtpPacket(thirdTsPayload, 3), clientRtpPort!, '127.0.0.1')
              }, 20)
              setTimeout(() => {
                void udpSender?.send(buildRtpPacket(secondTsPayload, 2), clientRtpPort!, '127.0.0.1')
              }, 30)
            }

            socket.end()
            continue
          }
        }
      })
    })

    await listen(upstreamServer, rtspPort)

    runtime = await createBridgeRuntime({
      env: {
        M3U_URL: 'http://octopus.local/playlist.m3u',
        ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
        HDHR_DEVICE_ID: '105A1B22'
      },
      fetchPlaylist: async () => `#EXTM3U
#EXTINF:-1 tvg-chno="203",Reordered UDP Channel
${aggregateUrl}`,
      logger,
      probeDeviceIdCollision: async () => false
    })

    mockNitroApp.localRuntime = runtime

    const channelId = runtime?.store.getChannels()[0]?.id
    const response = await localFetch?.(`/auto/v${channelId}`)
    const reader = response?.body?.getReader()
    const chunks: Buffer[] = []
    let totalLength = 0

    while (totalLength < firstTsPayload.length + secondTsPayload.length + thirdTsPayload.length) {
      const chunk = await reader?.read()
      if (!chunk || chunk.done) {
        break
      }

      const chunkBuffer = Buffer.from(chunk.value)
      chunks.push(chunkBuffer)
      totalLength += chunkBuffer.length
    }

    await reader?.cancel()

    expect(Buffer.concat(chunks)).toEqual(Buffer.concat([firstTsPayload, secondTsPayload, thirdTsPayload]))
  })
})
