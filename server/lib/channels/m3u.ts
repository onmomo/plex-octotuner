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
type ParsedChannel = Channel & {
  lineNumber: number
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

function hasNumericGuideNumber(value: string | undefined): value is string {
  return value !== undefined && /^\d+$/.test(value)
}

function compareCaseInsensitive(left: string, right: string): number {
  const leftFolded = left.toLowerCase()
  const rightFolded = right.toLowerCase()

  if (leftFolded < rightFolded) {
    return -1
  }

  if (leftFolded > rightFolded) {
    return 1
  }

  return 0
}

function compareParsedChannels(left: ParsedChannel, right: ParsedChannel): number {
  const leftHasNumber = hasNumericGuideNumber(left.number)
  const rightHasNumber = hasNumericGuideNumber(right.number)

  if (leftHasNumber && rightHasNumber) {
    const numberDiff = Number(left.number) - Number(right.number)
    if (numberDiff !== 0) {
      return numberDiff
    }

    return compareCaseInsensitive(left.identity.key, right.identity.key)
  }

  if (leftHasNumber !== rightHasNumber) {
    return leftHasNumber ? -1 : 1
  }

  const nameDiff = compareCaseInsensitive(left.name, right.name)
  if (nameDiff !== 0) {
    return nameDiff
  }

  return compareCaseInsensitive(left.identity.key, right.identity.key)
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z0-9_-]+)="([^"]*)"/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value)) !== null) {
    attributes[match[1].toLowerCase()] = match[2]
  }

  return attributes
}

function findExtInfSeparator(line: string): number {
  let inQuotes = false
  for (let index = '#EXTINF:'.length; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (character === ',' && !inQuotes) {
      return index
    }
  }

  return -1
}

function parseExtInf(line: string): ParsedExtInf | null {
  if (!line.startsWith('#EXTINF:')) {
    return null
  }

  const separatorIndex = findExtInfSeparator(line)
  if (separatorIndex < 0) {
    return null
  }

  const header = line.slice(0, separatorIndex)
  const name = line.slice(separatorIndex + 1).trim()
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
  const channels: ParsedChannel[] = []
  let pending: PendingChannel | null = null

  const finalizePending = (streamUrl: string): void => {
    if (!pending) {
      return
    }

    const channel = buildChannel(pending, streamUrl)
    channels.push({
      ...channel,
      lineNumber: pending.lineNumber
    })

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

  channels.sort(compareParsedChannels)

  const orderedChannels: Channel[] = []
  const seen = new Set<string>()
  for (const channel of channels) {
    if (seen.has(channel.identity.key)) {
      options.logger.warn(`dropped duplicate channel at line ${channel.lineNumber}: ${channel.identity.key}`)
      continue
    }

    seen.add(channel.identity.key)
    orderedChannels.push({
      identity: channel.identity,
      tvgId: channel.tvgId,
      number: channel.number,
      name: channel.name,
      logoUrl: channel.logoUrl,
      groupTitle: channel.groupTitle,
      streamUrl: channel.streamUrl
    })
  }

  return orderedChannels
}
