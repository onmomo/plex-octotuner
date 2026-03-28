import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseM3U } from '../../../server/lib/channels/m3u'

const samplePlaylist = readFileSync(new URL('../../fixtures/m3u/sample.m3u', import.meta.url), 'utf8')
const invalidOnlyPlaylist = readFileSync(new URL('../../fixtures/m3u/invalid-only.m3u', import.meta.url), 'utf8')

describe('parseM3U', () => {
  it('normalizes output order by numeric number first and then name', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    expect(parseM3U(samplePlaylist, { logger }).map((channel) => ({
      number: channel.number,
      name: channel.name
    }))).toEqual([
      { number: '100', name: 'Quoted Comma Channel' },
      { number: '101', name: 'Das Erste HD' },
      { number: '103', name: 'ZDF HD' },
      { number: undefined, name: 'alpha Channel' },
      { number: undefined, name: 'Zulu Channel' },
      { number: undefined, name: 'Ärger Channel' }
    ])
  })

  it('keeps the ordered first duplicate instead of the first playlist duplicate', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    const channels = parseM3U(samplePlaylist, { logger })

    expect(channels).toEqual([
      expect.objectContaining({
        number: '100',
        name: 'Quoted Comma Channel',
        groupTitle: 'News, Regional',
        streamUrl: 'http://octopus.local:8888/stream/channel/0?descramble=1'
      }),
      expect.objectContaining({
        number: '101',
        name: 'Das Erste HD',
        logoUrl: 'http://octopus.local/logos/daserste.png',
        groupTitle: 'German HD',
        streamUrl: 'http://octopus.local:8888/stream/channel/1?descramble=1'
      }),
      expect.objectContaining({
        number: '103',
        name: 'ZDF HD'
      }),
      expect.objectContaining({
        name: 'alpha Channel'
      }),
      expect.objectContaining({
        name: 'Zulu Channel'
      }),
      expect.objectContaining({
        name: 'Ärger Channel'
      })
    ])

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped duplicate channel'))
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('descramble=1'))
  })

  it('drops invalid channels and redacts warnings', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    expect(parseM3U(invalidOnlyPlaylist, { logger })).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped invalid channel'))
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('descramble=1'))
  })
})
