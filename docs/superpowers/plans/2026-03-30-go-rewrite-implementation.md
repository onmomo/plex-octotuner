# Go Rewrite Implementation Plan

## Goal

Replace the former JavaScript bridge with a single Go binary that preserves the existing Plex-facing behavior while improving RTSP/RTP ingest reliability.

## Tasks

- [ ] Task 1: Scaffold the Go service
Create `go.mod`, the main binary entrypoint, and a minimal package layout under `cmd/` and `internal/`.

- [ ] Task 2: Port config and logging
Implement env parsing, validation, startup logging, and fail-fast deployment checks.

- [ ] Task 3: Port M3U parsing and channel identity
Implement playlist fetch, parsing, stable channel IDs, ordered dedupe, and fallback guide numbering.

- [ ] Task 4: Port channel store and refresh loop
Add startup load, periodic refresh, and last-good-lineup retention.

- [ ] Task 5: Port HDHomeRun HTTP handlers
Implement `discover.json`, `device.xml`, `lineup.json`, `lineup_status.json`, `lineup.post`, and `/auto/v...`.

- [ ] Task 6: Port SSDP and HDHomeRun discovery
Implement multicast search responses, startup notify, and UDP discovery behavior.

- [ ] Task 7: Port HDHomeRun TCP control socket
Implement the tuner control/status endpoints Plex expects.

- [ ] Task 8: Implement native RTSP/SAT>IP relay
Implement RTSP transport negotiation, UDP/TCP ingest, RTP reorder/jitter handling, and stdout-like HTTP streaming to Plex.

- [ ] Task 9: Add diagnostics and session summaries
Implement RTP gap, TS continuity, and session-end summary logging in the Go relay.

- [ ] Task 10: Replace Docker packaging
Build and ship a single Linux binary in Docker, keeping `--network host` as the documented supported mode.

- [ ] Task 11: Verify against Plex on Linux
Test manual tuner add, playback, and artifact behavior on the Linux/PMS host against the Go implementation.
