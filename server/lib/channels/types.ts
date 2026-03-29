export type ChannelIdentityInput = {
  tvgId?: string
  number?: string
  name: string
  streamUrl: string
}

export type ChannelIdentity = {
  key: string
}

export type Channel = {
  id: string
  sourceIndex: number
  identity: ChannelIdentity
  tvgId?: string
  number?: string
  name: string
  logoUrl?: string
  groupTitle?: string
  streamUrl: string
}

export type ChannelLogger = {
  warn(message: string): void
}

export type ParseM3UOptions = {
  logger: ChannelLogger
}
