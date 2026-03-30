import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { isIP } from 'node:net'
import type { BridgeConfig } from '../config'
import type { BridgeLogger, BridgeRuntime, CleanupRegistration, DiscoveryHandle } from '../runtime'
import { startHdhomerunControlServer } from './hdhomerun-control'
import { buildHdhomerunDiscoveryReply } from './hdhomerun-packets'
import { readHdhomerunVarLength } from './hdhomerun-tlv'
import {
  buildSsdpNotifyPackets,
  buildSsdpSearchResponses,
  SSDP_ALL_TARGET,
  SSDP_ROOT_DEVICE_TARGET
} from './ssdp-packets'

export const SSDP_MULTICAST_HOST = '239.255.255.250'
export const SSDP_MULTICAST_PORT = 1900
export const HDHOMERUN_DISCOVERY_PORT = 65001

const HDHOMERUN_TYPE_DISCOVER_REQ = 0x0002
const HDHOMERUN_TAG_DEVICE_TYPE = 0x01
const HDHOMERUN_TAG_DEVICE_ID = 0x02
const HDHOMERUN_TAG_MULTI_TYPE = 0x2D
const HDHOMERUN_DEVICE_TYPE_WILDCARD = 0xFFFFFFFF
const HDHOMERUN_DEVICE_TYPE_TUNER = 0x00000001
const UDP4_SOCKET_TYPE = 'udp4'

type DiscoverySend = (
  message: string | Uint8Array,
  address: string,
  port: number
) => Promise<void> | void

type DiscoveryMessageOptions = {
  config: BridgeConfig
  logger: BridgeLogger
  message: Buffer
  remoteAddress: string
  remotePort: number
  send: DiscoverySend
}

type StartupNotifyOptions = {
  config: BridgeConfig
  send: DiscoverySend
}

export type DiscoveryServerOptions = {
  bindAddress?: string
  controlPort?: number
  ssdpPort?: number
  hdhomerunPort?: number
  ssdpMulticastHost?: string
  joinSsdpMulticast?: boolean
  startControl?: boolean
  startupNotify?: boolean
}

function asIpv4Interface(candidate: string | undefined): string | undefined {
  return isIP(candidate ?? '') === 4 ? candidate : undefined
}

function resolveSsdpMulticastInterface(config: BridgeConfig, options: DiscoveryServerOptions): string | undefined {
  return asIpv4Interface(options.bindAddress) ?? asIpv4Interface(config.advertisedBaseUrl.hostname)
}

function parseSsdpHeaders(message: Buffer): Map<string, string> | null {
  const lines = message.toString('utf8').split('\r\n')
  if (lines.length === 0 || lines[0]?.trim().toUpperCase() !== 'M-SEARCH * HTTP/1.1') {
    return null
  }

  const headers = new Map<string, string>()
  for (const line of lines.slice(1)) {
    if (line.trim() === '') {
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }

    headers.set(
      line.slice(0, separatorIndex).trim().toLowerCase(),
      line.slice(separatorIndex + 1).trim()
    )
  }

  return headers
}

function isSupportedSsdpTarget(
  searchTarget: string | undefined
): searchTarget is
  | typeof SSDP_ROOT_DEVICE_TARGET
  | typeof SSDP_ALL_TARGET {
  return searchTarget === SSDP_ROOT_DEVICE_TARGET
    || searchTarget === SSDP_ALL_TARGET
}

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

type HdhomerunDiscoveryRequest = {
  deviceId?: number
  deviceTypes: number[]
}

function parseHdhomerunDiscoveryRequest(message: Buffer): HdhomerunDiscoveryRequest | null {
  if (message.length < 8) {
    return null
  }

  const packetType = message.readUInt16BE(0)
  const payloadLength = message.readUInt16BE(2)
  const totalLength = 4 + payloadLength + 4

  if (packetType !== HDHOMERUN_TYPE_DISCOVER_REQ || message.length < totalLength) {
    return null
  }

  const expectedCrc = calculateCrc32(message.subarray(0, totalLength - 4))
  const actualCrc = message.readUInt32LE(totalLength - 4)
  if (expectedCrc !== actualCrc) {
    return null
  }

  const request: HdhomerunDiscoveryRequest = { deviceTypes: [] }
  let offset = 4
  const limit = 4 + payloadLength

  while (offset < limit) {
    const tag = message[offset]
    const length = readHdhomerunVarLength(message, offset + 1)
    if (!length) {
      return null
    }

    const valueOffset = offset + 1 + length.byteLength
    const valueLimit = valueOffset + length.value
    if (valueLimit > limit) {
      return null
    }

    if (tag === HDHOMERUN_TAG_DEVICE_TYPE && length.value === 4) {
      request.deviceTypes.push(message.readUInt32BE(valueOffset))
    }

    if (tag === HDHOMERUN_TAG_MULTI_TYPE && length.value >= 4 && length.value % 4 === 0) {
      for (let typeOffset = valueOffset; typeOffset < valueLimit; typeOffset += 4) {
        request.deviceTypes.push(message.readUInt32BE(typeOffset))
      }
    }

    if (tag === HDHOMERUN_TAG_DEVICE_ID && length.value === 4) {
      request.deviceId = message.readUInt32BE(valueOffset)
    }

    offset = valueLimit
  }

  if (request.deviceTypes.length === 0) {
    return null
  }

  return request
}

function requestMatchesConfig(request: HdhomerunDiscoveryRequest, config: BridgeConfig): boolean {
  const matchesType = request.deviceTypes.includes(HDHOMERUN_DEVICE_TYPE_WILDCARD)
    || request.deviceTypes.includes(HDHOMERUN_DEVICE_TYPE_TUNER)

  if (!matchesType) {
    return false
  }

  if (request.deviceId === undefined || request.deviceId === 0xFFFFFFFF) {
    return true
  }

  return request.deviceId === Number.parseInt(config.deviceId, 16)
}

function bindSocket(socket: Socket, port: number, address?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('error', onError)
      reject(error)
    }

    socket.once('error', onError)
    const onBound = () => {
      socket.off('error', onError)
      resolve()
    }

    if (address === undefined) {
      socket.bind(port, onBound)
      return
    }

    socket.bind(port, address, onBound)
  })
}

function sendOnSocket(
  socket: Socket,
  message: string | Uint8Array,
  address: string,
  port: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(message, port, address, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
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

function logSocketError(logger: BridgeLogger, scope: string, error: unknown): void {
  logger.error(`${scope} socket error`, error)
}

function joinSsdpMulticastGroup(
  socket: Socket,
  multicastHost: string,
  multicastInterface?: string
): void {
  try {
    if (multicastInterface) {
      socket.addMembership(multicastHost, multicastInterface)
      socket.setMulticastInterface(multicastInterface)
      return
    }

    socket.addMembership(multicastHost)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const interfaceLabel = multicastInterface ? ` on interface ${multicastInterface}` : ''
    throw new Error(`ssdp multicast join failed${interfaceLabel}: ${reason}`, {
      cause: error
    })
  }
}

export async function sendStartupNotify({ config, send }: StartupNotifyOptions): Promise<void> {
  for (const packet of buildSsdpNotifyPackets(config)) {
    await send(packet, SSDP_MULTICAST_HOST, SSDP_MULTICAST_PORT)
  }
}

export async function handleSsdpMessage({
  config,
  message,
  remoteAddress,
  remotePort,
  send
}: DiscoveryMessageOptions): Promise<boolean> {
  const headers = parseSsdpHeaders(message)
  const searchTarget = headers?.get('st')

  if (!isSupportedSsdpTarget(searchTarget)) {
    return false
  }

  for (const response of buildSsdpSearchResponses(config, searchTarget)) {
    await send(response, remoteAddress, remotePort)
  }
  return true
}

export async function handleHdhomerunDiscoveryRequest({
  config,
  message,
  remoteAddress,
  remotePort,
  send
}: DiscoveryMessageOptions): Promise<boolean> {
  const request = parseHdhomerunDiscoveryRequest(message)
  if (!request) {
    return false
  }

  if (!requestMatchesConfig(request, config)) {
    return false
  }

  await send(buildHdhomerunDiscoveryReply(config), remoteAddress, remotePort)
  return true
}

function attachSocketHandlers(
  runtime: BridgeRuntime,
  ssdpSocket: Socket,
  hdhomerunSocket: Socket
): void {
  ssdpSocket.on('error', (error) => {
    logSocketError(runtime.logger, 'ssdp discovery', error)
  })
  hdhomerunSocket.on('error', (error) => {
    logSocketError(runtime.logger, 'hdhomerun discovery', error)
  })

  ssdpSocket.on('message', (message: Buffer, remote: RemoteInfo) => {
    void handleSsdpMessage({
      config: runtime.config,
      logger: runtime.logger,
      message,
      remoteAddress: remote.address,
      remotePort: remote.port,
      send: (reply, address, port) => sendOnSocket(ssdpSocket, reply, address, port)
    }).catch((error) => {
      runtime.logger.error('ssdp discovery response failed', error)
    })
  })

  hdhomerunSocket.on('message', (message: Buffer, remote: RemoteInfo) => {
    void handleHdhomerunDiscoveryRequest({
      config: runtime.config,
      logger: runtime.logger,
      message,
      remoteAddress: remote.address,
      remotePort: remote.port,
      send: (reply, address, port) => sendOnSocket(hdhomerunSocket, reply, address, port)
    }).catch((error) => {
      runtime.logger.error('hdhomerun discovery response failed', error)
    })
  })
}

function registerSocketCleanup(socket: Socket, registerCleanup: (cleanup: CleanupRegistration) => void): void {
  registerCleanup(() => closeSocket(socket))
}

export async function startDiscoveryServer(
  runtime: BridgeRuntime,
  registerCleanup: (cleanup: CleanupRegistration) => void = () => {},
  options: DiscoveryServerOptions = {}
): Promise<DiscoveryHandle> {
  const ssdpPort = options.ssdpPort ?? SSDP_MULTICAST_PORT
  const hdhomerunPort = options.hdhomerunPort ?? HDHOMERUN_DISCOVERY_PORT
  const ssdpMulticastHost = options.ssdpMulticastHost ?? SSDP_MULTICAST_HOST
  const joinSsdpMulticast = options.joinSsdpMulticast ?? true
  const startControl = options.startControl ?? true
  const startupNotify = options.startupNotify ?? true
  const ssdpMulticastInterface = resolveSsdpMulticastInterface(runtime.config, options)

  const ssdpSocket = createSocket({ type: UDP4_SOCKET_TYPE, reuseAddr: true })
  registerSocketCleanup(ssdpSocket, registerCleanup)
  await bindSocket(ssdpSocket, ssdpPort, options.bindAddress)
  if (joinSsdpMulticast) {
    joinSsdpMulticastGroup(ssdpSocket, ssdpMulticastHost, ssdpMulticastInterface)
  }

  const hdhomerunSocket = createSocket(UDP4_SOCKET_TYPE)
  registerSocketCleanup(hdhomerunSocket, registerCleanup)
  await bindSocket(hdhomerunSocket, hdhomerunPort, options.bindAddress)

  attachSocketHandlers(runtime, ssdpSocket, hdhomerunSocket)

  const controlHandle = startControl
    ? await startHdhomerunControlServer(runtime, registerCleanup, {
      bindAddress: options.bindAddress,
      controlPort: options.controlPort
    })
    : undefined

  if (startupNotify) {
    await sendStartupNotify({
      config: runtime.config,
      send: (message, address, port) => sendOnSocket(ssdpSocket, message, address, port)
    })
  }

  let stopPromise: Promise<void> | undefined

  return {
    stop: async () => {
      if (!stopPromise) {
        stopPromise = Promise.all([
          controlHandle?.stop(),
          closeSocket(hdhomerunSocket),
          closeSocket(ssdpSocket)
        ]).then(() => undefined)
      }

      await stopPromise
    }
  }
}
