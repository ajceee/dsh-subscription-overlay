/**
 * dsh-subscription-overlay — host entry.
 *
 * Fresh-fetch quota aggregation for claude / codex / opencode-go (per
 * docs/SPIKE.md §2.1: same credential refs, endpoints, and header shapes the
 * wezterm stack proved — never calls into dsh-plugin-subscriptions usage RPC
 * or dsh-quota state), a commandcode /models probe (online/offline only, never
 * a fake percentage), and a local burn ledger in our own settings namespace.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-subscription-overlay'
export const inject = ['settings']

/** Settings namespace shared by the host half and the browser panel. */
export const NS = 'dsh-subscription-overlay'

export interface Config {
  enabled: boolean
  pollMinutes: number
  alertPct: number
  providers: { claude: boolean; codex: boolean; opencodeGo: boolean; commandcode: boolean }
  commandcodeMonthlyBudget: number
  overlay: { mode: 'pill' | 'ring'; hotkey: string }
  burn: Record<string, Array<[number, number]>>
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  pollMinutes: z.number().min(1).max(60).default(5),
  alertPct: z.number().min(1).max(100).default(85),
  providers: z.object({
    claude: z.boolean().default(true),
    codex: z.boolean().default(true),
    opencodeGo: z.boolean().default(true),
    commandcode: z.boolean().default(true),
  }).default({ claude: true, codex: true, opencodeGo: true, commandcode: true }),
  commandcodeMonthlyBudget: z.number().min(0).default(0),
  overlay: z.object({
    mode: z.union([z.const('pill'), z.const('ring')]).default('pill'),
    hotkey: z.string().default('Ctrl+Shift+S'),
  }).default({ mode: 'pill' as const, hotkey: 'Ctrl+Shift+S' }),
  burn: z.dict(z.array(z.array(z.number()))).default({}),
}) as unknown as Config

/* ── row shapes (same shape dsh-quota's panel renders) ── */
export interface QuotaItem { label: string; percent?: number; resetAt?: string; display?: string }
export type ProviderId = 'claude' | 'codex' | 'opencode-go' | 'commandcode'
export interface ProviderRow {
  id: ProviderId; label: string
  status: 'ok' | 'error' | 'disabled' | 'loading'
  message?: string
  items?: QuotaItem[]
  probe?: { ok: boolean; ms: number; models?: number; message?: string }
  burn?: { monthToDate: number; budget: number; percent: number | null; resetAt: string }
}

async function resolveSecret(credentials: any, refs: string[], envKeys: string[]) {
  if (credentials) for (const ref of refs) {
    if (!ref) continue
    try {
      const resolved = await credentials.resolve(credentialRef(ref))
      if (resolved?.value) return { value: resolved.value as string, ref, source: resolved.source }
    } catch { /* next */ }
  }
  for (const k of envKeys) {
    const v = process.env[k]?.trim()
    if (v) return { value: v, ref: k, source: 'env' }
  }
  return undefined
}

async function readJsonFile(path: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined }
}

/** Token resolution order per SPIKE §2.1 (DSH creds → session files → CLI files). */
async function claudeToken(credentials: any): Promise<string | undefined> {
  const s = await resolveSecret(credentials, ['CLAUDE_ACCESS_TOKEN', 'CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'], [])
  if (s) return s.value
  const sub = await readJsonFile(join(homedir(), '.dsh', 'plugins', 'subscriptions', 'auth.json'))
  const t1 = sub?.claude?.access_token ?? sub?.claude?.accessToken
  if (typeof t1 === 'string' && t1) return t1
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  const cli = await readJsonFile(join(dir, '.credentials.json'))
  const t2 = cli?.claudeAiOauth?.accessToken
  return typeof t2 === 'string' && t2 ? t2 : undefined
}

async function codexToken(credentials: any): Promise<string | undefined> {
  const s = await resolveSecret(credentials, ['OPENAI_ACCESS_TOKEN', 'OPENAI_API_KEY'], [])
  if (s) return s.value
  const sub = await readJsonFile(join(homedir(), '.dsh', 'plugins', 'subscriptions', 'auth.json'))
  const t1 = sub?.codex?.access_token ?? sub?.codex?.accessToken
  if (typeof t1 === 'string' && t1) return t1
  const cli = await readJsonFile(join(homedir(), '.codex', 'auth.json'))
  const t2 = cli?.tokens?.access_token
  return typeof t2 === 'string' && t2 ? t2 : undefined
}

async function opencodeGoToken(credentials: any, apiKeyEnv: string): Promise<string | undefined> {
  const s = await resolveSecret(credentials, [apiKeyEnv, 'OPENCODE_GO_API_KEY'], [apiKeyEnv, 'OPENCODE_GO_API_KEY'])
  if (s) return s.value
  const nix = await readJsonFile(join(homedir(), '.local', 'share', 'opencode', 'auth.json'))
  const t1 = nix?.['opencode-go']?.key
  if (typeof t1 === 'string' && t1) return t1
  const win = process.env.USERPROFILE
    ? await readJsonFile(join(process.env.USERPROFILE, '.config', 'opencode', 'auth.json'))
    : undefined
  const t2 = win?.['opencode-go']?.key
  return typeof t2 === 'string' && t2 ? t2 : undefined
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/* ── fresh fetches (SPIKE §2.1 request/response shapes) ── */
async function fetchClaude(token: string): Promise<ProviderRow> {
  try {
    const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-cli/2.1.20',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!resp.ok) {
      const auth = resp.status === 401 || resp.status === 403
      return { id: 'claude', label: 'Claude', status: 'error', message: auth ? 'auth failed — re-login in Subscriptions settings' : `HTTP ${resp.status}`, items: [] }
    }
    const b: any = await resp.json()
    const items: QuotaItem[] = []
    const push = (label: string, w: any) => {
      const pct = num(w?.utilization)
      if (pct !== undefined) items.push({ label, percent: pct, resetAt: typeof w?.resets_at === 'string' ? w.resets_at : undefined })
    }
    push('5h window', b?.five_hour)
    push('7d window', b?.seven_day)
    for (const lim of Array.isArray(b?.limits) ? b.limits : []) {
      const pct = num(lim?.percent)
      if (pct !== undefined) items.push({ label: String(lim?.kind ?? 'limit'), percent: pct, resetAt: typeof lim?.resets_at === 'string' ? lim.resets_at : undefined })
    }
    return { id: 'claude', label: 'Claude', status: 'ok', items }
  } catch (err) {
    return { id: 'claude', label: 'Claude', status: 'error', message: err instanceof Error ? err.message : String(err), items: [] }
  }
}

async function fetchCodex(token: string): Promise<ProviderRow> {
  try {
    const resp = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      const auth = resp.status === 401 || resp.status === 403
      return { id: 'codex', label: 'Codex', status: 'error', message: auth ? 'auth failed — re-login in Subscriptions settings' : `HTTP ${resp.status}`, items: [] }
    }
    const b: any = await resp.json()
    const items: QuotaItem[] = []
    const p = num(b?.primary_pct)
    if (p !== undefined) items.push({ label: 'primary', percent: p, resetAt: b?.primary_reset_at ?? b?.primary_reset })
    const s = num(b?.secondary_pct)
    if (s !== undefined) items.push({ label: 'secondary', percent: s, resetAt: b?.secondary_reset_at ?? b?.secondary_reset })
    return { id: 'codex', label: 'Codex', status: 'ok', items }
  } catch (err) {
    return { id: 'codex', label: 'Codex', status: 'error', message: err instanceof Error ? err.message : String(err), items: [] }
  }
}

async function fetchOpencodeGo(token: string): Promise<ProviderRow> {
  try {
    const resp = await fetch('https://opencode.ai/zen/go/v1/usage', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!resp.ok) {
      const auth = resp.status === 401 || resp.status === 403
      return { id: 'opencode-go', label: 'OpenCode Go', status: 'error', message: auth ? 'auth failed — re-login in Subscriptions settings' : `HTTP ${resp.status}`, items: [] }
    }
    const b: any = await resp.json()
    const items: QuotaItem[] = []
    const push = (label: string, w: any) => {
      const pct = num(w?.utilization)
      if (pct !== undefined) items.push({ label, percent: pct, resetAt: typeof w?.resets_at === 'string' ? w.resets_at : undefined })
    }
    push('5h window', b?.five_hour)
    push('7d window', b?.seven_day)
    push('monthly', b?.monthly)
    return { id: 'opencode-go', label: 'OpenCode Go', status: 'ok', items }
  } catch (err) {
    return { id: 'opencode-go', label: 'OpenCode Go', status: 'error', message: err instanceof Error ? err.message : String(err), items: [] }
  }
}

/** commandcode probe: GET {baseURL}/models → online/offline only, never a percentage. */
export async function probeCommandcode(baseURL: string, apiKey: string): Promise<{ ok: boolean; ms: number; message?: string; modelCount?: number }> {
  const base = baseURL.replace(/\/+$/, '')
  const t0 = Date.now()
  try {
    const resp = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    })
    const ms = Date.now() - t0
    if (!resp.ok) return { ok: false, ms, message: `探测失败 HTTP ${resp.status}` }
    let count: number | undefined
    try {
      const b: any = await resp.json()
      const arr = Array.isArray(b) ? b : b?.data
      if (Array.isArray(arr)) count = arr.length
    } catch { /* count stays undefined */ }
    return { ok: true, ms, modelCount: count }
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, message: `探测失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/* ── burn ledger (per-model [epochMs, tokens], 30d prune, 1000/model cap) ── */
export function appendBurn(
  burn: Record<string, Array<[number, number]>>,
  model: string, tokens: number, now = Date.now(),
): Record<string, Array<[number, number]>> {
  const key = `commandcode::${model}`
  const cutoff = now - 30 * 24 * 3600_000
  const next = [...(burn[key] ?? []), [now, tokens] as [number, number]]
    .filter(([t]) => t >= cutoff)
    .slice(-1000)
  return { ...burn, [key]: next }
}

export function monthToDate(burn: Record<string, Array<[number, number]>>, now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  let sum = 0
  for (const pts of Object.values(burn)) for (const [t, n] of pts) if (t >= start) sum += n
  return sum
}

class OverlayController {
  constructor(
    private ctx: Context,
    private getScope: () => any,
    private getCredentials: () => any,
    private getLlmProviders: () => Array<{ id: string; apiKeyEnv?: string; baseURL?: string }>,
  ) {}
  private cfg(): Config {
    return this.getScope()?.get() ?? {
      enabled: true, pollMinutes: 5, alertPct: 85,
      providers: { claude: true, codex: true, opencodeGo: true, commandcode: true },
      commandcodeMonthlyBudget: 0, overlay: { mode: 'pill', hotkey: 'Ctrl+Shift+S' }, burn: {},
    }
  }
  private llmProvider(id: string) { return this.getLlmProviders().find((p) => p.id === id) }

  async refresh(): Promise<{ refreshedAt: number; providers: ProviderRow[] }> {
    const cfg = this.cfg()
    const creds = this.getCredentials()
    const now = Date.now()
    const off = (id: ProviderId, label: string): ProviderRow => ({ id, label, status: 'disabled', items: [] })
    if (!cfg.enabled) {
      return {
        refreshedAt: now,
        providers: [
          off('claude', 'Claude'),
          off('codex', 'Codex'),
          off('opencode-go', 'OpenCode Go'),
          off('commandcode', 'command-code'),
        ],
      }
    }
    const providers: ProviderRow[] = []
    if (cfg.providers.claude) {
      const t = await claudeToken(creds)
      providers.push(t ? await fetchClaude(t) : { id: 'claude', label: 'Claude', status: 'error', message: 'no token — login via Subscriptions settings', items: [] })
    } else providers.push(off('claude', 'Claude'))
    if (cfg.providers.codex) {
      const t = await codexToken(creds)
      providers.push(t ? await fetchCodex(t) : { id: 'codex', label: 'Codex', status: 'error', message: 'no token — login via Subscriptions settings', items: [] })
    } else providers.push(off('codex', 'Codex'))
    if (cfg.providers.opencodeGo) {
      const env = this.llmProvider('opencode-go')?.apiKeyEnv || 'OPENCODE_GO_API_KEY'
      const t = await opencodeGoToken(creds, env)
      providers.push(t ? await fetchOpencodeGo(t) : { id: 'opencode-go', label: 'OpenCode Go', status: 'error', message: 'no token — login via Subscriptions settings', items: [] })
    } else providers.push(off('opencode-go', 'OpenCode Go'))
    if (cfg.providers.commandcode) providers.push(await this.commandcodeRow(cfg, creds))
    else providers.push(off('commandcode', 'command-code'))
    return { refreshedAt: now, providers }
  }

  private async commandcodeRow(cfg: Config, creds: any): Promise<ProviderRow> {
    const llm = this.llmProvider('command-code')
    const keyEnv = llm?.apiKeyEnv || 'COMMAND_CODE_API_KEY'
    const base = llm?.baseURL || 'https://api.commandcode.ai/provider/v1'
    const key = await resolveSecret(creds, [keyEnv, 'COMMAND_CODE_API_KEY'], [keyEnv, 'COMMAND_CODE_API_KEY'])
    const mtd = monthToDate(cfg.burn ?? {})
    const budget = cfg.commandcodeMonthlyBudget ?? 0
    const next = new Date(); next.setMonth(next.getMonth() + 1, 1); next.setHours(0, 0, 0, 0)
    const burn = { monthToDate: mtd, budget, percent: budget > 0 ? (mtd / budget) * 100 : null as number | null, resetAt: next.toISOString() }
    if (!key) {
      return { id: 'commandcode', label: 'command-code', status: 'error', message: 'no API key — add via DSH credentials', items: [], burn }
    }
    const probe = await probeCommandcode(base, key.value)
    return {
      id: 'commandcode', label: 'command-code',
      status: probe.ok ? 'ok' : 'error',
      ...(probe.ok ? {} : { message: probe.message }),
      items: [],
      probe: { ok: probe.ok, ms: probe.ms, ...(probe.modelCount !== undefined ? { models: probe.modelCount } : {}), ...(probe.message ? { message: probe.message } : {}) },
      burn,
    }
  }

  status() {
    const cfg = this.cfg()
    return { alertPct: cfg.alertPct, overlay: cfg.overlay, enabled: cfg.enabled, settings: publicSettings(cfg) }
  }

  /** Validate a partial settings patch and persist it via the installSection source. */
  async updateSettings(patch: unknown) {
    const scope = this.getScope()
    if (!scope) return { ok: false as const, error: 'settings unavailable' }
    const parsed = validateSettingsPatch(patch)
    if (!parsed.ok) return { ok: false as const, error: parsed.error }
    const cfg = this.cfg()
    const next: Config = {
      ...cfg,
      ...parsed.value,
      providers: { ...cfg.providers, ...(parsed.value.providers ?? {}) },
      overlay: { ...cfg.overlay, ...(parsed.value.overlay ?? {}) },
    }
    await scope.update(stripRuntime(next))
    return { ok: true as const, settings: publicSettings(this.cfg()) }
  }

  async ledgerAppend(model: string, tokens: number) {
    const scope = this.getScope()
    if (!scope || typeof model !== 'string' || !model || !Number.isFinite(tokens) || tokens < 0) {
      return { ok: false as const, error: 'model and non-negative tokens required' }
    }
    const cfg = this.cfg()
    await scope.update({ burn: appendBurn(cfg.burn ?? {}, model, tokens) })
    return { ok: true as const }
  }
}

/* ── settings seam (t6): validation + public echo, burn never leaves the host ── */
interface SettingsPatch {
  enabled?: boolean
  pollMinutes?: number
  alertPct?: number
  providers?: { claude?: boolean; codex?: boolean; opencodeGo?: boolean; commandcode?: boolean }
  commandcodeMonthlyBudget?: number
  overlay?: { mode?: 'pill' | 'ring'; hotkey?: string }
}

export function publicSettings(cfg: Config) {
  return {
    enabled: cfg.enabled,
    pollMinutes: cfg.pollMinutes,
    alertPct: cfg.alertPct,
    providers: { ...cfg.providers },
    commandcodeMonthlyBudget: cfg.commandcodeMonthlyBudget,
    overlay: { ...cfg.overlay },
  }
}

function stripRuntime(next: Config) {
  const { burn: _burn, ...rest } = next as Config & { burn?: unknown }
  void _burn
  return rest
}

export function validateSettingsPatch(patch: unknown): { ok: true; value: SettingsPatch } | { ok: false; error: string } {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, error: 'settings object required' }
  }
  const p = patch as Record<string, unknown>
  const out: SettingsPatch = {}
  if (p.enabled !== undefined) {
    if (typeof p.enabled !== 'boolean') return { ok: false, error: 'enabled must be boolean' }
    out.enabled = p.enabled
  }
  if (p.pollMinutes !== undefined) {
    if (typeof p.pollMinutes !== 'number' || !Number.isFinite(p.pollMinutes) || p.pollMinutes < 1 || p.pollMinutes > 60) {
      return { ok: false, error: 'pollMinutes must be a number in 1–60' }
    }
    out.pollMinutes = p.pollMinutes
  }
  if (p.alertPct !== undefined) {
    if (typeof p.alertPct !== 'number' || !Number.isFinite(p.alertPct) || p.alertPct < 1 || p.alertPct > 100) {
      return { ok: false, error: 'alertPct must be a number in 1–100' }
    }
    out.alertPct = p.alertPct
  }
  if (p.providers !== undefined) {
    if (typeof p.providers !== 'object' || p.providers === null || Array.isArray(p.providers)) {
      return { ok: false, error: 'providers must be an object' }
    }
    const prov = p.providers as Record<string, unknown>
    const sub: NonNullable<SettingsPatch['providers']> = {}
    for (const k of ['claude', 'codex', 'opencodeGo', 'commandcode'] as const) {
      if (prov[k] !== undefined) {
        if (typeof prov[k] !== 'boolean') return { ok: false, error: `providers.${k} must be boolean` }
        sub[k] = prov[k] as boolean
      }
    }
    out.providers = sub
  }
  if (p.commandcodeMonthlyBudget !== undefined) {
    if (typeof p.commandcodeMonthlyBudget !== 'number' || !Number.isFinite(p.commandcodeMonthlyBudget) || p.commandcodeMonthlyBudget < 0) {
      return { ok: false, error: 'commandcodeMonthlyBudget must be a number ≥ 0' }
    }
    out.commandcodeMonthlyBudget = p.commandcodeMonthlyBudget
  }
  if (p.overlay !== undefined) {
    if (typeof p.overlay !== 'object' || p.overlay === null || Array.isArray(p.overlay)) {
      return { ok: false, error: 'overlay must be an object' }
    }
    const ov = p.overlay as Record<string, unknown>
    const sub: NonNullable<SettingsPatch['overlay']> = {}
    if (ov.mode !== undefined) {
      if (ov.mode !== 'pill' && ov.mode !== 'ring') return { ok: false, error: 'overlay.mode must be pill|ring' }
      sub.mode = ov.mode
    }
    if (ov.hotkey !== undefined) {
      if (typeof ov.hotkey !== 'string' || !ov.hotkey) return { ok: false, error: 'overlay.hotkey must be a non-empty string' }
      sub.hotkey = ov.hotkey
    }
    out.overlay = sub
  }
  return { ok: true, value: out }
}

function send(res: any, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readJson(req: any): Promise<any> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return {} }
}

const API_PREFIX = '/plugins/dsh-subscription-overlay/api'
const CSRF_HEADER = 'x-dsh-subscription-overlay'

function registerHttpRoutes(sctx: any, ctrl: OverlayController) {
  sctx.effect(() => sctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req: any, res: any) => route(req, res, ctrl),
  }))
}

async function route(req: any, res: any, ctrl: OverlayController) {
  const path = new URL(req.url ?? '/', 'http://x').pathname.slice(API_PREFIX.length)
  const method = req.method ?? 'GET'
  try {
    if (method === 'GET' && path === '/status') return send(res, 200, { ...ctrl.status(), ...(await ctrl.refresh()) })
    if (method === 'POST') {
      if (req.headers[CSRF_HEADER] === undefined) return send(res, 403, { error: 'missing required custom header' })
      if (path === '/refresh') return send(res, 200, await ctrl.refresh())
      if (path === '/probe') return send(res, 200, await ctrl.refresh())
      if (path === '/settings') {
        const body = await readJson(req)
        const r = await ctrl.updateSettings(body)
        return send(res, r.ok ? 200 : 400, r)
      }
      if (path === '/ledger/append') {
        const body = await readJson(req)
        return send(res, 200, await ctrl.ledgerAppend(body?.model, body?.tokens))
      }
    }
    return send(res, 404, { error: 'not found' })
  } catch (err) {
    return send(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

export function apply(ctx: Context, config: Config): void {
  let scope: any
  let settingsSvc: any
  const ctrl = new OverlayController(
    ctx,
    () => scope,
    () => (ctx as any).get('credentials'),
    () => {
      const providers = settingsSvc?.describe?.()?.find((x: any) => x.ns === 'llm-pi-ai')?.value?.providers
      if (!providers || typeof providers !== 'object') return []
      const out: Array<{ id: string; apiKeyEnv?: string; baseURL?: string }> = []
      for (const [id, p] of Object.entries<any>(providers)) {
        out.push({
          id,
          ...(typeof p?.apiKeyEnv === 'string' && p.apiKeyEnv ? { apiKeyEnv: p.apiKeyEnv } : {}),
          ...(typeof p?.baseURL === 'string' && p.baseURL ? { baseURL: p.baseURL } : {}),
        })
      }
      return out
    },
  )
  ctx.inject(['settings'], (sctx: any) => {
    settingsSvc = sctx.settings
    scope = sctx.settings.register(NS, Config, { base: config })
  })
  if (config.pollMinutes > 0) {
    ctx.inject(['settings'], () => {
      const timer = setInterval(() => { void ctrl.refresh() }, config.pollMinutes * 60_000)
      return () => clearInterval(timer)
    })
  }
  ctx.inject(['webServer'], (sctx: any) => {
    registerHttpRoutes(sctx, ctrl)
  })
}
