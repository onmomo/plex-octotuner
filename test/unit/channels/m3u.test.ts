import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseM3U } from '../../../server/lib/channels/m3u'

const samplePlaylist = readFileSync(new URL('../../fixtures/m3u/sample.m3u', import.meta.url), 'utf8')
const invalidOnlyPlaylist = readFileSync(new URL('../../fixtures/m3u/invalid-only.m3u', import.meta.url), 'utf8')

describe('parseM3U', () => {
  it('parses valid channels, filters duplicates, and preserves stream urls', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    expect(parseM3U(samplePlaylist, { logger })).toEqual([
      expect.objectContaining({
        number: '101',
        name: 'Das Erste HD',
        logoUrl: 'http://octopus.local/logos/daserste.png',
        groupTitle: 'German HD',
        streamUrl: 'http://octopus.local:8888/stream/channel/1?descramble=1'
      }),
      expect.objectContaining({
        number: '102',
        name: 'ZDF HD'
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
