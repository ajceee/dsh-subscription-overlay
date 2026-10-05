# Requirements matrix — v0.2.0

| Req | Statement | Status | Tests | Evidence |
|-----|-----------|--------|-------|----------|
| R1 | Plugin loads on DSH 0.2 without throwing | DONE | TC-01 | dsh 0.2.0-rc.2 test profile (~/.dsh-02, :3099) 2026-10-05: activation `live`, no stderr from the overlay |
| R2 | Overlay settings (enabled, pollMinutes, alertPct, providers, commandcodeMonthlyBudget, overlay prefs) visible + editable in Settings › Plugins and persisted | PARTIAL | TC-02, TC-03 | POST /settings writes via configEditor.edit into the profile row; alertPct 85→86→85 round-trip verified. Settings › Plugins page render not yet checked in a browser |
| R3 | Live config change applies without restart where host supports it | DONE | TC-04 | configEditor write reloads only this plugin; GET /status showed the new value ~4s later, no harness restart. Not volatile (see SETTINGS-0.2.md §7 alternative) |
| R4 | Burn ledger persists outside the settings schema | DONE | TC-05 | burn-store.ts wired: commandcode burn reads burn.json; /ledger/append writes it; legacy config.burn migrated once at boot |
| R5 | llm-pi-ai provider discovery works on 0.2 | DONE | TC-06 | GET /status on 0.2: claude, codex, opencode-go, commandcode all `ok` |
| R6 | Still loads on 0.1 hosts if cheap, else DEFERRED | PARTIAL | TC-07 | register() path kept when the host has it (0.1); not re-run on rc.3 yet |
