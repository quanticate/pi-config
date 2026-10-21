#!/usr/bin/env bash
set -euo pipefail

server_dir="${BROWSER_MCP_LITE_DIR:-$HOME/browser-mcp-lite-v1.0.3/server}"
port="${MCP_PORT:-12307}"

if [[ ! -f "$server_dir/index.js" ]]; then
  printf 'Browser MCP Lite server not found: %s\n' "$server_dir" >&2
  printf 'Expected the v1.0.3 checkout at %s\n' "$HOME/browser-mcp-lite-v1.0.3" >&2
  exit 1
fi

cd "$server_dir"

# Keep the old foreground/logging behavior available for troubleshooting, but
# own the actual Node server directly so Ctrl+C cannot orphan an npm wrapper.
if [[ "${1:-}" == "--raw" ]]; then
  exec node index.js
fi
if [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--raw]\n' "$0" >&2
  exit 2
fi

health_url="http://127.0.0.1:${port}/ping"
is_alive() {
  curl --fail --silent --show-error --max-time 1 "$health_url" >/dev/null 2>&1
}

server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if ! is_alive; then
  # Suppress the server's abbreviated first/next-run token line. This command
  # prints the complete token below after the endpoint is confirmed healthy.
  node index.js >/dev/null 2>&1 &
  server_pid=$!

  ready=0
  for _ in $(seq 1 100); do
    if is_alive; then
      ready=1
      break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      wait "$server_pid" 2>/dev/null || true
      break
    fi
    sleep 0.1
  done
  if [[ "$ready" != 1 ]]; then
    printf 'Browser MCP Lite did not become healthy on port %s.\n' "$port" >&2
    exit 1
  fi
else
  printf 'Browser MCP Lite is already running on port %s; it will not be stopped by this command.\n' "$port"
fi

token="$(node -e '
const fs = require("fs");
const os = require("os");
const path = require("path");
const value = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".browser-mcp-secrets.json"), "utf8"));
if (typeof value.token !== "string" || value.token.length < 32) process.exit(1);
process.stdout.write(value.token);
')" || {
  printf 'No usable token found in ~/.browser-mcp-secrets.json.\n' >&2
  exit 1
}

printf '\nBrowser MCP Lite pairing token (paste into the Chrome extension):\n%s\n' "$token"
printf 'Leave this command running while pairing; press Ctrl+C after Chrome shows Connected.\n'

# If this command started the server, keep it alive for the pairing session.
# If another process already owned the port, exit without touching it.
if [[ -n "$server_pid" ]]; then
  wait "$server_pid"
fi
