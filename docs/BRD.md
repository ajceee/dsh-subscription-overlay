# BRD — dsh-subscription-overlay v0.2.0 (DSH 0.2 port)

Version: 0.2.0 · Scope: port `@dsh-external/dsh-subscription-overlay` to the DSH 0.2 host
(`dsh-web-app 0.2.0-rc.2`). License MIT, author ajceee. English only.

## 1. Background

The overlay plugin (quota windows 5h/7d/30d for Claude, Codex, OpenCode Go,
CommandCode probe + burn ledger) was built against the 0.1 host settings API.
On the 0.2 host it crashes at startup:

`TypeError: sctx.settings.register is not a function` (`src/index.ts:975`).

The 0.2 host removed `settings.register()`; settings now derive from the
plugin's exported `Config` schema and are edited via
`ctx.settings.configure/describe/mutate/writable` (+ `configEditor` service)
and the client slot `plugins.bundle.config`.

## 2. Business objectives

1. The plugin loads on DSH 0.2 without throwing (R1).
2. All overlay settings remain visible and editable in Settings › Plugins and
   persist across restarts (R2).
3. Config changes apply live without restart wherever the 0.2 host supports
   it (R3).
4. The burn ledger keeps working but is stored outside the settings schema
   (R4).
5. `llm-pi-ai` provider discovery keeps working on 0.2 (R5).
6. 0.1-host compatibility is kept only if cheap, otherwise deferred (R6).

## 3. Stakeholders

Plugin users (quota overlay), maintainer (ajceee). No upstream posts required.

## 4. Constraints

- Never restart DSH from tooling; the user restarts.
- Reference port: `dsh-mnemon` 0.5.24 (`ProfileMnemonSettings`,
  `lib/index.js:10209-10360`, `lib/client.js:12201-12260`).
- Traceability for v0.2.0: PRD, requirements matrix, test plan, test cases;
  enforced by `tests/sdlc-docs.test.ts`.

## 5. Acceptance (business level)

The plugin installs via the profile bundle, opens its overlay, its settings
page edits every field in R2, changes persist and apply per R3, and the
requirements matrix rows for v0.2.0 reach PASS/FAIL with evidence (none stay
PLANNED after implementation).
