import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface StructuredSearchArgs {
	query?: string;
	exactPhrases?: string[];
	excludeTerms?: string[];
	site?: string;
	count?: number;
}

interface BuiltSearchQuery {
	query: string;
	baseQuery?: string;
	exactPhrases: string[];
	excludeTerms: string[];
	site?: string;
}

const TAVILY_QUOTA_MESSAGE =
	"This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com";
const DEFAULT_SEARXNG_URL = "http://127.0.0.1:8888";

class TavilyQuotaExceededError extends Error {}

function hasTavilyQuotaExceeded(body: string): boolean {
	try {
		const data = JSON.parse(body) as { detail?: { error?: unknown } };
		return data.detail?.error === TAVILY_QUOTA_MESSAGE;
	} catch {
		return false;
	}
}

async function tavilySearch(
	query: string,
	count: number,
	apiKey: string,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const resp = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			api_key: apiKey,
			query,
			search_depth: "basic",
			topic: "general",
			max_results: Math.min(count, 20),
			include_answer: false,
			include_raw_content: false,
		}),
		signal,
	});
	if (!resp.ok) {
		const body = await resp.text();
		if (resp.status === 432 && hasTavilyQuotaExceeded(body)) {
			throw new TavilyQuotaExceededError("Tavily quota exhausted");
		}
		throw new Error(`Tavily API ${resp.status}: ${body.slice(0, 200)}`);
	}

	const data = (await resp.json()) as {
		results?: Array<{
			title?: string;
			url: string;
			content?: string;
		}>;
	};

	return (data.results ?? []).map((item) => ({
		title: item.title || item.url,
		url: item.url,
		snippet: item.content?.replace(/\n/g, " ") ?? "",
	}));
}

function getSearxngSearchUrl(): URL {
	const configured = process.env.SEARXNG_URL?.trim() || DEFAULT_SEARXNG_URL;
	let base: URL;
	try {
		base = new URL(configured);
	} catch {
		throw new Error(`Invalid SEARXNG_URL: ${configured}`);
	}
	if (
		(base.protocol !== "http:" && base.protocol !== "https:") ||
		!base.hostname ||
		base.username ||
		base.password ||
		base.search ||
		base.hash
	) {
		throw new Error(
			"SEARXNG_URL must be an absolute http(s) base URL without credentials, query, or fragment.",
		);
	}
	base.pathname = `${base.pathname.replace(/\/+$/, "")}/search`;
	return base;
}

async function searxngSearch(
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const url = getSearxngSearchUrl();
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");

	const resp = await fetch(url, { signal });
	if (!resp.ok) {
		const body = await resp.text();
		throw new Error(`SearXNG API ${resp.status}: ${body.slice(0, 200)}`);
	}

	const data = (await resp.json()) as {
		results?: Array<{
			title?: unknown;
			url?: unknown;
			content?: unknown;
		}>;
	};
	if (!Array.isArray(data.results)) {
		throw new Error("SearXNG API returned an invalid JSON result format.");
	}

	return data.results
		.filter(
			(item): item is { title?: string; url: string; content?: string } =>
				typeof item.url === "string" && Boolean(item.url),
		)
		.slice(0, count)
		.map((item) => ({
			title: typeof item.title === "string" && item.title ? item.title : item.url,
			url: item.url,
			snippet:
				typeof item.content === "string"
					? item.content.replace(/\n/g, " ")
					: "",
		}));
}

const EXT_DIR = path.dirname(new URL(import.meta.url).pathname);
const AUTH_PATH = path.join(EXT_DIR, "auth.json");
const TAVILY_KEY_PATH = path.join(homedir(), ".config", "tavily", "api-key");
let tavilyQuotaExhausted = false;

function loadCredentials(): { apiKey: string } | null {
	const envApiKey = process.env.TAVILY_API_KEY?.trim();
	if (envApiKey) return { apiKey: envApiKey };

	if (fs.existsSync(AUTH_PATH)) {
		try {
			const config = JSON.parse(fs.readFileSync(AUTH_PATH, "utf-8"));
			const apiKey = config.tavily_api_key as string;
			if (apiKey?.trim()) return { apiKey: apiKey.trim() };
		} catch {}
	}

	try {
		const apiKey = fs.readFileSync(TAVILY_KEY_PATH, "utf-8").trim();
		if (apiKey) return { apiKey };
	} catch {}
	return null;
}

function formatResults(results: SearchResult[]): string {
	if (results.length === 0) return "No results found.";
	return results
		.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
		.join("\n\n");
}

function stripWrappingQuotes(value: string): string {
	return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
		? value.slice(1, -1).trim()
		: value;
}

function cleanItems(values?: string[]): string[] {
	if (!values) return [];
	return values
		.map((value) => stripWrappingQuotes(value.trim().replace(/\s+/g, " ")))
		.filter(Boolean);
}

function cleanQuery(value?: string): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.trim().replace(/\s+/g, " ");
	return cleaned || undefined;
}

function normalizeSite(site?: string): string | undefined {
	if (typeof site !== "string") return undefined;

	let value = site.trim().replace(/^site:/i, "").trim();
	if (!value) return undefined;

	try {
		const candidate = /^[a-z]+:\/\//i.test(value)
			? value
			: `https://${value}`;
		const url = new URL(candidate);
		if (url.hostname) value = url.hostname;
	} catch {}

	return value.replace(/\/+$/, "") || undefined;
}

function quoteForSearch(value: string): string {
	return `"${value.replace(/"/g, '\\"')}"`;
}

function buildSearchQuery(args: StructuredSearchArgs): BuiltSearchQuery {
	const baseQuery = cleanQuery(args.query);
	const exactPhrases = cleanItems(args.exactPhrases);
	const excludeTerms = cleanItems(args.excludeTerms);
	const site = normalizeSite(args.site);

	if (!baseQuery && exactPhrases.length === 0) {
		throw new Error(
			"At least one of 'query' or 'exactPhrases' is required.",
		);
	}

	const parts: string[] = [];
	if (baseQuery) parts.push(baseQuery);
	for (const phrase of exactPhrases) {
		parts.push(quoteForSearch(phrase));
	}
	for (const term of excludeTerms) {
		parts.push(`-${term.includes(" ") ? quoteForSearch(term) : term}`);
	}
	if (site) {
		parts.push(`site:${site}`);
	}

	return {
		query: parts.join(" "),
		baseQuery,
		exactPhrases,
		excludeTerms,
		site,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web via Tavily, falling back to local SearXNG only after Tavily's confirmed quota-exhaustion response. Build one search per call from a base query string, exact phrases, exclusions, and an optional site. Returns title, URL, and snippet.",
		promptSnippet:
			"Search the web via a query string plus optional exactPhrases, excludeTerms, and site. Tavily is primary; local SearXNG is used only after Tavily's confirmed quota exhaustion. Use one tool call per search angle.",
		promptGuidelines: [
			"Use exactPhrases for exact phrase matching instead of embedding quote marks inside the main query string.",
			"Use one web_search tool call per search angle instead of batching multiple searches into one call.",
		],

		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						"Base search query as a normal string. Prefer this for the main search wording.",
				}),
			),
			exactPhrases: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Exact phrases to match. Each item becomes a quoted phrase in the final Tavily query.",
				}),
			),
			excludeTerms: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Terms or phrases to exclude. Multi-word items are excluded as exact phrases.",
				}),
			),
			site: Type.Optional(
				Type.String({
					description:
						"Optional site/domain restriction, such as example.com or a full URL.",
				}),
			),
			count: Type.Optional(
				Type.Number({
					description: "Number of results to return (default: 5, max: 10)",
					minimum: 1,
					maximum: 10,
				}),
			),
		}),

		async execute(_toolCallId, params: StructuredSearchArgs, signal) {
			const count = params.count ?? 5;
			const built = buildSearchQuery(params);
			let results: SearchResult[];
			let provider: "tavily" | "searxng";

			if (tavilyQuotaExhausted) {
				results = await searxngSearch(built.query, count, signal);
				provider = "searxng";
			} else {
				const creds = loadCredentials();
				if (!creds) {
					throw new Error(
						`Missing Tavily credentials. Set TAVILY_API_KEY, create ${AUTH_PATH} with {"tavily_api_key":"..."}, or put the token in ${TAVILY_KEY_PATH}.`,
					);
				}

				try {
					results = await tavilySearch(
						built.query,
						count,
						creds.apiKey,
						signal,
					);
					provider = "tavily";
				} catch (error) {
					if (!(error instanceof TavilyQuotaExceededError)) throw error;
					tavilyQuotaExhausted = true;
					results = await searxngSearch(built.query, count, signal);
					provider = "searxng";
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: formatResults(results),
					},
				],
				details: {
					composedQuery: built.query,
					query: built.baseQuery,
					exactPhrases: built.exactPhrases,
					excludeTerms: built.excludeTerms,
					site: built.site,
					provider,
					resultCount: results.length,
				},
			};
		},

		renderCall(args, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);
			const { count, ...searchArgs } = args as StructuredSearchArgs;

			try {
				const built = buildSearchQuery(searchArgs);
				const display =
					built.query.length > 70
						? built.query.slice(0, 67) + "..."
						: built.query;
				const lines = [
					theme.fg("toolTitle", theme.bold("search ")) +
						theme.fg("accent", `"${display}"`),
				];
				if (count && count !== 5) {
					lines.push(theme.fg("dim", `  count: ${count}`));
				}
				text.setText(lines.join("\n"));
				return text;
			} catch {
				text.setText(
					theme.fg("toolTitle", theme.bold("search ")) +
						theme.fg("error", "(invalid query)"),
				);
				return text;
			}
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);

			if (isPartial) {
				text.setText(theme.fg("warning", "Searching…"));
				return text;
			}

			if (context.isError) {
				const msg =
					result.content.find((c) => c.type === "text")?.text ||
					"Error";
				text.setText(theme.fg("error", msg));
				return text;
			}

			const details = result.details as {
				composedQuery?: string;
				provider?: "tavily" | "searxng";
				resultCount?: number;
			};
			const status = theme.fg(
				"success",
				`${details?.resultCount ?? 0} results${details?.provider ? ` via ${details.provider}` : ""}`,
			);
			if (!expanded) {
				text.setText(status);
				return text;
			}

			const content =
				result.content.find((c) => c.type === "text")?.text || "";
			const preview =
				content.length > 500 ? content.slice(0, 500) + "..." : content;
			const queryLine = details?.composedQuery
				? theme.fg("dim", `query: ${details.composedQuery}`)
				: "";
			text.setText(
				[status, queryLine, theme.fg("dim", preview)]
					.filter(Boolean)
					.join("\n"),
			);
			return text;
		},
	});
}
