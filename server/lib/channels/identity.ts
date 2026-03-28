import { createHash } from 'node:crypto'
import type { ChannelIdentity, ChannelIdentityInput } from './types'

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function streamPathKey(streamUrl: string): string {
  const url = new URL(streamUrl)
  const pathname = url.pathname || '/'
  const query = new URLSearchParams(url.searchParams)
  query.sort()
  const queryString = query.toString()

  return queryString ? `${pathname}?${queryString}` : pathname
}

function hashIdentity(key: string): ChannelIdentity {
  return { key }
}

export function buildChannelId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12)
}

export function buildChannelIdentity(input: ChannelIdentityInput): ChannelIdentity {
  const tvgId = normalize(input.tvgId ?? '')
  if (tvgId) {
    return hashIdentity(`tvg-id:${tvgId}`)
  }

  const number = normalize(input.number ?? '')
  const name = normalize(input.name)

  if (number && name) {
    return hashIdentity(`number-name:${number}:${name}`)
  }

  if (name) {
    return hashIdentity(`name-path:${name}:${streamPathKey(input.streamUrl)}`)
  }

  if (number) {
    return hashIdentity(`number-path:${number}:${streamPathKey(input.streamUrl)}`)
  }

  return hashIdentity(`path:${streamPathKey(input.streamUrl)}`)
}

export { normalize, streamPathKey }
