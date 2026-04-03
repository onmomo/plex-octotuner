# Go Rewrite Design

## Goal

Rewrite `plex-octotuner` as a single Go service that exposes an HDHomeRun-compatible tuner to Plex, loads channels from an Octopus-generated M3U playlist, and relays descrambled RTSP/SAT>IP channels to Plex as HTTP MPEG-TS without transcoding.

## Why Rewrite

The former Nuxt/Nitro implementation proved the product idea works, but the remaining complexity was concentrated in areas that are a better fit for a systems/runtime language than a web-first JavaScript framework:

- SSDP multicast and HDHomeRun UDP discovery
- HDHomeRun control socket handling
- RTSP/SAT>IP session management
- RTP ingest and MPEG-TS integrity handling
- Docker/Linux host-network deployment behavior

The bridge now behaves correctly at a protocol level, but reliability depends heavily on the media ingest path. Rewriting the full service in Go removes the Node/runtime boundary, simplifies deployment, and puts all networking and streaming work in a better-suited runtime.

## Recommended Architecture

Build one Go binary with these subsystems:

### Config

- parse env vars on startup
- validate alignment between bind port, advertised base URL, and device identity
- fail fast for invalid deployment configuration

### Playlist And Channel Store

- fetch and parse M3U at startup
- assign stable channel identities
- refresh periodically in the background
- retain last good lineup on refresh failure

### HDHomeRun HTTP Surface

- `GET /discover.json`
- `GET /device.xml`
- `GET /dri/device.xml`
- `GET /lineup.json`
- `GET /lineup_status.json`
- `POST /lineup.post`
- `GET /auto/v<channel-id>`

### Discovery

- SSDP M-SEARCH response handling
- SSDP startup NOTIFY messages
- HDHomeRun UDP discovery on port `65001`
- HDHomeRun TCP control socket

### Media Relay

- direct HTTP redirect for `http(s)` upstreams
- native RTSP/SAT>IP relay for `rtsp(s)` upstreams
- transport negotiation with TCP-first probing and UDP fallback
- bounded RTP reorder/jitter handling
- TS integrity diagnostics

## External Contract To Preserve

The rewrite should preserve the already-validated external behavior:

- same env variable names where reasonable
- one virtual HDHomeRun device
- same lineup and discovery endpoint shapes
- same channel numbering behavior, including M3U-order fallback numbering
- same Linux host-network deployment recommendation
- same manual Plex add workflow when auto-discovery on the same host is unreliable

## Preferred Deployment

The supported deployment should remain:

- Linux host
- Docker `--network host`
- bridge on the same host as Plex Media Server or another stable wired LAN host

The service should treat an invalid advertised IPv4 address as a startup error.

## Package Layout

Suggested layout:

```text
cmd/plex-octotuner/
internal/config/
internal/logging/
internal/m3u/
internal/channels/
internal/hdhr/
internal/discovery/
internal/rtsp/
internal/httpapi/
```

This keeps the HTTP, discovery, and media concerns separate while still compiling into one binary.

## Logging

Logs should stay concise and operationally useful:

- startup config
- loaded channel count
- channel playback started
- negotiated relay transport
- relay media started
- relay media ended summary
- warnings only for meaningful integrity issues or config/deployment problems

## Reliability Goals

Compared with the previous JS bridge, the rewrite should improve:

- UDP socket handling under bursty RTP load
- RTP packet reordering behavior
- cleanup behavior on client disconnect
- same-process observability for playback diagnostics
- Docker/runtime portability

## Testing Strategy

### Go Tests

- config validation
- M3U parsing and channel identity
- lineup serialization
- SSDP packet generation
- HDHomeRun discovery reply generation
- HDHomeRun control command handling
- RTSP transport negotiation
- RTP reorder behavior

### Integration Tests

- HTTP endpoints against an in-process server
- discovery socket behavior on local test ports
- RTSP fixture server proving TCP and UDP transport paths

### Manual Verification

- Plex manual tuner add on Linux host
- playback of descrambled Octopus RTSP channels
- confirm absence or reduction of RTP/TS integrity warnings compared with the Node relay baseline

## Migration Strategy

Do not port everything line-for-line.

Instead:

1. preserve the external contract
2. preserve the validated Plex-facing behavior
3. re-implement each subsystem idiomatically in Go

The previous Nuxt bridge should be treated as a historical behavioral reference, not a structural template.

## Non-Goals

- no transcoding
- no browser UI
- no general IPTV server features
- no ffmpeg dependency in the default path
