# syntax=docker/dockerfile:1
# Stage 1: Go server only. The web/player build will be copied in
# as a second source once Etapa 4 lands (web/player/dist -> /app/web/player/dist).

FROM golang:1.24-alpine AS builder
WORKDIR /src/server
COPY server/go.mod ./
RUN go mod download || true
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kinolink .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/kinolink /app/kinolink
# NOTE: web/player/dist will be copied to /app/web/player/dist once Etapa 4
# lands; until then the server answers 503 with a hint on / (API works).
# The --static-dir default (web/player/dist) already resolves under WORKDIR.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD ["/app/kinolink", "--help"]
ENTRYPOINT ["/app/kinolink"]
CMD ["--lan"]
