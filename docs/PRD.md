# PRD — dsh-subscription-overlay v0.2.0 (DSH 0.2 port)

Version: 0.2.0 · Host: `dsh-web-app 0.2.0-rc.2`.

## 1. Problem

`apply()` calls `sctx.settings.register(NS, Config, { base: config })`
(`src/index.ts:975`), which does not exist on the 0.2 host. The plugin throws
during load, so no overlay, no settings, no providers.

## 2. Solution

Port the settings layer to the 0.2 model, following `dsh-mnemon` 0.5.24
(`ProfileMnemonSettings`):

1. Keep the exported `Config` schemastery schema as the single source of
   truth; remove the `settings.register()` call path on 0.2.
2. Read runtime config from the 0.2 settings service
   (`ctx.settings.configure/describe/mutate/writable` or the injected
   `config` object) with a 0.1 fallback only if cheap.
3. Expose the settings through the host Settings › Plugins page
   (`configEditor` service / `plugins.bundle.config` client slot) so every
   field in R2 is visible and editable.
4. Subscribe to live config updates so edits apply without restart where the
   host supports it (R3).
5. Move the `burn` ledger out of the `Config` schema into a sidecar
   persistence file/namespace (R4) so usage history never pollutes settings.
6. Keep the `llm-pi-ai` `/models` discovery probe working on 0.2 (R5).

## 3. Functional requirements

- R1: plugin loads on DSH 0.2 without throwing.
- R2: settings `enabled`, `pollMinutes`, `alertPct`, `providers.*`,
  `commandcodeMonthlyBudget`, `overlay.{mode,hotkey,display}` visible +
  editable in Settings › Plugins and persisted.
- R3: live config change applies without restart where host supports it.
- R4: burn ledger persists outside the settings schema.
- R5: `llm-pi-ai` provider discovery works on 0.2.
- R6: 0.1-host load kept only if cheap, else DEFERRED.

## 4. Non-functional requirements

- No new runtime dependencies; stdlib-first.
- No fake percentages: commandcode without a quota endpoint stays
  online/offline probe + local ledger only.
- English only; MIT license; no upstream posts.

## 5. Out of scope for v0.2.0

New providers, UI redesign, burn-ledger export UI.

## 6. Acceptance

`docs/requirements-matrix.md` rows R1–R6 for v0.2.0 reach PASS (or R6
DEFERRED with rationale) with test evidence from `docs/TEST-CASES.md`
cases TC-01…; enforced by `tests/sdlc-docs.test.ts`.
