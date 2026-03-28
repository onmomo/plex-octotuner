import { describe, expect, it } from 'vitest'
import { buildLineup } from '../../../server/lib/hdhr/lineup'
import { buildLineupStatus } from '../../../server/lib/hdhr/lineup-status'

describe('buildLineup', () => {
  it('serializes normalized channels into HDHomeRun lineup entries', () => {
    const channels = [
      {
        id: '2f8c4d9a3e10',
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
})

describe('buildLineupStatus', () => {
  it('serializes the static no-scan lineup status contract', () => {
    expect(buildLineupStatus()).toEqual({
      ScanInProgress: 0,
      ScanPossible: 0,
      Source: 'Cable',
      SourceList: ['Cable']
    })
  })
})
