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
		push("5h window", b?.five_hour);
		push("7d window", b?.seven_day);
		for (const lim of Array.isArray(b?.limits) ? b.limits : []) {
			const pct = num(lim?.percent);
			if (pct !== void 0) items.push({
				label: String(lim?.kind ?? "limit"),
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
		const p = num(b?.primary_pct);
		if (p !== void 0) items.push({
			label: "primary",
			percent: p,
			resetAt: b?.primary_reset_at ?? b?.primary_reset
		});
		const s = num(b?.secondary_pct);
		if (s !== void 0) items.push({
			label: "secondary",
			percent: s,
			resetAt: b?.secondary_reset_at ?? b?.secondary_reset
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
		const push = (label, w) => {
			const pct = num(w?.utilization);
			if (pct !== void 0) items.push({
				label,
				percent: pct,
				resetAt: typeof w?.resets_at === "string" ? w.resets_at : void 0
			});
		};
		push("5h window", b?.five_hour);
		push("7d window", b?.seven_day);
		push("monthly", b?.monthly);
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
/** commandcode probe: GET {baseURL}/models → online/offline only, never a percentage. */
async function probeCommandcode(baseURL, apiKey) {
	const base = baseURL.replace(/\/+$/, "");
	const t0 = Date.now();
	try {
		const resp = await fetch(`${base}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(8e3)
		});
		const ms = Date.now() - t0;
		if (!resp.ok) return {
			ok: false,
			ms,
			message: `探测失败 HTTP ${resp.status}`
		};
		let count;
		try {
			const b = await resp.json();
			const arr = Array.isArray(b) ? b : b?.data;
			if (Array.isArray(arr)) count = arr.length;
		} catch {}
		return {
			ok: true,
			ms,
			modelCount: count
		};
	} catch (err) {
		return {
			ok: false,
			ms: Date.now() - t0,
			message: `探测失败：${err instanceof Error ? err.message : String(err)}`
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
				off("commandcode", "command-code")
			]
		};
		const providers = [];
		if (cfg.providers.claude) {
			const t = await claudeToken(creds);
			providers.push(t ? await fetchClaude(t) : {
				id: "claude",
				label: "Claude",
				status: "error",
				message: "no token — login via Subscriptions settings",
				items: []
			});
		} else providers.push(off("claude", "Claude"));
		if (cfg.providers.codex) {
			const t = await codexToken(creds);
			providers.push(t ? await fetchCodex(t) : {
				id: "codex",
				label: "Codex",
				status: "error",
				message: "no token — login via Subscriptions settings",
				items: []
			});
		} else providers.push(off("codex", "Codex"));
		if (cfg.providers.opencodeGo) {
			const t = await opencodeGoToken(creds, this.llmProvider("opencode-go")?.apiKeyEnv || "OPENCODE_GO_API_KEY");
			providers.push(t ? await fetchOpencodeGo(t) : {
				id: "opencode-go",
				label: "OpenCode Go",
				status: "error",
				message: "no token — login via Subscriptions settings",
				items: []
			});
		} else providers.push(off("opencode-go", "OpenCode Go"));
		if (cfg.providers.commandcode) providers.push(await this.commandcodeRow(cfg, creds));
		else providers.push(off("commandcode", "command-code"));
		return {
			refreshedAt: now,
			providers
		};
	}
	async commandcodeRow(cfg, creds) {
		const llm = this.llmProvider("command-code");
		const keyEnv = llm?.apiKeyEnv || "COMMAND_CODE_API_KEY";
		const base = llm?.baseURL || "https://api.commandcode.ai/provider/v1";
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
			label: "command-code",
			status: "error",
			message: "no API key — add via DSH credentials",
			items: [],
			burn
		};
		const probe = await probeCommandcode(base, key.value);
		return {
			id: "commandcode",
			label: "command-code",
			status: probe.ok ? "ok" : "error",
			...probe.ok ? {} : { message: probe.message },
			items: [],
			probe: {
				ok: probe.ok,
				ms: probe.ms,
				...probe.modelCount !== void 0 ? { models: probe.modelCount } : {},
				...probe.message ? { message: probe.message } : {}
			},
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
	const ctrl = new OverlayController(ctx, () => scope, () => ctx.get("credentials"), () => {
		const providers = settingsSvc?.describe?.()?.find((x) => x.ns === "llm-pi-ai")?.value?.providers;
		if (!providers || typeof providers !== "object") return [];
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
export { Config, NS, appendBurn, apply, inject, monthToDate, name, probeCommandcode, publicSettings, validateSettingsPatch };

//# sourceMappingURL=index.js.map