/**
 * Claude OAuth /usage → panel-row mapping (upstream fetchClaudeUsage parity).
 *
 * Pure module (no cordis, no classes): unit-testable under plain node
 * (`node --test`). Re-exported by the host entry for the fetch path.
 *
 * @module dsh-subscription-overlay/claude-usage
 */

/** One usage window row (subset of the host QuotaItem shape). */
export interface ClaudeUsageItem {
  label: string
  percent?: number
  resetAt?: string
  display?: string
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/**
 * Map an OAuth /usage payload to panel rows. The modern `limits[]` array
 * wins when non-empty; legacy flat buckets are the fallback. Kind mapping:
 * session → 5h; weekly_all/weekly_scoped → weekly (+ model scope when
 * named); anything else keeps its scope/kind.
 */
export function mapClaudeUsage(b: any): ClaudeUsageItem[] {
  const resetIso = (v: unknown): string | undefined =>
    typeof v === 'string' && v ? v : undefined
  const modern: ClaudeUsageItem[] = []
  for (const lim of Array.isArray(b?.limits) ? b.limits : []) {
    const pct = num(lim?.percent) ?? num(lim?.utilization)
    if (pct === undefined) continue
    const kind = String(lim?.kind ?? '')
    const scope = (lim as any)?.scope?.model?.display_name
    const scopeStr = typeof scope === 'string' && scope ? scope : undefined
    const label = kind === 'session'
      ? '5h'
      : (kind === 'weekly_all' || kind === 'weekly_scoped')
        ? (scopeStr ? `7d · ${scopeStr}` : '7d')
        : (scopeStr ?? (kind || 'other'))
    modern.push({ label, percent: pct, resetAt: resetIso(lim?.resets_at) })
  }
  if (modern.length > 0) return modern
  const items: ClaudeUsageItem[] = []
  const pushLegacy = (label: string, w: any) => {
    const pct = num(w?.utilization)
    if (pct !== undefined) items.push({ label, percent: pct, resetAt: resetIso(w?.resets_at) })
  }
  pushLegacy('5h', b?.five_hour)
  pushLegacy('7d', b?.seven_day)
  pushLegacy('7d · Opus', b?.seven_day_opus)
  pushLegacy('7d · Sonnet', b?.seven_day_sonnet)
  return items
}
