# RTSP Helper Design

## Goal

Replace the current Node-based RTSP/RTP ingest path for `rtsp://` and `rtsps://` channels with a small native helper that behaves more like a real media client, while keeping the existing Nuxt/Nitro bridge responsible for HDHomeRun discovery, lineup generation, runtime config, and Plex-facing HTTP routes.

## Why

The current bridge works functionally, but live debugging showed that:

- Octopus rejects the tested interleaved TCP `SETUP` variants with `461 Unsupported Transport`
- descrambled playback therefore falls back to UDP transport
- the Node relay can observe large RTP sequence gaps and MPEG-TS continuity mismatches
- those gaps correlate with visible artifacts and audio drift in Plex

Running the bridge on the same Linux host as Plex reduced the problem, but did not eliminate it. The remaining reliability risk is concentrated in the JavaScript RTP ingest path, not in the HDHomeRun or HTTP bridge layers.

## Recommended Approach

Use a small Go helper binary, launched per playback session, that:

- performs the RTSP handshake against Octopus
- negotiates media transport
- receives RTP/RTCP with a native networking stack
- applies bounded jitter/reorder handling
- writes clean MPEG-TS bytes to stdout

The existing Nitro route continues to expose `/auto/v<channel-id>` to Plex. For HTTP upstream channels, it keeps using the current redirect behavior. For RTSP upstream channels, it spawns the helper and streams the helper stdout to Plex as `video/mp2t`.

## Why Go

Go is the smallest practical upgrade from the current architecture:

- easy static Linux builds for Docker
- good UDP/TCP socket control without introducing a complex toolchain
- straightforward process management from Node
- much smaller surface area than wrapping `ffmpeg`

This keeps the project headless and protocol-focused without reintroducing transcoding or media-pipeline sprawl.

## Architecture

### Control Plane

Nuxt/Nitro remains the control plane:

- config parsing
- playlist loading and refresh
- HDHomeRun discovery and lineup endpoints
- playback route selection
- process lifecycle and logging

### Media Ingest Plane

A new native helper owns only RTSP media ingest:

- `native/octo-relay/` contains the helper source
- the helper accepts a structured CLI contract from Node
- stdout carries MPEG-TS to the bridge
- stderr carries structured diagnostics

The bridge treats the helper as a session-scoped child process and destroys it when the Plex request closes.

## Helper Contract

Suggested CLI shape:

```text
octo-relay --url <rtsp-url> --transport auto --stdout-ts
```

Behavior:

- exit non-zero if handshake or media startup fails
- emit MPEG-TS only on stdout
- emit diagnostics on stderr
- prefer transport variants in a deterministic order
- expose whether TCP or UDP was negotiated

The Node side should not parse raw RTP anymore. It should only supervise the helper, pipe stdout to the HTTP response, and surface startup/runtime failures cleanly.

## Transport Strategy

The helper should attempt transport negotiation in this order:

1. `RTP/AVP/TCP;unicast;interleaved=0-1`
2. `RTP/AVP/TCP;interleaved=0-1`
3. UDP unicast with explicit RTP/RTCP client ports

This preserves the current interoperability work while moving actual ingest into the native layer.

## Logging

Bridge logs should stay high signal:

- `channel playback started`
- helper startup failure
- helper negotiated transport
- helper media ended summary

Detailed RTP statistics should come from the helper and be surfaced only as summarized warnings or session-end stats. Raw handshake chatter should remain off by default.

## Docker Packaging

The Docker image should build the Go helper in the build stage and copy the static binary into the runtime image alongside the Nitro output.

The supported deployment remains:

- Linux
- Docker `--network host`
- `ADVERTISED_BASE_URL` using an IPv4 address owned by the host

## Failure Model

- if the helper cannot start, `/auto/v...` returns `502`
- if the helper exits during playback, the HTTP stream ends and the bridge logs the reason
- if the helper reports RTP loss or continuity issues, the bridge logs a concise session summary

## Testing

Required coverage:

- unit tests for helper process spawning and cleanup
- integration tests for route-to-helper piping
- Docker build verification that the helper is present in the runtime image
- at least one helper-level test or fixture proving out-of-order RTP can be recovered before TS output

## Non-Goals

- no transcoding
- no generalized IPTV engine
- no browser UI
- no ffmpeg dependency in the default path
