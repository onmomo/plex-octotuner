# Plex HDHomeRun octopus Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a headless Nuxt 4 bridge that emulates a single HDHomeRun device for Plex, loads channels from an octopus-generated M3U playlist, and redirects playback to the original upstream stream URLs without transcoding.

**Architecture:** Keep the core bridge logic in small `server/lib` modules that can be tested without Nuxt, then wire those modules into Nitro routes, startup orchestration, and UDP discovery sockets. Treat startup validation, first playlist load, and Linux Docker host-network deployment as first-class requirements rather than late integration details.

**Tech Stack:** Nuxt 4, Nitro, TypeScript, Vitest, `@nuxt/test-utils`, Node `dgram`, Node `timers`, `zod`, Yarn modern

---

## Planned File Structure

### Root

- Create: `package.json`
- Create: `.yarnrc.yml`
- Create: `.gitignore`
- Create: `nuxt.config.ts`
- Create: `app.vue`
- Create: `.env.example`
- Create: `README.md`
- Create: `Dockerfile`

### Server Runtime

- Create: `server/lib/config.ts`
- Create: `server/lib/logger.ts`
- Create: `server/lib/m3u-fetch.ts`
- Create: `server/lib/channels/types.ts`
- Create: `server/lib/channels/identity.ts`
- Create: `server/lib/channels/m3u.ts`
- Create: `server/lib/channels/store.ts`
- Create: `server/lib/hdhr/discover-json.ts`
- Create: `server/lib/hdhr/lineup.ts`
- Create: `server/lib/hdhr/lineup-status.ts`
- Create: `server/lib/hdhr/device-xml.ts`
- Create: `server/lib/discovery/ssdp-packets.ts`
- Create: `server/lib/discovery/hdhomerun-packets.ts`
- Create: `server/lib/discovery/device-id-probe.ts`
- Create: `server/lib/discovery/server.ts`
- Create: `server/lib/runtime.ts`
- Create: `server/plugins/runtime.server.ts`

### Nitro Routes

- Create: `server/api/discover.json.get.ts`
- Create: `server/api/lineup.json.get.ts`
- Create: `server/api/lineup_status.json.get.ts`
- Create: `server/api/lineup.post.ts`
- Create: `server/routes/dri/device.xml.get.ts`
- Create: `server/routes/device.xml.get.ts`
- Create: `server/routes/auto/[slug].get.ts`

### Tests And Fixtures

- Create: `test/fixtures/m3u/sample.m3u`
- Create: `test/fixtures/m3u/sample-updated.m3u`
- Create: `test/fixtures/m3u/invalid-only.m3u`
- Create: `test/unit/config.test.ts`
- Create: `test/unit/channels/identity.test.ts`
- Create: `test/unit/channels/m3u.test.ts`
- Create: `test/unit/channels/store.test.ts`
- Create: `test/unit/hdhr/discover-json.test.ts`
- Create: `test/unit/hdhr/lineup.test.ts`
- Create: `test/unit/hdhr/device-xml.test.ts`
- Create: `test/unit/discovery/ssdp-packets.test.ts`
- Create: `test/unit/discovery/hdhomerun-packets.test.ts`
- Create: `test/unit/discovery/device-id-probe.test.ts`
- Create: `test/unit/discovery/server.test.ts`
- Create: `test/integration/runtime-startup.test.ts`
- Create: `test/integration/runtime-refresh.test.ts`
- Create: `test/integration/http-routes.test.ts`

## Task 1: Bootstrap The Blank Repo Into A Runnable Nuxt Workspace

**Files:**
- Create: `package.json`
- Create: `.yarnrc.yml`
- Create: `.gitignore`
- Create: `nuxt.config.ts`
- Create: `app.vue`
- Create: `.env.example`
- Create: `README.md`
- Create: `test/unit/config.test.ts`

- [ ] **Step 1: Create the base project files with exact minimal contents**

```json
{
  "name": "plex-octotuner",
  "private": true,
  "type": "module",
  "packageManager": "yarn@4.9.1",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "test": "vitest run"
  },
  "dependencies": {
    "nuxt": "^4.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@nuxt/test-utils": "^3.17.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

```yaml
# .yarnrc.yml
nodeLinker: node-modules
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  compatibilityDate: '2026-03-28'
})
```

```vue
<!-- app.vue -->
<template>
  <div>plex-octotuner</div>
</template>
```

```dotenv
# .env.example
M3U_URL=http://octopus.local:8888/playlist.m3u
ADVERTISED_BASE_URL=http://192.168.1.50:34400
HDHR_DEVICE_ID=105A1B2C
HDHR_FRIENDLY_NAME=octotuner
HDHR_TUNER_COUNT=4
PLAYLIST_REFRESH_SECONDS=300
SERVER_PORT=34400
```

- [ ] **Step 2: Add the first failing config smoke test**

```ts
import { describe, expect, it } from 'vitest'
import { loadBridgeConfig } from '../../server/lib/config'

describe('loadBridgeConfig', () => {
  it('throws when required env vars are missing', () => {
    expect(() => loadBridgeConfig({})).toThrow(/M3U_URL/)
  })
})
```

- [ ] **Step 3: Install dependencies and generate Nuxt types**

Run: `yarn install`
Expected: install completes and writes `yarn.lock`

Run: `yarn exec nuxi prepare`
Expected: Nuxt generates `.nuxt/tsconfig.json`

- [ ] **Step 4: Run the smoke test to confirm the repo is wired but the config module is still missing**

Run: `yarn vitest run test/unit/config.test.ts`
Expected: FAIL with an import or missing-symbol error for `loadBridgeConfig`

- [ ] **Step 5: Commit the workspace bootstrap**

```bash
git add package.json yarn.lock .yarnrc.yml .gitignore nuxt.config.ts app.vue .env.example README.md test/unit/config.test.ts
git commit -m "chore: bootstrap nuxt bridge workspace"
```

## Task 2: Implement Strict Runtime Config And Redacted Logging

**Files:**
- Create: `server/lib/config.ts`
- Create: `server/lib/logger.ts`
- Modify: `test/unit/config.test.ts`

- [ ] **Step 1: Extend the config test to cover defaults and strict port matching**

```ts
it('applies safe defaults', () => {
  const config = loadBridgeConfig({
    M3U_URL: 'http://octopus.local/playlist.m3u',
    ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
    HDHR_DEVICE_ID: '105A1B2C'
  })

  expect(config.serverPort).toBe(34400)
  expect(config.friendlyName).toBe('octotuner')
  expect(config.playlistRefreshSeconds).toBe(300)
})

it('rejects mismatched advertised and bind ports', () => {
  expect(() => loadBridgeConfig({
    M3U_URL: 'http://octopus.local/playlist.m3u',
    ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
    SERVER_PORT: '3000',
    HDHR_DEVICE_ID: '105A1B2C'
  })).toThrow(/SERVER_PORT/)
})

it('defaults DeviceAuth from DeviceID and rejects invalid ids', () => {
  const config = loadBridgeConfig({
    M3U_URL: 'http://octopus.local/playlist.m3u',
    ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
    HDHR_DEVICE_ID: '105A1B2C'
  })

  expect(config.deviceAuth).toBe('octotuner-105A1B2C')
  expect(() => loadBridgeConfig({
    M3U_URL: 'http://octopus.local/playlist.m3u',
    ADVERTISED_BASE_URL: 'http://192.168.1.50:34400',
    HDHR_DEVICE_ID: 'not-valid'
  })).toThrow(/HDHR_DEVICE_ID/)
})

it('redacts sensitive URLs in startup logs', () => {
  const logger = createLogger()
  logger.info('bridge startup config', {
    m3uUrl: 'http://octopus.local/playlist.m3u?token=secret',
    upstreamUrl: 'http://octopus.local/stream/channel/1?descramble=1'
  })

  expect(logger.sink[0]).not.toContain('token=secret')
  expect(logger.sink[0]).not.toContain('descramble=1')
})
```

- [ ] **Step 2: Run the config test and verify it fails**

Run: `yarn vitest run test/unit/config.test.ts`
Expected: FAIL because `loadBridgeConfig` is not implemented

- [ ] **Step 3: Implement `loadBridgeConfig` plus a logger that never logs raw query strings**

```ts
export function loadBridgeConfig(env: Record<string, string | undefined>): BridgeConfig {
  const parsed = bridgeConfigSchema.parse(env)
  return {
    m3uUrl: new URL(parsed.M3U_URL),
    advertisedBaseUrl: new URL(parsed.ADVERTISED_BASE_URL),
    serverPort: Number(parsed.SERVER_PORT ?? 34400)
  }
}
```

- [ ] **Step 4: Re-run the config test and confirm it passes**

Run: `yarn vitest run test/unit/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the config layer**

```bash
git add server/lib/config.ts server/lib/logger.ts test/unit/config.test.ts
git commit -m "feat: add strict bridge runtime config"
```

## Task 3: Parse And Normalize Channels From M3U

**Files:**
- Create: `server/lib/channels/types.ts`
- Create: `server/lib/channels/identity.ts`
- Create: `server/lib/channels/m3u.ts`
- Create: `test/fixtures/m3u/sample.m3u`
- Create: `test/fixtures/m3u/invalid-only.m3u`
- Create: `test/unit/channels/identity.test.ts`
- Create: `test/unit/channels/m3u.test.ts`

- [ ] **Step 1: Write failing tests for identity rules, scheme filtering, dedupe, and ordering**

```ts
expect(buildChannelIdentity({
  tvgId: 'das-erste-hd',
  number: '101',
  name: 'Das Erste HD',
  streamUrl: 'http://octopus.local/stream?id=1&descramble=1'
}).key).toBe('tvg-id:das-erste-hd')
```

```ts
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

expect(parseM3U(invalidOnlyPlaylist, { logger })).toEqual([])
expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped invalid channel'))
expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped duplicate channel'))
expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('descramble=1'))
```

- [ ] **Step 2: Run the parser tests and verify they fail**

Run: `yarn vitest run test/unit/channels/identity.test.ts test/unit/channels/m3u.test.ts`
Expected: FAIL because the channel modules do not exist

- [ ] **Step 3: Implement channel normalization with deterministic IDs and allowed-scheme filtering**

```ts
export function buildChannelIdentity(input: ChannelIdentityInput): ChannelIdentity {
  if (input.tvgId) return hashIdentity(`tvg-id:${normalize(input.tvgId)}`)
  if (input.number) return hashIdentity(`number-name:${normalize(input.number)}:${normalize(input.name)}`)
  return hashIdentity(`name-path:${normalize(input.name)}:${streamPathKey(input.streamUrl)}`)
}
```

- [ ] **Step 4: Re-run the parser tests and confirm they pass**

Run: `yarn vitest run test/unit/channels/identity.test.ts test/unit/channels/m3u.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the parser layer**

```bash
git add server/lib/channels/types.ts server/lib/channels/identity.ts server/lib/channels/m3u.ts test/fixtures/m3u/sample.m3u test/fixtures/m3u/invalid-only.m3u test/unit/channels/identity.test.ts test/unit/channels/m3u.test.ts
git commit -m "feat: parse and normalize playlist channels"
```

## Task 4: Build The Channel Store And Startup Runtime Initialization

**Files:**
- Create: `server/lib/m3u-fetch.ts`
- Create: `server/lib/channels/store.ts`
- Create: `server/lib/discovery/device-id-probe.ts`
- Create: `server/lib/runtime.ts`
- Create: `test/unit/discovery/device-id-probe.test.ts`
- Create: `test/unit/channels/store.test.ts`
- Create: `test/integration/runtime-startup.test.ts`

- [ ] **Step 1: Write failing startup tests for the mandatory boot gates**

```ts
const logger = { info: vi.fn(), error: vi.fn() }
const runtime = await createBridgeRuntime({
  env: validEnv,
  fetchPlaylist: async () => samplePlaylist,
  logger
})

expect(runtime.store.getChannels()).toEqual([
  expect.objectContaining({ name: 'Das Erste HD' })
])
expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('bridge startup config'))
expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('loaded 2 channels'))

await expect(createBridgeRuntime({
  env: { ...validEnv, M3U_URL: undefined },
  fetchPlaylist: async () => samplePlaylist,
  logger
})).rejects.toThrow(/M3U_URL/)

await expect(createBridgeRuntime({
  env: validEnv,
  fetchPlaylist: async () => { throw new Error('fetch failed') },
  logger
})).rejects.toThrow(/fetch failed/)
expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('playlist fetch failed'), expect.any(Error))
```

```ts
const store = new ChannelStore()
store.replaceFromRaw(samplePlaylist)
expect(store.getChannels()).toHaveLength(2)

await expect(createBridgeRuntime({
  env: validEnv,
  fetchPlaylist: async () => invalidOnlyPlaylist,
  logger
})).rejects.toThrow(/zero valid channels/i)

await expect(createBridgeRuntime({
  env: validEnv,
  fetchPlaylist: async () => samplePlaylist,
  logger,
  probeDeviceIdCollision: async () => true
})).rejects.toThrow(/HDHR_DEVICE_ID/)

expect(await probeDeviceIdCollision(validConfig, async () => [{ deviceId: '105A1B2C' }])).toBe(true)
```

- [ ] **Step 2: Run the startup and device-id probe tests and verify they fail**

Run: `yarn vitest run test/integration/runtime-startup.test.ts test/unit/discovery/device-id-probe.test.ts`
Expected: FAIL because `createBridgeRuntime` and `probeDeviceIdCollision` do not exist

- [ ] **Step 3: Define the runtime contract and implement `ChannelStore`, `fetchM3U`, real device-id collision probing, and `createBridgeRuntime`**

```ts
export interface CreateRuntimeOptions {
  env: Record<string, string | undefined>
  fetchPlaylist: (url: URL) => Promise<string>
  logger: BridgeLogger
  startDiscovery?: (runtime: BridgeRuntime) => Promise<{ stop: () => Promise<void> | void }>
  probeDeviceIdCollision?: (config: BridgeConfig) => Promise<boolean>
}

export interface BridgeRuntime {
  config: BridgeConfig
  logger: BridgeLogger
  store: ChannelStore
  fetchPlaylist: (url: URL) => Promise<string>
  stop: () => Promise<void>
}

export async function probeDeviceIdCollision(
  config: BridgeConfig,
  discoverDevices: () => Promise<Array<{ deviceId: string }>> = discoverLanDevices
) {
  const devices = await discoverDevices()
  return devices.some((device) => device.deviceId === config.deviceId)
}

export async function createBridgeRuntime(options: CreateRuntimeOptions) {
  const config = loadBridgeConfig(options.env)
  const probe = options.probeDeviceIdCollision ?? ((nextConfig) => probeDeviceIdCollision(nextConfig))
  if (await probe(config)) {
    throw new Error('HDHR_DEVICE_ID collision on local network')
  }
  const rawPlaylist = await options.fetchPlaylist(config.m3uUrl)
  const store = new ChannelStore()
  store.replaceFromRaw(rawPlaylist)
  if (store.getChannels().length === 0) throw new Error('zero valid channels')
  return { config, logger: options.logger, store, fetchPlaylist: options.fetchPlaylist, stop: async () => {} }
}
```

- [ ] **Step 4: Re-run the startup and device-id probe tests and confirm they pass**

Run: `yarn vitest run test/integration/runtime-startup.test.ts test/unit/discovery/device-id-probe.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the startup initialization layer**

```bash
git add server/lib/m3u-fetch.ts server/lib/channels/store.ts server/lib/discovery/device-id-probe.ts server/lib/runtime.ts test/unit/discovery/device-id-probe.test.ts test/unit/channels/store.test.ts test/integration/runtime-startup.test.ts
git commit -m "feat: add bridge startup initialization"
```

## Task 5: Add Periodic Refresh Scheduling And Last-Good-Lineup Retention

**Files:**
- Create: `test/fixtures/m3u/sample-updated.m3u`
- Modify: `server/lib/runtime.ts`
- Modify: `server/lib/channels/store.ts`
- Modify: `test/unit/channels/store.test.ts`
- Create: `test/integration/runtime-refresh.test.ts`

- [ ] **Step 1: Write failing tests for refresh swaps, periodic scheduling, and last-good-lineup retention**

```ts
store.replaceFromRaw(samplePlaylist)
const firstId = store.getChannels()[0]?.id
const fetchPlaylist = vi.fn()
  .mockResolvedValueOnce(samplePlaylist)
  .mockResolvedValueOnce(sampleUpdatedPlaylist)

await store.refresh(fetchPlaylist)
expect(store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

await store.refresh(() => samplePlaylist)
expect(store.getChannels()[0]?.id).toBe(firstId)
```

```ts
vi.useFakeTimers()
const fetchPlaylist = vi.fn()
  .mockResolvedValueOnce(samplePlaylist)
  .mockResolvedValueOnce(sampleUpdatedPlaylist)
const logger = { info: vi.fn(), error: vi.fn() }
const runtime = await createBridgeRuntime({
  env: validEnv,
  fetchPlaylist,
  logger
})

await vi.advanceTimersByTimeAsync(300_000)
expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])

fetchPlaylist.mockRejectedValueOnce(new Error('upstream down'))
await vi.advanceTimersByTimeAsync(300_000)
expect(runtime.store.getChannels().map((channel) => channel.number)).toEqual(['101', '103'])
expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('playlist refresh failed'), expect.any(Error))
```

- [ ] **Step 2: Run the refresh tests and verify they fail**

Run: `yarn vitest run test/unit/channels/store.test.ts test/integration/runtime-refresh.test.ts`
Expected: FAIL because periodic scheduling is not implemented yet

- [ ] **Step 3: Implement validate-then-swap refresh logic plus a timer-based scheduler in runtime startup**

```ts
export function startRefreshLoop(runtime: BridgeRuntime) {
  const timer = setInterval(async () => {
    try {
      await runtime.store.refresh(() => runtime.fetchPlaylist(runtime.config.m3uUrl))
    } catch (error) {
      runtime.logger.error('playlist refresh failed', error)
    }
  }, runtime.config.playlistRefreshSeconds * 1000)

  return () => clearInterval(timer)
}
```

- [ ] **Step 4: Re-run the store tests and confirm they pass**

Run: `yarn vitest run test/unit/channels/store.test.ts test/integration/runtime-refresh.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the refresh store**

```bash
git add server/lib/runtime.ts server/lib/channels/store.ts test/fixtures/m3u/sample-updated.m3u test/unit/channels/store.test.ts test/integration/runtime-refresh.test.ts
git commit -m "feat: add scheduled playlist refresh"
```

## Task 6: Serialize The Full HDHomeRun HTTP Contract

**Files:**
- Create: `server/lib/hdhr/discover-json.ts`
- Create: `server/lib/hdhr/lineup.ts`
- Create: `server/lib/hdhr/lineup-status.ts`
- Create: `server/lib/hdhr/device-xml.ts`
- Create: `test/unit/hdhr/discover-json.test.ts`
- Create: `test/unit/hdhr/lineup.test.ts`
- Create: `test/unit/hdhr/device-xml.test.ts`

- [ ] **Step 1: Write failing serializer tests for every required response shape**

```ts
expect(buildDiscoverJson(config)).toMatchObject({
  FriendlyName: 'octotuner',
  Manufacturer: 'Silicondust',
  ModelNumber: 'HDTC-2US',
  FirmwareName: 'hdhomeruntc_atsc',
  FirmwareVersion: '20150826',
  DeviceID: '105A1B2C',
  DeviceAuth: 'octotuner-105A1B2C',
  BaseURL: 'http://192.168.1.50:34400',
  LineupURL: 'http://192.168.1.50:34400/lineup.json',
  TunerCount: 4
})
```

```ts
expect(buildLineupStatus()).toEqual({
  ScanInProgress: 0,
  ScanPossible: 0,
  Source: 'Cable',
  SourceList: ['Cable']
})
```

```ts
expect(buildLineup(channels, new URL('http://192.168.1.50:34400'))).toEqual([
  {
    GuideNumber: '101',
    GuideName: 'Das Erste HD',
    URL: 'http://192.168.1.50:34400/auto/v2f8c4d9a3e10'
  }
])
```

```ts
expect(buildDeviceXml(config)).toContain('<serialNumber>105A1B2C</serialNumber>')
expect(buildDeviceXml(config)).toContain('<friendlyName>octotuner</friendlyName>')
expect(buildDeviceXml(config)).toContain('<presentationURL>http://192.168.1.50:34400/</presentationURL>')
expect(buildDeviceXml(config)).toContain('<UDN>uuid:')
```

- [ ] **Step 2: Run the serializer tests and verify they fail**

Run: `yarn vitest run test/unit/hdhr/discover-json.test.ts test/unit/hdhr/lineup.test.ts test/unit/hdhr/device-xml.test.ts`
Expected: FAIL because the serializer modules do not exist

- [ ] **Step 3: Implement the explicit JSON and XML serializers**

```ts
export function buildLineup(channels: Channel[], baseUrl: URL) {
  return channels.map((channel) => ({
    GuideNumber: channel.number ?? '',
    GuideName: channel.name,
    URL: new URL(`/auto/v${channel.id}`, baseUrl).toString()
  }))
}
```

- [ ] **Step 4: Re-run the serializer tests and confirm they pass**

Run: `yarn vitest run test/unit/hdhr/discover-json.test.ts test/unit/hdhr/lineup.test.ts test/unit/hdhr/device-xml.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the serializer layer**

```bash
git add server/lib/hdhr/discover-json.ts server/lib/hdhr/lineup.ts server/lib/hdhr/lineup-status.ts server/lib/hdhr/device-xml.ts test/unit/hdhr/discover-json.test.ts test/unit/hdhr/lineup.test.ts test/unit/hdhr/device-xml.test.ts
git commit -m "feat: add hdhomerun response serializers"
```

## Task 7: Expose Nitro Routes For Every Required Endpoint

**Files:**
- Create: `server/plugins/runtime.server.ts`
- Create: `server/api/discover.json.get.ts`
- Create: `server/api/lineup.json.get.ts`
- Create: `server/api/lineup_status.json.get.ts`
- Create: `server/api/lineup.post.ts`
- Create: `server/routes/dri/device.xml.get.ts`
- Create: `server/routes/device.xml.get.ts`
- Create: `server/routes/auto/[slug].get.ts`
- Create: `test/integration/http-routes.test.ts`

- [ ] **Step 1: Write failing integration tests for the full HTTP contract**

```ts
const logger = { info: vi.fn(), error: vi.fn() }
expect(await $fetch('/discover.json')).toMatchObject({
  DeviceID: '105A1B2C',
  Manufacturer: 'Silicondust',
  ModelNumber: 'HDTC-2US',
  FirmwareName: 'hdhomeruntc_atsc',
  FirmwareVersion: '20150826'
})

expect(await $fetch('/lineup_status.json')).toEqual({
  ScanInProgress: 0,
  ScanPossible: 0,
  Source: 'Cable',
  SourceList: ['Cable']
})
```

```ts
const runtime = await createBridgeRuntime({
  env: validEnv,
  fetchPlaylist: async () => samplePlaylist,
  logger
})

const lineup = await $fetch('/lineup.json')
expect(lineup).toEqual([
  expect.objectContaining({
    GuideNumber: '101',
    GuideName: 'Das Erste HD',
    URL: `http://192.168.1.50:34400/auto/v${runtime.store.getChannels()[0]?.id}`
  })
])
expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('lineup request'))

const aliasXml = await $fetch('/device.xml')
const driXml = await $fetch('/dri/device.xml')
expect(aliasXml).toBe(driXml)

const lineupPost = await fetch('/lineup.post', { method: 'POST', body: 'scan=start' })
expect(lineupPost.status).toBe(200)
expect(await lineupPost.text()).toBe('')
```

```ts
const channelId = runtime.store.getChannels()[0]?.id
const redirect = await fetch(`/auto/v${channelId}`, { redirect: 'manual' })
expect(redirect.status).toBe(302)
expect(redirect.headers.get('cache-control')).toBe('no-store')
expect(redirect.headers.get('location')).toBe('http://octopus.local:8888/stream/channel/1?descramble=1')
expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('channel request'))

await expect($fetch('/auto/vunknown')).rejects.toMatchObject({ statusCode: 404 })
```

- [ ] **Step 2: Run the route tests and verify they fail**

Run: `yarn vitest run test/integration/http-routes.test.ts`
Expected: FAIL because the Nitro plugin and routes do not exist

- [ ] **Step 3: Implement the plugin runtime accessor and each route handler**

```ts
export default defineNitroPlugin(async (nitroApp) => {
  nitroApp.hooks.hookOnce('close', async () => {
    await nitroApp.localRuntime?.stop?.()
  })
})
```

- [ ] **Step 4: Re-run the route tests and confirm they pass**

Run: `yarn vitest run test/integration/http-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the HTTP route surface**

```bash
git add server/plugins/runtime.server.ts server/api/discover.json.get.ts server/api/lineup.json.get.ts server/api/lineup_status.json.get.ts server/api/lineup.post.ts server/routes/dri/device.xml.get.ts server/routes/device.xml.get.ts server/routes/auto/[slug].get.ts test/integration/http-routes.test.ts
git commit -m "feat: expose required bridge http endpoints"
```

## Task 8: Encode Discovery Payloads Before Opening Sockets

**Files:**
- Create: `server/lib/discovery/ssdp-packets.ts`
- Create: `server/lib/discovery/hdhomerun-packets.ts`
- Create: `test/unit/discovery/ssdp-packets.test.ts`
- Create: `test/unit/discovery/hdhomerun-packets.test.ts`

- [ ] **Step 1: Write failing tests for SSDP and HDHomeRun packet builders**

```ts
const expectedUdn = buildDeviceUdn('105A1B2C')
expect(buildSsdpNotify(config)).toContain('NT: upnp:rootdevice')
expect(buildSsdpNotify(config)).toContain('CACHE-CONTROL: max-age=')
expect(buildSsdpNotify(config)).toContain('SERVER: ')
expect(buildSsdpNotify(config)).toContain('USN: uuid:')
expect(buildSsdpSearchResponse(config, 'upnp:rootdevice')).toContain('ST: upnp:rootdevice')
expect(buildSsdpSearchResponse(config, 'ssdp:all')).toContain('LOCATION: http://192.168.1.50:34400/dri/device.xml')
expect(buildSsdpSearchResponse(config, 'upnp:rootdevice')).toContain(expectedUdn)
```

```ts
const packet = buildHdhomerunDiscoveryReply(config)
expect(decodeTags(packet)).toMatchObject({
  DeviceID: '105A1B2C',
  BaseURL: 'http://192.168.1.50:34400',
  LineupURL: 'http://192.168.1.50:34400/lineup.json',
  TunerCount: 4
})
```

- [ ] **Step 2: Run the packet tests and verify they fail**

Run: `yarn vitest run test/unit/discovery/ssdp-packets.test.ts test/unit/discovery/hdhomerun-packets.test.ts`
Expected: FAIL because the discovery packet builders do not exist

- [ ] **Step 3: Implement deterministic packet builders that follow the approved protocol references**

```ts
export function buildSsdpSearchResponse(config: BridgeConfig, searchTarget: string) {
  return [
    'HTTP/1.1 200 OK',
    `ST: ${searchTarget}`,
    `USN: ${buildUsn(config)}`,
    `LOCATION: ${new URL('/dri/device.xml', config.advertisedBaseUrl).toString()}`
  ].join('\r\n')
}
```

- [ ] **Step 4: Re-run the packet tests and confirm they pass**

Run: `yarn vitest run test/unit/discovery/ssdp-packets.test.ts test/unit/discovery/hdhomerun-packets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the discovery packet builders**

```bash
git add server/lib/discovery/ssdp-packets.ts server/lib/discovery/hdhomerun-packets.ts test/unit/discovery/ssdp-packets.test.ts test/unit/discovery/hdhomerun-packets.test.ts
git commit -m "feat: encode discovery protocol payloads"
```

## Task 9: Bind UDP Discovery Sockets And Reply To Real Requests Cleanly

**Files:**
- Create: `server/lib/discovery/server.ts`
- Modify: `server/lib/runtime.ts`
- Modify: `server/plugins/runtime.server.ts`
- Create: `test/unit/discovery/server.test.ts`

- [ ] **Step 1: Add failing tests for real responder behavior on UDP sockets**

```ts
const startDiscovery = vi.fn(async () => ({ stop: vi.fn() }))
const logger = { info: vi.fn(), error: vi.fn() }

const runtime = await createBridgeRuntime({
  env: validEnv,
  fetchPlaylist: async () => samplePlaylist,
  startDiscovery,
  logger
})

expect(startDiscovery).toHaveBeenCalledTimes(1)
await runtime.stop()
```

- [ ] **Step 1b: Add responder-specific socket tests**

```ts
const logger = { info: vi.fn(), error: vi.fn() }
await handleSsdpMessage({
  message: Buffer.from('M-SEARCH * HTTP/1.1\r\nST: upnp:rootdevice\r\n\r\n'),
  send: sendMock,
  logger,
  config
})
expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('ST: upnp:rootdevice'))

await handleSsdpMessage({
  message: Buffer.from('M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n'),
  send: sendMock,
  logger,
  config
})
expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('ST: ssdp:all'))

await handleSsdpMessage({
  message: Buffer.from('M-SEARCH * HTTP/1.1\r\nST: urn:ignored\r\n\r\n'),
  send: sendMock,
  logger,
  config
})
expect(sendMock).toHaveBeenCalledTimes(2)
```

```ts
await handleHdhomerunDiscoveryRequest({ message: validDiscoverProbe, send: sendMock, logger, config })
expect(sendMock).toHaveBeenCalledWith(expect.any(Uint8Array))
expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('discovery request'))
```

```ts
const notifySend = vi.fn()
await sendStartupNotify({ config, send: notifySend })
expect(notifySend).toHaveBeenCalledWith(
  expect.stringContaining('NTS: ssdp:alive'),
  '239.255.255.250',
  1900
)
```

- [ ] **Step 2: Run the startup and discovery-related tests and verify they fail**

Run: `yarn vitest run test/integration/runtime-startup.test.ts test/unit/discovery/ssdp-packets.test.ts test/unit/discovery/hdhomerun-packets.test.ts test/unit/discovery/server.test.ts`
Expected: FAIL because the responder logic and socket wiring do not exist yet

- [ ] **Step 3: Implement bind, notify, request parsing, target filtering, and reply behavior in a dedicated discovery server module**

```ts
export async function startDiscoveryServer(runtime: BridgeRuntime) {
  const ssdpSocket = createSocket('udp4')
  const hdhomerunSocket = createSocket('udp4')
  ssdpSocket.bind(1900)
  hdhomerunSocket.bind(65001)
  ssdpSocket.addMembership('239.255.255.250')
  return {
    async stop() {
      ssdpSocket.close()
      hdhomerunSocket.close()
    }
  }
}
```

- [ ] **Step 4: Re-run the startup and discovery tests and confirm they pass**

Run: `yarn vitest run test/integration/runtime-startup.test.ts test/unit/discovery/ssdp-packets.test.ts test/unit/discovery/hdhomerun-packets.test.ts test/unit/discovery/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the discovery server lifecycle**

```bash
git add server/lib/discovery/server.ts server/lib/runtime.ts server/plugins/runtime.server.ts test/unit/discovery/server.test.ts test/integration/runtime-startup.test.ts
git commit -m "feat: manage discovery server lifecycle"
```

## Task 10: Package For Linux Docker Host Networking And Verify End To End

**Files:**
- Create: `Dockerfile`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document the supported deployment contract before packaging**

```md
## Docker

V1 supports Linux Docker host networking only.

docker run \
  --network host \
  --env-file .env \
  plex-octotuner
```

- [ ] **Step 2: Add the production Dockerfile**

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable
COPY . .
RUN yarn build
CMD ["node", ".output/server/index.mjs"]
```

- [ ] **Step 3: Run the full automated verification suite**

Run: `yarn vitest run`
Expected: PASS

Run: `yarn build`
Expected: PASS and `.output/` exists

- [ ] **Step 4: Verify the supported Docker deployment path manually**

Run: `docker build -t plex-octotuner .`
Expected: PASS

Run: `docker run --network host --env-file .env plex-octotuner`
Expected: container starts, loads the playlist successfully, and logs no startup validation errors

Complete these manual checks:
- confirm Plex discovers the bridge on the LAN
- confirm Plex requests `/dri/device.xml`, `/discover.json`, `/lineup_status.json`, and `/lineup.json`
- confirm playback requests hit `/auto/v<channel-id>` and return `302 Found`
- confirm the redirect target still contains the octopus descrambler query parameters

- [ ] **Step 5: Commit the packaging and verified docs**

```bash
git add Dockerfile .env.example README.md
git commit -m "docs: add docker deployment and verification"
```
