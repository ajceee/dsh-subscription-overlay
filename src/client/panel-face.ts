/**
 * Registration-side inject face for the subscription panel.
 *
 * The `hooks` compartment carries the HostObservable snapshot store, so the
 * shell synthesizes the `useSubscriptionOverlay` selector hook for the
 * component (same convention as dsh-quota's `quotaPanel` → `useQuotaPanel`).
 *
 * @module dsh-subscription-overlay/client/panel-face
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { OverlaySnapshot } from './controller.ts';

/** What `OverlayController.inject()` returns (and the slot entry provides). */
export interface OverlaySnapshotFace {
  hooks: {
    subscriptionOverlay: SnapshotStore<OverlaySnapshot>;
  };
  toggle: () => void;
  close: () => void;
  setVisible: (visible: boolean) => void;
  setMode: (mode: 'pill' | 'ring') => void;
  refresh: () => void;
  probe: () => void;
}
