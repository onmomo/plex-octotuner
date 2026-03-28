import { createHash } from 'node:crypto'

export function buildDeviceUdn(deviceId: string): string {
  const hash = createHash('sha256').update(`octotuner:${deviceId}`).digest('hex')
  const versioned = `5${hash.slice(13, 16)}`
  const variantNibble = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)
  const variant = `${variantNibble}${hash.slice(17, 20)}`

  return `uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${versioned}-${variant}-${hash.slice(20, 32)}`
}
