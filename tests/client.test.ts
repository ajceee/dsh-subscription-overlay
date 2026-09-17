/**
 * t3 client unit tests: pure controller helpers + acceptance-critical rules.
 *
 * - commandcode burn.percent null (budget 0) is never coerced to a number
 *   (panel renders probe + burn only; no fake %).
 * - Hidden toggle closes the panel too (both unmount) and polling
 *   short-circuits while hidden.
 * - Same-origin POSTs carry the CSRF header.
 *
 * Run: node --test --experimental-strip-types tests/*.test.ts
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OverlayController,
  alertCount,
  headlineItem,
  summarizeProvider,
  toEpochMs,
} from '../src/client/controller.ts';
import type { ProviderState } from '../src/client/types.ts';

const claude: ProviderState = {
  id: 'claude',
  label: 'Claude',
  status: 'ok',
  items: [
    { label: '5h', percent: 20, resetAt: '2026-09-17T12:00:00.000Z' },
    { label: '7d', percent: 90, resetAt: '2026-09-20T00:00:00.000Z' },
  ],
};

const commandcode: ProviderState = {
  id: 'commandcode',
  label: 'commandcode',
  status: 'ok',
  probe: { ok: true, ms: 120, models: ['a', 'b'] },
  burn: { monthToDate: 1500, budget: 0, percent: null },
};

function statusBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    refreshedAt: Date.now(),
    alertPct: 85,
    pollMinutes: 5,
    enabled: true,
    providers: [claude, commandcode],
    overlay: { mode: 'pill', hotkey: 'Ctrl+Shift+S' },
    ...overrides,
  };
}

let lastRequest: { url: string; init: RequestInit } | null = null;

function stubFetch(body: Record<string, unknown>): void {
  lastRequest = null;
  (globalThis as Record<string, unknown>)['fetch'] = async (url: string, init: RequestInit) => {
    lastRequest = { url, init };
    return { ok: true, json: async () => body } as Response;
  };
}

beforeEach(() => {
  stubFetch(statusBody());
});

describe('toEpochMs', () => {
  it('passes epoch ms through, parses ISO, rejects garbage', () => {
    assert.equal(toEpochMs(1726000000000), 1726000000000);
    assert.equal(toEpochMs('2026-09-17T00:00:00.000Z'), Date.parse('2026-09-17T00:00:00.000Z'));
    assert.equal(toEpochMs('garbage'), 0);
    assert.equal(toEpochMs(undefined), 0);
  });
});

describe('alert + headline helpers', () => {
  it('counts over-threshold items and error providers, ignores disabled', () => {
    const snapshot = {
      providers: [
        claude,
        { id: 'codex', label: 'Codex', status: 'error', message: 'auth failed' },
        { id: 'opencode-go', label: 'opencode-go', status: 'disabled' },
      ],
      alertPct: 85,
    };
    // claude 7d @90 >= 85 (1) + codex error (1) = 2
    assert.equal(alertCount(snapshot as never), 2);
  });

  it('prefers the 5h window as headline', () => {
    assert.equal(headlineItem(claude)?.label, '5h');
  });

  it('summarizes headline windows, empty for non-ok providers', () => {
    assert.equal(summarizeProvider(claude), '5h 80% left · 7d 10% left');
    assert.equal(summarizeProvider({ ...claude, status: 'error' }), '');
    assert.equal(summarizeProvider(commandcode), '');
  });
});

describe('OverlayController acceptance rules', () => {
  it('never fabricates a commandcode percent when budget is 0', async () => {
    const controller = new OverlayController();
    await controller.reload();
    const cc = controller.store.getSnapshot().providers.find((p) => p.id === 'commandcode');
    assert.ok(cc?.burn);
    assert.equal(cc.burn.percent, null);
    assert.equal(cc.burn.budget, 0);
  });

  it('hidden toggle closes the panel too and polling short-circuits', async () => {
    const controller = new OverlayController();
    await controller.reload();
    controller.store.set({ ...controller.store.getSnapshot(), open: true });
    controller.inject().setVisible(false);
    const snapshot = controller.store.getSnapshot();
    assert.equal(snapshot.visible, false);
    assert.equal(snapshot.open, false);

    let fetched = false;
    (globalThis as Record<string, unknown>)['fetch'] = async () => {
      fetched = true;
      return { ok: true, json: async () => statusBody() } as Response;
    };
    controller.pollIfVisible();
    assert.equal(fetched, false);
  });

  it('toggle opens the panel and POSTs carry the CSRF header', async () => {
    const controller = new OverlayController();
    controller.inject().toggle();
    assert.equal(controller.store.getSnapshot().open, true);
    await controller.refresh();
    assert.ok(lastRequest);
    assert.ok(lastRequest.url.endsWith('/refresh'));
    const headers = lastRequest.init.headers as Record<string, string>;
    assert.equal(headers['x-dsh-subscription-overlay'], '1');
  });

  it('host enabled:false hides the overlay', async () => {
    stubFetch(statusBody({ enabled: false }));
    const controller = new OverlayController();
    await controller.reload();
    const snapshot = controller.store.getSnapshot();
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.visible, false);
    assert.equal(snapshot.open, false);
  });
});
