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
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applyStaleFallback, isLiveDue, isPersistentHttpStatus, nextLiveDelayMs, resolveStatusSnapshot } from './refresh-cache.js'
import type { SwrRow } from './refresh-cache.js'

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
  overlay: { mode: 'pill' | 'ring'; hotkey: string; display: 'dock' | 'floater' }
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
    display: z.union([z.const('dock'), z.const('floater')]).default('dock'),
  }).default({ mode: 'pill' as const, hotkey: 'Ctrl+Shift+S', display: 'dock' as const }),
  burn: z.dict(z.array(z.array(z.number()))).default({}),
}) as unknown as Config

/* ── row shapes (same shape dsh-quota's panel renders) ── */
export interface QuotaItem { label: string; percent?: number; resetAt?: string; display?: string }
export type ProviderId = 'claude' | 'codex' | 'opencode-go' | 'commandcode'
export interface ProviderRow {
  id: ProviderId; label: string
  status: 'ok' | 'error' | 'disabled' | 'loading'
  message?: string
  /** Served from cache after a transient failure (429/cooldown/network). */
  stale?: boolean
  /** Host-internal failure class; stripped before sending to clients. */
  transient?: boolean
  items?: QuotaItem[]
  probe?: { ok: boolean; ms: number; models?: number; message?: string }
  burn?: { monthToDate: number; budget: number; percent: number | null; resetAt: string }
  [key: string]: unknown
}

/** Cached parsed credentials yaml (keyed by path, loaded once per process). */
const _credCache: Record<string, Record<string, string> | null> = {}

/** Read key→value pairs from ~/.dsh/.credentials.yaml without a YAML parser.
 *  Only handles the simple `KEY: value` lines the DSH credentials domain writes. */
async function readDshCredentials(): Promise<Record<string, string>> {
  const path = join(homedir(), '.dsh', '.credentials.yaml')
  if (path in _credCache) return _credCache[path] ?? {}
  try {
    const raw = await readFile(path, 'utf8')
    const out: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const m = line.match(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.+)$/)
      if (m) out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    _credCache[path] = out
    return out
  } catch {
    _credCache[path] = null
    return {}
  }
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
  // Final fallback: read directly from ~/.dsh/.credentials.yaml when the
  // credentials service has not yet injected (e.g. on first cold refresh).
  const yaml = await readDshCredentials()
  for (const k of envKeys) {
    const v = yaml[k]?.trim()
    if (v) return { value: v, ref: k, source: 'yaml' }
  }
  return undefined
}

async function readJsonFile(path: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined }
}

/** Preemptive refresh window: upstream AccountTokenManager parity (5min). */
const SUB_PREEMPT_MS = 5 * 60_000

/** Normalized subscription session (camelCase store shape; snake_case tolerated on read). */
interface SubSession {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
}

const normStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : undefined
const normMs = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined

/** Pick the default account entry out of one provider's auth.json record. */
function pickSubEntry(entry: any): { key: string; raw: any } | undefined {
  if (!entry || typeof entry !== 'object') return undefined
  const accounts = entry.accounts
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    const keys = Object.keys(accounts)
    if (keys.length === 0) return undefined
    const def = entry.defaultAccount
    const key: string = typeof def === 'string' && accounts[def] ? def : keys[0] as string
    return { key, raw: accounts[key] }
  }
  // Legacy single-account shape (fields directly on the provider entry).
  return { key: '', raw: entry }
}

function normSubSession(raw: any): SubSession | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const accessToken = normStr(raw.accessToken ?? raw.access_token)
  if (!accessToken) return undefined
  const sess: SubSession = { accessToken }
  const refreshToken = normStr(raw.refreshToken ?? raw.refresh_token)
  if (refreshToken) sess.refreshToken = refreshToken
  const expiresAt = normMs(raw.expiresAt ?? raw.expires_at)
  if (expiresAt !== undefined) sess.expiresAt = expiresAt
  const accountId = normStr(raw.accountId ?? raw.account_id)
  if (accountId) sess.accountId = accountId
  return sess
}

function subAuthPath(): string {
  return join(homedir(), '.dsh', 'plugins', 'subscriptions', 'auth.json')
}

/** Read one provider's default subscription session (accounts-map aware). */
async function readSubSession(provider: 'claude' | 'codex'): Promise<{ key: string; session: SubSession } | undefined> {
  const store = await readJsonFile(subAuthPath())
  const picked = pickSubEntry(store?.[provider])
  if (!picked) return undefined
  const session = normSubSession(picked.raw)
  return session ? { key: picked.key, session } : undefined
}

/** Persist refreshed fields onto the same account entry, preserving the rest of the file. */
async function writeSubSession(provider: 'claude' | 'codex', key: string, patch: SubSession): Promise<void> {
  const path = subAuthPath()
  const store: any = await readJsonFile(path)
  if (!store || typeof store !== 'object' || Array.isArray(store)) return
  const entry = store[provider]
  if (!entry || typeof entry !== 'object') return
  const target = entry.accounts && typeof entry.accounts === 'object' && key
    ? entry.accounts[key]
    : entry
  if (!target || typeof target !== 'object') return
  // Write back in whichever case the entry already uses (never rename fields).
  if (patch.accessToken) {
    if ('accessToken' in target || !('access_token' in target)) target.accessToken = patch.accessToken
    else target.access_token = patch.accessToken
  }
  if (patch.refreshToken) {
    if ('refreshToken' in target || !('refresh_token' in target)) target.refreshToken = patch.refreshToken
    else target.refresh_token = patch.refreshToken
  }
  if (patch.expiresAt !== undefined) {
    if ('expiresAt' in target || !('expires_at' in target)) target.expiresAt = patch.expiresAt
    else target.expires_at = patch.expiresAt
  }
  await writeFile(path, JSON.stringify(store, null, 2))
}

const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CLAUDE_TOKEN_URL = 'https://claude.ai/v1/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'

/** Permanent grant rejection (upstream isClaudePermanentRefreshError parity). */
function isPermanentOAuthError(body: any): boolean {
  const code = typeof body?.error === 'string' ? body.error : ''
  return code === 'invalid_grant' || code === 'invalid_token'
}

/** Best-effort JWT exp read (codex expiry fallback; hint only, never verified). */
function decodeJwtExp(accessToken: string): number | undefined {
  try {
    const part = accessToken.split('.')[1]
    if (!part) return undefined
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as any
    return normMs(payload?.exp) !== undefined ? (payload.exp as number) : undefined
  } catch {
    return undefined
  }
}

/**
 * Refresh one stored session via its provider token endpoint. Returns the
 * fresh session, the stale session on transient failure (use it), or
 * undefined when the grant is permanently rejected (caller surfaces re-login).
 */
async function refreshSubSession(provider: 'claude' | 'codex', sess: SubSession): Promise<SubSession | undefined> {
  if (!sess.refreshToken) return undefined
  const url = provider === 'claude' ? CLAUDE_TOKEN_URL : CODEX_TOKEN_URL
  const clientId = provider === 'claude' ? CLAUDE_CLIENT_ID : CODEX_CLIENT_ID
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: sess.refreshToken, client_id: clientId }),
      signal: AbortSignal.timeout(15_000),
    })
    const body: any = await resp.json().catch(() => undefined)
    if (!resp.ok) return isPermanentOAuthError(body) ? undefined : sess
    const accessToken = normStr(body?.access_token)
    if (!accessToken) return sess
    const next: SubSession = { ...sess, accessToken }
    const refreshToken = normStr(body?.refresh_token)
    if (refreshToken) next.refreshToken = refreshToken
    const expiresIn = num(body?.expires_in)
    if (expiresIn !== undefined && expiresIn > 0) {
      next.expiresAt = Date.now() + expiresIn * 1000
    } else {
      const exp = decodeJwtExp(accessToken)
      if (exp !== undefined) next.expiresAt = exp * 1000
    }
    return next
  } catch {
    return sess
  }
}

/** In-flight refresh coalescing per provider+account (upstream TokenManager parity). */
const refreshInflight = new Map<string, Promise<SubSession | undefined>>()

/**
 * Resolve a usable session, refreshing proactively inside the preempt window
 * (upstream TokenManager.session parity). Sessions without expiry metadata
 * (DSH-creds / CLI tokens) are used as-is — there is no grant to refresh.
 */
async function ensureFreshSubSession(provider: 'claude' | 'codex', key: string, sess: SubSession): Promise<SubSession | undefined> {
  if (sess.expiresAt === undefined) return sess
  if (sess.expiresAt - Date.now() > SUB_PREEMPT_MS) return sess
  if (!sess.refreshToken) return sess.expiresAt > Date.now() ? sess : undefined
  const flightKey = `${provider}:${key || 'default'}`
  let p = refreshInflight.get(flightKey)
  if (!p) {
    p = (async () => {
      const fresh = await refreshSubSession(provider, sess)
      if (fresh && fresh !== sess) {
        try { await writeSubSession(provider, key, fresh) } catch { /* keep in-memory */ }
      }
      return fresh
    })().finally(() => { refreshInflight.delete(flightKey) })
    refreshInflight.set(flightKey, p)
  }
  return p
}

/** Token resolution order per SPIKE §2.1 (DSH creds → session files → CLI files). */
async function claudeToken(credentials: any): Promise<string | undefined> {
  const s = await resolveSecret(credentials, ['CLAUDE_ACCESS_TOKEN', 'CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'], [])
  if (s) return s.value
  const stored = await readSubSession('claude')
  if (stored) {
    const fresh = await ensureFreshSubSession('claude', stored.key, stored.session)
    if (fresh) return fresh.accessToken
  }
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  const cli = await readJsonFile(join(dir, '.credentials.json'))
  const t2 = cli?.claudeAiOauth?.accessToken
  return typeof t2 === 'string' && t2 ? t2 : undefined
}

async function codexToken(credentials: any): Promise<{ token: string; accountId?: string } | undefined> {
  const s = await resolveSecret(credentials, ['OPENAI_ACCESS_TOKEN', 'OPENAI_API_KEY'], [])
  if (s) return { token: s.value }
  const stored = await readSubSession('codex')
  if (stored) {
    const fresh = await ensureFreshSubSession('codex', stored.key, stored.session)
    if (fresh) return { token: fresh.accessToken, ...(fresh.accountId ? { accountId: fresh.accountId } : {}) }
  }
  const cli = await readJsonFile(join(homedir(), '.codex', 'auth.json'))
  const t2 = cli?.tokens?.access_token
  return typeof t2 === 'string' && t2 ? { token: t2 } : undefined
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

/** Anthropic throttles the OAuth usage endpoint per token. The same token is
 *  polled by the CLI, WezTerm quota widgets and this overlay, so 429s happen.
 *  While cooling down we fail fast without another network call. */
/** Fallback when Claude Code is absent (upstream CLAUDE_CLI_FALLBACK_VERSION). */
const CLAUDE_CLI_FALLBACK_VERSION = '2.1.263'

/**
 * Detected CLI version, memoized (upstream detectClaudeVersion parity: the
 * probe shells out, so it must not run at module-evaluation time).
 */
function detectClaudeCliVersion(): string {
  const probes: Array<[string, string[], { shell?: boolean }]> =
    process.platform === 'win32'
      ? [['claude --version', [], { shell: true }], ['claude.cmd --version', [], { shell: true }]]
      : [['claude', ['--version'], {}]]
  for (const [command, args, options] of probes) {
    try {
      const raw = execFileSync(command, [...args], {
        timeout: 10_000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        ...options,
      })
      const match = String(raw).match(/(\d+\.\d+\.\d+)/)
      if (match) return match[1]
    } catch { /* next probe */ }
  }
  return CLAUDE_CLI_FALLBACK_VERSION
}

let claudeCliUserAgent: string | undefined
/**
 * CLI-impersonating User-Agent (upstream getClaudeCliUserAgent parity:
 * `claude-cli/<version> (external, cli)`). Unrecognized clients are
 * aggressively rate-limited on the OAuth usage endpoint.
 */
function getClaudeCliUserAgent(): string {
  if (claudeCliUserAgent === undefined) {
    claudeCliUserAgent = `claude-cli/${detectClaudeCliVersion()} (external, cli)`
  }
  return claudeCliUserAgent
}

let claudeCooldownUntil = 0
import { mapClaudeUsage } from './claude-usage.js'
export { mapClaudeUsage }

async function fetchClaude(token: string): Promise<ProviderRow> {
  const limited = (): ProviderRow => ({
    id: 'claude', label: 'Claude', status: 'error',
    message: 'rate limited by Anthropic — retrying automatically', items: [], transient: true,
  })
  if (Date.now() < claudeCooldownUntil) return limited()
  try {
    const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': getClaudeCliUserAgent(),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!resp.ok) {
      const auth = isPersistentHttpStatus(resp.status)
      if (resp.status === 429) {
        // Honor Anthropic's retry-after (seconds or HTTP date), default 60s.
        let waitMs = 60_000
        const ra = resp.headers.get('retry-after')
        if (ra) {
          const secs = Number(ra)
          if (Number.isFinite(secs)) waitMs = Math.min(secs, 300) * 1000
          else { const t = Date.parse(ra); if (!Number.isNaN(t)) waitMs = Math.min(Math.max(t - Date.now(), 1000), 300_000) }
        }
        claudeCooldownUntil = Date.now() + waitMs
        return limited()
      }
      return { id: 'claude', label: 'Claude', status: 'error', message: auth ? 'auth failed — re-login in Subscriptions settings' : `HTTP ${resp.status}`, items: [], transient: !auth }
    }
    const b: any = await resp.json()
    return { id: 'claude', label: 'Claude', status: 'ok', items: mapClaudeUsage(b) }
  } catch (err) {
    return { id: 'claude', label: 'Claude', status: 'error', message: err instanceof Error ? err.message : String(err), items: [], transient: true }
  }
}

async function fetchCodex(token: string, accountId?: string): Promise<ProviderRow> {
  try {
    const resp = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
        originator: 'codex_cli_rs',
        ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      const auth = isPersistentHttpStatus(resp.status)
      return { id: 'codex', label: 'Codex', status: 'error', message: auth ? 'auth failed — re-login in Subscriptions settings' : `HTTP ${resp.status}`, items: [], transient: !auth }
    }
    const b: any = await resp.json()
    const items: QuotaItem[] = []

    // wham/usage raw shape:
    //   { rate_limit: { primary_window: { used_percent, limit_window_seconds, reset_at(unix-s) },
    //                   secondary_window: { … } } }
    // reset_at is a Unix seconds integer (e.g. 1789643729), not an ISO string.
    const rl = b?.rate_limit ?? b
    const windowPct = (w: any): number | undefined => num(w?.used_percent) ?? num(w?.usedPercent)
    // Normalise reset_at: unix-seconds int → ISO string; ISO string → pass through
    const windowReset = (w: any): string | undefined => {
      const v = w?.reset_at ?? w?.resetsAt
      if (typeof v === 'number' && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString()
      if (typeof v === 'string' && v) return v
      return undefined
    }
    const pri = rl?.primary_window ?? null
    const sec = rl?.secondary_window ?? null
    const priPct   = pri !== null ? windowPct(pri) : num(b?.primary_pct)
    const secPct   = sec !== null ? windowPct(sec) : num(b?.secondary_pct)
    const priReset = pri !== null ? windowReset(pri) : undefined
    const secReset = sec !== null ? windowReset(sec) : undefined
    // primary_window = 5-hour rolling; secondary_window = weekly (per Codex plan docs)
    if (priPct !== undefined) items.push({ label: '5h', percent: priPct, resetAt: priReset })
    if (secPct !== undefined) items.push({ label: '7d', percent: secPct, resetAt: secReset })
    return { id: 'codex', label: 'Codex', status: 'ok', items }
  } catch (err) {
    return { id: 'codex', label: 'Codex', status: 'error', message: err instanceof Error ? err.message : String(err), items: [], transient: true }
  }
}

async function fetchOpencodeGo(token: string): Promise<ProviderRow> {
  try {
    const resp = await fetch('https://opencode.ai/zen/go/v1/usage', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!resp.ok) {
      const auth = isPersistentHttpStatus(resp.status)
      return { id: 'opencode-go', label: 'OpenCode Go', status: 'error', message: auth ? 'auth failed — re-login in Subscriptions settings' : `HTTP ${resp.status}`, items: [], transient: !auth }
    }
    const b: any = await resp.json()
    const items: QuotaItem[] = []
    // opencode.ai/zen/go/v1/usage raw shape:
    //   { usage: { rolling: {percent, resetsAt, status}, weekly: {...}, monthly: {...} } }
    // WezTerm normalises rolling→five_hour, weekly→seven_day with .utilization/.resets_at.
    // We read both the raw and normalised shapes for forward/backward compatibility.
    const usage = b?.usage ?? b
    const pushWindow = (label: string, raw: any, normalised: any) => {
      const pct = num(raw?.percent) ?? num(normalised?.utilization)
      const resetAt = (typeof raw?.resetsAt === 'string' ? raw.resetsAt : undefined)
        ?? (typeof normalised?.resets_at === 'string' ? normalised.resets_at : undefined)
      if (pct !== undefined) items.push({ label, percent: pct, resetAt })
    }
    pushWindow('5h',  usage?.rolling, b?.five_hour)
    pushWindow('7d',  usage?.weekly,   b?.seven_day)
    pushWindow('30d', usage?.monthly,  b?.monthly)
    return { id: 'opencode-go', label: 'OpenCode Go', status: 'ok', items }
  } catch (err) {
    return { id: 'opencode-go', label: 'OpenCode Go', status: 'error', message: err instanceof Error ? err.message : String(err), items: [], transient: true }
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
export async function fetchCommandcode(apiKey: string): Promise<ProviderRow> {
  const base = 'https://api.commandcode.ai'
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  const sig = AbortSignal.timeout(15_000)
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers, signal: sig })
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
    return r.json() as Promise<any>
  }

  try {
    // 1. whoami — resolve orgId for scoped requests
    const whoami = await get('/alpha/whoami')
    const orgId: string | null = whoami?.org?.id ?? null
    const q = orgId ? `?orgId=${orgId}` : ''

    // 2+3. credits (window meters) + subscriptions in parallel
    const [creditsRaw, subsRaw] = await Promise.allSettled([
      get(`/alpha/billing/credits${q}`),
      get(`/alpha/billing/subscriptions${q}`),
    ])

    const credits = creditsRaw.status === 'fulfilled' ? creditsRaw.value : null
    const subs    = subsRaw.status === 'fulfilled'    ? subsRaw.value    : null

    const items: QuotaItem[] = []

    // Rolling window meters from billing/credits — same pattern as Claude 5h/7d
    const wl = credits?.windowLimits
    const pushWindow = (label: string, w: any) => {
      if (!w || typeof w.used !== 'number' || typeof w.cap !== 'number' || w.cap === 0) return
      const pct = Math.round((w.used / w.cap) * 100)
      // resetAt is a ms-epoch integer — convert to ISO string for the panel's resetText()
      const resetAt = typeof w.resetAt === 'number'
        ? new Date(w.resetAt).toISOString()
        : typeof w.resetAt === 'string' ? w.resetAt : undefined
      items.push({ label, percent: pct, resetAt })
    }
    pushWindow('5h', wl?.fiveHour)
    pushWindow('7d', wl?.weekly)

    // Plan
    const planId: string | undefined = subs?.data?.planId
    if (planId) items.push({ label: 'plan', display: planId })

    return { id: 'commandcode', label: 'CommandCode', status: 'ok', items }
  } catch (err: any) {
    const auth = err?.status === 401 || err?.status === 403
    return {
      id: 'commandcode', label: 'CommandCode', status: 'error',
      message: auth ? 'auth failed — check API key in DSH credentials'
        : err instanceof Error ? err.message : String(err),
      items: [],
    }
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

/** Providers with a bespoke quota fetcher: settings-form key → display info. */
const KNOWN_QUOTA = {
  claude:      { label: 'Claude',      detail: '5h / 7d windows' },
  codex:       { label: 'Codex',       detail: '5h / 7d windows' },
  opencodeGo:  { label: 'OpenCode Go', detail: '5h / 7d / 30d windows' },
  commandcode: { label: 'CommandCode', detail: '5h / 7d windows' },
} as const

export interface ProviderCatalogEntry {
  key: string
  label: string
  detail: string
  supported: boolean
}

/** llm-pi-ai provider id → settings-form key (unmapped ids stay as-is). */
const LLM_ID_TO_KEY: Record<string, string> = {
  'opencode-go': 'opencodeGo',
  'command-code': 'commandcode',
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
      commandcodeMonthlyBudget: 0, overlay: { mode: 'pill', hotkey: 'Ctrl+Shift+S', display: 'dock' }, burn: {},
    }
  }
  private llmProvider(id: string) { return this.getLlmProviders().find((p) => p.id === id) }

  /** Dynamic provider catalog: the 4 quota-capable providers first, then any
   *  extra llm-pi-ai providers (auto-detected, marked unsupported until a
   *  bespoke quota fetcher exists — each vendor needs its own endpoint/auth). */
  providerCatalog(): ProviderCatalogEntry[] {
    const out: ProviderCatalogEntry[] = []
    const seen = new Set<string>()
    for (const key of Object.keys(KNOWN_QUOTA)) {
      const k = KNOWN_QUOTA[key as keyof typeof KNOWN_QUOTA]
      seen.add(key)
      out.push({ key, label: k.label, detail: k.detail, supported: true })
    }
    for (const p of this.getLlmProviders()) {
      const key = LLM_ID_TO_KEY[p.id] ?? p.id
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, label: p.id, detail: 'Quota not supported yet', supported: false })
    }
    return out
  }

  /** Last-good rows per provider id (stale-while-revalidate store). */
  private lastGood: Record<string, ProviderRow> = {}
  /** Earliest timestamp for the next live fetch per throttled provider. */
  private nextLiveAt: Record<string, number> = {}
  /** Aggregate single-flight: concurrent refresh() calls share one run. */
  private refreshInflight: Promise<{ refreshedAt: number; providers: ProviderRow[]; providerCatalog: ProviderCatalogEntry[] }> | undefined
  /** Last served aggregate; GET /status reads this without fetching. */
  private cached: { refreshedAt: number; providers: ProviderRow[] } | undefined

  /**
   * Aggregate refresh. Concurrent callers share one in-flight run
   * (single-flight). Live usage fetches for claude/codex are throttled to
   * >=15min + jitter unless `force` (explicit Refresh button).
   */
  async refresh(opts?: { force?: boolean }): Promise<{ refreshedAt: number; providers: ProviderRow[]; providerCatalog: ProviderCatalogEntry[] }> {
    if (!this.refreshInflight) {
      const force = opts?.force === true
      this.refreshInflight = this.doRefresh(force).finally(() => { this.refreshInflight = undefined })
    }
    return this.refreshInflight
  }

  /** Last served aggregate for GET /status (pure cache serve, never fetches). */
  cachedSnapshot(): { refreshedAt: number; providers: ProviderRow[] } | undefined {
    return this.cached
  }

  /** Strip host-internal failure flags before sending rows to clients. */
  private static wireRow(row: ProviderRow): ProviderRow {
    const { transient: _drop, ...rest } = row
    void _drop
    return rest
  }

  /**
   * One throttled fetch for a single provider: serve last-good when the live
   * throttle hasn't lapsed, else fetch live and fold through stale fallback.
   */
  private async refreshProvider(
    id: 'claude' | 'codex' | 'opencode-go',
    label: string,
    enabled: boolean,
    force: boolean,
    now: number,
    live: () => Promise<ProviderRow>,
    throttle: boolean,
  ): Promise<ProviderRow> {
    if (!enabled) return { id, label, status: 'disabled', items: [] }
    const lastGood = this.lastGood[id]
    const due = force || !throttle || isLiveDue(this.nextLiveAt[id], now) || lastGood === undefined
    if (!due && lastGood !== undefined) return lastGood
    const fresh = await live()
    if (throttle) this.nextLiveAt[id] = now + nextLiveDelayMs()
    const decided = applyStaleFallback(lastGood as SwrRow | undefined, fresh as SwrRow)
    if (decided.cache !== undefined) this.lastGood[id] = decided.cache as ProviderRow
    else delete this.lastGood[id]
    return decided.row as ProviderRow
  }

  private async doRefresh(force: boolean): Promise<{ refreshedAt: number; providers: ProviderRow[]; providerCatalog: ProviderCatalogEntry[] }> {
    const cfg = this.cfg()
    const creds = this.getCredentials()
    const now = Date.now()
    const off = (id: ProviderId, label: string): ProviderRow => ({ id, label, status: 'disabled', items: [] })
    if (!cfg.enabled) {
      const providers = [
        off('claude', 'Claude'),
        off('codex', 'Codex'),
        off('opencode-go', 'OpenCode Go'),
        off('commandcode', 'CommandCode'),
      ]
      this.cached = { refreshedAt: now, providers }
      return {
        refreshedAt: now,
        providers,
        providerCatalog: this.providerCatalog(),
      }
    }
    // All four providers fetch in parallel — wall time is the slowest
    // provider, not the sum (previously sequential awaits).
    const [claude, codex, opencodeGo, commandcode] = await Promise.all([
      this.refreshProvider('claude', 'Claude', cfg.providers.claude, force, now, async () => {
        const t = await claudeToken(creds)
        return t ? fetchClaude(t) : { id: 'claude', label: 'Claude', status: 'error', message: 'no token — login via Subscriptions settings', items: [] }
      }, true),
      this.refreshProvider('codex', 'Codex', cfg.providers.codex, force, now, async () => {
        const t = await codexToken(creds)
        return t ? fetchCodex(t.token, t.accountId) : { id: 'codex', label: 'Codex', status: 'error', message: 'no token — login via Subscriptions settings', items: [] }
      }, true),
      this.refreshProvider('opencode-go', 'OpenCode Go', cfg.providers.opencodeGo, force, now, async () => {
        const env = this.llmProvider('opencode-go')?.apiKeyEnv || 'OPENCODE_GO_API_KEY'
        const t = await opencodeGoToken(creds, env)
        return t ? fetchOpencodeGo(t) : { id: 'opencode-go', label: 'OpenCode Go', status: 'error', message: 'no token — login via Subscriptions settings', items: [] }
      }, false),
      (async (): Promise<ProviderRow> => {
        if (!cfg.providers.commandcode) return off('commandcode', 'CommandCode')
        return this.commandcodeRow(cfg, creds)
      })(),
    ])
    const providers = [claude, codex, opencodeGo, commandcode].map(OverlayController.wireRow)
    this.cached = { refreshedAt: now, providers }
    return { refreshedAt: now, providers, providerCatalog: this.providerCatalog() }
  }

  private async commandcodeRow(cfg: Config, creds: any): Promise<ProviderRow> {
    const llm = this.llmProvider('command-code')
    const keyEnv = llm?.apiKeyEnv || 'COMMAND_CODE_API_KEY'
    const key = await resolveSecret(creds, [keyEnv, 'COMMAND_CODE_API_KEY'], [keyEnv, 'COMMAND_CODE_API_KEY'])
    const mtd = monthToDate(cfg.burn ?? {})
    const budget = cfg.commandcodeMonthlyBudget ?? 0
    const next = new Date(); next.setMonth(next.getMonth() + 1, 1); next.setHours(0, 0, 0, 0)
    const burn = { monthToDate: mtd, budget, percent: budget > 0 ? (mtd / budget) * 100 : null as number | null, resetAt: next.toISOString() }
    if (!key) {
      return { id: 'commandcode', label: 'CommandCode', status: 'error', message: 'no API key — add via DSH credentials', items: [], burn }
    }
    const row = await fetchCommandcode(key.value)
    return { ...row, burn }
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
  overlay?: { mode?: 'pill' | 'ring'; hotkey?: string; display?: 'dock' | 'floater' }
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
    if (ov.display !== undefined) {
      if (ov.display !== 'dock' && ov.display !== 'floater') return { ok: false, error: 'overlay.display must be dock|floater' }
      sub.display = ov.display as 'dock' | 'floater'
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
    if (method === 'GET' && path === '/status') return send(res, 200, { ...ctrl.status(), ...resolveStatusSnapshot(ctrl.cachedSnapshot()) })
    if (method === 'GET' && path === '/meta') return send(res, 200, { ...ctrl.status(), providerCatalog: ctrl.providerCatalog() })
    if (method === 'POST') {
      if (req.headers[CSRF_HEADER] === undefined) return send(res, 403, { error: 'missing required custom header' })
      if (path === '/refresh') return send(res, 200, await ctrl.refresh({ force: true }))
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
  // Hard-coded fallback provider definitions — used when settingsSvc hasn't injected yet
  // (first cold refresh). These match the well-known entries in ~/.dsh/settings.yaml.
  const FALLBACK_PROVIDERS: Array<{ id: string; apiKeyEnv: string; baseURL?: string }> = [
    { id: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
    { id: 'command-code', apiKeyEnv: 'COMMAND_CODE_API_KEY', baseURL: 'https://api.commandcode.ai/provider/v1' },
  ]

  const ctrl = new OverlayController(
    ctx,
    () => scope,
    () => (ctx as any).get('credentials'),
    () => {
      const providers = settingsSvc?.describe?.()?.find((x: any) => x.ns === 'llm-pi-ai')?.value?.providers
      if (!providers || typeof providers !== 'object') return FALLBACK_PROVIDERS
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
  // Warm the cache at boot so the first GET /status (pure cache serve) has
  // data; later refreshes ride the background cadence above.
  void ctrl.refresh().catch(() => undefined)
}
