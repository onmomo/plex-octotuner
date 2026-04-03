# GitHub Actions Release And CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Actions for PR CI and `develop` releases, including automatic minor version bumps and Docker Hub publishing.

**Architecture:** Store the version in a root `VERSION` file, update it with a tiny Go helper during the release workflow, and keep CI and publish concerns split across two workflow files that mirror the reference repository's structure. Pass the computed version into Docker builds through `APP_VERSION` metadata.

**Tech Stack:** Go, GitHub Actions, Docker Buildx, Docker Hub, Codecov

---

### Task 1: Add Version Source And Bump Helper

**Files:**
- Create: `VERSION`
- Create: `tools/bumpversion/main.go`

- [ ] **Step 1: Add the version source of truth**

Create `VERSION` with the initial semantic version text.

- [ ] **Step 2: Add the Go bump helper**

Implement a small Go CLI that reads `VERSION`, increments the minor version, resets patch to `0`, writes the file, and prints the new version.

- [ ] **Step 3: Run the helper locally only if needed**

Prefer code review for the helper logic first and avoid mutating `VERSION` during verification unless necessary.

### Task 2: Add Pull Request CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the workflow trigger and base job**

Trigger on pull requests to `develop` and direct pushes to `develop`, mirroring the reference workflow.

- [ ] **Step 2: Add Go build and coverage steps**

Set up Go from `go.mod`, build `./cmd/plex-octotuner`, run `go test -coverprofile=coverage.out ./...`, and upload coverage to Codecov when configured.

- [ ] **Step 3: Add Docker verification build**

Use Buildx to build the Docker image for `linux/amd64` without pushing.

### Task 3: Add Develop Release Workflow

**Files:**
- Create: `.github/workflows/docker-image-publish.yml`

- [ ] **Step 1: Add the `develop` push trigger and concurrency guard**

Keep the workflow layout close to the reference repository.

- [ ] **Step 2: Add version bump, commit, tag, and push steps**

Run the Go helper, commit `VERSION`, create a `v<version>` tag, and push `develop` with tags.

- [ ] **Step 3: Add Docker Hub publish steps**

Log in to Docker Hub, set up Buildx, and push `latest` plus the bumped version tag for `linux/amd64` and `linux/arm64`.

### Task 4: Surface Version Metadata And Docs

**Files:**
- Modify: `Dockerfile`
- Modify: `README.md`

- [ ] **Step 1: Accept `APP_VERSION` in the Dockerfile**

Add the build arg and OCI labels so GitHub Actions can pass the release version into image metadata.

- [ ] **Step 2: Align the README with published image names**

Document `onmomo/plex-octotuner` image usage and mention the automatic `latest` plus version-tag release flow.

### Task 5: Verify Repository State

**Files:**
- Test: `./...`

- [ ] **Step 1: Run Go tests**

Run: `go test ./...`

Expected: all package tests pass.

- [ ] **Step 2: Review workflow files for correctness**

Check trigger conditions, secrets, tags, and image names by reading the YAML after creation.
