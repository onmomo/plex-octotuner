# GitHub Actions Release And CI Design

## Goal

Add GitHub Actions that mirror the workflow split used in `squeeze-plex-hub` as closely as practical for a Go repository:

- validate pull requests with tests, coverage, and a Docker build
- auto-bump the minor version on every merge into `develop`
- push Docker images to Docker Hub as both `latest` and the bumped semantic version

## Constraints

- keep the workflow structure close to the reference repository
- adapt the Node.js release flow to Go without adding a Node.js release dependency
- preserve the current Docker-based deployment story
- assume Docker Hub image name `onmomo/plex-octotuner`

## Recommended Architecture

### Version Source Of Truth

Add a root `VERSION` file with semantic version text. Start at `1.0.0` because the README already describes the supported deployment contract as `v1`.

This file becomes the Go equivalent of the reference repo's `package.json` version field.

### Release Bump Mechanism

Add a tiny Go helper at `tools/bumpversion/main.go` that:

- reads the `VERSION` file
- parses `major.minor.patch`
- increments the minor version
- resets patch to `0`
- writes the new value back to disk
- prints the new version for workflow consumption

Using a Go helper keeps the release flow language-native instead of introducing `npx standard-version` into a Go repository.

### Pull Request CI Workflow

Add `.github/workflows/ci.yml` with the same job intent and rough order as the reference repo:

1. checkout
2. set up Go
3. build the Go binary
4. run tests with coverage
5. upload coverage to Codecov
6. build the Docker image with Buildx without pushing

The workflow should trigger on pull requests to `develop`. To stay close to the reference repo, it can also trigger on direct pushes to `develop`.

### Develop Release Workflow

Add `.github/workflows/docker-image-publish.yml` triggered on pushes to `develop`.

The job should:

1. checkout with full history
2. set up Go
3. configure git for the GitHub Actions bot
4. bump `VERSION`
5. commit the version change
6. create a `v<version>` tag
7. push the commit and tag back to `develop`
8. log into Docker Hub
9. build and push multi-platform images tagged `latest` and `<version>`

This preserves the reference repository's split between CI and publish concerns.

## Docker Integration

Update `Dockerfile` to accept an `APP_VERSION` build arg and surface it through OCI labels. This matches the reference workflow's use of build arguments without changing runtime behavior.

## Secrets And External Dependencies

The workflows should expect:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `CODECOV_TOKEN`

Coverage upload should be skipped cleanly when `CODECOV_TOKEN` is absent.

## Files To Add Or Modify

- add `VERSION`
- add `tools/bumpversion/main.go`
- add `.github/workflows/ci.yml`
- add `.github/workflows/docker-image-publish.yml`
- modify `Dockerfile`
- modify `README.md`

## Testing Strategy

### Local Verification

- run `go test ./...`
- run `go run ./tools/bumpversion -file VERSION -release minor` only if needed during development and restore the file afterward
- confirm workflow YAML is structurally valid by reading it carefully since GitHub-hosted execution is not available locally

### Runtime Validation In GitHub

- open a PR against `develop` and confirm CI runs tests, coverage upload, and Docker build
- merge into `develop` and confirm the publish workflow creates a version commit, a matching git tag, and pushes both Docker tags

## Non-Goals

- no additional release notes generation
- no changelog automation
- no runtime `--version` CLI surface in this pass
