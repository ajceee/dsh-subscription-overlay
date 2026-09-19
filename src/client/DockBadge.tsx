/**
 * Composer-dock badge replacing the subscriptions pill.
 *
 * Visual mirror of upstream `SubscriptionUsageBadge` (pixel-for-pixel chrome;
 * only the data source stays ours): collapsed pill `span > button` with the
 * stats icon + compact segments, portaled onto the host `[data-composer-stats]`
 * row with an in-place fallback, and a trigger-anchored `role="dialog"`
 * listing every provider with `dl`-grid window rows, flat usage bars, and a
 * 4-window preview + `<details>` overflow. No status dot, no gradients.
 *
 * Mount rules (the registration stays mounted; the component gates):
 * renders null while the plugin is disabled/hidden or while
 * `display !== 'dock'`; renders the invisible seat alone while no provider
 * reports usable windows (same as upstream).
 *
 * @module dsh-subscription-overlay/client/DockBadge
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  IconDataOutline16,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives';
import {
  dockCompactSegment,
  dockPreviewWindows,
  dockResetParts,
  dockUsageBarColor,
  dockUsedPercent,
  dockWindowLabel,
} from './dock-labels.ts';
import { browserLang, translate } from './locale.ts';
import type { ProviderState, StatusItem } from './types.ts';
import type { SubscriptionPanelFace } from './SubscriptionPanel.tsx';

/** Distance between the trigger's top edge and the dialog's bottom. */
const PANEL_GAP = 8;
/** Distance kept between the dialog and each viewport edge. */
const PANEL_MARGIN = 12;

type T = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => string;

/** The composer-dock quota badge + dialog entry. */
export function DockBadge(props: SubscriptionPanelFace): React.JSX.Element | null {
  const state = props.useSubscriptionOverlay((snapshot) => snapshot);
  const lang = browserLang();
  const t: T = (key, params) => translate(lang, key, params);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Always-rendered, invisible marker in the dock: locates the composer bar
  // (and the host stats row inside it) even while the pill itself is portaled.
  const seatRef = useRef<HTMLSpanElement | null>(null);

  const pos = useAnchoredPosition({
    open,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  });
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open ]);

  // Sit on the host's stats row when there is one (same bounded scope and
  // watcher as upstream); older hosts without it keep the in-place row.
  const [statsRow, setStatsRow] = useState<Element | null>(null);
  useEffect(() => {
    const seat = seatRef.current;
    if (seat === null) return;
    const scope = statsScopeOf(seat);
    if (scope === null) return;
    const find = (): Element | null => scope.querySelector('[data-composer-stats]');
    setStatsRow(find());
    const observer = new MutationObserver(() => {
      setStatsRow(find());
    });
    observer.observe(scope, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, []);

  // Mount rules: plugin off/hidden or floater mode → no pill, no seat.
  if (!state.visible || !state.enabled || state.display !== 'dock') return null;
  const seat = <span ref={seatRef} style={upStyles.seat} aria-hidden="true" />;
  // The pill reads providers with usable windows only, like upstream.
  const shown = state.providers.filter(
    (p) => p.status === 'ok' && (p.items ?? []).some((i) => dockUsedPercent(i) !== undefined),
  );
  if (shown.length === 0) return seat;

  const label = shown.map((p) => dockCompactSegment(p)).join(' | ');
  const title = t('dock.title');
  const busy = state.busy;
  const toggle = (): void => {
    setOpen(!open);
  };

  const pill = (
    <span ref={rootRef} style={upStyles.anchor}>
      <button
        type="button"
        data-dso-dock="1"
        style={{ ...upStyles.pill, ...(hover || open ? upStyles.pillActive : {}) }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${title} · ${label}`}
        title={title}
        onMouseEnter={() => {
          setHover(true);
        }}
        onMouseLeave={() => {
          setHover(false);
        }}
        onClick={toggle}
      >
        <IconDataOutline16 />
        <span style={upStyles.label}>{label}</span>
      </button>
      {open &&
        createPortal(
          <div ref={panelRef} role="dialog" aria-label={title} style={{ ...upStyles.panel, ...(pos ?? MEASURE_STYLE) }}>
            <div style={upStyles.title}>
              <span style={upStyles.titleLabel}>
                <IconDataOutline16 />
                {title}
              </span>
              <button
                type="button"
                style={upStyles.refreshButton}
                disabled={busy}
                onClick={() => {
                  props.refresh();
                }}
              >
                {busy ? t('panel.refreshing') : t('panel.refresh')}
              </button>
            </div>
            <div style={upStyles.titleRule} aria-hidden="true" />
            {state.providers.map((p, index) => (
              <DockProviderSection key={p.id} provider={p} first={index === 0} t={t} />
            ))}
            {state.formError !== '' && (
              <div style={upStyles.accountRow}>
                <span style={upStyles.providerMeta}>{state.formError}</span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
  return (
    <>
      {seat}
      {statsRow !== null && statsRow.isConnected ? createPortal(pill, statsRow) : pill}
    </>
  );
}

/**
 * Nearest ancestor of the dock seat that can contain the host's stats row:
 * the composer bar. Bounded so a badge in an unfamiliar layout never adopts
 * some other composer's pills.
 */
function statsScopeOf(seat: HTMLSpanElement | null): HTMLElement | null {
  let node: HTMLElement | null = seat === null ? null : seat.parentElement;
  for (let depth = 0; node !== null && depth < 4; depth++) {
    if (node.querySelector('[data-composer-stats]') !== null) return node;
    node = node.parentElement;
  }
  return seat === null ? null : seat.parentElement;
}

/** One provider section: name row, message line, window rows with preview. */
function DockProviderSection({
  provider,
  first,
  t,
}: {
  provider: ProviderState;
  first: boolean;
  t: T;
}): React.JSX.Element {
  const items = Array.isArray(provider.items) ? provider.items : [];
  const { shown, hidden } = dockPreviewWindows(items);
  return (
    <section style={first ? undefined : upStyles.section}>
      <div style={upStyles.providerRow}>
        <span style={upStyles.providerName}>{provider.label}</span>
        {provider.status !== 'ok' && (
          <span style={upStyles.providerMeta}>{t(`status.${provider.status}`)}</span>
        )}
      </div>
      {provider.message != null && provider.message !== '' && (
        <div style={upStyles.accountRow}>
          <span style={upStyles.providerMeta} title={provider.message}>
            {provider.message}
          </span>
        </div>
      )}
      {provider.status === 'ok' && items.length > 0 && (
        <>
          <dl style={upStyles.details}>
            {shown.map((item, i) => (
              <DockWindowRow key={`${item.label}-${i}`} item={item} />
            ))}
          </dl>
          {hidden.length > 0 && (
            <details style={upStyles.moreWindows}>
              <summary style={upStyles.moreSummary}>
                {t('dock.moreWindows', { count: hidden.length })}
              </summary>
              <dl style={upStyles.details}>
                {hidden.map((item, i) => (
                  <DockWindowRow key={`${item.label}-${i}`} item={item} />
                ))}
              </dl>
            </details>
          )}
        </>
      )}
      {provider.status === 'ok' && items.length === 0 && (
        <div style={upStyles.accountRow}>
          <span style={upStyles.providerMeta}>{t('panel.empty')}</span>
        </div>
      )}
    </section>
  );
}

/** One `dt`/`dd` pair: window name → `25% · 6d1h`, with the bar underneath. */
function DockWindowRow({ item }: { item: StatusItem }): React.JSX.Element {
  // A percentage paints only when it is a real finite number — display-only
  // rows (commandcode plan/balance) render their preformatted value instead.
  const percent = dockUsedPercent(item);
  const hasReset = dockResetParts(item.resetAt) !== undefined;
  return (
    <>
      <dt style={upStyles.dt}>{item.label}</dt>
      <dd style={upStyles.dd}>
        {percent !== undefined ? (
          <>
            {percent}%{hasReset && <span style={upStyles.reset}> · {dockWindowLabel(item)}</span>}
          </>
        ) : (
          (item.display ?? '')
        )}
      </dd>
      {percent !== undefined && (
        <div style={upStyles.bar} aria-hidden="true">
          <div style={{ ...upStyles.barFill, width: `${String(percent)}%`, background: dockUsageBarColor(percent) }} />
        </div>
      )}
    </>
  );
}

/**
 * Unplaced portal panel: hidden but laid out so the clamp measures real
 * dimensions (the `useAnchoredPosition` measure pass).
 */
const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 } as const;

/**
 * Upstream-exact chrome (mirrors the host StatsPills pill and stat-dialog
 * panel): every color resolves through a `--dsw-*` design token, fills are
 * flat `usageBarColor` steps, no gradients, no custom classes.
 */
const upStyles = {
  seat: { display: 'none' },
  anchor: { minWidth: 0, maxWidth: '100%', display: 'inline-flex' },
  pill: {
    boxSizing: 'border-box',
    maxWidth: '100%',
    color: 'var(--dsw-alias-label-tertiary)',
    font: 'inherit',
    fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    whiteSpace: 'nowrap',
    background: 'transparent',
    border: 'none',
    borderRadius: 24,
    alignItems: 'center',
    gap: 6,
    padding: '1px 8px',
    display: 'inline-flex',
    cursor: 'pointer',
  },
  pillActive: {
    background: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  label: { textOverflow: 'ellipsis', minWidth: 0, overflow: 'hidden' },
  panel: {
    position: 'fixed',
    zIndex: 1100,
    boxSizing: 'border-box',
    background: 'var(--dsw-specific-menu)',
    width: 'max-content',
    minWidth: 'min(300px, 100vw - 24px)',
    maxWidth: 'min(440px, 100vw - 24px)',
    maxHeight: 'min(560px, 100dvh - 24px)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    boxShadow: 'var(--dsw-elevation-prominent)',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'default',
    border: 0,
    borderRadius: 12,
    padding: 16,
    fontSize: 12,
    lineHeight: '18px',
  },
  title: {
    color: 'var(--dsw-alias-label-primary)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8,
    fontWeight: 500,
  },
  titleLabel: { alignItems: 'center', gap: 6, minWidth: 0, display: 'inline-flex' },
  titleRule: { borderTop: '0.5px solid var(--dsw-alias-border-l2)', marginBottom: 10 },
  refreshButton: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--dsw-alias-label-secondary)',
    font: 'inherit',
    fontSize: 12,
    padding: 0,
  },
  section: { marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--dsw-alias-border-l2)' },
  providerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 16,
    marginBottom: 6,
  },
  providerName: {
    color: 'var(--dsw-alias-label-primary)',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  providerMeta: {
    color: 'var(--dsw-alias-label-tertiary)',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  accountRow: { display: 'flex', marginBottom: 4 },
  details: {
    color: 'var(--dsw-alias-label-tertiary)',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) max-content',
    gap: '4px 16px',
    margin: 0,
  },
  moreWindows: { marginTop: 8 },
  moreSummary: { cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 },
  dt: { minWidth: 0, margin: 0, overflowWrap: 'anywhere' },
  dd: {
    minWidth: 0,
    margin: 0,
    color: 'var(--dsw-alias-label-secondary)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  reset: { color: 'var(--dsw-alias-label-tertiary)' },
  bar: {
    gridColumn: '1 / -1',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    background: 'var(--dsw-alias-border-l2)',
    marginBottom: 2,
  },
  barFill: { height: '100%', borderRadius: 2 },
} as const;
