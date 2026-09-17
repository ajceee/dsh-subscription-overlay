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
 * Fetch CommandCode usage from the confirmed live endpoint:
 *   GET https://api.commandcode.ai/alpha/usage/summary
 * Response: { totalTokens, totalTokensIn, totalTokensOut, totalCount,
 *             totalCredits, totalMonthlyCredits, totalPurchasedCredits,
 *             totalFreeCredits, successRate, completedCount, failedCount,
 *             averageCost, periodBasis }
 *
 * No quota cap or reset date is returned by this endpoint — Command Code does
 * not expose a percentage-based window meter via API (only the Studio dashboard
 * shows it).  We surface spend + token counts as display items, and optionally
 * compute a spend-% against the user-configured monthly budget.
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
