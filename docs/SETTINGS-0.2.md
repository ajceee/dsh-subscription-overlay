# DSH 0.2 settings seam (replacing `ctx.settings.register`)

Scope: what the 0.2 host (dsh-web-app 0.2.0-rc.2) offers in place of the pre-0.1.7
`ctx.settings.register(ns, schema, {base})` scope, and how
`@dsh-external/dsh-subscription-overlay` should port. Verified against the host
packages `@deepseek-ai/dsh-settings`, `dsh-config-editor`, `cordis-plugin-loader`,
`dsh-llm-pi-ai` (extracted from `app.asar`) and the reference port `dsh-mnemon 0.5.24`
(`lib/index.js:10197-10431` `ProfileMnemonSettings`, `lib/client.js:12201-12260`).

## 1. Why it crashes

`sctx.settings.register is not a function` (`src/index.ts:975`). On 0.2 the `settings`
service (`SettingsForms`, `dsh-settings/lib/index.js:322-542`) has **no `register`**.
Namespaces are no longer registered; a plugin's settings are *derived from its `Config`
schema*, and the namespace (`ns`) is simply the plugin's **entry id in the profile**
(`entry.options.id`; for us `dsh-subscription-overlay`, which already equals `NS`).
`dshmarket/lib/settings.js:97-108` (`canRegister`) is the minimal degrade pattern:
`if (typeof service.register === 'function') return true;` else warn once and keep the
composed config.

## 2. `ctx.settings` API (0.2)

| member | meaning |
|---|---|
| `configure({auto?: boolean}, owner = ctx.fiber)` -> disposer | Declare the plugin's presentation. `auto:false` = plugin ships its own page (no auto-generated form). Throws if the fiber is already configured; call inside `ctx.effect` and return the disposer. |
| `writable` (getter) | Host-side capability flag (always true on this build). Mnemon additionally requires `owner.entry !== undefined && configEditor.entries().includes(owner.entry)`. |
| `documentPath` | Path of the profile patch (`cordis.patch.yml`). |
| `describe({redactSecrets?})` -> `Descriptor[]` | `{autoGenerate, ns, schema, revision, applies:"live", value, base, user, [secrets]}` for every entry whose fiber is **active** (state 2) and whose schema has **at least one `.volatile()` field**. `value` = effective (projected) config, `base` = inherited layers, `user` = raw profile override. `revision` bumps when fiber uid, schema or entry config change. |
| `mutate(ns, ops, expectedRevision)` | `ops: [{op:'set'|'unset', path:string[], value?}]`. Throws `SettingsConflictError` (`error.code === "SETTINGS_CONFLICT"`) on a stale revision; `Config field "x" is not volatile` for non-volatile paths; `No configurable plugin entry "ns"`; `Plugin entry "ns" has no volatile fields`. Values must be JSON-shaped (no `undefined`, Dates, class instances). |
| `update(ns, patch, expectedRevision)` / `replace(ns, section, rev)` | Merge / replace helpers over the same write path. |
| `prepareDocument()` | Ensures the patch document exists. |
| event `settings/document-updated (ns, revision)` | Emitted after a write lands. |

Writes go through `configEditor.edit`. Remote reads use `redactSecrets` so fields marked
`role('secret')` never leave the host.

### `configEditor` service (`dsh-config-editor/lib/index.js:16-136`, inject `["loader","profileContext"]`)

- `documentPath`; `entries()` = loader entries owned by the profile root Include with a
  unique `options.id`; `configuration()` -> `[{entry, inherited, override}]`.
- `edit(entry, change(current, inherited))`: runs `change`, validates through the
  `internal/config` waterfall + `resolveConfig(fiber.runtime, ...)`, writes atomically
  into the profile patch row `{id, name, config}` (row removed when equal to the
  inherited value, YAML comments/`!!js` preserved), then `reconcileProfilePatches`
  into the Loader. On failure the previous file and patches are restored. Serialised
  under `hmr.runExclusive`. Throws if the value is overridden by a home patch or CLI
  overlay. Only entries of the profile root Include are editable.

## 3. Config schema -> effective config

1. Bundle layers (`package.json` `dsh.bundle.patch` = our `cordis.patch.yml`) are composed
   by `composeEntries`; the profile `cordis.patch.yml` (top-level YAML array, id-targeted
   `config` overrides, `disabled`, `insert`, `!!js`) is applied after them.
2. Result is `entry.options.config` -> `resolveConfig(runtime.Config, ...)` ->
   `apply(ctx, config)`. Every field that is not in the config takes the schema
   `.default()`.
3. Fields declared `.volatile()` (on the field or an ancestor, `isVolatilePath`) are
   *live*: they arrive in `apply` as Volatile refs, are the only fields exposed by
   `settings.describe/mutate`, and are the only ones the Settings UI can edit. All other
   fields stay hand-edited in `cordis.patch.yml` and need a fiber reload.

## 4. How a live change reaches `apply()`

`cordis-plugin-loader/lib/index.js:394-454` (`Entry.update`):

- Only `config` changed, fiber active, and `equalExceptVolatile(old, new, Config)` ->
  `_commitVolatile()`: resolve candidate; if all *non-volatile* values are unchanged,
  `updateVolatile(ref, source)` on each ref and emit
  **`loader/volatile-update(paths: string[][])`** scoped to that fiber. **No fiber reload;
  `apply()` is not re-run.** Read volatile values lazily (`ref.get()` / the plain
  resolved config) at use-time, and subscribe with
  `ctx.on('loader/volatile-update', paths => ...)` to react (mnemon fans this out to its
  listeners with the resolved value).
- Any non-volatile field changed (or invalid candidate) -> ordinary update: fiber disposed
  and re-applied (`loader/partial-dispose` -> `fiber.update(config)` -> `apply()` again).
- Pre-write validation: `ctx.on('internal/config', (_raw, next) => { const c = next(); validate(c); return c }, {prepend: true})`
  makes a bad value fail in `configEditor.edit` before anything is written.

## 5. Client settings page (slots)

Mnemon (`lib/client.js:12201-12260`):

```ts
ctx.slots.inject('plugins.bundle.config', () =>
  ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME,
                       locale: ns, children: {}, inject: configurationServices }, SettingsPage))
ctx.slots.inject('plugins.row.config', () =>          // optional per-row panel
  ctx.slots.register({ name: 'plugins.row.config', key: `${PACKAGE_NAME}#${rowId}`,
                       locale: ns }, RowPanel))
// open from our own UI:  inner.pluginNavigation.openBundle(PACKAGE_NAME)
// live revision stream:  ctx.inject(['configForms'], inner =>
//   inner.effect(() => followHostSettings(inner.configForms.get(NS), [...scopes]), '...'))
```

`plugins.bundle.config` renders in the plugin bundle's configuration page,
`plugins.row.config` in the row of a specific entry; `plugins.detail.actions` adds actions.
The client talks to the host through the settings API (`describe`/`mutate`, the
`configForms` client service); the host rejects stale `expectedRevision` with
`SETTINGS_CONFLICT` (retry after re-describe; mnemon retries up to 2x if the projected
value is unchanged).

## 6. Reading other plugins' settings (llm-pi-ai providers)

`dsh-llm-pi-ai` Config is `z.object({ providers: z.dict(profile).default({}).volatile() })`
(`lib/index.js:1051`; profile has `apiKeyEnv`, `baseURL`, ...). `providers` is
volatile, so `ctx.settings.describe().find(x => x.ns === 'llm-pi-ai')?.value?.providers`
(`src/index.ts:960`) **keeps working on 0.2**, but only while the llm-pi-ai fiber is
active and its entry id is `llm-pi-ai`; `describe()` is synchronous and may be empty
during boot. Keep `FALLBACK_PROVIDERS` (`src/index.ts:950`) and optionally
`describe({redactSecrets: true})` since only `apiKeyEnv`/`baseURL` are used.

## 7. Port plan for the overlay

1. `export const inject = ['settings']` stays; also optionally `configEditor` (via
   `ctx.get('configEditor')`) for the `writable` check as mnemon does.
2. Mark every user-editable field `.volatile()` in `Config` (`src/index.ts:36`):
   `enabled`, `alertPct`, `providers.*`, `commandcodeMonthlyBudget`, `overlay.*`, `burn`
   (and `pollMinutes` only if the timer is re-read each tick; otherwise leave it
   non-volatile so a change reloads the fiber). Mixed edits (volatile + ordinary) fall
   back to a reload, which is acceptable.
3. Replace the `register` scope with a small facade over `ctx.settings`:
   `get()` -> `describe().find(x => x.ns === NS)?.value ?? config` (cached by revision);
   `update(patch)` -> `mutate(NS, ops, revision)` with `set` ops per leaf path, retry on
   `SETTINGS_CONFLICT`; for `burn` use one `set` of `['burn', model]` (JSON-shaped
   arrays). Back it with the apply() `config` object as fallback when `describe()`
   returns nothing (not yet active / entry not in root include).
4. Replace the `pollMinutes` and routes wiring with `ctx.on('loader/volatile-update')`
   (or lazy reads) rather than relying on `apply()` re-running.
5. Re-enable in the profile: remove `disabled: true` from the
   `- id: dsh-subscription-overlay` row in the profile `cordis.patch.yml`.
6. Degrade: `typeof ctx.settings?.mutate !== 'function'` -> read-only, keep composed config
   (same spirit as dshmarket `canRegister`), warn once.

### Server snippet

```ts
export function apply(ctx: Context, config: Config): void {
  let rev = -1
  const find = () => (ctx as any).settings?.describe?.().find((d: any) => d.ns === NS)
  const scope = {
    get: (): Config => find()?.value ?? config,
    async update(patch: Partial<Config>, tries = 3): Promise<void> {
      const s = (ctx as any).settings
      for (let i = 0; i < tries; i++) {
        const d = find(); if (!d) throw new Error('settings unavailable')
        const ops = Object.entries(patch).map(([k, v]) => ({ op: 'set', path: [k], value: v }))
        try { await s.mutate(NS, ops, d.revision); return } catch (e: any) {
          if (e?.code !== 'SETTINGS_CONFLICT' || i === tries - 1) throw e
        }
      }
    },
  }
  ctx.effect(() => {
    const dispose = (ctx as any).settings?.configure?.({ auto: false })   // own page, no auto form
    return () => dispose?.()
  })
  ctx.on('internal/config', (_raw: unknown, next: () => unknown) => next(), { prepend: true }) // add validation here
  ctx.on('loader/volatile-update', () => { /* re-read scope.get() lazily */ })
  // pass `scope` into OverlayController instead of the register() result
}
```

### Client snippet (`src/client`)

```ts
ctx.slots.inject('plugins.bundle.config', () =>
  ctx.slots.register({ name: 'plugins.bundle.config', key: '@dsh-external/dsh-subscription-overlay',
                       locale: 'dsh-subscription-overlay' }, OverlaySettingsPage))
```

The page may keep using the overlay's own HTTP routes (`POST /settings`, which call
`updateSettings` -> `scope.update`) or the `configForms` client service; the host-side
facade above is what must change.

## 8. Caveats / open points

- `describe()` returns nothing until the fiber is active and the entry belongs to the
  profile root Include; always keep a `config` fallback.
- `settings.mutate` only accepts volatile paths; a non-volatile field in the patch throws.
- Revisions are integers per entry; always pass the latest `describe().revision`.
- Verified by reading the shipped host code only; nothing was run against a live host.
