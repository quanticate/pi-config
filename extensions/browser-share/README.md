# browser-share (pi extension)

Session controller for the **Browser MCP Lite** server. It starts and stops the
server, pairs it with a Chrome extension, and reconciles the result with the
MCP adapter so the agent gets live page-control tools.

This is **not** the same thing as the `browser` extension. That one provides
Playwright tools (`browser_goto`, `browser_console`, …) against a headless
Chromium. `browser-share` exposes a **real, already-signed-in Chrome** via MCP,
using the `mcp__browser_*` tool namespace so the two can coexist.

## Commands

| Command | Effect |
|---|---|
| `/browser-share on` | Starts the server in the background, asks the MCP adapter to reconnect, then reports server, Chrome-extension, and MCP status |
| `/browser-share off` | Stops the server and tears down the MCP session |
| `/browser-share status` | Reports the same three-part status without changing anything |

`status` is the default when the command is run with no argument.

The server is **off by default** and is only ever started by `/browser-share on`.
`off` stops only a server started by the current Pi session — it will not touch
an unrelated process already holding the port.

## One-time pairing

Needed once per Chrome extension install, not per session.

1. Load the Chrome extension from the Browser MCP Lite checkout as an unpacked
   extension (`chrome://extensions` → Developer mode → Load unpacked).
2. Run `~/.pi/agent/scripts/start-browser-mcp-lite.sh` in a **plain terminal**,
   outside Pi. It starts the server, waits until it is healthy, and prints the
   complete pairing token. Run it this way rather than inside Pi so the token
   never lands in session history.
3. Paste the token into the extension popup and click **Connect**.
4. Press Ctrl+C in the terminal. Day-to-day use is `/browser-share on` from then on.

The token is stored in a mode-600 file on disk and is read at connection time by
the adapter configuration. Neither the script nor the extension prints or logs it
during normal operation.

## Pinned version

The matching checkout is expected at `~/browser-mcp-lite-v1.0.3`, pinned to tag
`v1.0.3` (commit `892416a9ac43137c910755664fe9ea6546393a71`). The directory is
overridable with `BROWSER_MCP_LITE_DIR`.

## Security notes

- `inject_script` executes **without** a technical approval prompt from the MCP
  adapter.
- Scripts can read or change whatever page is active, including signed-in
  sessions. Prefer a dedicated Chrome profile holding only the accounts needed
  for the task, rather than a primary everyday profile.
- Pi should ask conversationally before any consequential action — sending a
  message, submitting a form, changing data, making a purchase, or walking
  through an account workflow — and wait for confirmation.

## Where the details live

Port, server directory, token file location, and dependency versions are
**not** repeated here. They are owned by the code and configuration that
enforces them:

- `extensions/browser-share.ts` — server directory, port, health check, token read
- `scripts/start-browser-mcp-lite.sh` — pairing-token extraction and health wait
- `mcp.json` — the `browser` MCP server entry (URL and auth)
- `server/package-lock.json` in the Browser MCP Lite checkout — the locked server dependency tree
