/**
 * Composer-dock badge replacing the subscriptions pill.
 *
 * Collapsed, it reads one compact segment per ok provider
 * ("Codex 6d1h 25%", see `dock-labels.ts` — upstream `compactSegment`
 * parity); clicking it opens a trigger-anchored dialog listing every
 * non-disabled provider (claude, codex, opencode-go, commandcode) with
 * progress bars and reset times. Tolerant states: errors render inline
 * with their message, display-only rows (e.g. commandcode plan) render
 * without a bar, and a fake percentage is never fabricated (percent must
 * be a finite number to paint).
 *
 * Mount rules (the registration stays mounted; the component gates):
 * renders null while the plugin is disabled/hidden, while
 * `display !== 'dock'`, or while no provider rows exist.
 *
 * @module dsh-subscription-overlay/client/DockBadge
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  alertCount,
  type OverlaySnapshot,
} from './controller.ts';
import {
  dockCompactSegment,
  dockFillClass,
  dockResetParts,
  dockUsageBarColor,
  dockUsedPercent,
  dockWindowLabel,
} from './dock-labels.ts';
import { browserLang, translate } from './locale.ts';
import type { ProviderState, StatusItem } from './types.ts';
import type { SubscriptionPanelFace } from './SubscriptionPanel.tsx';

/** Viewport margin kept around the dialog while clamping. */
const DIALOG_MARGIN = 12;
/** Gap between the pill's top edge and the dialog's bottom edge. */
const DIALOG_GAP = 8;

type T = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => string;

/** Pill status dot from the provider set (panel `dotClass` parity). */
function dotClass(state: OverlaySnapshot): string {
  if (state.providers.length === 0) return 'dso-dot--idle';
  if (state.providers.some((p) => p.status === 'ok')) {
    return state.providers.some((p) => p.status !== 'ok' && p.status !== 'disabled')
      ? 'dso-dot--warn'
      : 'dso-dot--ok';
  }
  return 'dso-dot--err';
}

function badgeClass(status: ProviderState['status']): string {
  switch (status) {
    case 'ok':
      return 'dso-badge--ok';
    case 'disabled':
      return 'dso-badge--disabled';
    case 'loading':
      return 'dso-badge--loading';
    default:
      return 'dso-badge--error';
  }
}

/** Compact reset label; tolerates ISO strings and epoch ms/s. */
function resetText(resetAt: StatusItem['resetAt'], t: T): string {
  const parsed = dockResetParts(resetAt);
  if (parsed === undefined) return '';
  const d = new Date(parsed.ms);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay
    ? t('reset.today', { time })
    : t('reset.day', { date: `${d.getMonth() + 1}/${d.getDate()}`, time });
}

/** The composer-dock quota badge + dialog entry. */
export function DockBadge(props: SubscriptionPanelFace): React.JSX.Element | null {
  const state = props.useSubscriptionOverlay((snapshot) => snapshot);
  const lang = browserLang();
  const t: T = (key, params) => translate(lang, key, params);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchorTop, setAnchorTop] = useState<number | null>(null);
  const [anchorLeft, setAnchorLeft] = useState<number | null>(null);

  // Measure the pill while the dialog is open so the panel anchors above it.
  useEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        setAnchorTop(rect.top);
        setAnchorLeft(rect.left);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [open ]);

  // Dismiss on Escape / outside pointer (upstream `useDismissOnOutsidePointer` parity).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (
        target !== null &&
        panelRef.current !== null &&
        !panelRef.current.contains(target) &&
        anchorRef.current !== null &&
        !anchorRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open ]);

  // Mount rules: plugin off/hidden, floater mode, or no rows → no pill.
  if (!state.visible || !state.enabled || state.display !== 'dock') return null;
  if (state.providers.length === 0) return null;

  const okProviders = state.providers.filter((p) => p.status === 'ok');
  const label =
    okProviders.length > 0
      ? okProviders.map((p) => dockCompactSegment(p)).join(' | ')
      : t('dock.unavailable');
  const alerts = alertCount(state);
  const busy = state.busy;
  const okCount = okProviders.length;
  const totalCount = state.providers.length;

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
  };

  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  const dialogWidth = Math.min(400, vw - DIALOG_MARGIN * 2);
  const dialogLeft = Math.max(
    DIALOG_MARGIN,
    Math.min(anchorLeft ?? vw - dialogWidth - DIALOG_MARGIN, vw - dialogWidth - DIALOG_MARGIN),
  );
  // Bottom-anchored so the panel grows upward from above the pill.
  const dialogBottom = Math.max(
    DIALOG_MARGIN,
    vh - (anchorTop ?? vh - DIALOG_MARGIN) + DIALOG_GAP,
  );

  const pill = (
    <span ref={anchorRef} className="dso-dock-anchor">
      <button
        type="button"
        data-dso-dock="1"
        className="dso-dock-pill"
        style={hover || open ? { background: 'var(--dsw-alias-interactive-bg-hover)' } : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onMouseEnter={() => {
          setHover(true);
        }}
        onMouseLeave={() => {
          setHover(false);
        }}
        onClick={toggle}
      >
        <span className={`dso-dot ${dotClass(state)}`} />
        <span className="dso-dock-label">{label}</span>
        {alerts > 0 && <span className="dso-alert">{alerts > 99 ? '99+' : alerts}</span>}
      </button>
    </span>
  );

  if (!open) return pill;

  const dialog = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('dock.title')}
      className="dso-dock-dialog"
      style={{ width: dialogWidth, left: dialogLeft, bottom: dialogBottom }}
    >
      <div className="dso-panel-head">
        <span className="dso-panel-title">{t('dock.title')}</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          {totalCount > 0 ? t('panel.normalCount', { ok: okCount, total: totalCount }) : ''}
        </span>
        <button
          type="button"
          className="dso-btn dso-btn--primary"
          disabled={busy}
          onClick={() => {
            props.refresh();
          }}
        >
          {busy ? t('panel.refreshing') : t('panel.refresh')}
        </button>
        <button
          type="button"
          className="dso-btn dso-btn--ghost"
          aria-label={t('dock.close')}
          onClick={() => {
            setOpen(false);
          }}
        >
          ✕
        </button>
      </div>
      <div className="dso-panel-body">
        {state.loaded && state.providers.length === 0 && (
          <div className="dso-empty">{t('panel.empty')}</div>
        )}
        {state.providers.map((p) => (
          <DockProviderCard key={p.id} provider={p} state={state} t={t} />
        ))}
        {state.formError !== '' && (
          <div className="dso-provider-msg" style={{ color: '#e74c3c' }}>
            {state.formError}
          </div>
        )}
      </div>
      <div className="dso-foot">
        {state.refreshedAt > 0
          ? t('panel.footer.refreshedAt', {
              time: new Date(state.refreshedAt).toLocaleString('en-US'),
            })
          : t('panel.footer.never')}
      </div>
    </div>
  );

  return (
    <>
      {pill}
      {typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)}
    </>
  );
}

function DockProviderCard({
  provider,
  state,
  t,
}: {
  provider: ProviderState;
  state: OverlaySnapshot;
  t: T;
}): React.JSX.Element {
  const items = Array.isArray(provider.items) ? provider.items : [];
  return (
    <div className="dso-provider">
      <div className="dso-provider-head">
        <span className="dso-provider-name">{provider.label}</span>
        <span className={`dso-badge ${badgeClass(provider.status)}`}>
          {t(`status.${provider.status}`)}
        </span>
      </div>
      {provider.message != null && provider.message !== '' && (
        <span className="dso-provider-msg">{provider.message}</span>
      )}
      {provider.status === 'ok' && items.length > 0 && (
        <div className="dso-items">
          {items.map((item, i) => (
            <DockUsageRow key={`${item.label}-${i}`} item={item} alertPct={state.alertPct} t={t} />
          ))}
        </div>
      )}
      {provider.status === 'ok' && items.length === 0 && (
        <span className="dso-provider-msg">{t('panel.empty')}</span>
      )}
    </div>
  );
}

function DockUsageRow({
  item,
  alertPct,
  t,
}: {
  item: StatusItem;
  alertPct: number;
  t: T;
}): React.JSX.Element {
  // A percentage paints only when it is a real finite number — display-only
  // rows (commandcode plan/balance) render their preformatted value instead.
  const percent = dockUsedPercent(item);
  const value =
    item.display ??
    (percent !== undefined
      ? `${percent}%`
      : item.remaining !== undefined
        ? t('item.remaining', { n: item.remaining })
        : '');
  const reset = resetText(item.resetAt, t);
  return (
    <div className="dso-item">
      <span className="dso-item-label" title={item.label}>
        {item.label}
      </span>
      {percent !== undefined ? (
        <span className="dso-item-bar">
          <span
            className={`dso-item-fill ${dockFillClass(percent, alertPct)}`}
            style={{ width: `${String(percent)}%`, background: dockUsageBarColor(percent) }}
          />
        </span>
      ) : (
        <span className="dso-item-bar" style={{ background: 'transparent' }} />
      )}
      <span className="dso-item-value">
        {percent !== undefined ? `${dockWindowLabel(item)} ${value}` : value}
      </span>
      {reset !== '' && <span className="dso-item-reset">{reset}</span>}
    </div>
  );
}
