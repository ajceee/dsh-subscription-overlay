/**
 * dsh-subscription-overlay — host entry.
 *
 * Fresh-fetch quota aggregation for claude / codex / opencode-go (per
 * docs/SPIKE.md §2.1: same credential refs, endpoints, and header shapes the
 * wezterm stack proved — never calls into dsh-plugin-subscriptions usage RPC
 * or dsh-quota state), a commandcode /models probe (online/offline only, never
 * a fake percentage), and a local burn ledger in our own settings namespace.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-subscription-overlay";
export declare const inject: string[];
/** Settings namespace shared by the host half and the browser panel. */
export declare const NS = "dsh-subscription-overlay";
export interface Config {
    enabled: boolean;
    pollMinutes: number;
    alertPct: number;
    providers: {
        claude: boolean;
        codex: boolean;
        opencodeGo: boolean;
        commandcode: boolean;
    };
    commandcodeMonthlyBudget: number;
    overlay: {
        mode: 'pill' | 'ring';
        hotkey: string;
    };
    burn: Record<string, Array<[number, number]>>;
}
export declare const Config: Config;
export interface QuotaItem {
    label: string;
    percent?: number;
    resetAt?: string;
    display?: string;
}
export type ProviderId = 'claude' | 'codex' | 'opencode-go' | 'commandcode';
export interface ProviderRow {
    id: ProviderId;
    label: string;
    status: 'ok' | 'error' | 'disabled' | 'loading';
    message?: string;
    items?: QuotaItem[];
    probe?: {
        ok: boolean;
        ms: number;
        models?: number;
        message?: string;
    };
    burn?: {
        monthToDate: number;
        budget: number;
        percent: number | null;
        resetAt: string;
    };
}
/**
 * Fetch CommandCode quota from the same four alpha endpoints the pi-commandcode-provider
 * and the cmd /usage command use (source: github.com/patlux/pi-commandcode-provider):
 *
 *   GET /alpha/whoami                 → { user: { userName }, org: { id } | null }
 *   GET /alpha/billing/credits        → { credits: { monthlyCredits, … },
 *                                         windowLimits: {
 *                                           fiveHour: { used, cap, resetAt(ms) },
 *                                           weekly:   { used, cap, resetAt(ms) } } }
 *   GET /alpha/billing/subscriptions  → { data: { planId, currentPeriodStart/End } }
 *   GET /alpha/usage/summary          → { totalCost, totalTokens, totalCount, … }
 *
 * windowLimits gives rolling percent = used/cap*100 + resetAt — identical pattern to
 * Claude (5h/7d) and Codex (primary/secondary).
 */
export declare function fetchCommandcode(apiKey: string): Promise<ProviderRow>;
export declare function appendBurn(burn: Record<string, Array<[number, number]>>, model: string, tokens: number, now?: number): Record<string, Array<[number, number]>>;
export declare function monthToDate(burn: Record<string, Array<[number, number]>>, now?: Date): number;
interface SettingsPatch {
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
    overlay?: {
        mode?: 'pill' | 'ring';
        hotkey?: string;
    };
}
export declare function publicSettings(cfg: Config): {
    enabled: boolean;
    pollMinutes: number;
    alertPct: number;
    providers: {
        claude: boolean;
        codex: boolean;
        opencodeGo: boolean;
        commandcode: boolean;
    };
    commandcodeMonthlyBudget: number;
    overlay: {
        mode: "pill" | "ring";
        hotkey: string;
    };
};
export declare function validateSettingsPatch(patch: unknown): {
    ok: true;
    value: SettingsPatch;
} | {
    ok: false;
    error: string;
};
export declare function apply(ctx: Context, config: Config): void;
export {};
