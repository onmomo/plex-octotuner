import { createServer, type Server, type Socket } from 'node:net'
import type { BridgeRuntime, CleanupRegistration, DiscoveryHandle } from '../runtime'
import { HDHR_DEVICE_PROFILE } from '../hdhr/profile'
import { encodeHdhomerunVarLength, readHdhomerunVarLength } from './hdhomerun-tlv'

const HDHOMERUN_CONTROL_TCP_PORT = 65001
const HDHOMERUN_TYPE_GETSET_REQ = 0x0004
const HDHOMERUN_TYPE_GETSET_RPY = 0x0005
const HDHOMERUN_TAG_GETSET_NAME = 0x03
const HDHOMERUN_TAG_GETSET_VALUE = 0x04
const HDHOMERUN_TAG_ERROR_MESSAGE = 0x05

type ControlServerOptions = {
  bindAddress?: string
  controlPort?: number
}

type ControlRequest = {
  name: string
  value: string | null
}

type HdhomerunFrame = {
  frameType: number
  payload: Buffer
  totalLength: number
}

type TunerState = {
  channel: string
  channelmap: string
  filter: string
  lockkey: string
  program: string
  target: string
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

function encodeTag(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeHdhomerunVarLength(value.length), value])
}

function encodeCString(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf8')
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

function tryReadFrame(buffer: Buffer): HdhomerunFrame | null {
  if (buffer.length < 8) {
    return null
  }

  const payloadLength = buffer.readUInt16BE(2)
  const totalLength = 4 + payloadLength + 4
  if (buffer.length < totalLength) {
    return null
  }

  const packet = buffer.subarray(0, totalLength - 4)
  const expectedCrc = calculateCrc32(packet)
  const actualCrc = buffer.readUInt32LE(totalLength - 4)
  if (expectedCrc !== actualCrc) {
    return {
      frameType: -1,
      payload: Buffer.alloc(0),
      totalLength
    }
  }

  return {
    frameType: buffer.readUInt16BE(0),
    payload: buffer.subarray(4, 4 + payloadLength),
    totalLength
  }
}

function decodeCString(value: Buffer): string {
  return value.toString('utf8').replace(/\0+$/, '')
}

function parseGetSetRequest(payload: Buffer): ControlRequest | null {
  let offset = 0
  let name: string | null = null
  let value: string | null = null

  while (offset < payload.length) {
    const tag = payload[offset]
    offset += 1

    const length = readHdhomerunVarLength(payload, offset)
    if (!length) {
      return null
    }

    offset += length.byteLength
    const body = payload.subarray(offset, offset + length.value)
    offset += length.value

    if (tag === HDHOMERUN_TAG_GETSET_NAME) {
      name = decodeCString(body)
      continue
    }

    if (tag === HDHOMERUN_TAG_GETSET_VALUE) {
      value = decodeCString(body)
    }
  }

  if (!name) {
    return null
  }

  return { name, value }
}

function buildGetSetReply(name: string, value: string): Buffer {
  const payload = Buffer.concat([
    encodeTag(HDHOMERUN_TAG_GETSET_NAME, encodeCString(name)),
    encodeTag(HDHOMERUN_TAG_GETSET_VALUE, encodeCString(value))
  ])

  return buildFrame(HDHOMERUN_TYPE_GETSET_RPY, payload)
}

function buildErrorReply(name: string, message: string): Buffer {
  const payload = Buffer.concat([
    encodeTag(HDHOMERUN_TAG_GETSET_NAME, encodeCString(name)),
    encodeTag(HDHOMERUN_TAG_ERROR_MESSAGE, encodeCString(message))
  ])

  return buildFrame(HDHOMERUN_TYPE_GETSET_RPY, payload)
}

function createInitialTunerState(): TunerState {
  return {
    channel: 'none',
    channelmap: 'us-bcast',
    filter: '0x0000-0x1FFF',
    lockkey: 'none',
    program: '0',
    target: 'none'
  }
}

function buildFeaturesValue(): string {
  return [
    'channelmap: us-bcast us-cable',
    'modulation: auto',
    'auto-modulation: auto',
    'program: 0'
  ].join('\n')
}

function buildTunerStatus(state: TunerState): string {
  const channel = state.channel === 'none' ? 'none' : state.channel
  const lock = state.channel === 'none' ? 'none' : 'qam'
  const signal = state.channel === 'none' ? 0 : 100

  return `ch=${channel} lock=${lock} ss=${signal} snq=${signal} seq=${signal} bps=0 pps=0`
}

function handleTunerRequest(state: TunerState, field: string, value: string | null): string | null {
  switch (field) {
    case 'channel':
      if (value !== null) state.channel = value === '' ? 'none' : value
      return state.channel
    case 'channelmap':
      if (value !== null) state.channelmap = value === '' ? 'us-bcast' : value
      return state.channelmap
    case 'filter':
      if (value !== null) state.filter = value === '' ? '0x0000-0x1FFF' : value
      return state.filter
    case 'lockkey':
      if (value !== null) state.lockkey = value === '' ? 'none' : value
      return state.lockkey
    case 'program':
      if (value !== null) state.program = value === '' ? '0' : value
      return state.program
    case 'status':
      return buildTunerStatus(state)
    case 'streaminfo':
      return 'none'
    case 'target':
      if (value !== null) state.target = value === '' ? 'none' : value
      return state.target
    default:
      return null
  }
}

function handleControlRequest(runtime: BridgeRuntime, tuners: TunerState[], request: ControlRequest): Buffer {
  const tunerMatch = request.name.match(/^\/tuner(\d+)\/([a-z_]+)$/)
  if (tunerMatch) {
    const tunerIndex = Number.parseInt(tunerMatch[1] ?? '', 10)
    const field = tunerMatch[2] ?? ''
    const tuner = tuners[tunerIndex]

    if (!tuner) {
      return buildErrorReply(request.name, 'ERROR: unknown key')
    }

    const value = handleTunerRequest(tuner, field, request.value)
    if (value !== null) {
      return buildGetSetReply(request.name, value)
    }

    return buildErrorReply(request.name, 'ERROR: unknown key')
  }

  switch (request.name) {
    case '/help':
      return buildGetSetReply(request.name, 'help')
    case '/lineup/location':
      return buildGetSetReply(request.name, `${runtime.config.advertisedBaseUrl.origin}/lineup.json`)
    case '/sys/copyright':
      return buildGetSetReply(request.name, 'Copyright Silicondust')
    case '/sys/debug':
      return buildGetSetReply(request.name, '0')
    case '/sys/features':
      return buildGetSetReply(request.name, buildFeaturesValue())
    case '/sys/hwmodel':
      return buildGetSetReply(request.name, HDHR_DEVICE_PROFILE.modelNumber)
    case '/sys/model':
      return buildGetSetReply(request.name, HDHR_DEVICE_PROFILE.modelNumber)
    case '/sys/version':
      return buildGetSetReply(request.name, HDHR_DEVICE_PROFILE.firmwareVersion)
    default:
      return buildErrorReply(request.name, 'ERROR: unknown key')
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

function listen(server: Server, port: number, host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('error', onError)
      reject(error)
    }

    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

function attachConnectionHandlers(runtime: BridgeRuntime, socket: Socket, tuners: TunerState[]): void {
  let buffer = Buffer.alloc(0)

  socket.on('error', (error) => {
    runtime.logger.error('hdhomerun control socket error', error)
  })

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    while (buffer.length > 0) {
      const frame = tryReadFrame(buffer)
      if (!frame) {
        return
      }

      buffer = buffer.subarray(frame.totalLength)

      if (frame.frameType !== HDHOMERUN_TYPE_GETSET_REQ) {
        continue
      }

      const request = parseGetSetRequest(frame.payload)
      if (!request) {
        continue
      }

      socket.write(handleControlRequest(runtime, tuners, request))
    }
  })
}

export async function startHdhomerunControlServer(
  runtime: BridgeRuntime,
  registerCleanup: (cleanup: CleanupRegistration) => void = () => {},
  options: ControlServerOptions = {}
): Promise<DiscoveryHandle> {
  const tuners = Array.from({ length: runtime.config.tunerCount }, createInitialTunerState)
  const server = createServer((socket) => attachConnectionHandlers(runtime, socket, tuners))
  registerCleanup(() => closeServer(server))

  await listen(server, options.controlPort ?? HDHOMERUN_CONTROL_TCP_PORT, options.bindAddress)

  let stopPromise: Promise<void> | undefined

  return {
    stop: async () => {
      if (!stopPromise) {
        stopPromise = closeServer(server)
      }

      await stopPromise
    }
  }
}
