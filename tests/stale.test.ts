/**
 * t7 stale-while-revalidate + poll-pressure tests: pure refresh-cache helpers
 * (upstream parity) — stale serve on 429, no-fetch status serve, live clamp.
 *
 * Run: node --test --experimental-strip-types tests/*.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStaleFallback,
  isLiveDue,
  isPersistentHttpStatus,
  LIVE_JITTER_MS,
  MIN_LIVE_INTERVAL_MS,
  nextLiveDelayMs,
  resolveStatusSnapshot,
  STALE_MESSAGE,
  type SwrRow,
} from '../src/refresh-cache.ts';

const NOW = 1_800_000_000_000;

function okRow(overrides: Partial<SwrRow> = {}): SwrRow {
  return {
    id: 'claude',
    label: 'Claude',
    status: 'ok',
    items: [{ label: '5h', percent: 20 }],
    ...overrides,
  };
}

function errRow(overrides: Partial<SwrRow> = {}): SwrRow {
  return {
    id: 'claude',
    label: 'Claude',
    status: 'error',
    message: 'rate limited by Anthropic — retrying automatically',
    items: [],
    transient: true,
    ...overrides,
  };
}

describe('stale-while-revalidate', () => {
  it('serves last-good flagged stale on transient failure, keeps cache', () => {
    const lastGood = okRow();
    const { row, cache } = applyStaleFallback(lastGood, errRow());
    assert.equal(row.status, 'ok');
    assert.equal(row.stale, true);
    assert.equal(row.message, STALE_MESSAGE);
    assert.deepEqual(row.items, lastGood.items);
    assert.equal(cache, lastGood);
  });

  it('stores fresh ok rows and clears the stale flag', () => {
    const { row, cache } = applyStaleFallback(okRow(), okRow({ stale: true }));
    assert.equal(row.status, 'ok');
    assert.equal(row.stale, false);
    assert.equal(cache?.stale, false);
  });

  it('passes persistent auth errors through and drops the cache', () => {
    const lastGood = okRow();
    const fresh = errRow({
      message: 'auth failed — re-login in Subscriptions settings',
      transient: false,
    });
    const { row, cache } = applyStaleFallback(lastGood, fresh);
    assert.equal(row.status, 'error');
    assert.match(row.message ?? '', /auth failed/);
    assert.equal(cache, undefined);
  });

  it('cold transient failure serves the error (nothing to show yet)', () => {
    const { row, cache } = applyStaleFallback(undefined, errRow());
    assert.equal(row.status, 'error');
    assert.equal(cache, undefined);
  });

  it('classifies only 401/403 as persistent', () => {
    assert.equal(isPersistentHttpStatus(401), true);
    assert.equal(isPersistentHttpStatus(403), true);
    assert.equal(isPersistentHttpStatus(429), false);
    assert.equal(isPersistentHttpStatus(500), false);
    assert.equal(isPersistentHttpStatus(undefined), false);
  });
});

describe('status serve never fetches', () => {
  it('returns the stored aggregate untouched', () => {
    const cached = { refreshedAt: NOW - 60_000, providers: [okRow()] };
    const out = resolveStatusSnapshot(cached);
    assert.equal(out, cached);
    assert.equal(out.providers.length, 1);
  });

  it('cold cache resolves to an empty snapshot, not a fetch', () => {
    // resolveStatusSnapshot takes data only — no fetch handle exists by
    // construction, so this path cannot trigger a live fetch.
    assert.deepEqual(resolveStatusSnapshot(undefined), { refreshedAt: 0, providers: [] });
  });
});

describe('live-interval clamp', () => {
  it('never-fetched providers are due', () => {
    assert.equal(isLiveDue(undefined, NOW), true);
  });

  it('blocks refetch inside the 15-minute window, allows after', () => {
    const allowedAt = NOW + MIN_LIVE_INTERVAL_MS;
    assert.equal(isLiveDue(allowedAt, NOW + MIN_LIVE_INTERVAL_MS - 1), false);
    assert.equal(isLiveDue(allowedAt, allowedAt), true);
    assert.equal(isLiveDue(allowedAt, allowedAt + 1), true);
  });

  it('delay is the minimum gap plus bounded jitter', () => {
    assert.equal(nextLiveDelayMs(() => 0), MIN_LIVE_INTERVAL_MS);
    const top = nextLiveDelayMs(() => 0.999999);
    assert.ok(top >= MIN_LIVE_INTERVAL_MS && top < MIN_LIVE_INTERVAL_MS + LIVE_JITTER_MS);
    const mid = nextLiveDelayMs(() => 0.5);
    assert.equal(mid, MIN_LIVE_INTERVAL_MS + Math.floor(0.5 * LIVE_JITTER_MS));
  });
});
