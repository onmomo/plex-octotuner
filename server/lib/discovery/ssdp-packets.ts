import type { BridgeConfig } from '../config'
import { buildDeviceUdn } from '../hdhr/device-identity'
import { HDHR_DEVICE_PROFILE } from '../hdhr/profile'

const SSDP_MULTICAST_HOST = '239.255.255.250'
const SSDP_MULTICAST_PORT = 1900
const SSDP_ROOT_DEVICE_TARGET = 'upnp:rootdevice'
const SSDP_CACHE_MAX_AGE_SECONDS = 1800

function buildSsdpLocation(config: BridgeConfig): string {
  return new URL('/dri/device.xml', config.advertisedBaseUrl).toString()
}

function buildSsdpServerHeader(): string {
  return `${HDHR_DEVICE_PROFILE.manufacturer}/${HDHR_DEVICE_PROFILE.firmwareVersion} UPnP/1.0 ${HDHR_DEVICE_PROFILE.modelNumber}/${HDHR_DEVICE_PROFILE.firmwareVersion}`
}

function buildSsdpUsn(config: BridgeConfig): string {
  return `${buildDeviceUdn(config.deviceId)}::${SSDP_ROOT_DEVICE_TARGET}`
}

function finalizePacket(lines: string[]): string {
  return `${lines.join('\r\n')}\r\n\r\n`
}

export function buildSsdpNotify(config: BridgeConfig): string {
  return finalizePacket([
    'NOTIFY * HTTP/1.1',
    `HOST: ${SSDP_MULTICAST_HOST}:${SSDP_MULTICAST_PORT}`,
    `NT: ${SSDP_ROOT_DEVICE_TARGET}`,
    'NTS: ssdp:alive',
    `LOCATION: ${buildSsdpLocation(config)}`,
    `CACHE-CONTROL: max-age=${SSDP_CACHE_MAX_AGE_SECONDS}`,
    `SERVER: ${buildSsdpServerHeader()}`,
    `USN: ${buildSsdpUsn(config)}`
  ])
}

export function buildSsdpSearchResponse(config: BridgeConfig, searchTarget: string): string {
  return finalizePacket([
    'HTTP/1.1 200 OK',
    `CACHE-CONTROL: max-age=${SSDP_CACHE_MAX_AGE_SECONDS}`,
    'EXT:',
    `LOCATION: ${buildSsdpLocation(config)}`,
    `SERVER: ${buildSsdpServerHeader()}`,
    `ST: ${searchTarget}`,
    `USN: ${buildSsdpUsn(config)}`
  ])
}
