# TEST-PLAN — dsh-subscription-overlay v0.2.0 (DSH 0.2 port)

Version: 0.2.0 · Host: `dsh-web-app 0.2.0-rc.2`.

## 1. Strategy

Prove the 0.2 settings port (PRD §2) requirement by requirement via the
cases in `docs/TEST-CASES.md`, traced through `docs/requirements-matrix.md`.
Doc completeness is enforced by `tests/sdlc-docs.test.ts` in the existing
`node --test` runner (`node --test --experimental-strip-types
tests/*.test.ts`).

## 2. Levels

1. **Doc gate (automated):** all five v0.2.0 docs exist and reference 0.2.0;
   every matrix row has a test ref pointing at a defined TC id.
2. **Unit:** Config schema defaults/validation, burn-ledger sidecar
   read/write, provider-discovery probe mapping (existing
   `tests/*.test.ts` + port tests).
3. **Integration (manual on live 0.2 host):** install via profile bundle,
   open overlay, edit Settings › Plugins, restart host, verify persistence;
   flip a setting and confirm no-restart apply where supported.

## 3. Entry / exit criteria

- Entry: docs set complete, gate test green.
- Exit: matrix rows R1–R6 PASS (or R6 DEFERRED with rationale) with evidence
  filled in; no row stays PLANNED after implementation.

## 4. Risks

- 0.2 settings service API drift vs `dsh-mnemon` 0.5.24 reference.
- Live-apply support limits on the 0.2 host (R3 degrades to
  restart-required with documentation).
