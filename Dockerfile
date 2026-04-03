ARG APP_VERSION=dev

FROM golang:1.24-alpine AS build

WORKDIR /src

COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

ARG TARGETOS=linux
ARG TARGETARCH=amd64
ARG APP_VERSION

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o /out/plex-octotuner ./cmd/plex-octotuner

FROM alpine:3.21 AS runtime

ARG APP_VERSION

RUN apk add --no-cache ca-certificates

WORKDIR /app

LABEL org.opencontainers.image.title="plex-octotuner" \
      org.opencontainers.image.description="HDHomeRun-compatible Octopus M3U bridge for Plex" \
      org.opencontainers.image.source="https://github.com/onmomo/plex-octotuner" \
      org.opencontainers.image.version="${APP_VERSION}"

COPY --from=build /out/plex-octotuner /usr/local/bin/plex-octotuner

EXPOSE 34400/tcp
EXPOSE 1900/udp
EXPOSE 65001/udp
EXPOSE 65001/tcp

CMD ["plex-octotuner"]
