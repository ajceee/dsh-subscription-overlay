# dsh-subscription-overlay — DSH/wezterm API spike

Status: verified 2026-09-17 against the installed DSH build
(`dsh-quota@0.14.1`, `dsh-plugin-subscriptions@0.9.2`,
`@dsh-external/dsh-task-router` 0.1.0, `@deepseek-ai/dsh` 0.1.5-rc.1)
and the live wezterm quota stack
(`agent-quota.wezterm` + `codex-limits-direct.py` + `%TEMP%/wezterm-quota-limit-*.json`).

## Decision summary

- **Overlay slot is `shell.overlay`, one registration per plugin id.** The
  precedent (`dsh-quota/lib/client.js`) mounts with
  `ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name:
  "shell.overlay", id: "dsh-quota", … }, QuotaPanel))`. Our plugin registers
  the same slot name with its **own id** (`dsh-subscription-overlay`); the
  overlay layer composites multiple registrations, so the existing quota pill
  keeps working. Toggle = conditional render + settings flag, not unregister.
- **Do fresh fetches for claude/codex/opencode-go; do not couple to
  `dsh-quota` or `dsh-plugin-subscriptions` internals.** The subscriptions
  `usage` RPC (`rpc.call('/api','subscriptions-auth.usage',…)`) is a
  browser→host channel whose controller is not exported as a host service,
  and `dsh-quota`'s settings rows are billing shapes, not subscription
  windows. Reuse only the **credential refs, endpoints, and header shapes**
  both stacks already proved.
- **commandcode has no quota endpoint; `/models` proves this.**
  `dsh-quota`'s controller already probes unknown `llm-pi-ai` providers with
  `GET {baseURL}/models` and renders `probe#<id>` rows as online/offline only
  ("该平台无 API-key 额度接口，仅探测服务可用性"). Copy that pattern, add a
  **local burn ledger** (per-model token history in our settings namespace,
  percent-of-budget computed locally), and **never render a fake percentage**.
- **Install path is the official profile bundle** (`dsh plugin --profile web
  add` + `dsh.bundle.patch` + one restart), exactly per
  `dsh-task-router/docs/SPIKE.md` §5. No manual patch edits, no
  super-injector.
- **Build-plan verdict: PASS** with two non-blocking amendments noted in §6.

## 1. Exact overlay/client slot for the toggleable pill + panel

From `dsh-quota/lib/client.js` (`src/client/index.ts`):

```ts
export const inject = ["slots"];

export function apply(ctx) {
  // …
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "dsh-quota",                       // ← unique per plugin
    inject: () => controller.inject(),     // hooks + toggle/close/refresh
  }, QuotaPanel));
}
```

Our client (`src/client/index.ts`):

```ts
export const inject = ["slots"];
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime";

export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(), "dsh-subscription-overlay: styles");
  const controller = new OverlayController(); // fetch /plugins/dsh-subscription-overlay/api
  ctx.effect(() => {
    const t = setInterval(() => controller.pollIfVisible(), 60_000);
    return () => clearInterval(t);
  }, "dsh-subscription-overlay: poll");
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "dsh-subscription-overlay",        // ← OUR id; composites with dsh-quota
    inject: () => controller.inject(),     // { hooks, toggle, close, refresh, … }
  }, SubscriptionPanel));
}
```

Toggle design (copy `dsh-quota`'s proven pieces):

- `localStorage`: `dsh-subscription-overlay:visible` (`"1"`/`"0"`),
  `dsh-subscription-overlay:mode` (`pill`|`ring`),
  `dsh-subscription-overlay:pos` (`{x,y,w,h}` JSON, clamped to viewport).
- Hotkey: `Ctrl+Shift+S` (quota uses `Ctrl+Shift+U` dashboard /
  `Ctrl+Shift+Y` cycle — no clash) toggling `visible`; the settings section
  (§4) exposes the same switch, which writes the settings namespace and the
  client mirrors it into `localStorage`.
- Hidden = render `null` (or skip registration effect). Either unmounts the
  pill/ring **and** the panel; polling short-circuits when hidden
  (`pollIfVisible` checks `visible && document.visibilityState`).
- Panel open state lives in the snapshot store (`open: boolean`); clicking
  the pill calls `toggle()` and triggers `refreshIfStale()` (>5 min).

CSS scope: prefix everything `.dso-` (quota uses `.dq-`), one `<style>`
tag with `data-plugin-css="dsh-subscription-overlay/panel"`, removed on
unload. Consume shell alias tokens (`--dsw-alias-*`) with local fallbacks.

## 2. Host APIs: reuse for claude/codex/opencode-go, fresh fetch, probe

### 2.1 What to reuse (no new auth UX)

| Provider | Endpoint (proven by wezterm stack) | Credential (resolve in this order) |
|---|---|---|
| claude | `GET https://api.anthropic.com/api/oauth/usage` | DSH credentials `CLAUDE_*` refs → `~/.dsh/plugins/subscriptions/auth.json` claude session → `~/.claude/.credentials.json` `claudeAiOauth.accessToken` (`CLAUDE_CONFIG_DIR` override honoured) |
| codex | `GET https://chatgpt.com/backend-api/wham/usage` | DSH credentials `OPENAI_*` refs → `~/.dsh/plugins/subscriptions/auth.json` codex session → `~/.codex/auth.json` `tokens.access_token` (exactly what `codex-limits-direct.py` does) |
| opencode-go | `GET https://opencode.ai/zen/go/v1/usage` | DSH credentials `OPENCODE_GO_API_KEY` (the `llm-pi-ai.providers.opencode-go.apiKeyEnv` value — read it live from settings, don't hardcode) → env → `~/.local/share/opencode/auth.json` `["opencode-go"].key` (+ `%USERPROFILE%\.config\opencode\auth.json` on Windows) |

Request shapes (copy verbatim from the wezterm precedent):

```ts
// claude — mirrors agent-quota call_usage_api()
fetch("https://api.anthropic.com/api/oauth/usage", { headers: {
  "Authorization": `Bearer ${token}`,
  "anthropic-beta": "oauth-2025-04-20",
  "Content-Type": "application/json",
  "User-Agent": `claude-cli/${version}`,   // unrecognized clients are rate-limited
}, signal: AbortSignal.timeout(20_000) });

// codex — mirrors codex-limits-direct.py
fetch("https://chatgpt.com/backend-api/wham/usage", { headers: {
  "Authorization": `Bearer ${accessToken}`,
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0",
}, signal: AbortSignal.timeout(15_000) });

// opencode-go — mirrors agent-quota fetch_opencode_limits()
fetch("https://opencode.ai/zen/go/v1/usage", { headers: {
  "Authorization": `Bearer ${token}`,
  "Content-Type": "application/json",
}, signal: AbortSignal.timeout(20_000) });
```

Response shapes (live `%TEMP%/wezterm-quota-limit-*.json`, 2026-09-17):

```jsonc
// claude: { five_hour:{utilization,resets_at}, seven_day:{…}, limits:[{kind,percent,resets_at,severity}], spend:{…} }
// codex:  { primary_pct, primary_reset, primary_reset_at, secondary_pct, secondary_reset, secondary_reset_at, primary_mins }
// opencode:{ five_hour:{utilization,resets_at}, seven_day:{…}, monthly:{utilization,resets_at}, _raw:{usage:{…}} }
```

Host normalizes each to `{ id, label, status, items: [{label, percent, resetAt}] }`
— the same row shape `dsh-quota`'s panel renders, so the panel code in §1 can
be adapted with minimal churn.

### 2.2 Why fresh fetch, not reuse of plugin state

- `dsh-plugin-subscriptions` exposes usage only through the browser RPC
  channel `subscriptions-auth.usage` (`/api/subscriptions-auth.usage`;
  returns `ProviderUsage { supported, windows?: UsageWindow[], plan? }`).
  The backing controller is **not** a host service — a sibling host plugin
  cannot call it. Reimplementing the three GETs above (same tokens, same
  headers) is ~60 lines and has zero coupling.
- `dsh-quota`'s `quota` namespace rows are API-key billing shapes
  (`kimi-coding`, `deepseek-balance`, …); only its `opencode-go` catalog
  entry overlaps, and it needs an `OPENCODE_GO_API_KEY` key the subscription
  user may not have. Our fetches use the OAuth/session tokens the user
  already has.
- Error mapping to copy: 401/403 → `auth failed — re-login in Subscriptions
  settings`; 429 → short backoff + keep previous snapshot (quota's
  `CLAUDE_RATE_LIMIT_RETRY_SECS = 60` pattern); `not running`-style string
  errors stay display-only and never gate fetching.

### 2.3 commandcode probe + local burn ledger

Probe (copies `dsh-quota` controller's unmatched-provider probe):

```ts
const base = provider.baseURL.replace(/\/+$/, ""); // https://api.commandcode.ai/provider/v1
const resp = await fetch(`${base}/models`, {
  headers: { Authorization: `Bearer ${key}` },   // COMMAND_CODE_API_KEY via credentials domain
  signal: AbortSignal.timeout(8_000),
});
// ok:true → { label: "模型服务", display: "在线" } + latency ms + model count
// !ok    → status:"error", message:`探测失败 HTTP ${resp.status}` — never a percentage
```

`/models` works; there is **no** official quota/balance endpoint for
commandcode, so percentages would be fabricated. The panel card shows:
probe state (在线/失败 + ms), discovered model list, and the ledger below.

Burn ledger (lives in our settings namespace, §4):

```ts
burn: Record<string, Array<[epochMs: number, tokens: number]>> // key = `commandcode::<model>`
// prune: drop points older than 30d, cap 1000/model
// panel math: monthToDate = Σ tokens since month start
//             percent = monthToDate / commandcodeMonthlyBudget * 100
//             remaining + resetAt (= 1st of next month, local time)
```

Feeding the ledger, in preference order:

1. `ctx.on('llm/stream', …)` wrapper taps `usage` chunks for
   `provider === 'command-code'` (task-router SPIKE §4: listeners must not
   mutate options; observing the yielded chunks is allowed). Map with the
   same disjoint-counts rule subscriptions uses
   (`input_tokens − cached_tokens`, `output_tokens`).
2. If the wrapper proves impractical during t2, fall back to per-`route_task`
   accounting: the tool result carries usage; the overlay host exposes
   `POST /ledger/append { model, tokens }` and whoever dispatches calls it.
   The panel and schema are identical either way — only the writer changes.

## 3. Official install path

Per `dsh-task-router/docs/SPIKE.md` §5 (verified mechanism, same CLI):

```jsonc
// package.json
{
  "name": "@dsh-external/dsh-subscription-overlay",
  "main": "./lib/index.js",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"],
      "platform": "web"
    }
  }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-subscription-overlay
      name: '@dsh-external/dsh-subscription-overlay'
      config: {}
```

```bash
dsh plugin --profile web add C:/Projects/dsh-subscription-overlay
# → link in $DSH_HOME/profiles/web/node_modules/@dsh-external/dsh-subscription-overlay
# → dependency entry in profiles/web/package.json
# → '@dsh-external/dsh-subscription-overlay' appended once to dsh.profile.bundles
# → the bundle patch contributes the loader row
```

Restart rule (same as task-router):

- **Initial add/remove or `dsh.profile.bundles` change → restart the DSH web
  process.** It does not watch dependency/bundle-list changes.
- Own settings edits → live via `installSection onChange`, no restart.
- `profiles/web/cordis.patch.yml` edits → live patch reload (composition
  tweaks only, not a substitute for installing the bundle).
- Rebuilt host/client JS → restart unless a verified dev watcher is running.

Verify: `dsh … dump-config | grep dsh-subscription-overlay` shows the loader
row; the overlay pill appears on next web load.

## 4. Settings namespace schema

Namespace `dsh-subscription-overlay`, `settings.installSection` (same seam as
task-router §3 and quota's `register(QUOTA_NS, Config, …)`):

```ts
export const Config = z.object({
  enabled: z.boolean().default(true),          // master kill-switch; false = client renders null
  pollMinutes: z.number().min(1).max(60).default(5),
  alertPct: z.number().min(1).max(100).default(85), // red dot + danger bars at/above
  providers: z.object({
    claude: z.boolean().default(true),
    codex: z.boolean().default(true),
    opencodeGo: z.boolean().default(true),
    commandcode: z.boolean().default(true),
  }).default({}),
  commandcodeMonthlyBudget: z.number().min(0).default(0), // tokens; 0 = track only, no %
  overlay: z.object({
    mode: z.union([z.const("pill"), z.const("ring")]).default("pill"),
    hotkey: z.string().default("Ctrl+Shift+S"),
  }).default({}),
  burn: z.dict(z.array(z.array(z.number()))).default({}), // ledger from §2.3, host-written
});
```

Rules: API keys **never** live here — credential refs only
(`OPENCODE_GO_API_KEY`, `COMMAND_CODE_API_KEY` resolved through
`ctx.get("credentials")` + env fallback, the `dsh-quota` `resolveKey`
pattern). The client `settings.section` page (order ~56, next to Task
Router's 55) exposes: master toggle, four provider toggles, poll interval,
alert %, monthly budget input, hotkey hint. Host subscribes
`settings/updated` for `llm-pi-ai` (re-read `opencode-go`/`command-code`
`apiKeyEnv`/`baseURL`) and applies own-namespace changes via `onChange`
without restart.

## 5. Host HTTP surface (same-origin, same pattern as `dsh-quota`)

```text
GET  /plugins/dsh-subscription-overlay/api/status   → { refreshedAt, providers[4], alertPct, overlay prefs }
POST /plugins/dsh-subscription-overlay/api/refresh  → force re-fetch (CSRF header x-dsh-subscription-overlay)
POST /plugins/dsh-subscription-overlay/api/probe    → { platform } → { ok, ms, message? } (read-only)
POST /plugins/dsh-subscription-overlay/api/ledger/append → { model, tokens } (fallback writer, §2.3)
```

Host `inject = ["tools"]` (probe/ledger need no tools; keep minimal) plus
optional `["settings"]`, `["webServer"]`, `["connection"]`-free — same
headless-safe shape as quota (`ctx.inject(["webServer"], …)` only serves
routes when a web server exists).

## 6. Build-plan verdict

**PASS.** t2 (host aggregation + ledger + install), t3 (overlay UI +
settings section), t4 (verify + push), t5 (independent review) match the
precedents above and need no restructuring.

Two amendments for the captain (non-blocking):

1. t2: state explicitly that claude/codex/opencode-go are **fresh fetches
   reusing credential refs + endpoints** (§2.1), not calls into
   `dsh-plugin-subscriptions`/`dsh-quota` — those seams are browser-RPC-only
   or wrong-shaped.
2. t3: acceptance must include "commandcode card shows probe + burn only;
   no percentage when `commandcodeMonthlyBudget` is 0" and "hidden toggle
   unmounts pill AND panel".
