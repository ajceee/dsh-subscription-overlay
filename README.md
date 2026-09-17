# dsh-subscription-overlay

Toggleable DSH web-overlay that aggregates subscription quota for **Claude**,
**Codex**, and **opencode-go** (fresh OAuth/session fetches), plus a
**commandcode** availability probe and a local monthly burn ledger.

> Honesty rule: commandcode has no quota endpoint, so the card shows
> probe state (online/offline + latency) and local burn only —
> **never a fabricated percentage**. When no monthly budget is set,
> no percentage bar is rendered at all.

## What it does

- **Overlay floater** (`shell.overlay` slot, own plugin id — composites with
  the stock `dsh-quota` pill): draggable pill **or** ring mode, alert badge,
  click opens the 4-provider panel, staleness-triggered refresh.
- **4-provider panel**: per-window usage bars + reset times for
  claude (5h/7d), codex (primary/secondary), opencode-go (5h/7d/monthly);
  commandcode shows probe + burn only.
- **Toggle**: `Ctrl+Shift+S` hotkey, settings-section switch, and host master
  switch. Hidden unmounts pill/ring **and** panel and stops polling.
- **Settings section** (order 56, next to Task Router): master toggle, four
  provider toggles, poll interval (1–60 min), alert threshold (1–100%),
  commandcode monthly budget in tokens (`0` = track only, no %).
- **Same-origin HTTP API** (all POSTs require the `x-dsh-subscription-overlay`
  CSRF header):
  - `GET  /plugins/dsh-subscription-overlay/api/status` → `{ refreshedAt, providers[4], alertPct, overlay, enabled, settings }`
  - `POST /plugins/dsh-subscription-overlay/api/refresh` → force re-fetch
  - `POST /plugins/dsh-subscription-overlay/api/probe` → commandcode re-probe
  - `POST /plugins/dsh-subscription-overlay/api/settings` → validated patch
  - `POST /plugins/dsh-subscription-overlay/api/ledger/append` → `{ model, tokens }` fallback burn writer

## Install

Prerequisites: DSH `0.1.5-rc.1` or later, Node 20+.

```bash
dsh plugin --profile web add C:/Projects/dsh-subscription-overlay
# restart the DSH web process once (bundle-list changes need a restart)
dsh --profile web --dump-config | grep dsh-subscription-overlay  # loader row check
```

On the next web load the 订阅额度 pill appears (bottom-right, draggable).
Press `Ctrl+Shift+S` to hide/show it.

## Usage

- Click the pill to open the panel; the refresh button forces a re-fetch.
- Settings → 订阅额度浮层: toggle providers, cadence, alert %, monthly budget.
- commandcode card: 探测 button re-probes `GET {baseURL}/models`;
  本月消耗 shows month-to-date tokens and (only when budget > 0) % of budget.
- API keys never live in settings — credentials resolve via the DSH
  credentials domain with env/session-file fallbacks (see `docs/SPIKE.md` §2.1).

## Screenshots

The overlay pill/panel render inside the running DSH web GUI after the
bundle loads (restart required after install). Screenshots will be added
here from a live session:
`docs/screenshots/pill.png`, `docs/screenshots/panel.png`,
`docs/screenshots/settings.png`.

## Development

```bash
npm install
npm run typecheck            # host
npm run typecheck:client     # browser client
npm run build                # tsdown → lib/index.js + lib/client.js
node --test tests/*.test.ts  # 8 tests
```

## Layout

- `src/index.ts` — host: fresh-fetch aggregation, commandcode probe, burn
  ledger, settings validation, HTTP routes.
- `src/client/` — browser: `SubscriptionPanel`, `OverlaySettingsSection`,
  `controller` (snapshot store + API bridge), `locale` (zh/en), `styles`.
- `docs/SPIKE.md` — DSH/wezterm API spike (precedents + verdict).
- `cordis.patch.yml` + `package.json#dsh` — official profile-bundle install.

## License

MIT — see [LICENSE](LICENSE).
