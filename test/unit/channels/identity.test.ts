import { describe, expect, it } from 'vitest'
import { buildChannelIdentity } from '../../../server/lib/channels/identity'

describe('buildChannelIdentity', () => {
  it('prefers tvg id when present', () => {
    expect(buildChannelIdentity({
      tvgId: 'das-erste-hd',
      number: '101',
      name: 'Das Erste HD',
      streamUrl: 'http://octopus.local/stream?id=1&descramble=1'
    }).key).toBe('tvg-id:das-erste-hd')
  })

  it('falls back to number and name when tvg id is missing', () => {
    expect(buildChannelIdentity({
      number: '101',
      name: 'Das Erste HD',
      streamUrl: 'http://octopus.local/stream/channel/1?descramble=1'
    }).key).toBe('number-name:101:das-erste-hd')
  })

  it('falls back to name and stream path when no tvg id or number exists', () => {
    expect(buildChannelIdentity({
      name: 'Das Erste HD',
      streamUrl: 'http://octopus.local:8888/stream/channel/1?descramble=1'
    }).key).toBe('name-path:das-erste-hd:/stream/channel/1')
  })

  it('ignores whitespace-only tvg ids and numbers after normalization', () => {
    expect(buildChannelIdentity({
      tvgId: '   ',
      number: '101',
      name: 'Das Erste HD',
      streamUrl: 'http://octopus.local:8888/stream/channel/1?descramble=1'
    }).key).toBe('number-name:101:das-erste-hd')

    expect(buildChannelIdentity({
      number: '   ',
      name: 'Das Erste HD',
      streamUrl: 'http://octopus.local:8888/stream/channel/1?descramble=1'
    }).key).toBe('name-path:das-erste-hd:/stream/channel/1')
  })

  it('keeps non-ascii-only metadata from collapsing into empty identities', () => {
    const first = buildChannelIdentity({
      name: 'テレビ',
      streamUrl: 'http://octopus.local:8888/stream/channel/1?descramble=1'
    }).key

    const second = buildChannelIdentity({
      name: 'مرحبا',
      streamUrl: 'http://octopus.local:8888/stream/channel/2?descramble=1'
    }).key

    expect(first).toBe('path:/stream/channel/1')
    expect(second).toBe('path:/stream/channel/2')
    expect(first).not.toBe(second)
  })
})
