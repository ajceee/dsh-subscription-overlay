/**
 * Shared wire shapes for the dsh-subscription-overlay client.
 *
 * Mirrors the t2 host contract (GET /plugins/dsh-subscription-overlay/api/status):
 * - `refreshedAt` is epoch ms (number; ISO strings are also tolerated).
 * - `providers` always has 4 rows (claude, codex, opencode-go, commandcode).
 * - Provider toggles switched off yield `status: "disabled"` rows.
 * - Missing credentials fold to `status: "error"` with a message (no separate
 *   missing-key status).
 * - commandcode carries `probe` + `burn`; `burn.percent` is `null` when
 *   `commandcodeMonthlyBudget` is 0 — the panel must NEVER render a fake %.
 * - Extra display fields on items are additive-only; the panel renders them
 *   generically and ignores unknown keys.
 *
 * @module dsh-subscription-overlay/client/types
 */

/** One usage window row (claude 5h/7d, codex primary/secondary, opencode-go 5h/7d/monthly). */
export interface StatusItem {
  label: string;
  /** 0-100 utilization; absent for display-only rows. */
  percent?: number;
  /** Reset instant: ISO string or epoch ms. */
  resetAt?: string | number;
  /** Preformatted value (e.g. "120 / 200"). */
  display?: string;
  remaining?: number;
  [key: string]: unknown;
}

/** commandcode `/models` probe result (online/offline only — never a percentage). */
export interface ProbeState {
  ok: boolean;
  ms: number;
  models?: string[];
  message?: string;
}

/** commandcode local burn ledger projection for the current month. */
export interface BurnState {
  /** Tokens consumed since month start. */
  monthToDate: number;
  /** Monthly budget in tokens; 0 = track only, no %. */
  budget: number;
  /** 0-100, or null when budget is 0 (never fabricate). */
  percent: number | null;
  /** First of next month (ISO or epoch ms). */
  resetAt?: string | number;
}

export type ProviderStatus = 'ok' | 'error' | 'disabled' | 'loading';

export interface ProviderState {
  id: 'claude' | 'codex' | 'opencode-go' | 'commandcode' | string;
  label: string;
  status: ProviderStatus;
  message?: string;
  /** Served from cache after a transient failure; values are last-known. */
  stale?: boolean;
  items?: StatusItem[];
  probe?: ProbeState;
  burn?: BurnState;
  [key: string]: unknown;
}

export interface StatusResponse {
  refreshedAt: number | string;
  alertPct?: number;
  pollMinutes?: number;
  enabled?: boolean;
  providers?: ProviderState[];
  overlay?: { mode?: 'pill' | 'ring'; hotkey?: string; display?: 'dock' | 'floater' };
  [key: string]: unknown;
}

/** Settings payload the section POSTs to /api/settings (t2 host owns it). */
export interface SettingsPatch {
  enabled?: boolean;
  pollMinutes?: number;
  alertPct?: number;
  providers?: {
    claude?: boolean;
    codex?: boolean;
    opencodeGo?: boolean;
    commandcode?: boolean;
  };
  commandcodeMonthlyBudget?: number;
  overlay?: { mode?: 'pill' | 'ring'; display?: 'dock' | 'floater' };
}
