export type LineupInput = {
  id: string
  sourceIndex: number
  number?: string
  name: string
}

export function buildLineup(channels: LineupInput[], baseUrl: URL) {
  return channels.map((channel) => ({
    GuideNumber: channel.number ?? String(channel.sourceIndex + 1),
    GuideName: channel.name,
    URL: new URL(`/auto/v${channel.id}`, baseUrl).toString()
  }))
}
