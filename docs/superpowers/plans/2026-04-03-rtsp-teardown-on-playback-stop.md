# RTSP Teardown On Playback Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a best-effort RTSP `TEARDOWN` to the Octopus upstream as soon as Plex stops the HTTP playback request.

**Architecture:** Keep the existing request-context cancellation path, but teach the RTSP relay to retain the negotiated session details and issue a best-effort `TEARDOWN` during shutdown. Cover the behavior with a regression test that proves cancellation now produces an explicit upstream teardown without surfacing cleanup failures to Plex.

**Tech Stack:** Go, `net`, `net/http`, existing RTSP relay tests

---

### Task 1: Add the failing teardown regression test

**Files:**
- Modify: `internal/rtsp/relay_test.go`
- Test: `internal/rtsp/relay_test.go`

- [ ] **Step 1: Write the failing test**
Add a relay test that starts a fixture RTSP server, begins playback, cancels the relay context, and asserts the server receives `TEARDOWN` with the negotiated session.

- [ ] **Step 2: Run test to verify it fails**
Run: `go test ./internal/rtsp -run TestRelaySendsTeardownOnContextCancel`
Expected: FAIL because the fixture never sees `TEARDOWN`

### Task 2: Implement best-effort teardown

**Files:**
- Modify: `internal/rtsp/relay.go`
- Test: `internal/rtsp/relay_test.go`

- [ ] **Step 1: Write minimal implementation**
Store the session ID and chosen control URL after `SETUP`/`PLAY`, add a helper that sends `TEARDOWN`, and call it during relay shutdown without returning cleanup errors to Plex.

- [ ] **Step 2: Run targeted tests to verify it passes**
Run: `go test ./internal/rtsp -run TestRelaySendsTeardownOnContextCancel`
Expected: PASS

### Task 3: Verify surrounding playback behavior

**Files:**
- Modify: `internal/httpapi/server_test.go`
- Test: `internal/rtsp/relay_test.go`
- Test: `internal/httpapi/server_test.go`

- [ ] **Step 1: Run focused regression coverage**
Run: `go test ./internal/rtsp ./internal/httpapi`
Expected: PASS with no regressions in RTSP relay or HTTP playback handling
