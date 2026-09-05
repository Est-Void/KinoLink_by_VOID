#!/bin/sh

set -eu

REPO_URL="https://github.com/Est-Void/KinoLink_by_VOID.git"
RAW_USERSCRIPT="https://github.com/Est-Void/KinoLink_by_VOID/raw/main/userscript/kinolink.user.js"
PLAYER_URL="http://127.0.0.1:8080"

DIR="${KINOLINK_DIR:-$HOME/KinoLink_by_VOID}"
NO_SERVICE="${KINOLINK_NO_SERVICE:-0}"

usage() {
	echo "Usage: install.sh [--dir <path>] [--no-service]"
	echo "  curl -sSL https://raw.githubusercontent.com/Est-Void/KinoLink_by_VOID/main/install.sh | sh"
}

while [ $# -gt 0 ]; do
	case "$1" in
		--dir)
			[ $# -ge 2 ] || { echo "error: --dir needs a path" >&2; exit 1; }
			DIR="$2"
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

say "[KinoLink] Installing to: $DIR"

have python3 || die "python3 not found — install Python 3 first"
have git || die "git not found — install git first"

if [ -d "$DIR/.git" ]; then
	say "[KinoLink] Directory exists, updating via git pull..."
	git -C "$DIR" pull --ff-only || die "git pull failed in $DIR"
elif [ -e "$DIR" ]; then
	die "$DIR already exists and is not a git checkout — remove it or use --dir <path>"
else
	say "[KinoLink] Cloning repository..."
	git clone --depth 1 "$REPO_URL" "$DIR" || die "git clone failed"
fi

[ -f "$DIR/player/server.py" ] || die "checkout looks broken: $DIR/player/server.py missing"

python3 -m py_compile "$DIR/player/server.py" || die "player/server.py failed syntax check"

SERVICE_NAME="kinolink.service"
install_service() {
	[ "$NO_SERVICE" = "1" ] && { say "[KinoLink] Skipping service setup (--no-service)."; return 0; }
	have systemctl || { say "[KinoLink] No systemctl — skipping autostart setup."; return 0; }
	systemctl --user show-environment >/dev/null 2>&1 || { say "[KinoLink] No user systemd — skipping autostart setup."; return 0; }
	have python3 || return 0

	SERVICE_DIR="$HOME/.config/systemd/user"
	mkdir -p "$SERVICE_DIR"
	SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME"
	PYBIN="$(command -v python3)"

	cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=KinoLink by VOID local player server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR/player
ExecStart=$PYBIN $DIR/player/server.py
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
say "  1. Start server (if service not enabled):  cd \"$DIR/player\" && python3 server.py"
say "  2. Player URL: $PLAYER_URL"
say "  3. Install userscript in Tampermonkey/Violentmonkey:"
say "     $RAW_USERSCRIPT"
say "  4. Open any Kinopoisk film page and press «Смотреть»."
