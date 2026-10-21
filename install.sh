#!/usr/bin/env bash
# install.sh - sets up the shared pi add-ons in your pi agent folder.
#
# Run it as your normal user, from inside this folder. Do NOT use sudo:
#   cd pi-config-share
#   ./install.sh
#
# Safe to run again. Existing files are backed up before they are replaced,
# and settings files are merged rather than overwritten.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
STAMP="$(date +%F)"

BMCL_DIR="$HOME/browser-mcp-lite-v1.0.3"
BMCL_REPO="https://github.com/notoriouslab/browser-mcp-lite"
BMCL_TAG="v1.0.3"
BMCL_COMMIT="892416a9ac43137c910755664fe9ea6546393a71"

# Pi's installer may put its own Node.js here instead of on your PATH.
PI_NODE_BIN="${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin"
if [ -x "$PI_NODE_BIN/node" ]; then PATH="$PI_NODE_BIN:$PATH"; export PATH; fi

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
tilde() { printf '%s' "${1/#"$HOME"/'~'}"; }   # shows /home/you/x as ~/x

if [ "$(id -u)" -eq 0 ]; then
  die "Do not run this script as root or with sudo. Run it as your normal user."
fi

# ---------------------------------------------------------------------------
# 1. Prerequisites. Nothing is changed until all of these pass.
# ---------------------------------------------------------------------------
check_prereqs() {
  say "Checking prerequisites"
  local missing=0

  check_cmd() { # check_cmd <command> <how to fix>
    if command -v "$1" >/dev/null 2>&1; then
      info "ok: $1"
    else
      warn "missing: $1 - $2"
      missing=1
    fi
  }

  check_cmd git    "sudo apt install -y git"
  check_cmd curl   "sudo apt install -y curl"
  check_cmd tmux   "sudo apt install -y tmux"
  check_cmd python3 "sudo apt install -y python3 python3-venv"
  check_cmd npm    "installed with Node.js - see the Node.js line below"

  if python3 -m venv --help >/dev/null 2>&1 && python3 -c 'import ensurepip' >/dev/null 2>&1; then
    info "ok: python3 venv"
  else
    warn "missing: python3 venv support - run: sudo apt install -y python3-venv"
    missing=1
  fi

  if command -v node >/dev/null 2>&1; then
    local v major minor
    v="$(node -p 'process.versions.node')"
    major="${v%%.*}"
    minor="${v#*.}"; minor="${minor%%.*}"
    if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 19 ]; }; then
      info "ok: node $v"
    else
      warn "node $v is too old - pi needs Node.js 22.19 or newer. Install a newer Node.js (for example with nvm)."
      missing=1
    fi
  else
    warn "missing: node - pi needs Node.js 22.19 or newer."
    missing=1
  fi

  if command -v pi >/dev/null 2>&1; then
    info "ok: pi"
  else
    warn "missing: pi - install it first with: curl -fsSL https://pi.dev/install.sh | sh"
    warn "then open a new terminal and run this script again."
    missing=1
  fi

  if [ "$missing" -ne 0 ]; then
    die "Install the missing items above, then run ./install.sh again. Nothing was changed."
  fi
}

# ---------------------------------------------------------------------------
# 2. File helpers. Replaced files are always backed up first.
# ---------------------------------------------------------------------------
backup() { # backup <path> - keeps the old file as <path>.bak-<date>
  local bak="$1.bak-$STAMP"
  if [ -e "$bak" ] || [ -L "$bak" ]; then bak="$1.bak-$STAMP-$(date +%H%M%S)"; fi
  if [ -L "$1" ]; then
    mv "$1" "$bak"          # never write through a symlink
  else
    cp -p "$1" "$bak"
  fi
  info "saved your old copy as $(tilde "$bak")"
}

copy_file() { # copy_file <source> <destination> [replace|keep]
  local src="$1" dst="$2" mode="${3:-replace}" shown
  shown="$(tilde "$dst")"
  mkdir -p "$(dirname "$dst")"
  if [ ! -e "$dst" ] && [ ! -L "$dst" ]; then
    cp "$src" "$dst"
    info "added $shown"
    return
  fi
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    return   # already up to date
  fi
  if [ "$mode" = keep ]; then
    info "kept your existing $shown (you may have edited it)"
    return
  fi
  backup "$dst"
  rm -f "$dst"
  cp "$src" "$dst"
  info "updated $shown"
}

copy_tree() { # copy_tree <source dir> <destination dir> [replace|keep]
  local src="$1" dst="$2" mode="${3:-replace}" f
  while IFS= read -r -d '' f; do
    copy_file "$f" "$dst/${f#"$src"/}" "$mode"
  done < <(find "$src" \( -name node_modules -o -name .venv -o -name __pycache__ -o -name '*.bak*' \) -prune -o -type f -print0)
}

# ---------------------------------------------------------------------------
# 3. Copy the files from this repo into ~/.pi/agent
# ---------------------------------------------------------------------------
copy_files() {
  say "Copying add-on files into $AGENT_DIR"
  mkdir -p "$AGENT_DIR"

  copy_file "$REPO_DIR/APPEND_SYSTEM.md" "$AGENT_DIR/APPEND_SYSTEM.md"
  copy_tree "$REPO_DIR/extensions" "$AGENT_DIR/extensions"
  copy_tree "$REPO_DIR/skills" "$AGENT_DIR/skills"
  copy_tree "$REPO_DIR/scripts" "$AGENT_DIR/scripts"
  # Agents are yours to edit (for example the model: line), so existing ones are kept.
  copy_tree "$REPO_DIR/agents" "$AGENT_DIR/agents" keep

  chmod 755 "$AGENT_DIR"/scripts/*.sh

  if [ -d "$AGENT_DIR/extensions/interactive-subagents" ]; then
    warn "You have a local copy at $AGENT_DIR/extensions/interactive-subagents."
    warn "The sub-agent package is installed from GitHub now, so the two would clash."
    warn "Move that folder aside (for example: mv it to ~/interactive-subagents-old) and run this script again."
  fi
}

# ---------------------------------------------------------------------------
# 4. Merge settings.json and mcp.json (never overwrite what is already there)
# ---------------------------------------------------------------------------
merge_json() { # merge_json <target> <template> <settings|mcp>
  python3 -I - "$1" "$2" "$3" "$STAMP" <<'PY'
import json, os, shutil, sys

target, template_path, kind, stamp = sys.argv[1:5]

with open(template_path, encoding="utf-8") as f:
    template = json.load(f)

original_text = None
existing = {}
if os.path.exists(target):
    with open(target, encoding="utf-8") as f:
        original_text = f.read()
    try:
        existing = json.loads(original_text) if original_text.strip() else {}
    except json.JSONDecodeError as err:
        sys.exit(f"ERROR: {target} is not valid JSON ({err}). Fix it, then run again. Nothing was changed.")
    if not isinstance(existing, dict):
        sys.exit(f"ERROR: {target} does not contain a JSON object. Nothing was changed.")

def package_name(source):
    # "npm:pi-mcp-adapter@2.32.1" and "git:github.com/x/y@abc" both compare as the bare source.
    at = source.rfind("@")
    return source[:at] if at > source.rfind("/") and at > 0 else source

if kind == "settings":
    packages = existing.setdefault("packages", [])
    if not isinstance(packages, list):
        sys.exit(f"ERROR: 'packages' in {target} is not a list. Nothing was changed.")
    have = {package_name(p) for p in packages if isinstance(p, str)}
    for source in template.get("packages", []):
        if source in packages:
            print(f"    package already listed: {source}")
        elif package_name(source) in have:
            print(f"    package {package_name(source)} is already listed with a different version - left as it is")
        else:
            packages.append(source)
            print(f"    added package: {source}")
    for key, value in template.items():
        if key == "packages":
            continue
        if key in existing:
            print(f"    kept your existing '{key}' settings")
        else:
            existing[key] = value
            print(f"    added '{key}' settings")
else:
    servers = existing.setdefault("mcpServers", {})
    for name, config in template.get("mcpServers", {}).items():
        if name not in servers:
            servers[name] = config
            print(f"    added MCP server: {name}")
        elif servers[name] == config:
            print(f"    MCP server already set up: {name}")
        else:
            print(f"    WARNING: you already have an MCP server called '{name}' with different settings. Left unchanged.")
    section = existing.setdefault("settings", {})
    for key, value in template.get("settings", {}).items():
        if key not in section:
            section[key] = value

new_text = json.dumps(existing, indent=2, ensure_ascii=False) + "\n"
if new_text == original_text:
    print("    already up to date")
    sys.exit(0)

os.makedirs(os.path.dirname(target), exist_ok=True)
if original_text is not None:
    bak = f"{target}.bak-{stamp}"
    if os.path.exists(bak):
        bak = f"{target}.bak-{stamp}-{os.getpid()}"
    shutil.copy2(target, bak)
    print(f"    saved your old copy as {os.path.relpath(bak, os.path.expanduser('~'))}")
with open(target, "w", encoding="utf-8") as f:
    f.write(new_text)
if original_text is None:
    os.chmod(target, 0o600)
PY
}

merge_settings() {
  say "Merging pi settings (packages and observational-memory defaults)"
  merge_json "$AGENT_DIR/settings.json" "$REPO_DIR/settings.template.json" settings
}

merge_mcp() {
  say "Merging the Browser MCP server entry into mcp.json"
  merge_json "$AGENT_DIR/mcp.json" "$REPO_DIR/mcp.template.json" mcp
}

# ---------------------------------------------------------------------------
# 5. Small helper so pi's tools can run yt-dlp from the skill's venv
# ---------------------------------------------------------------------------
write_yt_dlp_wrapper() {
  say "Creating the yt-dlp wrapper"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<'EOF'
#!/bin/sh
# Runs the yt-dlp installed in the youtube-transcript skill's virtual environment.
exec "$HOME/.pi/agent/skills/youtube-transcript/.venv/bin/yt-dlp" "$@"
EOF
  chmod 755 "$tmp"
  copy_file "$tmp" "$AGENT_DIR/bin/yt-dlp" replace
  chmod 755 "$AGENT_DIR/bin/yt-dlp"
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
# 6. Python virtual environments for the two skills
# ---------------------------------------------------------------------------
setup_venv() { # setup_venv <skill folder> <requirements file>
  local skill="$1" req="$2"
  if [ ! -x "$skill/.venv/bin/python" ]; then
    info "creating $(basename "$skill")/.venv"
    python3 -m venv "$skill/.venv"
  fi
  info "installing $(basename "$skill") requirements"
  "$skill/.venv/bin/python" -m pip install --quiet -r "$req"
}

setup_python() {
  say "Python environments for the pdf-reader and youtube-transcript skills"
  setup_venv "$AGENT_DIR/skills/pdf-reader" "$AGENT_DIR/skills/pdf-reader/requirements.txt"
  setup_venv "$AGENT_DIR/skills/youtube-transcript" "$AGENT_DIR/skills/youtube-transcript/requirements.txt"
}

# ---------------------------------------------------------------------------
# 7. Node packages for each extension, and Chromium for the browser extension
# ---------------------------------------------------------------------------
npm_install_dir() { # npm_install_dir <folder>
  (
    cd "$1"
    if [ -f package-lock.json ]; then
      npm ci --no-audit --no-fund --loglevel=error
    else
      npm install --no-audit --no-fund --loglevel=error
    fi
  )
}

setup_node() {
  say "Installing Node.js packages for extensions"
  local dir
  for dir in "$AGENT_DIR"/extensions/*/; do
    dir="${dir%/}"
    if [ -f "$dir/package.json" ]; then
      info "$(basename "$dir")"
      npm_install_dir "$dir"
    fi
  done
}

setup_chromium() {
  say "Installing Chromium for the browser extension (about 150 MB, one time)"
  if (cd "$AGENT_DIR/extensions/browser" && npx --no-install playwright-core install chromium); then
    info "Chromium ready"
  else
    warn "Chromium did not install. Try again later with:"
    warn "  cd ~/.pi/agent/extensions/browser && npx playwright-core install chromium"
  fi
  info "If Chromium later complains about missing system libraries, run this once (it asks for your password):"
  info "  cd ~/.pi/agent/extensions/browser && sudo npx playwright-core install-deps chromium"
}

# ---------------------------------------------------------------------------
# 8. Browser MCP Lite server (used by browser-share)
# ---------------------------------------------------------------------------
install_browser_mcp_lite() {
  say "Browser MCP Lite $BMCL_TAG (used by /browser-share)"
  if [ ! -e "$BMCL_DIR" ]; then
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$BMCL_TAG" "$BMCL_REPO" "$BMCL_DIR"
    info "downloaded to $(tilde "$BMCL_DIR")"
  else
    info "found $(tilde "$BMCL_DIR")"
  fi

  local head
  head="$(git -C "$BMCL_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$head" != "$BMCL_COMMIT" ]; then
    die "${BMCL_DIR} is not the $BMCL_TAG release (found commit $head). Move it aside, then run this script again."
  fi
  info "version $BMCL_TAG confirmed"

  info "installing server packages"
  npm_install_dir "$BMCL_DIR/server"
}

# ---------------------------------------------------------------------------
# 9. Interactive sub-agents, from GitHub (pinned to a commit)
# ---------------------------------------------------------------------------
install_pi_packages() {
  say "Installing pi packages declared in settings.json"
  local source
  while IFS= read -r source; do
    info "$source"
    if ! pi install "$source" >/tmp/pi-config-share-install.log 2>&1; then
      warn "pi could not install $source. Details are in /tmp/pi-config-share-install.log"
    fi
  done < <(python3 -I -c 'import json,sys; [print(p) for p in json.load(open(sys.argv[1])).get("packages", []) if isinstance(p, str)]' "$REPO_DIR/settings.template.json")
}

# ---------------------------------------------------------------------------
# Run everything
# ---------------------------------------------------------------------------
check_prereqs
copy_files
merge_settings
merge_mcp
write_yt_dlp_wrapper
setup_python
setup_node
setup_chromium
install_browser_mcp_lite
install_pi_packages

cat <<EOF

==============================================================
  Install finished. A few steps are still yours to do.
==============================================================

1. ⚠️ CHANGE THE SUB-AGENT MODELS (required check)
   Open these three files in a text editor and look at the "model:" line:
     ~/.pi/agent/agents/scout.md
     ~/.pi/agent/agents/researcher.md
     ~/.pi/agent/agents/worker.md
   They are preset to OpenAI models (gpt-5.4-mini and gpt-5.4). If pi
   does not list a model as available in /model, change the model: line
   to one you can use.

2. Connect pi to OpenAI
   Start pi and type /login, or set OPENAI_API_KEY in your shell.

3. Web search (optional)
   Put your Tavily key in ~/.config/tavily/api-key (one line, nothing else),
   or set TAVILY_API_KEY. Without it, web search will not work.

4. Browser control (optional, only if you want /browser-share)
   a. Copy the Chrome extension to Windows, for example:
        cp -r ~/browser-mcp-lite-v1.0.3/extension /mnt/c/Users/<your Windows name>/browser-mcp-lite-extension
   b. In Chrome on Windows, open chrome://extensions, turn on Developer mode,
      click "Load unpacked", and pick that folder.
   c. In WSL, run:  ~/.pi/agent/scripts/start-browser-mcp-lite.sh
      Copy the token it prints into the extension popup and click Connect.
      Then press Ctrl+C in that terminal.
   Then in pi, type /browser-share on whenever you need it.

5. Observational memory (optional, off by default)
   It is set to use OpenAI, so your OpenAI key is enough. Turn it on with /om on.

Full details are in README.md.
EOF
