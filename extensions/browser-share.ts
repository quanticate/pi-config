/**
 * Browser MCP Lite session controller.
 *
 * The server is deliberately opt-in: it is started only by `/browser-share on`.
 * The Chrome extension is paired once outside Pi; the server reads its token from
 * ~/.browser-mcp-secrets.json and this extension never reads or prints that token.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SERVER_NAME = "browser";
const STATUS_KEY = "browser-share";
const MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";
const HEALTH_URL = "http://127.0.0.1:12307/ping";
const DEFAULT_SERVER_DIR = join(homedir(), "browser-mcp-lite-v1.0.3", "server");
const TOKEN_FILE = join(homedir(), ".browser-mcp-secrets.json");
const HEALTH_TIMEOUT_MS = 800;
const START_TIMEOUT_MS = 10_000;
const ADAPTER_TIMEOUT_MS = 6_000;

interface Health {
  server: true;
  extension: boolean;
}

type AdapterStatus =
  | "connected"
  | "cached"
  | "failed"
  | "needs-auth"
  | "not-connected"
  | "disabled"
  | "unknown";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Check that pairing has happened without retaining or displaying the token. */
function hasUsablePairing(): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    return isObject(value) && typeof value.token === "string" && value.token.length >= 32;
  } catch {
    return false;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveDelay();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolveDelay();
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function pingServer(signal?: AbortSignal): Promise<Health | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) return null;
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isObject(body) && body.status === "ok"
      ? { server: true, extension: body.extension === true }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function waitForServer(signal?: AbortSignal): Promise<Health | null> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline && !signal?.aborted) {
    const health = await pingServer(signal);
    if (health) return health;
    await delay(150, signal);
  }
  return null;
}

function adapterStatusFromSnapshot(raw: unknown): AdapterStatus {
  if (!isObject(raw) || !Array.isArray(raw.servers)) return "unknown";
  const server = raw.servers.find((entry) => isObject(entry) && entry.name === SERVER_NAME);
  if (!isObject(server)) return "not-connected";
  const status = server.status;
  return status === "connected" || status === "cached" || status === "failed" ||
    status === "needs-auth" || status === "not-connected" || status === "disabled"
    ? status
    : "unknown";
}

function adapterLabel(status: AdapterStatus): string {
  switch (status) {
    case "connected": return "MCP connected";
    case "cached": return "MCP cached";
    case "failed": return "MCP failed";
    case "needs-auth": return "MCP needs auth";
    case "not-connected": return "MCP disconnected";
    case "disabled": return "MCP disabled";
    default: return "MCP unknown";
  }
}

export default function browserShare(pi: ExtensionAPI): void {
  let child: ChildProcess | null = null;
  let active = false;
  let currentCtx: ExtensionContext | null = null;
  let latestHealth: Health | null = null;
  let adapterStatus: AdapterStatus = "unknown";
  let adapterEventSequence = 0;
  let operation: Promise<void> = Promise.resolve();
  let lifecycleController = new AbortController();
  let lifecycleGeneration = 0;
  let shuttingDown = false;

  function cancelledError(): Error {
    const error = new Error("Browser sharing session is shutting down");
    error.name = "AbortError";
    return error;
  }

  function assertCurrent(generation: number, signal: AbortSignal): void {
    if (shuttingDown || generation !== lifecycleGeneration || signal.aborted) {
      throw cancelledError();
    }
  }

  function notify(message: string, type: "info" | "warning" | "error" = "info"): void {
    if (currentCtx?.hasUI) currentCtx.ui.notify(message, type);
  }

  function renderStatus(): void {
    if (!currentCtx?.hasUI) return;
    if (!active && !latestHealth) {
      currentCtx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const server = latestHealth ? "server alive" : "server unavailable";
    const extension = latestHealth
      ? latestHealth.extension ? "Chrome connected" : "Chrome disconnected"
      : "Chrome unknown";
    currentCtx.ui.setStatus(
      STATUS_KEY,
      `${active ? "Browser share on" : "Browser share off"} · ${server} · ${extension} · ${adapterLabel(adapterStatus)}`,
    );
  }

  function updateHealth(health: Health | null): void {
    latestHealth = health;
    renderStatus();
  }

  function stopOwnedChild(): Promise<void> {
    const process = child;
    if (!process) return Promise.resolve();
    child = null;

    return new Promise((resolveStop) => {
      let settled = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        resolveStop();
      };
      process.once("exit", finish);
      process.once("close", finish);
      if (process.exitCode !== null || process.signalCode !== null) {
        finish();
        return;
      }
      try {
        process.kill("SIGTERM");
      } catch {
        finish();
        return;
      }
      forceTimer = setTimeout(() => {
        if (process.exitCode === null && process.signalCode === null) {
          try {
            process.kill("SIGKILL");
          } catch {
            // The child may have exited between the liveness check and kill.
          }
        }
        finish();
      }, 2_000);
      forceTimer.unref?.();
    });
  }

  function startOwnedChild(): void {
    const serverDir = resolve(process.env.BROWSER_MCP_LITE_DIR ?? DEFAULT_SERVER_DIR);
    const serverEntry = join(serverDir, "index.js");
    if (!existsSync(serverEntry)) {
      throw new Error(`Browser MCP Lite server not found at ${serverEntry}`);
    }

    const childProcess = spawn(process.execPath, [serverEntry], {
      cwd: serverDir,
      env: { ...process.env },
      stdio: "ignore",
      detached: false,
      windowsHide: true,
    });
    childProcess.unref();
    child = childProcess;

    childProcess.once("error", (error) => {
      if (child !== childProcess) return;
      child = null;
      if (active) {
        updateHealth(null);
        notify(`Browser MCP Lite stopped: ${error.message}`, "error");
      }
    });
    childProcess.once("exit", (code, signal) => {
      if (child !== childProcess) return;
      child = null;
      if (active) {
        updateHealth(null);
        notify(
          `Browser MCP Lite stopped unexpectedly (${signal ?? `exit ${code ?? "unknown"}`}).`,
          "error",
        );
      }
    });
  }

  function waitForAdapterEvent(previousSequence: number): Promise<void> {
    if (adapterEventSequence > previousSequence) return Promise.resolve();
    return new Promise((resolveWait) => {
      const deadline = setTimeout(resolveWait, ADAPTER_TIMEOUT_MS);
      const check = () => {
        if (adapterEventSequence <= previousSequence) return;
        clearTimeout(deadline);
        resolveWait();
      };
      const interval = setInterval(check, 25);
      interval.unref?.();
      setTimeout(() => clearInterval(interval), ADAPTER_TIMEOUT_MS + 50).unref?.();
    });
  }

  /**
   * pi-mcp-adapter@2.32.1 has no public cross-extension reconnect method or
   * reconnect event. Its documented command path is safe here: Pi dispatches
   * a leading slash command only when expandPromptTemplates is true, and the
   * command is handled before a user message is written to session history.
   */
  async function requestAdapterReconnect(generation: number, signal: AbortSignal): Promise<void> {
    assertCurrent(generation, signal);
    const previousSequence = adapterEventSequence;
    const statusWait = waitForAdapterEvent(previousSequence);
    await pi.sendUserMessage(`/mcp reconnect ${SERVER_NAME}`, {
      expandPromptTemplates: true,
    });
    // sendUserMessage is intentionally fire-and-forget in the extension API.
    // Wait for the adapter's status event (or its bounded timeout) before the
    // operation is allowed to finish, so shutdown can serialize behind it.
    await statusWait;
    assertCurrent(generation, signal);
  }

  async function refreshStatus(generation: number, signal: AbortSignal): Promise<Health | null> {
    const health = await pingServer(signal);
    assertCurrent(generation, signal);
    updateHealth(health);
    return health;
  }

  async function turnOn(generation: number, signal: AbortSignal): Promise<void> {
    assertCurrent(generation, signal);
    active = true;
    renderStatus();

    if (!hasUsablePairing()) {
      notify(
        "Browser MCP Lite is not paired yet. Run the pairing command once, paste its token into the Chrome extension, click Connect, then use /browser-share on.",
        "warning",
      );
      active = false;
      renderStatus();
      return;
    }

    let health = await pingServer(signal);
    assertCurrent(generation, signal);
    if (!health && !child) {
      try {
        startOwnedChild();
      } catch (error) {
        active = false;
        renderStatus();
        throw error;
      }
      health = await waitForServer(signal);
      assertCurrent(generation, signal);
    } else if (!health && child) {
      health = await waitForServer(signal);
      assertCurrent(generation, signal);
    }

    updateHealth(health);
    if (!health) {
      await stopOwnedChild();
      assertCurrent(generation, signal);
      active = false;
      renderStatus();
      throw new Error("Browser MCP Lite did not become healthy; no process was adopted or stopped.");
    }

    await requestAdapterReconnect(generation, signal);
    // Re-ping after reconnect: the server or its Chrome extension may have
    // changed while the adapter was refreshing its MCP session.
    const finalHealth = await refreshStatus(generation, signal);
    if (!finalHealth) {
      throw new Error("Browser MCP Lite stopped while MCP was reconnecting.");
    }
    if (finalHealth.extension && adapterStatus === "connected") {
      notify("Browser sharing on: server, Chrome extension, and MCP are ready.", "info");
    } else if (!finalHealth.extension) {
      notify("Browser sharing on: server is alive, but the Chrome extension is disconnected. Open its popup and click Connect.", "warning");
    } else {
      notify(`Browser sharing on: server and Chrome are ready, but ${adapterLabel(adapterStatus).toLowerCase()}.`, "warning");
    }
  }

  async function turnOff(generation: number, signal: AbortSignal): Promise<void> {
    const owned = child !== null;
    active = false;
    await stopOwnedChild();
    assertCurrent(generation, signal);
    await refreshStatus(generation, signal);

    // There is no adapter-level disconnect API. Reconnect after stopping our
    // child so the adapter closes its old session and publishes a failed status.
    // An externally-owned server is never touched.
    if (owned) await requestAdapterReconnect(generation, signal);
    renderStatus();
    notify(
      owned
        ? "Browser sharing off; the Pi-owned server was stopped."
        : "Browser sharing off; no Pi-owned server was stopped.",
      "info",
    );
  }

  async function showStatus(generation: number, signal: AbortSignal, ctx: ExtensionContext): Promise<void> {
    await refreshStatus(generation, signal);
    const ownership = child ? "owned by this Pi session" : "not owned by this Pi session";
    const server = latestHealth ? `alive (${ownership})` : "not reachable";
    const extension = latestHealth
      ? latestHealth.extension ? "connected" : "disconnected"
      : "unknown";
    const lines = [
      `Browser sharing: ${active ? "on" : "off"}`,
      `Server: ${server}`,
      `Chrome extension: ${extension}`,
      `Pi MCP: ${adapterLabel(adapterStatus)}`,
      "",
      "Use /browser-share on or /browser-share off.",
    ];
    ctx.ui.notify(lines.join("\n"), "info");
    renderStatus();
  }

  function enqueue(action: (generation: number, signal: AbortSignal) => Promise<void>): Promise<void> {
    const generation = lifecycleGeneration;
    const signal = lifecycleController.signal;
    const run = () => {
      assertCurrent(generation, signal);
      return action(generation, signal);
    };
    const next = operation.then(run, run);
    operation = next.catch(() => {});
    return next;
  }

  pi.events.on(MCP_STATUS_EVENT, (raw: unknown) => {
    adapterStatus = adapterStatusFromSnapshot(raw);
    adapterEventSequence++;
    renderStatus();
  });

  pi.on("session_start", async (_event, ctx) => {
    lifecycleController.abort();
    lifecycleController = new AbortController();
    lifecycleGeneration++;
    shuttingDown = false;
    currentCtx = ctx;
    active = false;
    latestHealth = null;
    adapterStatus = "unknown";
    renderStatus();
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    lifecycleGeneration++;
    lifecycleController.abort();
    active = false;
    latestHealth = null;
    // A command can be between spawn/health/reconnect steps. Invalidate it,
    // then wait for the serialized operation to finish before stopping the
    // owned process. This prevents late reconnects or child starts after
    // session shutdown begins.
    await operation;
    await stopOwnedChild();
    currentCtx = null;
  });

  pi.registerCommand("browser-share", {
    description: "Start, stop, or inspect Browser MCP Lite (on|off|status)",
    getArgumentCompletions: (prefix: string) => {
      const choices = ["on", "off", "status"]
        .filter((choice) => choice.startsWith(prefix.trimStart()));
      return choices.length > 0 ? choices.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length > 1) {
        ctx.ui.notify("Usage: /browser-share on|off|status", "error");
        return;
      }
      const command = (parts[0] ?? "status").toLowerCase();
      if (command !== "on" && command !== "off" && command !== "status") {
        ctx.ui.notify("Usage: /browser-share on|off|status", "error");
        return;
      }
      try {
        if (command === "status") {
          await enqueue((generation, signal) => showStatus(generation, signal, ctx));
        } else {
          await enqueue(command === "on" ? turnOn : turnOff);
        }
      } catch (error) {
        if (shuttingDown || (error instanceof Error && error.name === "AbortError")) return;
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Browser sharing ${command} failed: ${message}`, "error");
        renderStatus();
      }
    },
  });
}
