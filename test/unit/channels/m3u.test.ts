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
      name: channel.name,
      sourceIndex: channel.sourceIndex
    }))).toEqual([
      { number: '100', name: 'Quoted Comma Channel', sourceIndex: 0 },
      { number: '101', name: 'Das Erste HD', sourceIndex: 3 },
      { number: '103', name: 'ZDF HD', sourceIndex: 6 },
      { number: undefined, name: 'alpha Channel', sourceIndex: 4 },
      { number: undefined, name: 'Zulu Channel', sourceIndex: 2 },
      { number: undefined, name: 'Ärger Channel', sourceIndex: 5 }
    ])
  })

  it('keeps the ordered first duplicate instead of the first playlist duplicate', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    const channels = parseM3U(samplePlaylist, { logger })

    expect(channels).toEqual([
      expect.objectContaining({
        number: '100',
        name: 'Quoted Comma Channel',
        sourceIndex: 0,
        groupTitle: 'News, Regional',
        streamUrl: 'http://octopus.local:8888/stream/channel/0?descramble=1'
      }),
      expect.objectContaining({
        number: '101',
        name: 'Das Erste HD',
        sourceIndex: 3,
        logoUrl: 'http://octopus.local/logos/daserste.png',
        groupTitle: 'German HD',
        streamUrl: 'http://octopus.local:8888/stream/channel/1?descramble=1'
      }),
      expect.objectContaining({
        number: '103',
        name: 'ZDF HD',
        sourceIndex: 6
      }),
      expect.objectContaining({
        name: 'alpha Channel',
        sourceIndex: 4
      }),
      expect.objectContaining({
        name: 'Zulu Channel',
        sourceIndex: 2
      }),
      expect.objectContaining({
        name: 'Ärger Channel',
        sourceIndex: 5
      })
    ])

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped duplicate channel'))
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('descramble=1'))
  })

  it('assigns a stable id to each normalized channel', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    const channels = parseM3U(samplePlaylist, { logger })

    expect(channels[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^[a-f0-9]{12}$/)
    }))
    expect(channels.every((channel) => channel.id.length === 12)).toBe(true)
    expect(new Set(channels.map((channel) => channel.id)).size).toBe(channels.length)
  })

  it('accepts rtsp stream urls for pass-through playback', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const playlist = `#EXTM3U
#EXTINF:0,Discovery HD
rtsp://10.0.1.195:554/?freq=298&x_ci=1`

    expect(parseM3U(playlist, { logger })).toEqual([
      expect.objectContaining({
        name: 'Discovery HD',
        streamUrl: 'rtsp://10.0.1.195:554/?freq=298&x_ci=1'
      })
    ])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('drops invalid channels and redacts warnings', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }

    expect(parseM3U(invalidOnlyPlaylist, { logger })).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped invalid channel'))
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('descramble=1'))
  })
})
