#!/bin/bash

set -euo pipefail

PORT="${PORT:-9222}"
WORKSPACE_DIR="${WORKSPACE_DIR:-$HOME/workspace/.copilot}"
USER_DATA_DIR="${USER_DATA_DIR:-$WORKSPACE_DIR/data/chrome-debug-profile}"
LOG_DIR="${LOG_DIR:-$WORKSPACE_DIR/logs}"
LOG_FILE="$LOG_DIR/chrome-debug.log"

resolve_chrome_bin() {
  if [[ -n "${CHROME_BIN:-}" ]]; then
    printf '%s\n' "$CHROME_BIN"
    return 0
  fi

  if [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
    printf '%s\n' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    return 0
  fi

  if command -v google-chrome >/dev/null 2>&1; then
    command -v google-chrome
    return 0
  fi

  if command -v chromium >/dev/null 2>&1; then
    command -v chromium
    return 0
  fi

  echo "Could not find Chrome. Set CHROME_BIN to your Chrome executable." >&2
  return 1
}

CHROME_BIN="$(resolve_chrome_bin)"

mkdir -p "$USER_DATA_DIR" "$LOG_DIR"

"$CHROME_BIN" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$USER_DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "about:blank" >>"$LOG_FILE" 2>&1 &

echo "Chrome started on port $PORT"
echo "Profile: $USER_DATA_DIR"
echo "Log: $LOG_FILE"
