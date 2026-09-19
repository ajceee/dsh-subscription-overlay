/**
 * Client entry: toggleable shell.overlay pill/ring + 4-provider panel +
 * settings.section page.
 *
 * Precedents (docs/SPIKE.md §1): dsh-quota's `shell.overlay` registration
 * (own plugin id `dsh-subscription-overlay`, composite overlay layer) and
 * dsh-plugin-subscriptions' `settings.section` registration.
 *
 * Toggle design (SPIKE §1): localStorage `visible` ("1"/"0"), `mode`
 * (pill|ring), `pos` ({x,y,w,h} JSON, clamped); hotkey Ctrl+Shift+S
 * (quota uses Ctrl+Shift+U/Y — no clash); settings section switch mirrors
 * into the same keys. Hidden = render null: unmounts pill/ring AND panel,
 * and `pollIfVisible` short-circuits when hidden.
 *
 * @module dsh-subscription-overlay/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime';
import { DISPLAY_KEY, MODE_KEY, OverlayController, POS_KEY, VISIBLE_KEY } from './controller.ts';
import { OverlaySettingsSection } from './OverlaySettingsSection.tsx';
import { DOCK_CSS, DOCK_HIDE_CSS, DOCK_HIDE_TAG_ID, DOCK_STYLE_TAG_ID, PANEL_CSS, STYLE_TAG_ID } from './styles.ts';
import { DockBadge } from './DockBadge.tsx';
import { SubscriptionPanel } from './SubscriptionPanel.tsx';

/** Required services (cordis fiber inject). */
export const inject = ['slots'];

/** Plugin id — unique per plugin; the overlay layer composites registrations. */
const PLUGIN_ID = 'dsh-subscription-overlay';

/** Hotkey toggling overlay visibility (no clash with quota's Ctrl+Shift+U/Y). */
const HOTKEY = 'Ctrl+Shift+S';

/**
 * Mount the subscription pill/ring + panel into the frame-wide overlay layer
 * and the settings section page.
 *
 * Failure policy: mounting problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin
 * must not take the GUI down.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => injectStyles(), `${PLUGIN_ID}: styles`);
  } catch (error) {
    console.error(`[${PLUGIN_ID}] style inject failed`, error);
  }

  let controller: OverlayController;
  try {
    controller = new OverlayController();
  } catch (error) {
    console.error(`[${PLUGIN_ID}] controller init failed`, error);
    return;
  }

  // Poll ticker: fires every minute; pollIfVisible enforces the
  // host-reported pollMinutes cadence and short-circuits while hidden.
  try {
    ctx.effect(() => {
      const timer = setInterval(() => {
        try {
          controller.pollIfVisible();
        } catch (error) {
          console.error(`[${PLUGIN_ID}] poll failed`, error);
        }
      }, 60_000);
      void controller.reload();
      return () => clearInterval(timer);
    }, `${PLUGIN_ID}: poll`);
  } catch (error) {
    console.error(`[${PLUGIN_ID}] poll effect failed`, error);
  }

  // Hotkey visibility toggle: writes the same localStorage key and drives
  // the same snapshot flag as the settings switch, so they never disagree.
  try {
    ctx.effect(() => {
      const onKey = (event: KeyboardEvent): void => {
        if (
          event.ctrlKey &&
          event.shiftKey &&
          !event.altKey &&
          !event.metaKey &&
          (event.key === 'S' || event.key === 's')
        ) {
          event.preventDefault();
          setVisible(controller, !controller.store.getSnapshot().visible);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => {
        window.removeEventListener('keydown', onKey);
      };
    }, `${PLUGIN_ID}: hotkey`);
  } catch (error) {
    console.error(`[${PLUGIN_ID}] hotkey effect failed`, error);
  }

  // Mirror the settings-namespace master switch into local visibility: the
  // host reports `enabled:false` on every status read and the controller
  // already hides on it; this only aligns the persisted key.
  try {
    const off = controller.store.subscribe(() => {
      const snapshot = controller.store.getSnapshot();
      try {
        window.localStorage.setItem(VISIBLE_KEY, snapshot.enabled && snapshot.visible ? '1' : '0');
      } catch {
        /* private mode */
      }
    });
    ctx.effect(() => off, `${PLUGIN_ID}: visible mirror`);
  } catch (error) {
    console.error(`[${PLUGIN_ID}] visible mirror failed`, error);
  }

  try {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: PLUGIN_ID,
          inject: () => controller.inject(),
        },
        SubscriptionPanel,
      ),
    );
  } catch (error) {
    console.error(`[${PLUGIN_ID}] overlay slot registration failed`, error);
  }

  // Composer-dock badge (order 11, adjacent to the upstream
  // `subscription-usage` pill at order 10). Session-bound inject face over
  // the same snapshot store as the floater — only the mount point differs.
  try {
    ctx.slots.inject('conversation.composer.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.composer.dock',
          id: 'dso-dock-badge',
          order: 11,
          inject: () => controller.inject(),
        },
        DockBadge,
      ),
    );
  } catch (error) {
    console.error(`[${PLUGIN_ID}] dock slot registration failed`, error);
  }

  // Upstream-pill hide rule: mounted only while our dock badge is the active
  // mount point (display dock + visible + enabled). llm-subscriptions stays
  // ENABLED so OAuth refresh keeps auth.json alive.
  try {
    const syncDockHide = (): void => {
      if (typeof document === 'undefined') return;
      try {
        const snapshot = controller.store.getSnapshot();
        const want = snapshot.display === 'dock' && snapshot.visible && snapshot.enabled;
        const selector = `style[data-plugin-css="${DOCK_HIDE_TAG_ID}"]`;
        const existing = document.querySelector(selector);
        if (want && existing === null) {
          const tag = document.createElement('style');
          tag.dataset['plugin'] = PLUGIN_ID;
          tag.dataset['pluginCss'] = DOCK_HIDE_TAG_ID;
          tag.textContent = DOCK_HIDE_CSS;
          document.head.appendChild(tag);
        } else if (!want && existing !== null) {
          existing.remove();
        }
      } catch (error) {
        console.error(`[${PLUGIN_ID}] dock-hide sync failed`, error);
      }
    };
    const offDockHide = controller.store.subscribe(() => {
      syncDockHide();
    });
    syncDockHide();
    ctx.effect(() => offDockHide, `${PLUGIN_ID}: dock-hide`);
  } catch (error) {
    console.error(`[${PLUGIN_ID}] dock-hide effect failed`, error);
  }

  try {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: PLUGIN_ID,
          order: 56,
          label: () => 'Subscription Overlay',
          inject: () => ({
            // The section reads/writes through the same-origin host API
            // (t2 owns validation + persistence); no host service needed.
            hooks: {},
            setOverlayVisible: (visible: boolean) => {
              setVisible(controller, visible);
            },
          }),
        },
        OverlaySettingsSection,
      ),
    );
  } catch (error) {
    console.error(`[${PLUGIN_ID}] settings section registration failed`, error);
  }
}

/** Persist visibility in both the snapshot store and localStorage. */
function setVisible(controller: OverlayController, visible: boolean): void {
  try {
    window.localStorage.setItem(VISIBLE_KEY, visible ? '1' : '0');
  } catch {
    /* private mode */
  }
  try {
    const face = controller.inject();
    (face['setVisible'] as (visible: boolean) => void)(visible);
  } catch (error) {
    console.error(`[${PLUGIN_ID}] setVisible failed`, error);
  }
}

/** Inject the panel stylesheet; the returned cleanup removes it on unload. */
function injectStyles(): () => void {
  const offPanel = injectStyleTag(STYLE_TAG_ID, PANEL_CSS);
  const offDock = injectStyleTag(DOCK_STYLE_TAG_ID, DOCK_CSS);
  return () => {
    offPanel();
    offDock();
  };
}

/** Inject one plugin stylesheet; the returned cleanup removes it on unload. */
function injectStyleTag(tagId: string, css: string): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) {
    return () => undefined;
  }
  const tag = document.createElement('style');
  tag.dataset['plugin'] = PLUGIN_ID;
  tag.dataset['pluginCss'] = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
  return () => tag.remove();
}

/** Re-exported for tests: persisted-preference keys and hotkey. */
export const PREF_KEYS = { MODE_KEY, POS_KEY, VISIBLE_KEY, DISPLAY_KEY, HOTKEY };
