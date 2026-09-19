/**
 * t2 dock-badge unit tests: pure label helpers (upstream parity) + display
 * mount-point handling in the snapshot store. t4 additions: hide-selector
 * scoping (never a bare dialog-button selector) + claude limits mapping.
 *
 * Run: node --test --experimental-strip-types tests/*.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OverlayController,
} from '../src/client/controller.ts';
import {
  dockCompactSegment,
  dockPreviewWindows,
  DOCK_WINDOW_PREVIEW_LIMIT,
  dockResetParts,
  dockUsageBarColor,
  dockUsedPercent,
  dockWindowLabel,
} from '../src/client/dock-labels.ts';
import type { ProviderState } from '../src/client/types.ts';
import { DOCK_HIDE_CSS } from '../src/client/styles.ts';
import * as stylesModule from '../src/client/styles.ts';
import { mapClaudeUsage } from '../src/claude-usage.ts';

const NOW = Date.parse('2026-09-18T00:00:00.000Z');

function statusBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    refreshedAt: NOW,
    alertPct: 85,
    pollMinutes: 5,
    enabled: true,
    providers: [],
    overlay: { mode: 'pill', hotkey: 'Ctrl+Shift+S', display: 'dock' },
    ...overrides,
  };
}

function stubFetch(body: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>)['fetch'] = async () => {
    return { ok: true, json: async () => body } as Response;
  };
}

describe('dock label helpers (upstream parity)', () => {
  it('clamps percents, undefined for display-only rows', () => {
    assert.equal(dockUsedPercent({ label: '5h', percent: 25 }), 25);
    assert.equal(dockUsedPercent({ label: '5h', percent: 150 }), 100);
    assert.equal(dockUsedPercent({ label: '5h', percent: -3 }), 0);
    assert.equal(dockUsedPercent({ label: 'plan', display: 'pro' }), undefined);
    assert.equal(dockUsedPercent({ label: 'x', percent: Number.NaN }), undefined);
  });

  it('usageBarColor parity: success <80, warn 80–94, error ≥95', () => {
    assert.equal(dockUsageBarColor(10), 'var(--dsw-alias-state-success-primary)');
    assert.equal(dockUsageBarColor(79), 'var(--dsw-alias-state-success-primary)');
    assert.equal(dockUsageBarColor(80), 'var(--dsw-alias-state-warn-label)');
    assert.equal(dockUsageBarColor(94), 'var(--dsw-alias-state-warn-label)');
    assert.equal(dockUsageBarColor(95), 'var(--dsw-alias-state-error-primary)');
  });

  it('bar fills are flat usageBarColor steps (no gradients)', () => {
    // Upstream-exact dialog bars resolve to bare --dsw-* tokens; the dock
    // badge must never paint gradient fills.
    for (const pct of [0, 10, 79, 80, 94, 95, 100]) {
      const color = dockUsageBarColor(pct);
      assert.ok(color.startsWith('var(--dsw-'), `pct ${pct} resolves off-token: ${color}`);
      assert.ok(!color.includes('gradient'), `pct ${pct} must not use a gradient`);
    }
  });

  it('preview shows the first 4 windows, rest collapse into overflow', () => {
    const items = [0, 1, 2, 3, 4, 5].map((n) => ({ label: `w${n}`, percent: n }));
    const { shown, hidden } = dockPreviewWindows(items);
    assert.equal(DOCK_WINDOW_PREVIEW_LIMIT, 4);
    assert.deepEqual(shown.map((i) => i.label), ['w0', 'w1', 'w2', 'w3']);
    assert.deepEqual(hidden.map((i) => i.label), ['w4', 'w5']);
    assert.deepEqual(dockPreviewWindows(items.slice(0, 2)).hidden, []);
  });
  it('resetParts tolerates ISO, epoch ms and epoch seconds', () => {
    assert.equal(dockResetParts('2026-09-20T00:00:00.000Z')?.ms, Date.parse('2026-09-20T00:00:00.000Z'));
    assert.equal(dockResetParts(1789766676217)?.ms, 1789766676217);
    assert.equal(dockResetParts(1789766676)?.ms, 1789766676000);
    assert.equal(dockResetParts('garbage'), undefined);
    assert.equal(dockResetParts(undefined), undefined);
  });

  it('windowLabel countdowns with label fallback', () => {
    // +6d18h from NOW
    assert.equal(
      dockWindowLabel({ label: '7d', percent: 25, resetAt: new Date(NOW + (6 * 24 + 18) * 3600_000).toISOString() }, NOW),
      '6d18h',
    );
    // +1h58m from NOW
    assert.equal(
      dockWindowLabel({ label: '5h', percent: 25, resetAt: NOW + 118 * 60_000 }, NOW),
      '1h58m',
    );
    // +42m from NOW
    assert.equal(dockWindowLabel({ label: '5h', percent: 25, resetAt: NOW + 42 * 60_000 }, NOW), '42m');
    // no reset → item label; empty label → W
    assert.equal(dockWindowLabel({ label: '5h', percent: 25 }, NOW), '5h');
    assert.equal(dockWindowLabel({ label: '', percent: 25 }, NOW), 'W');
  });

  it('compactSegment reads like the upstream pill', () => {
    const codex: ProviderState = {
      id: 'codex',
      label: 'Codex',
      status: 'ok',
      items: [
        { label: '7d', percent: 25, resetAt: new Date(NOW + (6 * 24 + 1) * 3600_000).toISOString() },
      ],
    };
    assert.equal(dockCompactSegment(codex, NOW), 'Codex 6d1h 25%');
  });

  it('compactSegment caps at two windows with +n overflow, bare label when windowless', () => {
    const p: ProviderState = {
      id: 'claude',
      label: 'Claude',
      status: 'ok',
      items: [
        { label: '5h', percent: 10, resetAt: NOW + 60_000 },
        { label: '7d', percent: 20, resetAt: NOW + 60_000 },
        { label: '30d', percent: 30, resetAt: NOW + 60_000 },
      ],
    };
    assert.match(dockCompactSegment(p, NOW), /\+1$/);
    const plan: ProviderState = {
      id: 'commandcode',
      label: 'CommandCode',
      status: 'ok',
      items: [{ label: 'plan', display: 'pro' }],
    };
    assert.equal(dockCompactSegment(plan, NOW), 'CommandCode');
  });
});

describe('display mount point', () => {
  it('defaults to dock before the first status read', () => {
    const controller = new OverlayController();
    assert.equal(controller.store.getSnapshot().display, 'dock');
  });

  it('applyStatus tracks host display, ignores garbage', async () => {
    const controller = new OverlayController();
    stubFetch(statusBody({ overlay: { mode: 'pill', display: 'floater' } }));
    await controller.reload();
    assert.equal(controller.store.getSnapshot().display, 'floater');
    stubFetch(statusBody({ overlay: { mode: 'pill', display: 'sideways' } }));
    await controller.reload();
    assert.equal(controller.store.getSnapshot().display, 'floater');
  });

  it('inject face exposes setDisplay', () => {
    const controller = new OverlayController();
    controller.inject().setDisplay('floater');
    assert.equal(controller.store.getSnapshot().display, 'floater');
    controller.inject().setDisplay('dock');
    assert.equal(controller.store.getSnapshot().display, 'dock');
  });
});

describe('hide selector scoping (t4/BUG 1)', () => {
  it('fingerprints the upstream pill mount; never a bare dialog-button selector', () => {
    // Every rule targeting a dialog button must carry a mount fingerprint
    // (portaled anchor or invisible seat) so host context/cache pills survive.
    const rules = DOCK_HIDE_CSS.split('}').map((r) => r.split('{')[0] ?? '');
    const pillRules = rules.filter((sel) => sel.includes('button[aria-haspopup'));
    assert.ok(pillRules.length >= 2, 'expected portaled + in-place hide rules');
    for (const sel of pillRules) {
      assert.ok(
        sel.includes('inline-flex') || sel.includes('aria-hidden'),
        `unfingerprinted hide selector: ${sel.trim()}`,
      );
      assert.ok(sel.includes(':not([data-dso-dock])'), `missing self-exclusion: ${sel.trim()}`);
    }
  });

  it('has no outlet-wide dialog-button rule', () => {
    // The t2 regression: `[data-slot=...] button[aria-haspopup]` with only a
    // descendant combinator matches every dialog pill in the dock outlet.
    assert.ok(
      !DOCK_HIDE_CSS.includes('[data-slot="conversation.composer.dock"] button['),
      'generic outlet dialog-button selector must stay deleted',
    );
  });

  it('dock custom stylesheet is deleted (t10 upstream-exact chrome)', () => {
    // The DOCK_CSS export (custom pill/dialog/dot/gradient classes) is gone;
    // dock chrome lives in DockBadge.tsx as upstream-exact inline styles.
    assert.ok(!('DOCK_CSS' in stylesModule), 'DOCK_CSS export must stay deleted');
    assert.ok(!('DOCK_STYLE_TAG_ID' in stylesModule), 'dock style tag must stay deleted');
    // The dock pill + dialog are inline-styled upstream mirrors; no
    // `.dso-dock-*` custom classes may exist anywhere in the hide sheet.
    assert.ok(!DOCK_HIDE_CSS.includes('.dso-dock-'), 'custom dock classes must stay deleted');
    assert.ok(!DOCK_HIDE_CSS.includes('.dso-dot'), 'status-dot styling must stay deleted');
    assert.ok(!DOCK_HIDE_CSS.includes('gradient'), 'gradient styling must stay deleted');
  });
});

describe('mapClaudeUsage (t4/BUG 2 upstream parity)', () => {
  it('modern limits[] wins when non-empty', () => {
    const rows = mapClaudeUsage({
      five_hour: { utilization: 99, resets_at: '2026-09-18T01:00:00.000Z' },
      seven_day: { utilization: 99, resets_at: '2026-09-20T00:00:00.000Z' },
      limits: [
        { kind: 'session', percent: 20, resets_at: '2026-09-18T05:00:00.000Z' },
        {
          kind: 'weekly_scoped',
          percent: 35,
          resets_at: '2026-09-25T00:00:00.000Z',
          scope: { model: { display_name: 'Opus' } },
        },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.label, '5h');
    assert.equal(rows[0]?.percent, 20);
    assert.equal(rows[1]?.label, '7d · Opus');
    assert.equal(rows[1]?.percent, 35);
    assert.equal(rows[1]?.resetAt, '2026-09-25T00:00:00.000Z');
  });

  it('maps weekly_all to 7d and unknown kinds to scope/kind', () => {
    const rows = mapClaudeUsage({
      limits: [
        { kind: 'weekly_all', percent: 50, resets_at: '2026-09-25T00:00:00.000Z' },
        { kind: 'mystery', percent: 10, scope: { model: { display_name: 'X' } } },
        { kind: 'other', percent: 5 },
        { kind: 'session', percent: 'high' },
      ],
    });
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.label, '7d');
    assert.equal(rows[1]?.label, 'X');
    assert.equal(rows[2]?.label, 'other');
  });

  it('limits-only modern response needs no legacy buckets', () => {
    const rows = mapClaudeUsage({
      limits: [{ kind: 'session', percent: 12, resets_at: '2026-09-18T05:00:00.000Z' }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.label, '5h');
  });

  it('legacy fallback without the stale Fable label', () => {
    const rows = mapClaudeUsage({
      five_hour: { utilization: 20, resets_at: '2026-09-18T01:00:00.000Z' },
      seven_day: { utilization: 40, resets_at: '2026-09-20T00:00:00.000Z' },
      seven_day_opus: { utilization: 60, resets_at: '2026-09-20T00:00:00.000Z' },
      seven_day_sonnet: { utilization: 70, resets_at: '2026-09-20T00:00:00.000Z' },
    });
    assert.deepEqual(
      rows.map((r) => r.label),
      ['5h', '7d', '7d · Opus', '7d · Sonnet'],
    );
    assert.ok(rows.every((r) => r.label !== 'Fable'));
  });

  it('utilization-shaped limits entries fall back to utilization (V1)', () => {
    const rows = mapClaudeUsage({
      limits: [{ kind: 'session', utilization: 33, resets_at: '2026-09-18T05:00:00.000Z' }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.label, '5h');
    assert.equal(rows[0]?.percent, 33);
  });

  it('empty payload maps to no rows (never fabricated)', () => {
    assert.deepEqual(mapClaudeUsage({}), []);
    assert.deepEqual(mapClaudeUsage({ limits: [] }), []);
  });
});
