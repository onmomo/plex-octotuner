import { describe, expect, it } from 'vitest'
import { loadBridgeConfig } from '../../server/lib/config'

describe('loadBridgeConfig', () => {
  it('throws when required env vars are missing', () => {
    expect(() => loadBridgeConfig({})).toThrow(/M3U_URL/)
  })
})
