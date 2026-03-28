import { parseM3U } from './m3u'
import type { Channel, ChannelLogger } from './types'

const noopLogger: ChannelLogger = {
  warn() {}
}

export class ChannelStore {
  #channels: Channel[] = []
  #logger: ChannelLogger

  constructor(logger: ChannelLogger = noopLogger) {
    this.#logger = logger
  }

  replaceFromRaw(playlist: string): Channel[] {
    const nextChannels = parseM3U(playlist, { logger: this.#logger })
    this.#channels = nextChannels
    return this.getChannels()
  }

  async refresh(fetchPlaylist: () => Promise<string>): Promise<Channel[]> {
    const playlist = await fetchPlaylist()
    const nextChannels = parseM3U(playlist, { logger: this.#logger })

    if (nextChannels.length === 0) {
      throw new Error('zero valid channels')
    }

    this.#channels = nextChannels
    return this.getChannels()
  }

  getChannels(): Channel[] {
    return [...this.#channels]
  }
}
