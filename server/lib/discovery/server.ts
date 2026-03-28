import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import type { BridgeConfig } from '../config'
import type { BridgeLogger, BridgeRuntime, CleanupRegistration, DiscoveryHandle } from '../runtime'
import { buildHdhomerunDiscoveryReply } from './hdhomerun-packets'
import { buildSsdpNotify, buildSsdpSearchResponse } from './ssdp-packets'

export const SSDP_MULTICAST_HOST = '239.255.255.250'
export const SSDP_MULTICAST_PORT = 1900
export const HDHOMERUN_DISCOVERY_PORT = 65001

const SSDP_ROOT_DEVICE_TARGET = 'upnp:rootdevice'
const SSDP_ALL_TARGET = 'ssdp:all'
const HDHOMERUN_TYPE_DISCOVER_REQ = 0x0002
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
  ssdpPort?: number
  hdhomerunPort?: number
  ssdpMulticastHost?: string
  joinSsdpMulticast?: boolean
  startupNotify?: boolean
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

function isSupportedSsdpTarget(searchTarget: string | undefined): searchTarget is typeof SSDP_ROOT_DEVICE_TARGET | typeof SSDP_ALL_TARGET {
  return searchTarget === SSDP_ROOT_DEVICE_TARGET || searchTarget === SSDP_ALL_TARGET
}

function isHdhomerunDiscoveryRequest(message: Buffer): boolean {
  if (message.length < 8) {
    return false
  }

  const packetType = message.readUInt16BE(0)
  const payloadLength = message.readUInt16BE(2)

  return packetType === HDHOMERUN_TYPE_DISCOVER_REQ && message.length >= 4 + payloadLength + 4
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

export async function sendStartupNotify({ config, send }: StartupNotifyOptions): Promise<void> {
  await send(buildSsdpNotify(config), SSDP_MULTICAST_HOST, SSDP_MULTICAST_PORT)
}

export async function handleSsdpMessage({
  config,
  logger,
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

  logger.info('ssdp discovery request', {
    address: remoteAddress,
    port: remotePort,
    searchTarget
  })

  await send(buildSsdpSearchResponse(config, searchTarget), remoteAddress, remotePort)
  return true
}

export async function handleHdhomerunDiscoveryRequest({
  config,
  logger,
  message,
  remoteAddress,
  remotePort,
  send
}: DiscoveryMessageOptions): Promise<boolean> {
  if (!isHdhomerunDiscoveryRequest(message)) {
    return false
  }

  logger.info('hdhomerun discovery request', {
    address: remoteAddress,
    port: remotePort
  })

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
  const startupNotify = options.startupNotify ?? true

  const ssdpSocket = createSocket({ type: UDP4_SOCKET_TYPE, reuseAddr: true })
  registerSocketCleanup(ssdpSocket, registerCleanup)
  await bindSocket(ssdpSocket, ssdpPort, options.bindAddress)
  if (joinSsdpMulticast) {
    ssdpSocket.addMembership(ssdpMulticastHost)
  }

  const hdhomerunSocket = createSocket(UDP4_SOCKET_TYPE)
  registerSocketCleanup(hdhomerunSocket, registerCleanup)
  await bindSocket(hdhomerunSocket, hdhomerunPort, options.bindAddress)

  attachSocketHandlers(runtime, ssdpSocket, hdhomerunSocket)
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
          closeSocket(hdhomerunSocket),
          closeSocket(ssdpSocket)
        ]).then(() => undefined)
      }

      await stopPromise
    }
  }
}
