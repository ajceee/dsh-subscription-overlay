# Dock-slot spike + hide-selector verification

Status: verified 2026-09-18 against clean checkout `dsh-subscription-overlay@0.1.0`
(DSH `0.1.5-rc.2`, web profile) plus upstream reference
`dsh-plugin-subscriptions` (installed profile copy, `lib/client.js` bundled,
`lib/client/SubscriptionUsageBadge.js/.d.ts`, `lib/providers/claude.js`,
`lib/providers/codex.js`).

## 1. Dock inject-face + order semantics — CONFIRMED, use order 11

Upstream registration (`lib/client.js`, both bundle copies identical):

```js
ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
  name: "conversation.composer.dock",
  id: "subscription-usage",
  order: 10,
  locale: NS,
  inject: (sessionId) => ({
    rpc: connection.rpc,
    currentModel: createCurrentModelReader(models, sessionId),
  }),
}, SubscriptionUsageBadge));
```

- Slot name is **`conversation.composer.dock`** (not `composer.dock`, not
  `shell.overlay`). `shell.overlay` is our current floater layer
  (`src/client/index.ts:116`, id `dsh-subscription-overlay`, composites with
  `dsh-quota`) — the dock is a separate, per-session, ordered slot.
- `inject` is **session-bound**: `(sessionId) => face`. Our dock entry must use
  the same shape: `inject: (sessionId) => controller.inject(sessionId?)`.
  `currentModel` resolves via `modelDirectories` (`directoryFor(sessionId)`),
  lazily per call — the service may register after us.
- `order` is ascending; upstream pill is **10**. No other `composer.dock`
  registration exists in the web profile (`dsh-pocket` only *reads* the slot:
  `[data-phase] [data-slot="conversation.composer.dock"]`, stats row
  `[data-composer-stats]`).
- **Confirm order `11`**: sits immediately after the upstream
  `subscription-usage` pill (~ cache/time-token pill row), so the two pills
  read as siblings on the host stats line. The badge portals itself into
  `[data-composer-stats]` when present (`SubscriptionUsageBadge.js`:
  `statsRow !== null && statsRow.isConnected ? createPortal(pill, statsRow) :
  pill`); our dock pill should copy that portal pattern so order 11 lands
  visually adjacent even when the stats row mounts late (row mounts only once
  the session has steps/tokens; watched via MutationObserver).
- Face to inject (mirror upstream + our snapshot):
  `{ rpc?: ConnectionHandle['rpc'] (only if we reuse `subscriptions-auth`
  endpoints — we don't, see §5), quota: OverlayStore snapshot selector,
  toggle/refresh, t?: locale }`. Keep the component tolerant of a missing
  face (upstream renders `seat` alone when `displays.length === 0`; we render
  our pill from our own `/api/status`).

Upstream badge facts reused by t2 (all verified in source):
- `SubscriptionUsageBadge.js/.d.ts`: pill (`Codex 6d1h 25%` style via
  `compactSegment`) + trigger-anchored dialog (all providers/accounts,
  `WINDOW_PREVIEW_LIMIT = 4`, current provider first via
  `expandedDisplays`, default account starred first).
- Tokens: **all `--dsw-*`** (`--dsw-alias-label-tertiary/secondary/primary`,
  `--dsw-alias-interactive-bg-hover`, `--dsw-specific-menu`,
  `--dsw-elevation-prominent`, `--dsw-alias-border-l2`,
  `--dsw-alias-bg-layer-1`); no hardcoded colors except via
  `usageBarColor`.
- `usageBarColor(pct)`: **success normally, warn from 80%
  (`--dsw-alias-state-warn-label`), error from 95%
  (`--dsw-alias-state-error-primary`)** — shared by badge + dialog bars.
- `windowLabel(w)`: `"6d18h" / "1h58m" / "42m"` from `resetsAt`, fallback
  scope/kind (`5h` session, `Wk` weekly, `W` other).
- Poll: **`USAGE_POLL_INTERVAL_MS = 15 * 60_000`** (usage `status`+`usage`
  RPCs, server cache shared across surfaces, last-known-good kept across
  429s), `MODEL_POLL_INTERVAL_MS = 3000` (current-model re-read; host pushes
  nothing on model switch).
- Providers: `fetchClaudeUsage` (`GET` Claude usage URL, `Bearer` +
  `anthropic-beta: oauth-2025-04-20`); `fetchCodexUsage` (`GET` wham/usage,
  `Bearer` + `chatgpt-account-id` + `originator`); `codexUsageWindow`
  maps `used_percent` + `reset_at`(s)→ms / `reset_after_seconds`, kind by
  `limit_window_seconds` (session/weekly/other) with positional fallback.
  Our host already mirrors these shapes fresh (§5).

## 2. Hiding the upstream `subscription-usage` pill (llm-subscriptions ENABLED)

Live-DOM inspection was **not reachable** from this checkout (no running DSH
web GUI attached); selector below is derived from the badge source, which is
deterministic. Verify once against the live DOM during t2.

Why CSS-only is fragile here: the pill is a `<button>` with **inline styles
only, no class**, and when the host stats row exists it is **portaled out**
of the dock outlet into `[data-composer-stats]` (`createPortal(pill,
statsRow)`); the dock outlet keeps just the invisible seat
(`styles.seat = { display: 'none' }`). So an outlet-scoped selector cannot
reliably reach the portaled pill.

Recommended approach (code, not CSS — t2 implements this):
- Gate at the source: when our `display-mode = dock`, **do not register**
  (or short-circuit) the upstream pill by shipping a tiny host/client guard
  in our plugin: skip our *floater* registration and register the dock pill;
  hide upstream via the subscriptions plugin's own enable flag **per-surface**
  if available, else:
- Exact CSS selector (_targets the portaled pill wherever it lands_):

```css
/* Primary: the pill button carries an aria-label/title from usageBadgeTitle;
   match the dialog trigger semantics, not translated text. */
[data-composer-stats] > span > button[aria-haspopup="dialog"][aria-label] {
  display: none !important;
}
```

- Fallback (covers in-place row when the stats row is absent, and older
  hosts without `[data-composer-stats]`):

```css
/* Fallback: any dock-outlet descendant dialog-trigger pill that is NOT ours.
   Our pill must carry data-dso-dock="1" so this never matches itself. */
[data-slot="conversation.composer.dock"] button[aria-haspopup="dialog"]:not([data-dso-dock]) {
  display: none !important;
}
```

- Scoping rule: apply the stylesheet **only while our dock pill is active**
  (same `visible && display-mode === 'dock'` gate as the registration), so
  disabling our plugin restores the upstream pill with no leftover hiding.
- Live-DOM check for t2 (5 min): open composer, confirm pill node path
  (`seat` span in dock outlet vs portaled button under
  `[data-composer-stats]`), confirm the `:not([data-dso-dock])` exclusion
  keeps our pill visible, confirm dialog (`role="dialog"`) no longer opens.

## 3. Dock-vs-floater decision

**Recommend: dock path primary + floater kept behind a `display-mode`
setting defaulting to `dock`.** Not a full replace (yet).

- Dock wins on placement (sits with the time/token pills users already read),
  zero drag/position state, no viewport-clamp/edge-hug code, and it follows
  the composer across layouts. Cost: one slot registration (~30 lines) plus
  the §2 hide rule.
- Keep the floater (`shell.overlay` pill/ring + `settings.section order 56`,
  current `src/client/index.ts`) as the `display-mode: 'floater'` fallback
  for users who prefer the HUD and for hosts without the dock slot. The
  snapshot store, `/api/*` surface, and settings section are shared — only
  the mount point differs.
- Migration: add `display: 'dock' | 'floater'` (default `'dock'`) to
  `overlay` config + settings section toggle; `visible=false` (or plugin
  disabled) unmounts both. Revisit full replace after one release of
  dock-default telemetry (no new infra — settings value read is enough).

## 4. Dock pill provider set

**Recommend: all enabled providers, including `opencode-go` +
`commandcode`** — i.e. the same 4 rows `/api/status` already returns
(`claude`, `codex`, `opencode-go`, `commandcode`), collapsed text =
`collapsedDisplays` semantics (current model's provider when known, else all).

- Rationale: the dock pill replaces the upstream pill's job (at-a-glance
  quota); showing only claude/codex would silently drop the two providers
  this overlay exists for. `commandcode` renders its real items (5h/weekly +
  balance/plan/spend per current panel) — never a fake % (budget 0 → no %,
  existing panel rule stands).
- Collapsed format: `compactSegment`-style (`<Name> <win> <pct>`, max 2
  windows + `+n`), `usageBarColor` thresholds (warn-80/err-95), `windowLabel`
  countdowns — copy upstream helpers so the pills read as siblings.
- Respect per-provider toggles: a disabled provider contributes no segment;
  all-disabled → pill shows the idle dot/disabled state, never an empty
  button (upstream returns `seat` alone when `displays` is empty — mirror
  that: render nothing clickable when there is nothing to show).

## 5. Host changes — minimal, reuse `/api/status`

**Expect minimal host diff; no new endpoints, no new auth UX.**

- Reuse `GET /plugins/dsh-subscription-overlay/api/status` as-is
  (`src/index.ts`: `{ refreshedAt, providers[4], alertPct, overlay prefs }`
  + `providerCatalog` via `/meta`). The dock pill polls it on the existing
  cadence (`pollMinutes`, default 5; upstream badge uses 15 — ours stays
  owner-controlled).
- Additive-only host diff: `overlay.display: 'dock' | 'floater'` (default
  `'dock'`) in `Config` (`src/index.ts`), `publicSettings` echo, and
  `validateSettingsPatch` accept. No credential, route, or ledger changes;
  API keys never enter settings (existing `resolveSecret` + env/yaml
  fallback pattern stands).
- Client diff: one `conversation.composer.dock` registration
  (`id: 'dsh-subscription-overlay-dock'`, `order: 11`,
  `inject: (sessionId) => face`), `data-dso-dock="1"` attr on our pill,
  §2 hide stylesheet gated on `display === 'dock'`, settings-section
  display-mode toggle. `package.json` `dsh.client.inject` already lists
  `dsh-client-runtime`, `dsh-client-ui-slots`, `dsh-client-store` —
  sufficient for the dock slot (same outlet system as `shell.overlay`).
- `cordis.patch.yml` unchanged (loader row only).

## 6. t2 plan verdict: PASS

t2 (dock badge replacing subscriptions pill) may proceed per §§1–5:
order-11 dock registration with session-bound face, portaled-pill hide
selector + `:not([data-dso-dock])` fallback, dock-default display-mode with
floater fallback, 4-provider pill reusing `/api/status`, additive host
config only. Non-blocking: confirm §2 selectors against the live DOM during
t2 implementation.

---
SENTINEL-SPIKE-DONE
