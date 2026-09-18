# syntax=docker/dockerfile:1
# The image bakes in the built player, so run `make web-build` first
# (web/player/dist must exist in the build context).

FROM golang:1.24-alpine AS builder
WORKDIR /src/server
COPY server/go.mod ./
RUN go mod download || true
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kinolink .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/kinolink /app/kinolink
# Served by the --static-dir default (web/player/dist under WORKDIR).
COPY web/player/dist /app/web/player/dist
EXPOSE 8080
# --healthcheck performs a real /api/status probe: distroless has no curl/wget.
# The port is pinned so the mapped container port always matches the server.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD ["/app/kinolink", "--healthcheck", "--port", "8080"]
ENTRYPOINT ["/app/kinolink"]
CMD ["--lan", "--port", "8080"]
