import { createSocket, type Socket as DatagramSocket } from 'node:dgram'
import { connect as connectTcp, type Socket } from 'node:net'
import { PassThrough } from 'node:stream'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import { createError, sendStream, setResponseHeader, type H3Event } from 'h3'
import type { BridgeLogger } from './runtime'

type RtspSocket = Socket | TLSSocket

type RtspResponse = {
  statusCode: number
  headers: Map<string, string>
  body: Buffer
}

type RtspTrack = {
  setupUrl: URL
  playUrl: URL
}

type UdpTransport = {
  kind: 'udp'
  rtpSocket: DatagramSocket
  rtcpSocket: DatagramSocket
  clientRtpPort: number
  clientRtcpPort: number
}

type TcpTransport = {
  kind: 'tcp'
}

type RelayTransport = UdpTransport | TcpTransport

type MediaSection = {
  payloadTypes: number[]
  control?: string
  rtpmap: Map<number, string>
}

const INTERLEAVED_FRAME_MARKER = 0x24
const RTP_VERSION = 2
const MPEG_TS_PAYLOAD_TYPE = 33
const UDP_INITIAL_PACKET_TIMEOUT_MS = 15_000
const UDP_IDLE_TIMEOUT_MS = 5_000
const UDP_BIND_HOST = '0.0.0.0'
const UDP_TRANSPORT_BIND_ATTEMPTS = 10

function bindUdpSocket(socket: DatagramSocket, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('error', onError)
      reject(error)
    }

    socket.once('error', onError)
    socket.bind(port, UDP_BIND_HOST, () => {
      socket.off('error', onError)
      const address = socket.address()
      resolve(typeof address === 'object' ? address.port : 0)
    })
  })
}

function closeUdpSocket(socket: DatagramSocket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

function connectRtspSocket(url: URL): Promise<RtspSocket> {
  return new Promise((resolve, reject) => {
    const port = Number(url.port || (url.protocol === 'rtsps:' ? 322 : 554))
    const socket = url.protocol === 'rtsps:'
      ? connectTls({
        host: url.hostname,
        port,
        servername: url.hostname
      })
      : connectTcp({
        host: url.hostname,
        port
      })

    const onConnect = () => {
      socket.off('error', onError)
      resolve(socket)
    }

    const onError = (error: Error) => {
      socket.off('connect', onConnect)
      reject(error)
    }

    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

function writeToSocket(socket: RtspSocket, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('error', onError)
      reject(error)
    }

    socket.once('error', onError)
    socket.write(payload, (error) => {
      socket.off('error', onError)
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function resolveControlUrl(control: string, baseUrl: URL): URL {
  if (control === '*') {
    return new URL(baseUrl.toString())
  }

  const resolved = new URL(control, baseUrl)

  // SAT>IP tuning parameters live in the RTSP query string. When the SDP
  // advertises a relative media control like `track1`, keep the original
  // query on the derived SETUP/PLAY URLs unless the control URL overrides it.
  if (resolved.search === '' && baseUrl.search !== '') {
    resolved.search = baseUrl.search
  }

  return resolved
}

function parseSdpTrack(body: string, streamUrl: URL): RtspTrack {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const sections: MediaSection[] = []
  let aggregateControl: string | undefined
  let currentSection: MediaSection | undefined

  for (const line of lines) {
    if (line.startsWith('m=')) {
      const parts = line.slice(2).split(/\s+/)
      currentSection = {
        payloadTypes: parts.slice(3).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite),
        rtpmap: new Map<number, string>()
      }
      sections.push(currentSection)
      continue
    }

    if (line.startsWith('a=control:')) {
      const control = line.slice('a=control:'.length)
      if (currentSection) {
        currentSection.control = control
      } else {
        aggregateControl = control
      }
      continue
    }

    if (line.startsWith('a=rtpmap:') && currentSection) {
      const rest = line.slice('a=rtpmap:'.length)
      const [payloadType, encoding] = rest.split(/\s+/, 2)
      const parsedPayloadType = Number.parseInt(payloadType ?? '', 10)
      if (Number.isFinite(parsedPayloadType) && encoding) {
        currentSection.rtpmap.set(parsedPayloadType, encoding.toUpperCase())
      }
    }
  }

  const matchingSection = sections.find((section) => {
    if (section.payloadTypes.includes(MPEG_TS_PAYLOAD_TYPE)) {
      return true
    }

    return section.payloadTypes.some((payloadType) => section.rtpmap.get(payloadType)?.startsWith('MP2T/'))
  })

  if (!matchingSection?.control) {
    throw new Error('rtsp relay requires an MPEG-TS media track with a control URL')
  }

  return {
    setupUrl: resolveControlUrl(matchingSection.control, streamUrl),
    playUrl: resolveControlUrl(aggregateControl ?? matchingSection.control, streamUrl)
  }
}

function parseSessionId(response: RtspResponse): string {
  const rawValue = response.headers.get('session')
  if (!rawValue) {
    throw new Error('rtsp setup response missing session header')
  }

  return rawValue.split(';', 1)[0] ?? rawValue
}

async function createUdpTransport(): Promise<UdpTransport> {
  let lastError: unknown

  for (let attempt = 0; attempt < UDP_TRANSPORT_BIND_ATTEMPTS; attempt += 1) {
    const rtpSocket = createSocket('udp4')
    const rtcpSocket = createSocket('udp4')

    try {
      const clientRtpPort = await bindUdpSocket(rtpSocket)
      if (clientRtpPort % 2 !== 0) {
        throw new Error('rtsp relay requires an even RTP port for SAT>IP transport')
      }

      const clientRtcpPort = clientRtpPort + 1
      await bindUdpSocket(rtcpSocket, clientRtcpPort)

      return {
        kind: 'udp',
        rtpSocket,
        rtcpSocket,
        clientRtpPort,
        clientRtcpPort
      }
    } catch (error) {
      lastError = error
      await Promise.allSettled([
        closeUdpSocket(rtpSocket),
        closeUdpSocket(rtcpSocket)
      ])
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('rtsp relay failed to reserve a SAT>IP UDP port pair')
}

function parseTransport(response: RtspResponse): RelayTransport {
  const transport = response.headers.get('transport')?.toLowerCase() ?? ''

  if (transport.includes('rtp/avp/tcp')) {
    return { kind: 'tcp' }
  }

  return { kind: 'udp' } as const
}

function depacketizeRtpPayload(packet: Buffer): Buffer {
  if (packet.length < 12) {
    throw new Error('rtsp relay received a truncated RTP packet')
  }

  const version = packet[0] >> 6
  if (version !== RTP_VERSION) {
    throw new Error('rtsp relay received an unsupported RTP version')
  }

  const hasPadding = (packet[0] & 0x20) !== 0
  const hasExtension = (packet[0] & 0x10) !== 0
  const csrcCount = packet[0] & 0x0F
  let headerLength = 12 + csrcCount * 4

  if (packet.length < headerLength) {
    throw new Error('rtsp relay received a truncated RTP header')
  }

  if (hasExtension) {
    if (packet.length < headerLength + 4) {
      throw new Error('rtsp relay received a truncated RTP extension header')
    }

    const extensionLength = packet.readUInt16BE(headerLength + 2) * 4
    headerLength += 4 + extensionLength
  }

  if (packet.length < headerLength) {
    throw new Error('rtsp relay received a truncated RTP payload')
  }

  let payloadLength = packet.length - headerLength
  if (hasPadding) {
    const paddingLength = packet[packet.length - 1] ?? 0
    if (paddingLength > payloadLength) {
      throw new Error('rtsp relay received invalid RTP padding')
    }
    payloadLength -= paddingLength
  }

  return packet.subarray(headerLength, headerLength + payloadLength)
}

class RtspConnection {
  private readonly socket: RtspSocket
  private buffer = Buffer.alloc(0)
  private ended = false
  private failure: Error | undefined
  private cseq = 1
  private waiters: Array<() => void> = []

  constructor(socket: RtspSocket) {
    this.socket = socket
    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.flushWaiters()
    })
    this.socket.on('end', () => {
      this.ended = true
      this.flushWaiters()
    })
    this.socket.on('close', () => {
      this.ended = true
      this.flushWaiters()
    })
    this.socket.on('error', (error) => {
      this.failure = error
      this.flushWaiters()
    })
  }

  destroy(): void {
    this.socket.destroy()
  }

  async request(method: string, url: URL, headers: Record<string, string> = {}): Promise<RtspResponse> {
    const cseq = String(this.cseq)
    this.cseq += 1

    const request = [
      `${method} ${url.toString()} RTSP/1.0`,
      `CSeq: ${cseq}`,
      'User-Agent: plex-octotuner',
      ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`)
    ].join('\r\n') + '\r\n\r\n'

    await writeToSocket(this.socket, request)

    const response = await this.readResponse()
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`rtsp ${method} failed with status ${response.statusCode}`)
    }

    return response
  }

  async pumpMpegTs(stream: PassThrough, onMediaStart?: () => void): Promise<void> {
    let mediaStarted = false

    while (true) {
      if (this.failure) {
        throw this.failure
      }

      if (this.buffer.length === 0 && this.ended) {
        return
      }

      if (this.buffer.length < 4) {
        await this.waitForMoreData()
        continue
      }

      if (this.buffer[0] !== INTERLEAVED_FRAME_MARKER) {
        if (this.buffer.toString('utf8', 0, Math.min(this.buffer.length, 8)).startsWith('RTSP/1.0')) {
          await this.readResponse()
          continue
        }

        throw new Error('rtsp relay received unexpected non-interleaved data')
      }

      const frameLength = this.buffer.readUInt16BE(2)
      const totalLength = 4 + frameLength
      if (this.buffer.length < totalLength) {
        await this.waitForMoreData()
        continue
      }

      const channel = this.buffer[1]
      const payload = this.buffer.subarray(4, totalLength)
      this.buffer = this.buffer.subarray(totalLength)

      if (channel % 2 !== 0) {
        continue
      }

      const tsPayload = depacketizeRtpPayload(payload)
      if (tsPayload.length > 0) {
        if (!mediaStarted) {
          mediaStarted = true
          onMediaStart?.()
        }
        stream.write(tsPayload)
      }
    }
  }

  private async readResponse(): Promise<RtspResponse> {
    const headerEnd = await this.waitForHeaderEnd()
    const headerText = this.buffer.subarray(0, headerEnd).toString('utf8')
    const headerLines = headerText.split('\r\n')
    const statusLine = headerLines.shift() ?? ''
    const statusCode = Number.parseInt(statusLine.split(/\s+/)[1] ?? '', 10)
    const headers = new Map<string, string>()

    for (const line of headerLines) {
      const separator = line.indexOf(':')
      if (separator > 0) {
        headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
      }
    }

    const contentLength = Number.parseInt(headers.get('content-length') ?? '0', 10) || 0
    const totalLength = headerEnd + 4 + contentLength
    await this.waitForLength(totalLength)

    const body = this.buffer.subarray(headerEnd + 4, totalLength)
    this.buffer = this.buffer.subarray(totalLength)

    return { statusCode, headers, body }
  }

  private async waitForHeaderEnd(): Promise<number> {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd >= 0) {
        return headerEnd
      }

      await this.waitForMoreData()
    }
  }

  private async waitForLength(length: number): Promise<void> {
    while (this.buffer.length < length) {
      await this.waitForMoreData()
    }
  }

  private async waitForMoreData(): Promise<void> {
    if (this.failure) {
      throw this.failure
    }

    if (this.ended) {
      throw new Error('rtsp connection closed unexpectedly')
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  private flushWaiters(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) {
      waiter()
    }
  }
}

async function performRtspRequest(
  connection: RtspConnection,
  logger: BridgeLogger,
  method: string,
  url: URL,
  headers: Record<string, string> = {}
): Promise<RtspResponse> {
  const response = await connection.request(method, url, headers)

  return response
}

async function pumpUdpMpegTs(
  socket: DatagramSocket,
  stream: PassThrough,
  onMediaStart?: () => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timeout: NodeJS.Timeout | undefined
    let mediaStarted = false

    const refreshTimeout = () => {
      if (timeout) {
        clearTimeout(timeout)
      }

      timeout = setTimeout(() => {
        cleanup()
        if (mediaStarted) {
          resolve()
          return
        }

        reject(new Error('rtsp relay timed out waiting for the first RTP packet'))
      }, mediaStarted ? UDP_IDLE_TIMEOUT_MS : UDP_INITIAL_PACKET_TIMEOUT_MS)
    }

    const onMessage = (message: Buffer) => {
      try {
        const tsPayload = depacketizeRtpPayload(message)
        if (tsPayload.length > 0) {
          if (!mediaStarted) {
            mediaStarted = true
            onMediaStart?.()
          }
          stream.write(tsPayload)
        }
        refreshTimeout()
      } catch (error) {
        cleanup()
        reject(error)
      }
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onClose = () => {
      cleanup()
      resolve()
    }

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout)
      }
      socket.off('message', onMessage)
      socket.off('error', onError)
      socket.off('close', onClose)
    }

    socket.on('message', onMessage)
    socket.once('error', onError)
    socket.once('close', onClose)
    refreshTimeout()
  })
}

export async function relayRtspAsHttpTs(event: H3Event, streamUrl: string, logger: BridgeLogger) {
  const url = new URL(streamUrl)
  const socket = await connectRtspSocket(url)
  const connection = new RtspConnection(socket)
  const stream = new PassThrough()
  let transport: RelayTransport | undefined

  try {
    const describe = await performRtspRequest(connection, logger, 'DESCRIBE', url, {
      Accept: 'application/sdp'
    })
    const track = parseSdpTrack(describe.body.toString('utf8'), url)
    const udpTransport = await createUdpTransport()
    const setup = await performRtspRequest(connection, logger, 'SETUP', track.setupUrl, {
      Transport: `RTP/AVP;unicast;client_port=${udpTransport.clientRtpPort}-${udpTransport.clientRtcpPort}`
    })
    transport = parseTransport(setup)
    if (transport.kind === 'tcp') {
      await closeUdpSocket(udpTransport.rtpSocket)
      await closeUdpSocket(udpTransport.rtcpSocket)
    } else {
      transport = udpTransport
    }
    const sessionId = parseSessionId(setup)
    await performRtspRequest(connection, logger, 'PLAY', track.playUrl, {
      Session: sessionId
    })
  } catch (error) {
    logger.error('rtsp relay setup failed', error)
    if (transport?.kind === 'udp') {
      await Promise.allSettled([
        closeUdpSocket(transport.rtpSocket),
        closeUdpSocket(transport.rtcpSocket)
      ])
    }
    connection.destroy()
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to start upstream RTSP relay',
      data: error instanceof Error ? error.message : String(error)
    })
  }

  let relayClosed = false

  const closeRelay = () => {
    if (relayClosed) {
      return
    }

    relayClosed = true

    if (transport?.kind === 'udp') {
      void closeUdpSocket(transport.rtpSocket)
      void closeUdpSocket(transport.rtcpSocket)
    }

    connection.destroy()
    stream.end()
  }

  event.node.req.on('close', closeRelay)

  const logMediaStarted = () => {
    logger.info('rtsp relay media started', {
      transport: transport?.kind ?? 'unknown',
      upstreamUrl: streamUrl
    })
  }

  const pumpPromise = transport?.kind === 'udp'
    ? pumpUdpMpegTs(transport.rtpSocket, stream, logMediaStarted)
    : connection.pumpMpegTs(stream, logMediaStarted)

  void pumpPromise.catch((error) => {
    logger.error('rtsp relay failed', error)
    stream.destroy(error)
  }).finally(() => {
    event.node.req.off('close', closeRelay)
    closeRelay()
  })

  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'content-type', 'video/mp2t')

  return sendStream(event, stream)
}
