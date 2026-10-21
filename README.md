# pi add-ons: a shared setup for pi on WSL

This folder holds a set of extras for [pi](https://pi.dev), the terminal coding assistant. It adds things like web search, a memory helper, sub-agents that run in their own tmux panes, and tools for reading web pages, PDFs and YouTube captions.

It is set up for **WSL (Ubuntu) and OpenAI**. You do not need a Claude account.

Everything here is installed by one script, `install.sh`. It does not remove or overwrite anything you already have. Files it would replace are saved first as `<name>.bak-<date>`.

---

## What's included

**Extensions** (features that pi loads on start-up)

- **bash-guard**: asks before risky shell commands, and blocks dangerous ones in sub-agents.
- **browser**: a headless Chromium you can drive (open pages, run JavaScript, read the console and network, take screenshots).
- **browser-share**: lets pi use your real, signed-in Chrome on Windows through Browser MCP Lite. Turn it on with `/browser-share on`.
- **interactive-subagents**: runs sub-agents in their own tmux panes so you can watch them. Installed from GitHub (see credits).
- **md-log**: copies the chat into a Markdown file with `/md-log <file>`.
- **observational-memory**: a background helper that summarises sessions. Off by default; turn on with `/om on`.
- **prompt-snippets**: a menu (Alt+S or `/snippets`) of ready-made instructions to insert.
- **session-setup**: a short start-up checklist for the extensions above.
- **web-fetch**: fetches web pages and PDFs as clean text.
- **web-search**: web search through Tavily (with SearXNG as a fallback if you run it).

**Skills** (instructions pi can pick up when a task needs them)

- **analyze-sessions**: reports on cost, prompts and transcripts from your past pi sessions.
- **pdf-reader**: reads, searches and renders PDFs.
- **web-debug**: step-by-step guides for debugging a live website with the browser tools.
- **youtube-transcript**: fetches a YouTube video's captions and saves them to `~/transcripts`.

**Sub-agents**

- **scout**: quick, read-only look through local files.
- **researcher**: searches the web and writes a short, sourced summary.
- **worker**: reads, writes and edits files. It can call scout and researcher.

**Other**

- **Browser MCP Lite** server, plus its start script (`~/.pi/agent/scripts/start-browser-mcp-lite.sh`).
- **APPEND_SYSTEM.md**: asks pi to answer in short, plain English.

---

## What you need first

1. **WSL with Ubuntu** on Windows, and a terminal open inside it.
2. **Some packages from Ubuntu.** Run this once, in your WSL terminal:

   ```bash
   sudo apt update && sudo apt install -y git curl tmux python3 python3-venv
   ```

3. **Node.js 22.19 or newer.** The pi installer in the next step offers to set this up for you. Or install Ubuntu's own Node first, which is new enough on Ubuntu 26.04:

   ```bash
   sudo apt install -y nodejs npm
   ```

   Check it with `node -v`.
4. **pi itself.** If you do not have it yet, run:

   ```bash
   curl -fsSL https://pi.dev/install.sh | sh
   ```

   Then close the terminal, open a new one, and check with `pi --version`.
5. **An OpenAI API key.** Everything in this setup, including the sub-agents, uses OpenAI. You can set it in pi with `/login`, or with `export OPENAI_API_KEY=...` in your shell.
6. **Chrome on Windows.** Only needed if you want `/browser-share`, which controls your real Chrome.

`install.sh` checks items 1 to 4 before it changes anything. If something is missing, it tells you the command to fix it and stops.

---

## Install

1. Get this folder onto your machine:

   ```bash
   git clone https://github.com/quanticate/pi-config ~/pi-config
   cd ~/pi-config
   ```

2. Run the installer. **Do not use `sudo`**:

   ```bash
   ./install.sh
   ```

   If it says "permission denied", run `bash install.sh` instead.

The first run takes several minutes, mostly because it downloads Chromium (about 150 MB). You can run it again at any time. It only changes what is out of date.

3. **Fresh Ubuntu only:** if the installer says Chromium is missing system libraries, run this once (it asks for your password):

   ```bash
   cd ~/.pi/agent/extensions/browser && sudo npx playwright-core install-deps chromium
   ```

When it finishes, it prints a short checklist. The steps below are the same, with more detail.

---

## ⚠️ After installing: change the sub-agent models

**Do this before you use sub-agents.**

The scout, researcher and worker sub-agents each have a `model:` line near the top of their file. These are the files to open:

- `~/.pi/agent/agents/scout.md`
- `~/.pi/agent/agents/researcher.md`
- `~/.pi/agent/agents/worker.md`

They are set to `openai/gpt-5.4-mini` (scout and worker) and `openai/gpt-5.4` (researcher). Start pi and type `/model` to see which OpenAI models your account can use. If one of these is not in the list, change its `model:` line to one that is. The format is `openai/<model-name>`.

The installer keeps your edits. If you run `install.sh` again, it will not overwrite these three files.

---

## Other steps

### 1. Connect pi to OpenAI

Start pi by typing `pi`. Then type `/login`, choose OpenAI and paste your key. Then type `/model` and pick an OpenAI model for your main chat.

### 2. Web search (optional)

Web search needs a Tavily key. Either:

- put the key in a file called `~/.config/tavily/api-key` (only the key on one line), or
- set `export TAVILY_API_KEY=...` in your shell.

If you skip this, the other tools still work. Only web search will fail.

### 3. Browser control with `/browser-share` (optional)

This controls your real Chrome, so do it once and then forget about it.

1. Copy the Chrome extension to a Windows folder. Replace `<your Windows name>` with your Windows user name:

   ```bash
   cp -r ~/browser-mcp-lite-v1.0.3/extension /mnt/c/Users/<your Windows name>/browser-mcp-lite-extension
   ```

2. In Chrome on Windows, type `chrome://extensions` in the address bar.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `browser-mcp-lite-extension` folder you just copied.
5. In your WSL terminal, run:

   ```bash
   ~/.pi/agent/scripts/start-browser-mcp-lite.sh
   ```

   It prints a pairing token. Copy it.
6. Click the Browser MCP Lite icon in Chrome, paste the token into the **Auth Token** box, and click **Connect**. The dot turns green when it works.
7. Back in the WSL terminal, press **Ctrl+C**.

From then on, type `/browser-share on` in pi when you need it, and `/browser-share off` when you are done. The token is stored on your computer in a private file. It is never written into this folder.

### 4. Observational memory (optional)

It is set to use OpenAI, so your OpenAI key is enough. It is off by default. Type `/om on` to turn it on.

---

## What needs your own accounts or keys

| Thing | Needed for | Where it lives |
|---|---|---|
| OpenAI API key | pi itself, sub-agents, observational memory | pi's own login store (`/login`) or `OPENAI_API_KEY` |
| Tavily API key (optional) | web search | `~/.config/tavily/api-key` or `TAVILY_API_KEY` |
| Browser MCP Lite pairing token | `/browser-share` | created by the server in `~/.browser-mcp-secrets.json` |

Nothing in this folder contains a key or a token. If you ever see one in a file here, do not share it, and tell whoever set this up.

Not included: Paseo skills (install them through the Paseo app if you want them), and Claude-based models.

---

## Troubleshooting

- **"missing: ..." when you run `install.sh`**: the message says what to install. Install it, then run the script again.
- **pi prints a warning about the built-in `mcp` extension**: you can ignore it. The MCP adapter provides `/mcp` instead.
- **"Not logged in" when you start pi**: run `/login` and choose OpenAI.
- **Chromium complains about missing system libraries**: run this once, and type your password when asked:

  ```bash
  cd ~/.pi/agent/extensions/browser && sudo npx playwright-core install-deps chromium
  ```

- **Chrome says it cannot connect when you click Connect**: make sure `start-browser-mcp-lite.sh` is still running in WSL, then try again.
- **You want to start again**: the backups are next to the original files, named `*.bak-<date>`. Copy one back to restore it.

---

## Credits and licences

This setup is put together from MIT-licensed projects, plus pi itself:

- **interactive-subagents** by Amos Blomqvist, MIT. Installed unchanged from [github.com/amosblomqvist/pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents) (pinned to one commit). It is a fork of [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents).
- **Browser MCP Lite** by notoriouslab, MIT. Installed from [github.com/notoriouslab/browser-mcp-lite](https://github.com/notoriouslab/browser-mcp-lite), release v1.0.3.
- **pi-mcp-adapter** by Nico Bailon, MIT. Installed from npm.
- **pi** by Earendil, MIT.
- **observational-memory** includes its own MIT licence in `extensions/observational-memory/LICENSE`.

The other extensions, skills and sub-agents in this folder were written for this setup.
