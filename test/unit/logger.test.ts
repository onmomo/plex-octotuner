import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../server/lib/logger'

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes log lines to the matching console method while keeping recent sink entries', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger()

    logger.info('startup ok')
    logger.warn('refresh warning')
    logger.error('refresh failed')

    expect(info).toHaveBeenCalledWith('startup ok')
    expect(warn).toHaveBeenCalledWith('refresh warning')
    expect(error).toHaveBeenCalledWith('refresh failed')
    expect(logger.sink).toEqual([
      'startup ok',
      'refresh warning',
      'refresh failed'
    ])
  })

  it('preserves useful Error fields and redacts urls inside them', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger()
    const error = new Error('fetch failed for http://user:pass@octopus.local/playlist.m3u?token=secret#frag')
    error.stack = `Error: fetch failed for http://user:pass@octopus.local/playlist.m3u?token=secret#frag
    at fetchPlaylist (http://octopus.local/stream/channel/1?descramble=1:1:1)`

    logger.error('playlist refresh failed', error)

    expect(logger.sink[0]).toContain('playlist refresh failed')
    expect(logger.sink[0]).toContain('"message":"fetch failed for http://octopus.local/playlist.m3u"')
    expect(logger.sink[0]).toContain('"name":"Error"')
    expect(logger.sink[0]).toContain('"stack":"Error: fetch failed for http://octopus.local/playlist.m3u')
    expect(logger.sink[0]).not.toContain('token=secret')
    expect(logger.sink[0]).not.toContain('descramble=1')
    expect(logger.sink[0]).not.toContain('user:pass@')
  })

  it('preserves the full upstream url for playback start logs only', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const logger = createLogger()

    logger.info('channel playback started', {
      channelId: '2ef7f254bca6',
      channelName: 'Das Erste HD',
      upstreamUrl: 'http://octopus.local:8888/stream/channel/1?descramble=1'
    })

    expect(logger.sink[0]).toContain('"upstreamUrl":"http://octopus.local:8888/stream/channel/1?descramble=1"')
  })

  it('bounds the in-memory sink for long-lived service use', () => {
    const writer = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = createLogger(writer, 2)

    logger.info('one')
    logger.info('two')
    logger.info('three')

    expect(logger.sink).toEqual(['two', 'three'])
  })
})
