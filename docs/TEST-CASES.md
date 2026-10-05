# TEST-CASES — dsh-subscription-overlay v0.2.0

Scope: v0.2.0 port. Automation = `tests/sdlc-docs.test.ts` for TC-00;
port unit/integration tests for the rest.

- TC-00 — SDLC doc gate passes (`node --test tests/sdlc-docs.test.ts`).
- TC-01 — [R1] Plugin loads on DSH 0.2 (`dsh-web-app 0.2.0-rc.2`) with no
  `settings.register` TypeError; overlay slot registers.
- TC-02 — [R2] Settings › Plugins page shows every overlay setting
  (enabled, pollMinutes, alertPct, providers.*, commandcodeMonthlyBudget,
  overlay.mode/hotkey/display); each is editable.
- TC-03 — [R2] Edited settings persist across a host restart.
- TC-04 — [R3] Changing a setting (e.g. alertPct) applies live without
  restart where the 0.2 host supports config updates.
- TC-05 — [R4] Burn ledger entries survive restarts and are stored outside
  the settings schema (sidecar file/namespace, not `Config`).
- TC-06 — [R5] `llm-pi-ai` provider `/models` discovery probe renders
  online/offline (never a fake percentage) on 0.2.
- TC-07 — [R6] Plugin still loads on a 0.1 host if the compat shim is
  cheap; otherwise R6 is recorded DEFERRED with rationale.
