import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
//#region src/index.ts
const name = "dsh-subscription-overlay";
const inject = ["settings"];
/** Settings namespace shared by the host half and the browser panel. */
const NS = "dsh-subscription-overlay";
const Config = z.object({
	enabled: z.boolean().default(true),
	pollMinutes: z.number().min(1).max(60).default(5),
	alertPct: z.number().min(1).max(100).default(85),
	providers: z.object({
		claude: z.boolean().default(true),
		codex: z.boolean().default(true),
		opencodeGo: z.boolean().default(true),
		commandcode: z.boolean().default(true)
	}).default({
		claude: true,
		codex: true,
		opencodeGo: true,
		commandcode: true
	}),
	commandcodeMonthlyBudget: z.number().min(0).default(0),
	overlay: z.object({
		mode: z.union([z.const("pill"), z.const("ring")]).default("pill"),
		hotkey: z.string().default("Ctrl+Shift+S")
	}).default({
		mode: "pill",
		hotkey: "Ctrl+Shift+S"
	}),
	burn: z.dict(z.array(z.array(z.number()))).default({})
});
/** Cached parsed credentials yaml (keyed by path, loaded once per process). */
const _credCache = {};
/** Read key→value pairs from ~/.dsh/.credentials.yaml without a YAML parser.
*  Only handles the simple `KEY: value` lines the DSH credentials domain writes. */
async function readDshCredentials() {
	const path = join(homedir(), ".dsh", ".credentials.yaml");
	if (path in _credCache) return _credCache[path] ?? {};
	try {
		const raw = await readFile(path, "utf8");
		const out = {};
		for (const line of raw.split("\n")) {
			const m = line.match(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.+)$/);
			if (m) out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
		}
		_credCache[path] = out;
		return out;
	} catch {
		_credCache[path] = null;
		return {};
	}
}
async function resolveSecret(credentials, refs, envKeys) {
	if (credentials) for (const ref of refs) {
		if (!ref) continue;
		try {
			const resolved = await credentials.resolve(credentialRef(ref));
			if (resolved?.value) return {
				value: resolved.value,
				ref,
				source: resolved.source
			};
		} catch {}
	}
	for (const k of envKeys) {
		const v = process.env[k]?.trim();
		if (v) return {
			value: v,
			ref: k,
			source: "env"
		};
	}
	const yaml = await readDshCredentials();
	for (const k of envKeys) {
		const v = yaml[k]?.trim();
		if (v) return {
			value: v,
			ref: k,
			source: "yaml"
		};
	}
}
async function readJsonFile(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return;
	}
}
/** Token resolution order per SPIKE §2.1 (DSH creds → session files → CLI files). */
async function claudeToken(credentials) {
	const s = await resolveSecret(credentials, [
		"CLAUDE_ACCESS_TOKEN",
		"CLAUDE_API_KEY",
		"ANTHROPIC_API_KEY"
	], []);
	if (s) return s.value;
	const sub = await readJsonFile(join(homedir(), ".dsh", "plugins", "subscriptions", "auth.json"));
	const t1 = sub?.claude?.access_token ?? sub?.claude?.accessToken;
	if (typeof t1 === "string" && t1) return t1;
	const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
	const t2 = (await readJsonFile(join(dir, ".credentials.json")))?.claudeAiOauth?.accessToken;
	return typeof t2 === "string" && t2 ? t2 : void 0;
}
async function codexToken(credentials) {
	const s = await resolveSecret(credentials, ["OPENAI_ACCESS_TOKEN", "OPENAI_API_KEY"], []);
	if (s) return s.value;
	const sub = await readJsonFile(join(homedir(), ".dsh", "plugins", "subscriptions", "auth.json"));
	const t1 = sub?.codex?.access_token ?? sub?.codex?.accessToken;
	if (typeof t1 === "string" && t1) return t1;
	const t2 = (await readJsonFile(join(homedir(), ".codex", "auth.json")))?.tokens?.access_token;
	return typeof t2 === "string" && t2 ? t2 : void 0;
}
async function opencodeGoToken(credentials, apiKeyEnv) {
	const s = await resolveSecret(credentials, [apiKeyEnv, "OPENCODE_GO_API_KEY"], [apiKeyEnv, "OPENCODE_GO_API_KEY"]);
	if (s) return s.value;
	const t1 = (await readJsonFile(join(homedir(), ".local", "share", "opencode", "auth.json")))?.["opencode-go"]?.key;
	if (typeof t1 === "string" && t1) return t1;
	const t2 = (process.env.USERPROFILE ? await readJsonFile(join(process.env.USERPROFILE, ".config", "opencode", "auth.json")) : void 0)?.["opencode-go"]?.key;
	return typeof t2 === "string" && t2 ? t2 : void 0;
}
const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
async function fetchClaude(token) {
	try {
		const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
				"Content-Type": "application/json",
				"User-Agent": "claude-cli/2.1.20"
			},
			signal: AbortSignal.timeout(2e4)
		});
		if (!resp.ok) return {
			id: "claude",
			label: "Claude",
			status: "error",
			message: resp.status === 401 || resp.status === 403 ? "auth failed — re-login in Subscriptions settings" : `HTTP ${resp.status}`,
			items: []
		};
		const b = await resp.json();
		const items = [];
		const push = (label, w) => {
			const pct = num(w?.utilization);
			if (pct !== void 0) items.push({
				label,
				percent: pct,
				resetAt: typeof w?.resets_at === "string" ? w.resets_at : void 0
			});
		};
		push("5h", b?.five_hour);
		push("7d", b?.seven_day);
		for (const lim of Array.isArray(b?.limits) ? b.limits : []) {
			const kind = String(lim?.kind ?? "");
			if (kind === "session" || kind === "weekly_all") continue;
			const pct = num(lim?.percent);
			if (pct !== void 0) items.push({
				label: kind === "weekly_scoped" ? "Fable" : kind,
				percent: pct,
				resetAt: typeof lim?.resets_at === "string" ? lim.resets_at : void 0
			});
		}
		return {
			id: "claude",
			label: "Claude",
			status: "ok",
			items
		};
	} catch (err) {
		return {
			id: "claude",
			label: "Claude",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			items: []
		};
	}
}
async function fetchCodex(token) {
	try {
		const resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				"User-Agent": "Mozilla/5.0"
			},
			signal: AbortSignal.timeout(15e3)
		});
		if (!resp.ok) return {
			id: "codex",
			label: "Codex",
			status: "error",
			message: resp.status === 401 || resp.status === 403 ? "auth failed — re-login in Subscriptions settings" : `HTTP ${resp.status}`,
			items: []
		};
		const b = await resp.json();
		const items = [];
		const rl = b?.rate_limit ?? b;
		const windowPct = (w) => num(w?.used_percent) ?? num(w?.usedPercent);
		const windowReset = (w) => {
			const v = w?.reset_at ?? w?.resetsAt;
			if (typeof v === "number" && v > 0) return new Date(v < 0xe8d4a51000 ? v * 1e3 : v).toISOString();
			if (typeof v === "string" && v) return v;
		};
		const pri = rl?.primary_window ?? null;
		const sec = rl?.secondary_window ?? null;
		const priPct = pri !== null ? windowPct(pri) : num(b?.primary_pct);
		const secPct = sec !== null ? windowPct(sec) : num(b?.secondary_pct);
		const priReset = pri !== null ? windowReset(pri) : void 0;
		const secReset = sec !== null ? windowReset(sec) : void 0;
		if (priPct !== void 0) items.push({
			label: "5h",
			percent: priPct,
			resetAt: priReset
		});
		if (secPct !== void 0) items.push({
			label: "7d",
			percent: secPct,
			resetAt: secReset
		});
		return {
			id: "codex",
			label: "Codex",
			status: "ok",
			items
		};
	} catch (err) {
		return {
			id: "codex",
			label: "Codex",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			items: []
		};
	}
}
async function fetchOpencodeGo(token) {
	try {
		const resp = await fetch("https://opencode.ai/zen/go/v1/usage", {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json"
			},
			signal: AbortSignal.timeout(2e4)
		});
		if (!resp.ok) return {
			id: "opencode-go",
			label: "OpenCode Go",
			status: "error",
			message: resp.status === 401 || resp.status === 403 ? "auth failed — re-login in Subscriptions settings" : `HTTP ${resp.status}`,
			items: []
		};
		const b = await resp.json();
		const items = [];
		const usage = b?.usage ?? b;
		const pushWindow = (label, raw, normalised) => {
			const pct = num(raw?.percent) ?? num(normalised?.utilization);
			const resetAt = (typeof raw?.resetsAt === "string" ? raw.resetsAt : void 0) ?? (typeof normalised?.resets_at === "string" ? normalised.resets_at : void 0);
			if (pct !== void 0) items.push({
				label,
				percent: pct,
				resetAt
			});
		};
		pushWindow("5h", usage?.rolling, b?.five_hour);
		pushWindow("7d", usage?.weekly, b?.seven_day);
		pushWindow("30d", usage?.monthly, b?.monthly);
		return {
			id: "opencode-go",
			label: "OpenCode Go",
			status: "ok",
			items
		};
	} catch (err) {
		return {
			id: "opencode-go",
			label: "OpenCode Go",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			items: []
		};
	}
}
/**
* Fetch CommandCode quota from the same four alpha endpoints the pi-commandcode-provider
* and the cmd /usage command use (source: github.com/patlux/pi-commandcode-provider):
*
*   GET /alpha/whoami                 → { user: { userName }, org: { id } | null }
*   GET /alpha/billing/credits        → { credits: { monthlyCredits, … },
*                                         windowLimits: {
*                                           fiveHour: { used, cap, resetAt(ms) },
*                                           weekly:   { used, cap, resetAt(ms) } } }
*   GET /alpha/billing/subscriptions  → { data: { planId, currentPeriodStart/End } }
*   GET /alpha/usage/summary          → { totalCost, totalTokens, totalCount, … }
*
* windowLimits gives rolling percent = used/cap*100 + resetAt — identical pattern to
* Claude (5h/7d) and Codex (primary/secondary).
*/
async function fetchCommandcode(apiKey) {
	const base = "https://api.commandcode.ai";
	const headers = {
		Authorization: `Bearer ${apiKey}`,
		Accept: "application/json"
	};
	const sig = AbortSignal.timeout(15e3);
	const get = async (path) => {
		const r = await fetch(`${base}${path}`, {
			headers,
			signal: sig
		});
		if (!r.ok) throw Object.assign(/* @__PURE__ */ new Error(`HTTP ${r.status}`), { status: r.status });
		return r.json();
	};
	try {
		const orgId = (await get("/alpha/whoami"))?.org?.id ?? null;
		const q = orgId ? `?orgId=${orgId}` : "";
		const [creditsRaw, subsRaw] = await Promise.allSettled([get(`/alpha/billing/credits${q}`), get(`/alpha/billing/subscriptions${q}`)]);
		const credits = creditsRaw.status === "fulfilled" ? creditsRaw.value : null;
		const subs = subsRaw.status === "fulfilled" ? subsRaw.value : null;
		const items = [];
		const wl = credits?.windowLimits;
		const pushWindow = (label, w) => {
			if (!w || typeof w.used !== "number" || typeof w.cap !== "number" || w.cap === 0) return;
			const pct = Math.round(w.used / w.cap * 100);
			const resetAt = typeof w.resetAt === "number" ? new Date(w.resetAt).toISOString() : typeof w.resetAt === "string" ? w.resetAt : void 0;
			items.push({
				label,
				percent: pct,
				resetAt
			});
		};
		pushWindow("5h", wl?.fiveHour);
		pushWindow("7d", wl?.weekly);
		const planId = subs?.data?.planId;
		if (planId) items.push({
			label: "plan",
			display: planId
		});
		return {
			id: "commandcode",
			label: "CommandCode",
			status: "ok",
			items
		};
	} catch (err) {
		return {
			id: "commandcode",
			label: "CommandCode",
			status: "error",
			message: err?.status === 401 || err?.status === 403 ? "auth failed — check API key in DSH credentials" : err instanceof Error ? err.message : String(err),
			items: []
		};
	}
}
function appendBurn(burn, model, tokens, now = Date.now()) {
	const key = `commandcode::${model}`;
	const cutoff = now - 2592e6;
	const next = [...burn[key] ?? [], [now, tokens]].filter(([t]) => t >= cutoff).slice(-1e3);
	return {
		...burn,
		[key]: next
	};
}
function monthToDate(burn, now = /* @__PURE__ */ new Date()) {
	const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	let sum = 0;
	for (const pts of Object.values(burn)) for (const [t, n] of pts) if (t >= start) sum += n;
	return sum;
}
/** Providers with a bespoke quota fetcher: settings-form key → display info. */
const KNOWN_QUOTA = {
	claude: {
		label: "Claude",
		detail: "5h / 7d windows"
	},
	codex: {
		label: "Codex",
		detail: "5h / 7d windows"
	},
	opencodeGo: {
		label: "OpenCode Go",
		detail: "5h / 7d / 30d windows"
	},
	commandcode: {
		label: "CommandCode",
		detail: "5h / 7d windows"
	}
};
/** llm-pi-ai provider id → settings-form key (unmapped ids stay as-is). */
const LLM_ID_TO_KEY = {
	"opencode-go": "opencodeGo",
	"command-code": "commandcode"
};
var OverlayController = class {
	ctx;
	getScope;
	getCredentials;
	getLlmProviders;
	constructor(ctx, getScope, getCredentials, getLlmProviders) {
		this.ctx = ctx;
		this.getScope = getScope;
		this.getCredentials = getCredentials;
		this.getLlmProviders = getLlmProviders;
	}
	cfg() {
		return this.getScope()?.get() ?? {
			enabled: true,
			pollMinutes: 5,
			alertPct: 85,
			providers: {
				claude: true,
				codex: true,
				opencodeGo: true,
				commandcode: true
			},
			commandcodeMonthlyBudget: 0,
			overlay: {
				mode: "pill",
				hotkey: "Ctrl+Shift+S"
			},
			burn: {}
		};
	}
	llmProvider(id) {
		return this.getLlmProviders().find((p) => p.id === id);
	}
	/** Dynamic provider catalog: the 4 quota-capable providers first, then any
	*  extra llm-pi-ai providers (auto-detected, marked unsupported until a
	*  bespoke quota fetcher exists — each vendor needs its own endpoint/auth). */
	providerCatalog() {
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		for (const key of Object.keys(KNOWN_QUOTA)) {
			const k = KNOWN_QUOTA[key];
			seen.add(key);
			out.push({
				key,
				label: k.label,
				detail: k.detail,
				supported: true
			});
		}
		for (const p of this.getLlmProviders()) {
			const key = LLM_ID_TO_KEY[p.id] ?? p.id;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({
				key,
				label: p.id,
				detail: "Quota not supported yet",
				supported: false
			});
		}
		return out;
	}
	async refresh() {
		const cfg = this.cfg();
		const creds = this.getCredentials();
		const now = Date.now();
		const off = (id, label) => ({
			id,
			label,
			status: "disabled",
			items: []
		});
		if (!cfg.enabled) return {
			refreshedAt: now,
			providers: [
				off("claude", "Claude"),
				off("codex", "Codex"),
				off("opencode-go", "OpenCode Go"),
				off("commandcode", "CommandCode")
			],
			providerCatalog: this.providerCatalog()
		};
		const [claude, codex, opencodeGo, commandcode] = await Promise.all([
			(async () => {
				if (!cfg.providers.claude) return off("claude", "Claude");
				const t = await claudeToken(creds);
				return t ? fetchClaude(t) : {
					id: "claude",
					label: "Claude",
					status: "error",
					message: "no token — login via Subscriptions settings",
					items: []
				};
			})(),
			(async () => {
				if (!cfg.providers.codex) return off("codex", "Codex");
				const t = await codexToken(creds);
				return t ? fetchCodex(t) : {
					id: "codex",
					label: "Codex",
					status: "error",
					message: "no token — login via Subscriptions settings",
					items: []
				};
			})(),
			(async () => {
				if (!cfg.providers.opencodeGo) return off("opencode-go", "OpenCode Go");
				const env = this.llmProvider("opencode-go")?.apiKeyEnv || "OPENCODE_GO_API_KEY";
				const t = await opencodeGoToken(creds, env);
				return t ? fetchOpencodeGo(t) : {
					id: "opencode-go",
					label: "OpenCode Go",
					status: "error",
					message: "no token — login via Subscriptions settings",
					items: []
				};
			})(),
			(async () => {
				if (!cfg.providers.commandcode) return off("commandcode", "CommandCode");
				return this.commandcodeRow(cfg, creds);
			})()
		]);
		return {
			refreshedAt: now,
			providers: [
				claude,
				codex,
				opencodeGo,
				commandcode
			],
			providerCatalog: this.providerCatalog()
		};
	}
	async commandcodeRow(cfg, creds) {
		const keyEnv = this.llmProvider("command-code")?.apiKeyEnv || "COMMAND_CODE_API_KEY";
		const key = await resolveSecret(creds, [keyEnv, "COMMAND_CODE_API_KEY"], [keyEnv, "COMMAND_CODE_API_KEY"]);
		const mtd = monthToDate(cfg.burn ?? {});
		const budget = cfg.commandcodeMonthlyBudget ?? 0;
		const next = /* @__PURE__ */ new Date();
		next.setMonth(next.getMonth() + 1, 1);
		next.setHours(0, 0, 0, 0);
		const burn = {
			monthToDate: mtd,
			budget,
			percent: budget > 0 ? mtd / budget * 100 : null,
			resetAt: next.toISOString()
		};
		if (!key) return {
			id: "commandcode",
			label: "CommandCode",
			status: "error",
			message: "no API key — add via DSH credentials",
			items: [],
			burn
		};
		return {
			...await fetchCommandcode(key.value),
			burn
		};
	}
	status() {
		const cfg = this.cfg();
		return {
			alertPct: cfg.alertPct,
			overlay: cfg.overlay,
			enabled: cfg.enabled,
			settings: publicSettings(cfg)
		};
	}
	/** Validate a partial settings patch and persist it via the installSection source. */
	async updateSettings(patch) {
		const scope = this.getScope();
		if (!scope) return {
			ok: false,
			error: "settings unavailable"
		};
		const parsed = validateSettingsPatch(patch);
		if (!parsed.ok) return {
			ok: false,
			error: parsed.error
		};
		const cfg = this.cfg();
		const next = {
			...cfg,
			...parsed.value,
			providers: {
				...cfg.providers,
				...parsed.value.providers ?? {}
			},
			overlay: {
				...cfg.overlay,
				...parsed.value.overlay ?? {}
			}
		};
		await scope.update(stripRuntime(next));
		return {
			ok: true,
			settings: publicSettings(this.cfg())
		};
	}
	async ledgerAppend(model, tokens) {
		const scope = this.getScope();
		if (!scope || typeof model !== "string" || !model || !Number.isFinite(tokens) || tokens < 0) return {
			ok: false,
			error: "model and non-negative tokens required"
		};
		const cfg = this.cfg();
		await scope.update({ burn: appendBurn(cfg.burn ?? {}, model, tokens) });
		return { ok: true };
	}
};
function publicSettings(cfg) {
	return {
		enabled: cfg.enabled,
		pollMinutes: cfg.pollMinutes,
		alertPct: cfg.alertPct,
		providers: { ...cfg.providers },
		commandcodeMonthlyBudget: cfg.commandcodeMonthlyBudget,
		overlay: { ...cfg.overlay }
	};
}
function stripRuntime(next) {
	const { burn: _burn, ...rest } = next;
	return rest;
}
function validateSettingsPatch(patch) {
	if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return {
		ok: false,
		error: "settings object required"
	};
	const p = patch;
	const out = {};
	if (p.enabled !== void 0) {
		if (typeof p.enabled !== "boolean") return {
			ok: false,
			error: "enabled must be boolean"
		};
		out.enabled = p.enabled;
	}
	if (p.pollMinutes !== void 0) {
		if (typeof p.pollMinutes !== "number" || !Number.isFinite(p.pollMinutes) || p.pollMinutes < 1 || p.pollMinutes > 60) return {
			ok: false,
			error: "pollMinutes must be a number in 1–60"
		};
		out.pollMinutes = p.pollMinutes;
	}
	if (p.alertPct !== void 0) {
		if (typeof p.alertPct !== "number" || !Number.isFinite(p.alertPct) || p.alertPct < 1 || p.alertPct > 100) return {
			ok: false,
			error: "alertPct must be a number in 1–100"
		};
		out.alertPct = p.alertPct;
	}
	if (p.providers !== void 0) {
		if (typeof p.providers !== "object" || p.providers === null || Array.isArray(p.providers)) return {
			ok: false,
			error: "providers must be an object"
		};
		const prov = p.providers;
		const sub = {};
		for (const k of [
			"claude",
			"codex",
			"opencodeGo",
			"commandcode"
		]) if (prov[k] !== void 0) {
			if (typeof prov[k] !== "boolean") return {
				ok: false,
				error: `providers.${k} must be boolean`
			};
			sub[k] = prov[k];
		}
		out.providers = sub;
	}
	if (p.commandcodeMonthlyBudget !== void 0) {
		if (typeof p.commandcodeMonthlyBudget !== "number" || !Number.isFinite(p.commandcodeMonthlyBudget) || p.commandcodeMonthlyBudget < 0) return {
			ok: false,
			error: "commandcodeMonthlyBudget must be a number ≥ 0"
		};
		out.commandcodeMonthlyBudget = p.commandcodeMonthlyBudget;
	}
	if (p.overlay !== void 0) {
		if (typeof p.overlay !== "object" || p.overlay === null || Array.isArray(p.overlay)) return {
			ok: false,
			error: "overlay must be an object"
		};
		const ov = p.overlay;
		const sub = {};
		if (ov.mode !== void 0) {
			if (ov.mode !== "pill" && ov.mode !== "ring") return {
				ok: false,
				error: "overlay.mode must be pill|ring"
			};
			sub.mode = ov.mode;
		}
		if (ov.hotkey !== void 0) {
			if (typeof ov.hotkey !== "string" || !ov.hotkey) return {
				ok: false,
				error: "overlay.hotkey must be a non-empty string"
			};
			sub.hotkey = ov.hotkey;
		}
		out.overlay = sub;
	}
	return {
		ok: true,
		value: out
	};
}
function send(res, code, body) {
	res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
async function readJson(req) {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return {};
	}
}
const API_PREFIX = "/plugins/dsh-subscription-overlay/api";
const CSRF_HEADER = "x-dsh-subscription-overlay";
function registerHttpRoutes(sctx, ctrl) {
	sctx.effect(() => sctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: (req, res) => route(req, res, ctrl)
	}));
}
async function route(req, res, ctrl) {
	const path = new URL(req.url ?? "/", "http://x").pathname.slice(37);
	const method = req.method ?? "GET";
	try {
		if (method === "GET" && path === "/status") return send(res, 200, {
			...ctrl.status(),
			...await ctrl.refresh()
		});
		if (method === "GET" && path === "/meta") return send(res, 200, {
			...ctrl.status(),
			providerCatalog: ctrl.providerCatalog()
		});
		if (method === "POST") {
			if (req.headers[CSRF_HEADER] === void 0) return send(res, 403, { error: "missing required custom header" });
			if (path === "/refresh") return send(res, 200, await ctrl.refresh());
			if (path === "/probe") return send(res, 200, await ctrl.refresh());
			if (path === "/settings") {
				const body = await readJson(req);
				const r = await ctrl.updateSettings(body);
				return send(res, r.ok ? 200 : 400, r);
			}
			if (path === "/ledger/append") {
				const body = await readJson(req);
				return send(res, 200, await ctrl.ledgerAppend(body?.model, body?.tokens));
			}
		}
		return send(res, 404, { error: "not found" });
	} catch (err) {
		return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
	}
}
function apply(ctx, config) {
	let scope;
	let settingsSvc;
	const FALLBACK_PROVIDERS = [{
		id: "opencode-go",
		apiKeyEnv: "OPENCODE_GO_API_KEY"
	}, {
		id: "command-code",
		apiKeyEnv: "COMMAND_CODE_API_KEY",
		baseURL: "https://api.commandcode.ai/provider/v1"
	}];
	const ctrl = new OverlayController(ctx, () => scope, () => ctx.get("credentials"), () => {
		const providers = settingsSvc?.describe?.()?.find((x) => x.ns === "llm-pi-ai")?.value?.providers;
		if (!providers || typeof providers !== "object") return FALLBACK_PROVIDERS;
		const out = [];
		for (const [id, p] of Object.entries(providers)) out.push({
			id,
			...typeof p?.apiKeyEnv === "string" && p.apiKeyEnv ? { apiKeyEnv: p.apiKeyEnv } : {},
			...typeof p?.baseURL === "string" && p.baseURL ? { baseURL: p.baseURL } : {}
		});
		return out;
	});
	ctx.inject(["settings"], (sctx) => {
		settingsSvc = sctx.settings;
		scope = sctx.settings.register(NS, Config, { base: config });
	});
	if (config.pollMinutes > 0) ctx.inject(["settings"], () => {
		const timer = setInterval(() => {
			ctrl.refresh();
		}, config.pollMinutes * 6e4);
		return () => clearInterval(timer);
	});
	ctx.inject(["webServer"], (sctx) => {
		registerHttpRoutes(sctx, ctrl);
	});
}
//#endregion
export { Config, NS, appendBurn, apply, fetchCommandcode, inject, monthToDate, name, publicSettings, validateSettingsPatch };

//# sourceMappingURL=index.js.map