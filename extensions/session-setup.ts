import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

const MD_LOG_DIR = path.join(homedir(), "mdlogs");

function timestampName(date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function createMdLogFile(): string {
	fs.mkdirSync(MD_LOG_DIR, { recursive: true });
	const base = timestampName();
	let suffix = 0;

	while (true) {
		const suffixText = suffix === 0 ? "" : `-${String(suffix).padStart(2, "0")}`;
		const filepath = path.join(MD_LOG_DIR, `${base}${suffixText}.md`);
		try {
			const fd = fs.openSync(filepath, "wx");
			fs.closeSync(fd);
			return filepath;
		} catch (error: any) {
			if (error?.code !== "EEXIST") throw error;
			suffix++;
		}
	}
}

/**
 * Small startup checklist for the extensions that are useful but session-local.
 * The extensions themselves are already loaded; this just runs their normal
 * commands so their existing state/validation remains authoritative.
 */
export default function sessionSetup(pi: ExtensionAPI): void {
	pi.on("session_start", async (event: any, ctx: any) => {
		// Do not interrupt print/JSON/RPC sessions, or a simple reload/resume.
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		if (event.reason !== "startup" && event.reason !== "new") return;

		const configure = await ctx.ui.select("Session setup — configure your usual extensions?", [
			"Yes, show the checklist",
			"No, leave them as they are",
		]);
		if (configure !== "Yes, show the checklist") return;

		// BashGuard is on by default. The flag is the only way it can start off.
		const bashChoice = await ctx.ui.select("BashGuard", [
			"Disable protection for this session",
			"Enable protection (recommended)",
		]);
		if (bashChoice) {
			const startsDisabled = event.reason === "startup" && pi.getFlag("--bash-guard-disabled") === true;
			const wantsDisabled = bashChoice.startsWith("Disable");
			if (wantsDisabled !== startsDisabled) {
				await pi.sendUserMessage("/bash-guard", { expandPromptTemplates: true });
			}
		}

		const memoryChoice = await ctx.ui.select("Observational memory", [
			"Leave disabled (/om off)",
			"Enable (/om on)",
		]);
		if (memoryChoice) {
			await pi.sendUserMessage(
				memoryChoice.startsWith("Enable") ? "/om on" : "/om off",
				{ expandPromptTemplates: true },
			);
		}

		const logChoice = await ctx.ui.select("MD-log", [
			"Leave MD-log disabled",
			"Create and link a new timestamped Markdown file",
		]);
		if (logChoice === "Create and link a new timestamped Markdown file") {
			try {
				const filepath = createMdLogFile();
				await pi.sendUserMessage(`/md-log ${filepath}`, { expandPromptTemplates: true });
			} catch (error: any) {
				ctx.ui.notify(`Could not create MD-log file: ${error?.message ?? String(error)}`, "error");
			}
		}

		ctx.ui.notify("Session extension setup complete.", "success");
	});
}
