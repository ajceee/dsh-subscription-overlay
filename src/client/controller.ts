/**
 * Panel controller: bridges the plugin's same-origin HTTP API
 * (/plugins/dsh-subscription-overlay/api) onto a snapshot store.
 *
 * Adapted from dsh-quota's QuotaPanelController (SPIKE §1): fresh minimal
 * surface — status reload, manual refresh, staleness-triggered refresh,
 * probe relay. Polling short-circuits when the overlay is hidden
 * (acceptance: hidden toggle unmounts pill AND panel, no background fetch).
 *
 * The store is a real HostObservable (`createSnapshotStore` from
 * `@deepseek-ai/dsh-client-store`), so the shell synthesizes the
 * `useSubscriptionOverlay` selector hook for the panel from the
 * `hooks: { subscriptionOverlay }` compartment.
 *
 * @module dsh-subscription-overlay/client/controller
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { OverlaySnapshotFace } from './panel-face.ts';
import type { ProviderState, StatusItem } from './types.ts';

export interface OverlaySnapshot {
  loaded: boolean;
  busy: boolean;
  /** Panel open state; pill click flips it and triggers refreshIfStale. */
  open: boolean;
  /** Overlay visibility: false unmounts pill AND panel, stops polling. */
  visible: boolean;
  mode: 'pill' | 'ring';
  refreshedAt: number;
  providers: ProviderState[];
  alertPct: number;
  pollMinutes: number;
  enabled: boolean;
  formError: string;
  probing: string;
}

/** Initial snapshot before the first status read. */
export const INITIAL: OverlaySnapshot = {
  loaded: false,
  busy: false,
  open: false,
  visible: true,
  mode: 'pill',
  refreshedAt: 0,
  providers: [],
  alertPct: 85,
  pollMinutes: 5,
  enabled: true,
  formError: '',
  probing: '',
};

export const API_PREFIX = '/plugins/dsh-subscription-overlay/api';
/** Opening the panel auto-refreshes when the snapshot is older than this. */
export const AUTO_REFRESH_STALE_MS = 300 * 1000;

/** Snapshot store type (HostObservable): created via createSnapshotStore. */
export type OverlayStore = SnapshotStore<OverlaySnapshot>;

/** Normalize refreshedAt (epoch ms number, ISO tolerated) to epoch ms. */
export function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

/** Count alert-worthy rows: provider errors + usage items at/above the threshold. */
export function alertCount(snapshot: OverlaySnapshot): number {
  const over = snapshot.providers
    .filter((p) => p.status === 'ok' && Array.isArray(p.items))
    .reduce(
      (n, p) =>
        n +
        (p.items as StatusItem[]).filter(
          (i) => typeof i.percent === 'number' && i.percent >= snapshot.alertPct,
        ).length,
      0,
    );
  return over + snapshot.providers.filter((p) => p.status === 'error').length;
}

/** Headline percent item of a provider card (5h window preferred, else first with %). */
export function headlineItem(p: ProviderState): StatusItem | undefined {
  const items = Array.isArray(p.items) ? p.items : [];
  const withPct = items.filter((i) => typeof i.percent === 'number');
  return withPct.find((i) => /5\s*h/i.test(i.label)) ?? withPct[0];
}

/** One-line summary of a provider's headline windows ("5h 20% left · 7d 36% left"). */
export function summarizeProvider(p: ProviderState): string {
  if (!p || p.status !== 'ok' || !Array.isArray(p.items)) return '';
  const head = (item: StatusItem): string | undefined => {
    if (typeof item.percent !== 'number') return item.display;
    const tag = /5\s*h/i.test(item.label)
      ? '5h'
      : /7\s*d/i.test(item.label)
        ? '7d'
        : /30\s*d/i.test(item.label)
          ? '30d'
          : /month/i.test(item.label)
          ? 'mo'
          : /primary/i.test(item.label)
            ? 'pri'
            : /secondary/i.test(item.label)
              ? 'sec'
              : '';
    const value = `${Math.max(0, Math.round(100 - item.percent))}% left`;
    return tag !== '' ? `${tag} ${value}` : value;
  };
  const headlines = p.items.filter((i) => typeof i.percent === 'number');
  return (headlines.length > 0 ? headlines : p.items)
    .map(head)
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .slice(0, 2)
    .join(' · ');
}

/** Drives the panel off the plugin's HTTP API. */
export class OverlayController {
  readonly store: SnapshotStore<OverlaySnapshot>;
  private pollMinutes = 5;
  private lastPollAttempt = 0;

  constructor(initial?: Partial<OverlaySnapshot>) {
    this.store = createSnapshotStore<OverlaySnapshot>({ ...INITIAL, ...initial });
  }

  /** Merge a local patch into the snapshot. */
  private patch(patch: Partial<OverlaySnapshot>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch });
  }

  /** Periodic re-read; no-op while hidden, busy, tab-backgrounded, or within cadence. */
  pollIfVisible(): void {
    const snapshot = this.store.getSnapshot();
    if (!snapshot.visible) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (snapshot.busy) return;
    const now = Date.now();
    if (now - this.lastPollAttempt < this.getPollMs()) return;
    this.lastPollAttempt = now;
    void this.reload();
  }

  /** Apply the poll cadence the host reports (settings section edits it live). */
  setPollMinutes(minutes: number): void {
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 60) {
      this.pollMinutes = minutes;
    }
  }

  getPollMs(): number {
    return this.pollMinutes * 60 * 1000;
  }

  /** Build the face the slot registration injects. */
  inject(): OverlaySnapshotFace {
    return {
      hooks: { subscriptionOverlay: this.store },
      toggle: () => {
        const next = !this.store.getSnapshot().open;
        this.patch({ open: next });
        if (next) void this.reload().then(() => this.refreshIfStale());
      },
      close: () => this.patch({ open: false }),
      setVisible: (visible: boolean) => {
        this.patch({ visible, open: visible ? this.store.getSnapshot().open : false });
        if (visible) void this.reload();
      },
      setMode: (mode: 'pill' | 'ring') => this.patch({ mode }),
      refresh: () => {
        void this.refresh();
      },
      probe: () => {
        void this.probeCommandcode();
      },
    };
  }

  /** Read the snapshot (initial load, opening the panel). */
  async reload(): Promise<void> {
    try {
      const state = await request('/status', undefined);
      this.applyStatus(state);
    } catch (error) {
      this.patch({
        loaded: true,
        formError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Refresh when the stored snapshot is stale (called after opening the panel). */
  async refreshIfStale(): Promise<void> {
    const { refreshedAt, busy } = this.store.getSnapshot();
    if (busy) return;
    const age = refreshedAt > 0 ? Date.now() - refreshedAt : Number.POSITIVE_INFINITY;
    if (Number.isNaN(age) || age > AUTO_REFRESH_STALE_MS) await this.refresh();
  }

  /** Ask the host to re-fetch every provider snapshot. */
  async refresh(): Promise<void> {
    this.patch({ busy: true, formError: '' });
    try {
      const state = await request('/refresh', {});
      this.applyStatus(state);
    } catch (error) {
      this.patch({ formError: error instanceof Error ? error.message : String(error) });
    } finally {
      this.patch({ busy: false });
    }
  }

  /** One-shot commandcode `/models` probe (latency + model list, never a %). */
  async probeCommandcode(): Promise<void> {
    this.patch({ probing: 'commandcode' });
    try {
      await request('/probe', { platform: 'commandcode' });
      await this.reload();
    } catch (error) {
      this.patch({ formError: error instanceof Error ? error.message : String(error) });
    } finally {
      this.patch({ probing: '' });
    }
  }

  private applyStatus(state: Record<string, unknown>): void {
    const providers = Array.isArray(state['providers'])
      ? (state['providers'] as ProviderState[])
      : [];
    const overlay = (state['overlay'] as { mode?: 'pill' | 'ring' } | undefined) ?? {};
    const patch: Partial<OverlaySnapshot> = {
      loaded: true,
      refreshedAt: toEpochMs(state['refreshedAt']),
      providers,
    };
    if (typeof state['alertPct'] === 'number') patch.alertPct = state['alertPct'];
    if (typeof state['pollMinutes'] === 'number') {
      patch.pollMinutes = state['pollMinutes'];
      this.setPollMinutes(state['pollMinutes']);
    }
    if (typeof state['enabled'] === 'boolean') {
      patch.enabled = state['enabled'];
      if (!state['enabled']) {
        patch.visible = false;
        patch.open = false;
      }
    }
    if (overlay.mode === 'pill' || overlay.mode === 'ring') {
      patch.mode = overlay.mode;
      try {
        window.localStorage.setItem(MODE_KEY, overlay.mode);
      } catch {
        /* private mode: keep in-memory only */
      }
    }
    this.store.set({ ...this.store.getSnapshot(), ...patch });
  }
}

/** Same-origin JSON call against the plugin API; POSTs carry the CSRF header. */
async function request(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body !== undefined
      ? {
          headers: {
            'content-type': 'application/json',
            'x-dsh-subscription-overlay': '1',
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw new Error(`Plugin request failed (HTTP ${response.status})`);
  const data = (await response.json()) as Record<string, unknown>;
  if (body !== undefined && typeof data['statusMessage'] === 'string') {
    throw new Error(data['statusMessage']);
  }
  return data;
}

/** localStorage key for the floater shape (pill | ring). */
export const MODE_KEY = 'dsh-subscription-overlay:mode';
/** localStorage key for overlay visibility ("1" | "0"). */
export const VISIBLE_KEY = 'dsh-subscription-overlay:visible';
/** localStorage key for the user-dragged pill/ring position. */
export const POS_KEY = 'dsh-subscription-overlay:pos';
