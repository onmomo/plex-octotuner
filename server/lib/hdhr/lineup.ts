export type LineupInput = {
  id: string
  number?: string
  name: string
}

export function buildLineup(channels: LineupInput[], baseUrl: URL) {
  return channels.map((channel) => ({
    GuideNumber: channel.number ?? '',
    GuideName: channel.name,
    URL: new URL(`/auto/v${channel.id}`, baseUrl).toString()
  }))
}
