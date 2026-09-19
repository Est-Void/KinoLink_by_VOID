#!/bin/sh
# KinoLink server installer.
#
#   curl -sSL https://raw.githubusercontent.com/Est-Void/KinoLink_by_VOID/main/install.sh | sh
#
# Installs the prebuilt Go server binary + the player bundle from the latest
# GitHub release (or --version) and enables autostart via systemd user unit.
# The browser userscript is installed separately in Tampermonkey.
#
# Env overrides: KINOLINK_VERSION, KINOLINK_BIN_DIR, KINOLINK_SHARE_DIR,
#   KINOLINK_PORT, KINOLINK_NO_SERVICE=1

set -eu

REPO="Est-Void/KinoLink_by_VOID"
SERVICE_NAME="kinolink.service"
USERSCRIPT_URL="https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/main/web/userscript/dist/kinolink.user.js"

BIN_DIR="${KINOLINK_BIN_DIR:-$HOME/.local/bin}"
SHARE_DIR="${KINOLINK_SHARE_DIR:-$HOME/.local/share/kinolink}"
VERSION="${KINOLINK_VERSION:-}"
NO_SERVICE="${KINOLINK_NO_SERVICE:-0}"
PORT="${KINOLINK_PORT:-8080}"

usage() {
	echo "Usage: install.sh [--version <tag>] [--bin-dir <path>] [--port <port>] [--no-service]"
	echo "  curl -sSL https://raw.githubusercontent.com/Est-Void/KinoLink_by_VOID/main/install.sh | sh"
}

while [ $# -gt 0 ]; do
	case "$1" in
		--version)
			[ $# -ge 2 ] || { echo "error: --version needs a tag (e.g. v2.0.5)" >&2; exit 1; }
			VERSION="$2"
			shift 2
			;;
		--bin-dir)
			[ $# -ge 2 ] || { echo "error: --bin-dir needs a path" >&2; exit 1; }
			BIN_DIR="$2"
			shift 2
			;;
		--port)
			[ $# -ge 2 ] || { echo "error: --port needs a number" >&2; exit 1; }
			PORT="$2"
			shift 2
			;;
		--no-service)
			NO_SERVICE=1
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "error: unknown flag: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have curl || die "curl not found — install curl first"
have tar || die "tar not found — install tar first"

case "$(uname -s)" in
	Linux) OS="linux" ;;
	Darwin) OS="darwin" ;;
	*) die "unsupported OS: $(uname -s) (linux and darwin only)" ;;
esac
case "$(uname -m)" in
	x86_64|amd64) ARCH="amd64" ;;
	aarch64|arm64) ARCH="arm64" ;;
	*) die "unsupported architecture: $(uname -m) (amd64 and arm64 only)" ;;
esac

if [ -z "$VERSION" ]; then
	say "[KinoLink] Resolving latest release..."
	VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
	[ -n "$VERSION" ] || die "could not resolve latest release (set --version explicitly, e.g. --version v2.0.5)"
fi
say "[KinoLink] Installing $VERSION for $OS/$ARCH"

TMPDIR_="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_"' EXIT INT TERM

BIN_ASSET="kinolink-$OS-$ARCH"
say "[KinoLink] Downloading $BIN_ASSET..."
curl -fsSL -o "$TMPDIR_/$BIN_ASSET" "https://github.com/$REPO/releases/download/$VERSION/$BIN_ASSET" \
	|| die "download failed — check that release $VERSION has asset $BIN_ASSET"
if curl -fsSL -o "$TMPDIR_/$BIN_ASSET.sha256" "https://github.com/$REPO/releases/download/$VERSION/$BIN_ASSET.sha256" 2>/dev/null; then
	if have sha256sum; then
		(cd "$TMPDIR_" && echo "$(cat "$BIN_ASSET.sha256")  $BIN_ASSET" | sha256sum -c -) \
			|| die "checksum mismatch for $BIN_ASSET"
		say "[KinoLink] Checksum OK"
	else
		say "[KinoLink] Warning: sha256sum missing, skipping verification"
	fi
else
	say "[KinoLink] Warning: no checksum file, skipping verification"
fi

say "[KinoLink] Downloading player bundle..."
curl -fsSL -o "$TMPDIR_/player-dist.tar.gz" "https://github.com/$REPO/releases/download/$VERSION/player-dist.tar.gz" \
	|| die "download failed — check that release $VERSION has asset player-dist.tar.gz"

mkdir -p "$BIN_DIR" "$SHARE_DIR/player-dist"
install -m755 "$TMPDIR_/$BIN_ASSET" "$BIN_DIR/kinolink"
tar -xzf "$TMPDIR_/player-dist.tar.gz" -C "$SHARE_DIR/player-dist"
[ -f "$SHARE_DIR/player-dist/index.html" ] || die "player bundle looks broken (index.html missing)"
say "[KinoLink] Installed to $BIN_DIR/kinolink"

case ":$PATH:" in
	*":$BIN_DIR:"*) ;;
	*) say "[KinoLink] Note: $BIN_DIR is not in PATH — add: export PATH=\"\$BIN_DIR:\$PATH\"" ;;
esac

STATIC_ARGS=""
[ "$PORT" != "8080" ] && STATIC_ARGS=" --port $PORT"

install_service() {
	[ "$NO_SERVICE" = "1" ] && { say "[KinoLink] Skipping service setup (--no-service)."; return 0; }
	have systemctl || { say "[KinoLink] No systemctl — skipping autostart setup."; return 0; }
	systemctl --user show-environment >/dev/null 2>&1 || { say "[KinoLink] No user systemd — skipping autostart setup."; return 0; }

	SERVICE_DIR="$HOME/.config/systemd/user"
	mkdir -p "$SERVICE_DIR"
	cat > "$SERVICE_DIR/$SERVICE_NAME" <<EOF
[Unit]
Description=KinoLink local player server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BIN_DIR/kinolink --static-dir $SHARE_DIR/player-dist$STATIC_ARGS
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

	systemctl --user daemon-reload
	systemctl --user enable --now "$SERVICE_NAME" || say "[KinoLink] Could not enable service, start manually instead."
	say "[KinoLink] Autostart enabled: systemctl --user {status,restart,stop} $SERVICE_NAME"
}

install_service

say ""
say "[KinoLink] Done."
say "  Player:  http://127.0.0.1:$PORT"
say "  Script:  install in Tampermonkey/Violentmonkey from"
say "           $USERSCRIPT_URL"
say "  Manual:  $BIN_DIR/kinolink --static-dir $SHARE_DIR/player-dist$STATIC_ARGS"
