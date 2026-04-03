# RTSP Helper Implementation Plan

## Goal

Replace the Node RTSP/RTP relay with a native Go helper while preserving the existing Plex-facing HDHomeRun bridge behavior.

## Tasks

- [ ] Task 1: Add the helper interface on the Node side
Create a small process-launch wrapper in `server/lib/rtsp-helper.ts` that starts the native binary, wires stdout to Plex, captures stderr, and kills the child on request close.

- [ ] Task 2: Switch the playback route to helper-based RTSP handling
Update [`server/routes/auto/[slug].get.ts`](/Users/cmos/workspace/plex-octotuner/server/routes/auto/[slug].get.ts) so RTSP channels use the helper wrapper, while HTTP channels stay on the redirect path.

- [ ] Task 3: Scaffold the Go helper
Add `native/octo-relay/` with a minimal Go module and a CLI that accepts an RTSP URL, negotiates transport, and writes MPEG-TS to stdout.

- [ ] Task 4: Implement RTSP handshake and transport negotiation in Go
Port the proven handshake order from the Node relay and keep the same TCP-first, UDP-fallback behavior.

- [ ] Task 5: Implement UDP ingest, reorder/jitter handling, and TS output in Go
Use native sockets and a bounded reorder window, then write ordered MPEG-TS payload bytes to stdout.

- [ ] Task 6: Add bridge/helper logging and failure mapping
Keep bridge logs concise and convert helper failures into clear `502` responses and session summaries.

- [ ] Task 7: Package the helper into Docker
Update `Dockerfile` so the helper is built in the build stage and copied into the runtime image.

- [ ] Task 8: Add verification coverage
Update route integration tests, add helper wrapper tests, and keep full `yarn vitest run` passing.

- [ ] Task 9: Validate on Linux host-network deployment
Run the bridge on the Linux/PMS host, test manual tuner add, and compare playback stability versus the current Node relay baseline.
