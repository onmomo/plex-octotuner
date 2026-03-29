import { describe, expect, it } from 'vitest'
import { buildLineup, type LineupInput } from '../../../server/lib/hdhr/lineup'
import { buildLineupStatus } from '../../../server/lib/hdhr/lineup-status'

describe('buildLineup', () => {
  it('serializes normalized channels into HDHomeRun lineup entries', () => {
    const channels: LineupInput[] = [
      {
        id: '2f8c4d9a3e10',
        sourceIndex: 0,
        number: '101',
        name: 'Das Erste HD'
      }
    ]

    expect(buildLineup(channels, new URL('http://192.168.1.50:34400'))).toEqual([
      {
        GuideNumber: '101',
        GuideName: 'Das Erste HD',
        URL: 'http://192.168.1.50:34400/auto/v2f8c4d9a3e10'
      }
    ])
  })

  it('assigns fallback guide numbers from the original m3u order when a channel has no explicit number', () => {
    const channels: LineupInput[] = [
      {
        id: 'aaaaaaaaaaaa',
        sourceIndex: 4,
        name: 'alpha Channel'
      },
      {
        id: 'bbbbbbbbbbbb',
        sourceIndex: 1,
        name: 'Zulu Channel'
      }
    ]

    expect(buildLineup(channels, new URL('http://192.168.1.50:34400'))).toEqual([
      {
        GuideNumber: '5',
        GuideName: 'alpha Channel',
        URL: 'http://192.168.1.50:34400/auto/vaaaaaaaaaaaa'
      },
      {
        GuideNumber: '2',
        GuideName: 'Zulu Channel',
        URL: 'http://192.168.1.50:34400/auto/vbbbbbbbbbbbb'
      }
    ])
  })
})

describe('buildLineupStatus', () => {
  it('serializes the static no-scan lineup status contract', () => {
    expect(buildLineupStatus()).toStrictEqual({
      ScanInProgress: 0,
      ScanPossible: 0,
      Source: 'Cable',
      SourceList: ['Cable']
    })
  })
})
