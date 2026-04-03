FROM golang:1.24-alpine AS build

WORKDIR /src

COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

ARG TARGETOS=linux
ARG TARGETARCH=amd64

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o /out/plex-octotuner ./cmd/plex-octotuner

FROM alpine:3.21 AS runtime

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=build /out/plex-octotuner /usr/local/bin/plex-octotuner

EXPOSE 34400/tcp
EXPOSE 1900/udp
EXPOSE 65001/udp
EXPOSE 65001/tcp

CMD ["plex-octotuner"]
