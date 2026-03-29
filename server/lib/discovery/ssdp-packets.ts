import type { BridgeConfig } from '../config'
import { buildDeviceUdn } from '../hdhr/device-identity'

const SSDP_MULTICAST_HOST = '239.255.255.250'
const SSDP_MULTICAST_PORT = 1900
const SSDP_ROOT_DEVICE_TARGET = 'upnp:rootdevice'
const SSDP_ALL_TARGET = 'ssdp:all'
const SSDP_CACHE_MAX_AGE_SECONDS = 1800
const XTEVE_SSDP_SERVER = 'xTeVe'

function buildSsdpLocation(config: BridgeConfig): string {
  return new URL('/device.xml', config.advertisedBaseUrl).toString()
}

function buildSsdpUsn(config: BridgeConfig, searchTarget: string): string {
  return `${buildDeviceUdn(config.deviceId)}::${searchTarget}`
}

function finalizePacket(lines: string[]): string {
  return `${lines.join('\r\n')}\r\n\r\n`
}

function buildNotifyPacket(config: BridgeConfig): string {
  return finalizePacket([
    'NOTIFY * HTTP/1.1',
    `HOST: ${SSDP_MULTICAST_HOST}:${SSDP_MULTICAST_PORT}`,
    `NT: ${SSDP_ROOT_DEVICE_TARGET}`,
    'NTS: ssdp:alive',
    `USN: ${buildSsdpUsn(config, SSDP_ROOT_DEVICE_TARGET)}`,
    `LOCATION: ${buildSsdpLocation(config)}`,
    `SERVER: ${XTEVE_SSDP_SERVER}`,
    `CACHE-CONTROL: max-age=${SSDP_CACHE_MAX_AGE_SECONDS}`
  ])
}

function buildSearchResponsePacket(config: BridgeConfig): string {
  return finalizePacket([
    'HTTP/1.1 200 OK',
    'EXT:',
    `ST: ${SSDP_ROOT_DEVICE_TARGET}`,
    `USN: ${buildSsdpUsn(config, SSDP_ROOT_DEVICE_TARGET)}`,
    `LOCATION: ${buildSsdpLocation(config)}`,
    `SERVER: ${XTEVE_SSDP_SERVER}`,
    `CACHE-CONTROL: max-age=${SSDP_CACHE_MAX_AGE_SECONDS}`
  ])
}

export function buildSsdpNotifyPackets(config: BridgeConfig): string[] {
  return [buildNotifyPacket(config)]
}

export function buildSsdpSearchResponses(config: BridgeConfig, searchTarget: string): string[] {
  if (searchTarget === SSDP_ALL_TARGET || searchTarget === SSDP_ROOT_DEVICE_TARGET) {
    return [buildSearchResponsePacket(config)]
  }

  return []
}

export {
  SSDP_ALL_TARGET,
  SSDP_ROOT_DEVICE_TARGET
}
