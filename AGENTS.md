# AGENTS.md

## Project Type

This repository is a Go project.

## Test Commands

Run tests with direct `go test` commands only.

Preferred examples:
- `go test ./...`
- `go test ./internal/rtsp`
- `go test ./internal/httpapi`
- `go test -run TestRelaySendsTeardownOnContextCancel ./internal/rtsp`
- `go test -race ./internal/rtsp`

## Command Style

Do not use shell scripting features for verification commands.
Avoid pipes, redirection, `;`, `&&`, `||`, shell variables, and subshells.

Run each command directly as its own invocation.

## Formatting

Format Go files with direct `gofmt -w` commands.

Example:
- `gofmt -w internal/rtsp/relay.go internal/rtsp/relay_test.go`
