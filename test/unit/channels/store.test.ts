import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ChannelStore } from '../../../server/lib/channels/store'

const samplePlaylist = readFileSync(new URL('../../fixtures/m3u/sample.m3u', import.meta.url), 'utf8')

describe('ChannelStore', () => {
  it('replaces channels from parsed raw playlist data', () => {
    const store = new ChannelStore()

    store.replaceFromRaw(samplePlaylist)

    expect(store.getChannels()).toHaveLength(6)
    expect(store.getChannels()).toEqual([
      expect.objectContaining({ name: 'Quoted Comma Channel' }),
      expect.objectContaining({ name: 'Das Erste HD' }),
      expect.objectContaining({ name: 'ZDF HD' }),
      expect.objectContaining({ name: 'alpha Channel' }),
      expect.objectContaining({ name: 'Zulu Channel' }),
      expect.objectContaining({ name: 'Ärger Channel' })
    ])
  })

  it('returns a defensive snapshot of the current channel list', () => {
    const store = new ChannelStore()

    store.replaceFromRaw(samplePlaylist)

    const channels = store.getChannels()
    channels.pop()

    expect(store.getChannels()).toHaveLength(6)
  })

  it('accepts an injected parser logger', () => {
    const logger = { warn: vi.fn() }
    const store = new ChannelStore(logger)

    store.replaceFromRaw(samplePlaylist)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped duplicate channel'))
  })
})
