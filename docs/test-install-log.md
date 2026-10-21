# Test install log

A record of every step used to install pi and this config on a blank machine, so it can be repeated.

## Test machine

- Proxmox VM, Ubuntu 26.04.1 LTS, user `admini`. Plain Ubuntu, not WSL; the steps are the same.
- Already present: git, curl, tmux, python3. Not present: Node.js, npm, pi.

## Steps (2026-10-21)

1. System packages:

   ```bash
   sudo apt-get update
   sudo apt-get install -y git curl tmux python3 python3-venv
   ```

2. Node.js. The pi installer only offers to install Node in an interactive terminal; over a non-interactive SSH session it stops with "install Node.js 22.19.0 or newer". Ubuntu 26.04's own Node (22.22.1) is new enough:

   ```bash
   sudo apt-get install -y nodejs npm
   ```

3. pi (installed pi 1.3.0):

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   export PATH="$HOME/.pi/agent/bin:$PATH"   # or open a new terminal
   ```

4. This repo:

   ```bash
   git clone https://github.com/quanticate/pi-config ~/pi-config
   cd ~/pi-config && ./install.sh
   ```

5. Chromium system libraries (fresh Ubuntu only; the installer detects this and tells you):

   ```bash
   cd ~/.pi/agent/extensions/browser && sudo npx playwright-core install-deps chromium
   ```

## Checks

| Check | Result |
| --- | --- |
| `pi list` shows pi-mcp-adapter and pi-interactive-subagents | ✅ |
| All 10 extensions, 4 skills and 3 sub-agents copied | ✅ |
| `pi -p` starts with no extension errors (only the expected built-in `mcp` notice) | ✅ after fix 2 |
| Headless Chromium opens a page | ✅ after step 5 |
| `~/.pi/agent/bin/yt-dlp --version` | ✅ 2026.08.19 |
| Re-running `install.sh` changes nothing | ✅ |
| AI calls, sub-agent tmux panes, Chrome pairing | Not tested (no provider login; no Windows Chrome on the VM) |

## Problems found and fixed

1. Chromium failed to start (`libatk-1.0.so.0` missing). The installer now test-launches Chromium and, if it fails, prints the `install-deps` command as a required step instead of an optional hint.
2. pi showed "Failed to connect to browser … bearer token" on every start until Chrome was paired, because the token file didn't exist yet. The installer now creates the token file (`~/.browser-mcp-secrets.json`, private to the user).
