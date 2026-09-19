import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
//#region src/claude-usage.ts
const num$1 = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
/**
* Map an OAuth /usage payload to panel rows. The modern `limits[]` array
* wins when non-empty; legacy flat buckets are the fallback. Kind mapping:
* session → 5h; weekly_all/weekly_scoped → weekly (+ model scope when
* named); anything else keeps its scope/kind.
*/
function mapClaudeUsage(b) {
	const resetIso = (v) => typeof v === "string" && v ? v : void 0;
	const modern = [];
	for (const lim of Array.isArray(b?.limits) ? b.limits : []) {
		const pct = num$1(lim?.percent) ?? num$1(lim?.utilization);
		if (pct === void 0) continue;
		const kind = String(lim?.kind ?? "");
		const scope = lim?.scope?.model?.display_name;
		const scopeStr = typeof scope === "string" && scope ? scope : void 0;
		const label = kind === "session" ? "5h" : kind === "weekly_all" || kind === "weekly_scoped" ? scopeStr ? `7d · ${scopeStr}` : "7d" : scopeStr ?? (kind || "other");
		modern.push({
			label,
			percent: pct,
			resetAt: resetIso(lim?.resets_at)
		});
	}
	if (modern.length > 0) return modern;
	const items = [];
	const pushLegacy = (label, w) => {
		const pct = num$1(w?.utilization);
		if (pct !== void 0) items.push({
			label,
			percent: pct,
			resetAt: resetIso(w?.resets_at)
		});
	};
	pushLegacy("5h", b?.five_hour);
	pushLegacy("7d", b?.seven_day);
	pushLegacy("7d · Opus", b?.seven_day_opus);
	pushLegacy("7d · Sonnet", b?.seven_day_sonnet);
	return items;
}
//#endregion
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
		hotkey: z.string().default("Ctrl+Shift+S"),
		display: z.union([z.const("dock"), z.const("floater")]).default("dock")
	}).default({
		mode: "pill",
		hotkey: "Ctrl+Shift+S",
		display: "dock"
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
/** Preemptive refresh window: upstream AccountTokenManager parity (5min). */
const SUB_PREEMPT_MS = 3e5;
const normStr = (v) => typeof v === "string" && v ? v : void 0;
const normMs = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : void 0;
/** Pick the default account entry out of one provider's auth.json record. */
function pickSubEntry(entry) {
	if (!entry || typeof entry !== "object") return void 0;
	const accounts = entry.accounts;
	if (accounts && typeof accounts === "object" && !Array.isArray(accounts)) {
		const keys = Object.keys(accounts);
		if (keys.length === 0) return void 0;
		const def = entry.defaultAccount;
		const key = typeof def === "string" && accounts[def] ? def : keys[0];
		return {
			key,
			raw: accounts[key]
		};
	}
	return {
		key: "",
		raw: entry
	};
}
function normSubSession(raw) {
	if (!raw || typeof raw !== "object") return void 0;
	const accessToken = normStr(raw.accessToken ?? raw.access_token);
	if (!accessToken) return void 0;
	const sess = { accessToken };
	const refreshToken = normStr(raw.refreshToken ?? raw.refresh_token);
	if (refreshToken) sess.refreshToken = refreshToken;
	const expiresAt = normMs(raw.expiresAt ?? raw.expires_at);
	if (expiresAt !== void 0) sess.expiresAt = expiresAt;
	const accountId = normStr(raw.accountId ?? raw.account_id);
	if (accountId) sess.accountId = accountId;
	return sess;
}
function subAuthPath() {
	return join(homedir(), ".dsh", "plugins", "subscriptions", "auth.json");
}
/** Read one provider's default subscription session (accounts-map aware). */
async function readSubSession(provider) {
	const picked = pickSubEntry((await readJsonFile(subAuthPath()))?.[provider]);
	if (!picked) return void 0;
	const session = normSubSession(picked.raw);
	return session ? {
		key: picked.key,
		session
	} : void 0;
}
/** Persist refreshed fields onto the same account entry, preserving the rest of the file. */
async function writeSubSession(provider, key, patch) {
	const path = subAuthPath();
	const store = await readJsonFile(path);
	if (!store || typeof store !== "object" || Array.isArray(store)) return;
	const entry = store[provider];
	if (!entry || typeof entry !== "object") return;
	const target = entry.accounts && typeof entry.accounts === "object" && key ? entry.accounts[key] : entry;
	if (!target || typeof target !== "object") return;
	if (patch.accessToken) {
		if ("accessToken" in target || !("access_token" in target)) target.accessToken = patch.accessToken;
		else target.access_token = patch.accessToken;
	}
	if (patch.refreshToken) {
		if ("refreshToken" in target || !("refresh_token" in target)) target.refreshToken = patch.refreshToken;
		else target.refresh_token = patch.refreshToken;
	}
	if (patch.expiresAt !== void 0) {
		if ("expiresAt" in target || !("expires_at" in target)) target.expiresAt = patch.expiresAt;
		else target.expires_at = patch.expiresAt;
	}
	await writeFile(path, JSON.stringify(store, null, 2));
}
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_TOKEN_URL = "https://claude.ai/v1/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
/** Permanent grant rejection (upstream isClaudePermanentRefreshError parity). */
function isPermanentOAuthError(body) {
	const code = typeof body?.error === "string" ? body.error : "";
	return code === "invalid_grant" || code === "invalid_token";
}
/** Best-effort JWT exp read (codex expiry fallback; hint only, never verified). */
function decodeJwtExp(accessToken) {
	try {
		const part = accessToken.split(".")[1];
		if (!part) return void 0;
		const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
		return normMs(payload?.exp) !== void 0 ? payload.exp : void 0;
	} catch {
		return;
	}
}
/**
* Refresh one stored session via its provider token endpoint. Returns the
* fresh session, the stale session on transient failure (use it), or
* undefined when the grant is permanently rejected (caller surfaces re-login).
*/
async function refreshSubSession(provider, sess) {
	if (!sess.refreshToken) return void 0;
	const url = provider === "claude" ? CLAUDE_TOKEN_URL : CODEX_TOKEN_URL;
	const clientId = provider === "claude" ? CLAUDE_CLIENT_ID : CODEX_CLIENT_ID;
	try {
		const resp = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: sess.refreshToken,
				client_id: clientId
			}),
			signal: AbortSignal.timeout(15e3)
		});
		const body = await resp.json().catch(() => void 0);
		if (!resp.ok) return isPermanentOAuthError(body) ? void 0 : sess;
		const accessToken = normStr(body?.access_token);
		if (!accessToken) return sess;
		const next = {
			...sess,
			accessToken
		};
		const refreshToken = normStr(body?.refresh_token);
		if (refreshToken) next.refreshToken = refreshToken;
		const expiresIn = num(body?.expires_in);
		if (expiresIn !== void 0 && expiresIn > 0) next.expiresAt = Date.now() + expiresIn * 1e3;
		else {
			const exp = decodeJwtExp(accessToken);
			if (exp !== void 0) next.expiresAt = exp * 1e3;
		}
		return next;
	} catch {
		return sess;
	}
}
/** In-flight refresh coalescing per provider+account (upstream TokenManager parity). */
const refreshInflight = /* @__PURE__ */ new Map();
/**
* Resolve a usable session, refreshing proactively inside the preempt window
* (upstream TokenManager.session parity). Sessions without expiry metadata
* (DSH-creds / CLI tokens) are used as-is — there is no grant to refresh.
*/
async function ensureFreshSubSession(provider, key, sess) {
	if (sess.expiresAt === void 0) return sess;
	if (sess.expiresAt - Date.now() > SUB_PREEMPT_MS) return sess;
	if (!sess.refreshToken) return sess.expiresAt > Date.now() ? sess : void 0;
	const flightKey = `${provider}:${key || "default"}`;
	let p = refreshInflight.get(flightKey);
	if (!p) {
		p = (async () => {
			const fresh = await refreshSubSession(provider, sess);
			if (fresh && fresh !== sess) try {
				await writeSubSession(provider, key, fresh);
			} catch {}
			return fresh;
		})().finally(() => {
			refreshInflight.delete(flightKey);
		});
		refreshInflight.set(flightKey, p);
	}
	return p;
}
/** Token resolution order per SPIKE §2.1 (DSH creds → session files → CLI files). */
async function claudeToken(credentials) {
	const s = await resolveSecret(credentials, [
		"CLAUDE_ACCESS_TOKEN",
		"CLAUDE_API_KEY",
		"ANTHROPIC_API_KEY"
	], []);
	if (s) return s.value;
	const stored = await readSubSession("claude");
	if (stored) {
		const fresh = await ensureFreshSubSession("claude", stored.key, stored.session);
		if (fresh) return fresh.accessToken;
	}
	const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
	const t2 = (await readJsonFile(join(dir, ".credentials.json")))?.claudeAiOauth?.accessToken;
	return typeof t2 === "string" && t2 ? t2 : void 0;
}
async function codexToken(credentials) {
	const s = await resolveSecret(credentials, ["OPENAI_ACCESS_TOKEN", "OPENAI_API_KEY"], []);
	if (s) return { token: s.value };
	const stored = await readSubSession("codex");
	if (stored) {
		const fresh = await ensureFreshSubSession("codex", stored.key, stored.session);
		if (fresh) return {
			token: fresh.accessToken,
			...fresh.accountId ? { accountId: fresh.accountId } : {}
		};
	}
	const t2 = (await readJsonFile(join(homedir(), ".codex", "auth.json")))?.tokens?.access_token;
	return typeof t2 === "string" && t2 ? { token: t2 } : void 0;
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
/** Anthropic throttles the OAuth usage endpoint per token. The same token is
*  polled by the CLI, WezTerm quota widgets and this overlay, so 429s happen.
*  While cooling down we fail fast without another network call. */
/** Fallback when Claude Code is absent (upstream CLAUDE_CLI_FALLBACK_VERSION). */
const CLAUDE_CLI_FALLBACK_VERSION = "2.1.263";
/**
* Detected CLI version, memoized (upstream detectClaudeVersion parity: the
* probe shells out, so it must not run at module-evaluation time).
*/
function detectClaudeCliVersion() {
	const probes = process.platform === "win32" ? [[
		"claude --version",
		[],
		{ shell: true }
	], [
		"claude.cmd --version",
		[],
		{ shell: true }
	]] : [[
		"claude",
		["--version"],
		{}
	]];
	for (const [command, args, options] of probes) try {
		const raw = execFileSync(command, [...args], {
			timeout: 1e4,
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			],
			...options
		});
		const match = String(raw).match(/(\d+\.\d+\.\d+)/);
		if (match) return match[1];
	} catch {}
	return CLAUDE_CLI_FALLBACK_VERSION;
}
let claudeCliUserAgent;
/**
* CLI-impersonating User-Agent (upstream getClaudeCliUserAgent parity:
* `claude-cli/<version> (external, cli)`). Unrecognized clients are
* aggressively rate-limited on the OAuth usage endpoint.
*/
function getClaudeCliUserAgent() {
	if (claudeCliUserAgent === void 0) claudeCliUserAgent = `claude-cli/${detectClaudeCliVersion()} (external, cli)`;
	return claudeCliUserAgent;
}
let claudeCooldownUntil = 0;
async function fetchClaude(token) {
	const limited = () => ({
		id: "claude",
		label: "Claude",
		status: "error",
		message: "rate limited by Anthropic — retrying automatically",
		items: []
	});
	if (Date.now() < claudeCooldownUntil) return limited();
	try {
		const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
				"Content-Type": "application/json",
				"User-Agent": getClaudeCliUserAgent(),
				Accept: "application/json"
			},
			signal: AbortSignal.timeout(2e4)
		});
		if (!resp.ok) {
			const auth = resp.status === 401 || resp.status === 403;
			if (resp.status === 429) {
				let waitMs = 6e4;
				const ra = resp.headers.get("retry-after");
				if (ra) {
					const secs = Number(ra);
					if (Number.isFinite(secs)) waitMs = Math.min(secs, 300) * 1e3;
					else {
						const t = Date.parse(ra);
						if (!Number.isNaN(t)) waitMs = Math.min(Math.max(t - Date.now(), 1e3), 3e5);
					}
				}
				claudeCooldownUntil = Date.now() + waitMs;
				return limited();
			}
			return {
				id: "claude",
				label: "Claude",
				status: "error",
				message: auth ? "auth failed — re-login in Subscriptions settings" : `HTTP ${resp.status}`,
				items: []
			};
		}
		return {
			id: "claude",
			label: "Claude",
			status: "ok",
			items: mapClaudeUsage(await resp.json())
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
async function fetchCodex(token, accountId) {
	try {
		const resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				"User-Agent": "Mozilla/5.0",
				originator: "codex_cli_rs",
				...accountId ? { "chatgpt-account-id": accountId } : {}
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
				hotkey: "Ctrl+Shift+S",
				display: "dock"
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
				return t ? fetchCodex(t.token, t.accountId) : {
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
		if (ov.display !== void 0) {
			if (ov.display !== "dock" && ov.display !== "floater") return {
				ok: false,
				error: "overlay.display must be dock|floater"
			};
			sub.display = ov.display;
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
export { Config, NS, appendBurn, apply, fetchCommandcode, inject, mapClaudeUsage, monthToDate, name, publicSettings, validateSettingsPatch };

//# sourceMappingURL=index.js.map