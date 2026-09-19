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
    label: string;
    percent?: number;
    resetAt?: string;
    display?: string;
}
/**
 * Map an OAuth /usage payload to panel rows. The modern `limits[]` array
 * wins when non-empty; legacy flat buckets are the fallback. Kind mapping:
 * session → 5h; weekly_all/weekly_scoped → weekly (+ model scope when
 * named); anything else keeps its scope/kind.
 */
export declare function mapClaudeUsage(b: any): ClaudeUsageItem[];
