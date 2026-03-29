import { describe, expect, it } from 'vitest'
import nuxtConfig from '../../nuxt.config'

describe('nuxt config', () => {
  it('binds the dev server to all interfaces for LAN discovery testing', () => {
    expect(nuxtConfig.devServer).toMatchObject({
      host: '0.0.0.0'
    })
  })
})
