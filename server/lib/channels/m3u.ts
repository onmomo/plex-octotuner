import { buildChannelIdentity } from './identity'
import type { Channel, ParseM3UOptions } from './types'

type PendingChannel = {
  tvgId?: string
  number?: string
  name: string
  logoUrl?: string
  groupTitle?: string
  lineNumber: number
}

type ParsedExtInf = Omit<PendingChannel, 'lineNumber'>

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z0-9_-]+)="([^"]*)"/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) !== null) {
    attributes[match[1].toLowerCase()] = match[2]
  }

  return attributes
}

function parseExtInf(line: string): ParsedExtInf | null {
  if (!line.startsWith('#EXTINF:')) {
    return null
  }

  const commaIndex = line.indexOf(',')
  if (commaIndex < 0) {
    return null
  }

  const header = line.slice(0, commaIndex)
  const name = line.slice(commaIndex + 1).trim()
  if (!name) {
    return null
  }

  const attributes = parseAttributes(header)
  return {
    tvgId: attributes['tvg-id'],
    number: attributes['tvg-chno'],
    name,
    logoUrl: attributes['tvg-logo'],
    groupTitle: attributes['group-title']
  }
}

function isAllowedStreamUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ALLOWED_SCHEMES.has(url.protocol)
  } catch {
    return false
  }
}

function buildChannel(pending: PendingChannel, streamUrl: string): Channel {
  const identity = buildChannelIdentity({
    tvgId: pending.tvgId,
    number: pending.number,
    name: pending.name,
    streamUrl
  })

  return {
    identity,
    tvgId: pending.tvgId,
    number: pending.number,
    name: pending.name,
    logoUrl: pending.logoUrl,
    groupTitle: pending.groupTitle,
    streamUrl
  }
}

export function parseM3U(playlist: string, options: ParseM3UOptions): Channel[] {
  const channels: Channel[] = []
  const seen = new Set<string>()
  let pending: PendingChannel | null = null

  const finalizePending = (streamUrl: string): void => {
    if (!pending) {
      return
    }

    const channel = buildChannel(pending, streamUrl)
    if (seen.has(channel.identity.key)) {
      options.logger.warn(`dropped duplicate channel at line ${pending.lineNumber}: ${channel.identity.key}`)
    } else {
      seen.add(channel.identity.key)
      channels.push(channel)
    }

    pending = null
  }

  const dropPending = (reason: string): void => {
    if (!pending) {
      return
    }

    options.logger.warn(`dropped invalid channel at line ${pending.lineNumber}: ${reason}`)
    pending = null
  }

  const lines = playlist.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const rawLine = lines[index]
    const line = rawLine.trim()

    if (!line || line === '#EXTM3U') {
      continue
    }

    const extInf = parseExtInf(line)
    if (extInf) {
      dropPending('missing stream url')
      pending = { ...extInf, lineNumber }
      continue
    }

    if (line.startsWith('#EXTINF:')) {
      options.logger.warn(`dropped invalid channel at line ${lineNumber}: malformed metadata`)
      continue
    }

    if (line.startsWith('#')) {
      continue
    }

    if (!isAllowedStreamUrl(rawLine)) {
      if (pending) {
        dropPending('unsupported or invalid stream url')
      } else {
        options.logger.warn(`dropped invalid channel at line ${lineNumber}: unexpected stream url`)
      }
      continue
    }

    if (!pending) {
      options.logger.warn(`dropped invalid channel at line ${lineNumber}: stream url without metadata`)
      continue
    }

    finalizePending(rawLine)
  }

  dropPending('missing stream url')

  return channels
}
