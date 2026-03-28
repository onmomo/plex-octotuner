import { readFileSync } from 'node:fs'
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeRuntime } from '../../server/lib/runtime'
import { createBridgeRuntime } from '../../server/lib/runtime'
import autoRoute from '../../server/routes/auto/[slug].get'
import discoverRoute from '../../server/routes/discover.json.get'
import deviceRoute from '../../server/routes/device.xml.get'
import driDeviceRoute from '../../server/routes/dri/device.xml.get'
import lineupRoute from '../../server/routes/lineup.json.get'
import lineupPostRoute from '../../server/routes/lineup.post.post'
import lineupStatusRoute from '../../server/routes/lineup_status.json.get'
import runtimePlugin from '../../server/plugins/runtime.server'

const { mockNitroApp } = vi.hoisted(() => ({
  mockNitroApp: {} as { localRuntime?: BridgeRuntime }
}))

vi.mock('nitropack/runtime', async () => {
  return {
    defineNitroPlugin: <T>(plugin: T) => plugin,
    useNitroApp: () => mockNitroApp
  }
})

const samplePlaylist = readFileSync(new URL('../fixtures/m3u/sample.m3u', import.meta.url), 'utf8')

const validEnv = {
  M3U_URL: 'http://octopus.local/playlist.m3u',
  ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
  HDHR_DEVICE_ID: '105A1B2C',
  HDHR_TUNER_COUNT: '2'
}

describe('required bridge http routes', () => {
  let runtime: BridgeRuntime
  let baseUrl: string
  let localFetch: (path: string, init?: RequestInit & { redirect?: RequestRedirect }) => Promise<Response>
  let $fetch: <T>(path: string, init?: RequestInit) => Promise<T>

  beforeEach(async () => {
    const logger = { info: vi.fn(), error: vi.fn() }

    runtime = await createBridgeRuntime({
      env: validEnv,
      fetchPlaylist: async () => samplePlaylist,
      logger,
      probeDeviceIdCollision: async () => false
    })

    mockNitroApp.localRuntime = runtime

    const app = createApp()
    const router = createRouter()
      .get('/discover.json', discoverRoute)
      .get('/lineup.json', lineupRoute)
      .get('/lineup_status.json', lineupStatusRoute)
      .post('/lineup.post', lineupPostRoute)
      .get('/dri/device.xml', driDeviceRoute)
      .get('/device.xml', deviceRoute)
      .get('/auto/:slug', autoRoute)

    app.use(router.handler)
    const appFetch = toWebHandler(app)

    baseUrl = 'http://test.local'
    localFetch = async (path, init = {}) => appFetch(new Request(new URL(path, baseUrl), init))
    $fetch = async (path, init) => {
      const response = await localFetch(path, init)

      if (!response.ok) {
        throw { statusCode: response.status }
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('json')) {
        return response.json()
      }

      return response.text() as Promise<never>
    }
  })

  afterEach(async () => {
    mockNitroApp.localRuntime = undefined
    await runtime?.stop()
  })

  it('serves discover and lineup status contracts', async () => {
    expect(await $fetch('/discover.json')).toMatchObject({
      FriendlyName: 'octotuner',
      DeviceID: '105A1B2C',
      DeviceAuth: 'octotuner-105A1B2C',
      Manufacturer: 'Silicondust',
      ModelNumber: 'HDTC-2US',
      FirmwareName: 'hdhomeruntc_atsc',
      FirmwareVersion: '20150826',
      BaseURL: 'http://192.168.1.50:34400',
      LineupURL: 'http://192.168.1.50:34400/lineup.json',
      TunerCount: 2
    })

    expect(await $fetch('/lineup_status.json')).toEqual({
      ScanInProgress: 0,
      ScanPossible: 0,
      Source: 'Cable',
      SourceList: ['Cable']
    })
  })

  it('serves lineup and device xml aliases and accepts lineup post requests', async () => {
    const lineup = await $fetch('/lineup.json')
    const numberedChannel = runtime.store.getChannels().find((channel) => channel.number === '101')

    expect(lineup).toContainEqual(expect.objectContaining({
      GuideNumber: '101',
      GuideName: 'Das Erste HD',
      URL: `http://192.168.1.50:34400/auto/v${numberedChannel?.id}`
    }))
    expect(runtime.logger.info).toHaveBeenCalledWith(expect.stringContaining('lineup request'))

    const aliasXml = await $fetch('/device.xml')
    const driXml = await $fetch('/dri/device.xml')
    expect(aliasXml).toBe(driXml)

    const lineupPost = await localFetch('/lineup.post', {
      method: 'POST',
      body: 'scan=start'
    })
    expect(lineupPost.status).toBe(200)
    expect(await lineupPost.text()).toBe('')
  })

  it('redirects channel aliases to the upstream stream url and returns 404 for unknown channels', async () => {
    const channelId = runtime.store.getChannels().find((channel) => channel.number === '101')?.id
    const redirect = await localFetch(`/auto/v${channelId}`, { redirect: 'manual' })

    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('cache-control')).toBe('no-store')
    expect(redirect.headers.get('location')).toBe('http://octopus.local:8888/stream/channel/1?descramble=1')
    expect(runtime.logger.info).toHaveBeenCalledWith(expect.stringContaining('channel request'))

    await expect($fetch('/auto/vunknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('stops the attached bridge runtime when Nitro closes', async () => {
    const stop = vi.fn(async () => {})
    let closeHook: (() => Promise<void>) | undefined

    await runtimePlugin({
      hooks: {
        hookOnce(name: string, handler: () => Promise<void>) {
          if (name === 'close') {
            closeHook = handler
          }
        }
      },
      localRuntime: { stop }
    } as never)

    await closeHook?.()

    expect(stop).toHaveBeenCalledTimes(1)
  })
})
