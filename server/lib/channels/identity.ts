import type { ChannelIdentity, ChannelIdentityInput } from './types'

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function streamPathKey(streamUrl: string): string {
  return new URL(streamUrl).pathname || '/'
}

function hashIdentity(key: string): ChannelIdentity {
  return { key }
}

export function buildChannelIdentity(input: ChannelIdentityInput): ChannelIdentity {
  if (input.tvgId) {
    return hashIdentity(`tvg-id:${normalize(input.tvgId)}`)
  }

  if (input.number) {
    return hashIdentity(`number-name:${normalize(input.number)}:${normalize(input.name)}`)
  }

  return hashIdentity(`name-path:${normalize(input.name)}:${streamPathKey(input.streamUrl)}`)
}

export { normalize, streamPathKey }
