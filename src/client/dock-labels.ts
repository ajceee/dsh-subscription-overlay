/**
 * Pure dock-pill label helpers (upstream `SubscriptionUsageBadge` parity).
 *
 * No React imports — unit-testable under plain node (`node --test`).
 * Reading guide: `dockWindowLabel` mirrors upstream `windowLabel`
 * ("6d18h" / "1h58m" / "42m", scope/kind fallback), `dockUsageBarColor`
 * mirrors upstream `usageBarColor` (success <80, warn 80–94, error ≥95),
 * `dockCompactSegment` mirrors `compactSegment` ("Codex 6d1h 25%").
 *
 * @module dsh-subscription-overlay/client/dock-labels
 */
import type { ProviderState, StatusItem } from './types.ts';

/** Clamp a 0–100 utilization for display, or undefined for display-only rows. */
export function dockUsedPercent(item: StatusItem): number | undefined {
  if (typeof item.percent !== 'number' || !Number.isFinite(item.percent)) return undefined;
  return Math.max(0, Math.min(100, Math.round(item.percent)));
}

/**
 * Bar/dot color for a used share. Parity with upstream `usageBarColor`:
 * success normally, warn from 80%, error from 95%. Every color resolves
 * through a `--dsw-*` design token.
 */
export function dockUsageBarColor(percent: number): string {
  if (percent >= 95) return 'var(--dsw-alias-state-error-primary)';
  if (percent >= 80) return 'var(--dsw-alias-state-warn-label)';
  return 'var(--dsw-alias-state-success-primary)';
}

/** Max windows shown before the overflow collapses into a <details> block. */
export const DOCK_WINDOW_PREVIEW_LIMIT = 4;

/** Split items into preview rows + overflow (upstream previewWindows parity). */
export function dockPreviewWindows(items: StatusItem[]): { shown: StatusItem[]; hidden: StatusItem[] } {
  const list = Array.isArray(items) ? items : [];
  return { shown: list.slice(0, DOCK_WINDOW_PREVIEW_LIMIT), hidden: list.slice(DOCK_WINDOW_PREVIEW_LIMIT) };
}
/** Normalize a reset instant (ISO string or epoch ms/s) to epoch ms. */
export function dockResetParts(resetAt: unknown): { ms: number } | undefined {
  if (typeof resetAt === 'number' && Number.isFinite(resetAt) && resetAt > 0) {
    return { ms: resetAt < 1e12 ? resetAt * 1000 : resetAt };
  }
  if (typeof resetAt === 'string' && resetAt !== '') {
    const ms = Date.parse(resetAt);
    return Number.isNaN(ms) ? undefined : { ms };
  }
  return undefined;
}

/**
 * Compact time-remaining label for one usage window: "6d18h" (days+hours),
 * "1h58m" (hours+minutes), or "42m" (minutes only). Falls back to the item
 * label (already "5h"/"7d"/"30d" on our rows) when no reset time is known.
 */
export function dockWindowLabel(item: StatusItem, now: number = Date.now()): string {
  const parsed = dockResetParts(item.resetAt);
  if (parsed === undefined) {
    return item.label !== '' ? item.label : 'W';
  }
  const diff = Math.max(0, parsed.ms - now);
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d${hours % 24}h`;
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}

/**
 * Collapsed pill segment for one provider: "<Name> <win> <pct>%" for up to
 * two percent windows plus a "+n" overflow (mirrors upstream
 * `compactSegment`). Providers with no percent windows contribute their
 * bare label so an ok-but-windowless provider still reads in the pill.
 */
export function dockCompactSegment(p: ProviderState, now: number = Date.now()): string {
  const items = Array.isArray(p.items) ? p.items : [];
  const windows = items.filter((i) => dockUsedPercent(i) !== undefined);
  if (windows.length === 0) return p.label;
  const parts = windows
    .slice(0, 2)
    .map((w) => `${dockWindowLabel(w, now)} ${(dockUsedPercent(w) ?? 0).toString()}%`);
  if (windows.length > 2) parts.push(`+${windows.length - 2}`);
  return `${p.label} ${parts.join(' · ')}`;
}
