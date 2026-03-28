# plex-octotuner

Nuxt/Nitro bridge that exposes an octopus-generated M3U playlist as a single HDHomeRun-compatible tuner for Plex.

## Supported deployment contract

v1 supports same-LAN Linux Docker deployments with `--network host` only.

- Supported: Linux host networking on the same LAN as Plex
- Not supported in v1: Docker bridge networking, published-port-only setups, or Docker Desktop host emulation
- Why: Plex discovery depends on SSDP multicast and HDHomeRun UDP discovery traffic, so bridge/published-port mode is not a reliable v1 path

## Setup

1. Run `cp .env.example .env`.
2. Fill in the required values:

| Variable | Required | Notes |
| --- | --- | --- |
| `HOST` | Recommended | Keep `0.0.0.0` in Docker |
| `PORT` | Recommended | Nitro bind port; must match `SERVER_PORT` and `ADVERTISED_BASE_URL` |
| `M3U_URL` | Yes | octopus-generated playlist URL |
| `ADVERTISED_BASE_URL` | Yes | LAN-reachable origin Plex uses, with explicit port and no path/query |
| `HDHR_DEVICE_ID` | Yes | Unique 8-character uppercase hexadecimal ID on your LAN |
| `HDHR_DEVICE_AUTH` | No | Defaults to `octotuner-<HDHR_DEVICE_ID>` |
| `HDHR_FRIENDLY_NAME` | No | Defaults to `octotuner` |
| `HDHR_TUNER_COUNT` | No | Defaults to `4` |
| `PLAYLIST_REFRESH_SECONDS` | No | Defaults to `300` |
| `SERVER_PORT` | No | Defaults to `34400`; must match `PORT` and the port in `ADVERTISED_BASE_URL` |

## Docker

Build the production image:

```bash
docker build -t plex-octotuner .
```

Run it on a Linux Docker host with host networking:

```bash
docker run --rm --network host --env-file .env plex-octotuner
```

The supported v1 command above assumes the ports in `.env` stay aligned:

- `PORT` is the Nitro listener port inside the container
- `SERVER_PORT` is the validated bridge port
- `ADVERTISED_BASE_URL` must use the same port Plex will reach on the LAN

## Local verification

Automated checks for this task:

- `yarn vitest run`
- `yarn build`

Manual Plex verification on the supported Docker path:

1. Start the container with `--network host` and confirm startup succeeds with no config or playlist-load errors.
2. In Plex DVR setup, confirm the bridge is discovered on the LAN.
3. Confirm Plex requests `/dri/device.xml`, `/discover.json`, `/lineup_status.json`, and `/lineup.json`.
4. Start playback for a channel and confirm requests hit `/auto/v<channel-id>`.
5. Confirm the playback response is `302 Found` and the redirect target still includes the original octopus descrambler query parameters.
