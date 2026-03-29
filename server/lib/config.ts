export type BridgeConfig = {
  m3uUrl: URL
  advertisedBaseUrl: URL
  serverPort: number
  friendlyName: string
  playlistRefreshSeconds: number
  tunerCount: number
  deviceId: string
  deviceAuth: string
}

const DEFAULT_SERVER_PORT = 34400
const DEFAULT_FRIENDLY_NAME = 'octotuner'
const DEFAULT_PLAYLIST_REFRESH_SECONDS = 300
const DEFAULT_TUNER_COUNT = 4
const DEFAULT_DEVICE_ID = '105A1B22'
const HDHOMERUN_MAX_TUNER_COUNT = 255
const DEVICE_ID_PATTERN = /^[A-F0-9]{8}$/
const HTTP_SCHEMES = new Set(['http:', 'https:'])
const HDHOMERUN_DEVICE_ID_LOOKUP = [0xA, 0x5, 0xF, 0x6, 0x7, 0xC, 0x1, 0xB, 0x9, 0x2, 0x8, 0xD, 0x4, 0x3, 0xE, 0x0] as const

function readRequired(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]
  if (!value) {
    throw new Error(`${key} is required`)
  }

  return value
}

function parseUrl(env: Record<string, string | undefined>, key: string): URL {
  const value = readRequired(env, key)

  if (value.trim() !== value) {
    throw new Error(`${key} must not contain leading or trailing whitespace`)
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${key} must be a valid URL`)
  }

  if (!HTTP_SCHEMES.has(parsed.protocol)) {
    throw new Error(`${key} must use http or https`)
  }

  return parsed
}

function requireExplicitPort(value: URL, key: string): void {
  if (!value.port) {
    throw new Error(`${key} must include an explicit port`)
  }
}

function requireOriginOnlyBaseUrl(value: URL, key: string): void {
  if (value.username || value.password) {
    throw new Error(`${key} must not include credentials`)
  }

  if (value.pathname !== '/' || value.search !== '' || value.hash !== '') {
    throw new Error(`${key} must be an origin-only URL`)
  }
}

function parsePort(value: string | undefined, key: string, defaultPort: number): number {
  if (value === undefined || value === '') {
    return defaultPort
  }

  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${key} must be a plain decimal integer`)
  }

  const parsed = Number(value)
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`${key} must be a valid TCP port`)
  }

  return parsed
}

function parsePositiveInt(value: string | undefined, key: string, defaultValue: number, maxValue?: number): number {
  if (value === undefined || value === '') {
    return defaultValue
  }

  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${key} must be a plain decimal integer`)
  }

  const parsed = Number(value)
  if (parsed <= 0) {
    throw new Error(`${key} must be a positive integer`)
  }

  if (maxValue !== undefined && parsed > maxValue) {
    throw new Error(`${key} must be less than or equal to ${maxValue}`)
  }

  return parsed
}

function isValidHdhomerunDeviceId(deviceId: string): boolean {
  const value = Number.parseInt(deviceId, 16)
  let checksum = 0

  checksum ^= HDHOMERUN_DEVICE_ID_LOOKUP[(value >> 28) & 0x0F]
  checksum ^= (value >> 24) & 0x0F
  checksum ^= HDHOMERUN_DEVICE_ID_LOOKUP[(value >> 20) & 0x0F]
  checksum ^= (value >> 16) & 0x0F
  checksum ^= HDHOMERUN_DEVICE_ID_LOOKUP[(value >> 12) & 0x0F]
  checksum ^= (value >> 8) & 0x0F
  checksum ^= HDHOMERUN_DEVICE_ID_LOOKUP[(value >> 4) & 0x0F]
  checksum ^= value & 0x0F

  return checksum === 0
}

function normalizeDeviceId(value: string): string {
  const deviceId = value.trim().toUpperCase()
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new Error('HDHR_DEVICE_ID must be an 8-character hexadecimal identifier')
  }

  if (!isValidHdhomerunDeviceId(deviceId)) {
    throw new Error('HDHR_DEVICE_ID must be a valid HDHomeRun device identifier')
  }

  return deviceId
}

function portFromUrl(value: URL): number {
  if (value.port) {
    return Number(value.port)
  }

  return value.protocol === 'https:' ? 443 : 80
}

function parseDeviceAuth(value: string): string {
  if (value.trim() === '') {
    throw new Error('HDHR_DEVICE_AUTH must not be blank')
  }

  return value
}

export function loadBridgeConfig(env: Record<string, string | undefined>): BridgeConfig {
  const m3uUrl = parseUrl(env, 'M3U_URL')
  const advertisedBaseUrl = parseUrl(env, 'ADVERTISED_BASE_URL')
  requireExplicitPort(advertisedBaseUrl, 'ADVERTISED_BASE_URL')
  requireOriginOnlyBaseUrl(advertisedBaseUrl, 'ADVERTISED_BASE_URL')
  const serverPort = parsePort(env.SERVER_PORT, 'SERVER_PORT', DEFAULT_SERVER_PORT)
  const friendlyName = (env.HDHR_FRIENDLY_NAME ?? DEFAULT_FRIENDLY_NAME).trim() || DEFAULT_FRIENDLY_NAME
  const playlistRefreshSeconds = parsePositiveInt(
    env.PLAYLIST_REFRESH_SECONDS,
    'PLAYLIST_REFRESH_SECONDS',
    DEFAULT_PLAYLIST_REFRESH_SECONDS
  )
  const tunerCount = parsePositiveInt(
    env.HDHR_TUNER_COUNT,
    'HDHR_TUNER_COUNT',
    DEFAULT_TUNER_COUNT,
    HDHOMERUN_MAX_TUNER_COUNT
  )
  const deviceId = normalizeDeviceId(env.HDHR_DEVICE_ID ?? DEFAULT_DEVICE_ID)
  const deviceAuth = env.HDHR_DEVICE_AUTH === undefined
    ? `octotuner-${deviceId}`
    : parseDeviceAuth(env.HDHR_DEVICE_AUTH)

  if (serverPort !== portFromUrl(advertisedBaseUrl)) {
    throw new Error('SERVER_PORT must match the port in ADVERTISED_BASE_URL')
  }

  return {
    m3uUrl,
    advertisedBaseUrl,
    serverPort,
    friendlyName,
    playlistRefreshSeconds,
    tunerCount,
    deviceId,
    deviceAuth
  }
}
