/**
 * Stale-while-revalidate + live-throttle helpers for the quota aggregate.
 *
 * Upstream parity notes: the subscriptions server shares one cache across UI
 * surfaces and keeps showing last-known windows on transient failure, and it
 * re-reads usage on a 15-minute server poll — never per surface read. This
 * module is the pure core of that behavior: last-good rows are served with a
 * `stale` flag on 429/cooldown/transient-network instead of `status: 'error'`
 * (reserved for persistent auth failure and missing tokens), and live usage
 * fetches are throttled per provider. No imports — unit-testable under plain
 * node (`node --test`).
 *
 * @module dsh-subscription-overlay/refresh-cache
 */
/** Minimal row shape the cache operates on (host ProviderRow satisfies this). */
export interface SwrRow {
    id: string;
    label: string;
    status: 'ok' | 'error' | 'disabled' | 'loading';
    message?: string;
    stale?: boolean;
    transient?: boolean;
    [key: string]: unknown;
}
/** Minimum gap between live usage fetches per provider (upstream 15-min poll). */
export declare const MIN_LIVE_INTERVAL_MS: number;
/** Jitter spread so restarted processes don't stampede the endpoint. */
export declare const LIVE_JITTER_MS = 60000;
/** Message carried by stale rows (rendered by the panel's message affordance). */
export declare const STALE_MESSAGE = "showing last-known values \u2014 retrying automatically";
/**
 * Auth failures are persistent (re-login required); every other failure mode
 * (429, 5xx, network) is transient and keeps the last-good row on screen.
 */
export declare function isPersistentHttpStatus(status: number | undefined): boolean;
/** Delay until the next allowed live fetch (minimum gap + jitter). */
export declare function nextLiveDelayMs(random?: () => number): number;
/**
 * Whether a live fetch is due. `nextAllowedAt` undefined (never fetched)
 * means due; otherwise the provider stays on cache until the throttle lapses.
 */
export declare function isLiveDue(nextAllowedAt: number | undefined, now: number): boolean;
export interface SwrDecision {
    row: SwrRow;
    cache: SwrRow | undefined;
}
/**
 * Fold one fresh fetch into the served row + stored cache:
 * - ok → served fresh (stale cleared) and cached;
 * - transient failure with a last-good row → serve it flagged stale, keep cache;
 * - persistent failure (or cold transient) → serve the error, drop the cache
 *   so a revoked login is never resurrected by a later transient failure.
 */
export declare function applyStaleFallback(lastGood: SwrRow | undefined, fresh: SwrRow): SwrDecision;
export interface StatusCache {
    refreshedAt: number;
    providers: SwrRow[];
}
/**
 * Merge for GET /api/status: serves the stored aggregate, or a cold empty
 * snapshot before the first background refresh lands. Pure cache serve —
 * takes no fetch handle by construction, so a status read can never trigger
 * a live fetch.
 */
export declare function resolveStatusSnapshot(cached: StatusCache | undefined): StatusCache;
