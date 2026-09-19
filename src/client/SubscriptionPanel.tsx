/**
 * Toggleable shell.overlay pill/ring + 4-provider panel.
 *
 * Adapted from dsh-quota's QuotaPanel (SPIKE §1, `.dso-` scope): draggable
 * floater persisted (mode + position), alert badge, click toggles the panel
 * + alert color at the host threshold. Tolerant empty/error states.
 *
 * Acceptance-critical rules (SPIKE §6 amendments):
 * - commandcode now renders real quota items (5h window + weekly with
 *   reset timers, balance, plan, spend, tokens) — identical pattern to
 *   claude/codex/opencode-go. Probe line only appears after an explicit
 *   probe; "Not probed yet" placeholder removed.
 * - burn ledger remains but is supplementary below the items.
 * - Hidden toggle unmounts BOTH the pill/ring AND the panel (render null).
 *
 * @module dsh-subscription-overlay/client/SubscriptionPanel
 */
import { useEffect, useRef, useState } from 'react';
import {
  MODE_KEY,
  POS_KEY,
  VISIBLE_KEY,
  DISPLAY_KEY,
  alertCount,
  headlineItem,
  summarizeProvider,
  type OverlaySnapshot,
} from './controller.ts';
import { browserLang, translate } from './locale.ts';
import type { ProviderState, StatusItem } from './types.ts';

/** Pointer travel below this many px still counts as a click, not a drag. */
const DRAG_THRESHOLD_PX = 5;
/** Viewport margin kept around the floater while dragging/clamping. */
const POS_MARGIN = 4;
/** Ring geometry (SVG viewBox 46x46). */
const RING_R = 19.5;
const RING_C = 2 * Math.PI * RING_R;
/** Carousel dwell per provider while the ring cycles. */
const RING_CAROUSEL_MS = 4000;

interface FloaterPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Keep the floater fully inside the viewport. */
function clampPos(p: FloaterPos): FloaterPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    ...p,
    x: Math.min(Math.max(p.x, POS_MARGIN), Math.max(POS_MARGIN, vw - p.w - POS_MARGIN)),
    y: Math.min(Math.max(p.y, POS_MARGIN), Math.max(POS_MARGIN, vh - p.h - POS_MARGIN)),
  };
}

/** Read the stored floater position; missing/corrupt falls back to the default corner. */
function loadPos(): FloaterPos | null {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FloaterPos>;
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      return clampPos({ x: p.x, y: p.y, w: p.w ?? 160, h: p.h ?? 36 });
    }
  } catch {
    /* fall through */
  }
  return null;
}

function loadMode(): 'pill' | 'ring' {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'ring' ? 'ring' : 'pill';
  } catch {
    return 'pill';
  }
}

function loadVisible(): boolean {
  try {
    return window.localStorage.getItem(VISIBLE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Pill dot color from the provider status set. */
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

/** Bar fill color class from a 0-100 percent and the host alert threshold. */
function fillClass(percent: number, alertPct: number): string {
  if (percent >= alertPct) return 'dso-item-fill--danger';
  if (percent >= 60) return 'dso-item-fill--warn';
  return 'dso-item-fill--ok';
}

/** Compact reset label; tolerates ISO strings and epoch ms. */
function resetText(iso: string | number | undefined, t: (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => string): string {
  if (iso === undefined || iso === null || iso === '') return '';
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay
    ? t('reset.today', { time })
    : t('reset.day', { date: `${d.getMonth() + 1}/${d.getDate()}`, time });
}

/** Compact token count (1234567 -> "1.23M"). */
function compactTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store';
import type { OverlaySnapshotFace } from './panel-face.ts';

export type { OverlaySnapshotFace };
/** Component-side view of the inject face: hooks arrive as use<Name> selector hooks. */
export type SubscriptionPanelFace = Omit<OverlaySnapshotFace, 'hooks'> & {
  useSubscriptionOverlay: SnapshotSelectorHook<import('./controller.ts').OverlaySnapshot>;
};
export type SubscriptionPanelProps = SubscriptionPanelFace;

/** The pill + panel entry. */
export function SubscriptionPanel(props: SubscriptionPanelProps): React.JSX.Element | null {
  const state = props.useSubscriptionOverlay((snapshot) => snapshot);
  const lang = browserLang();
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>): string =>
    translate(lang, key, params);
  const busy = state.busy;
  const okCount = state.providers.filter((p) => p.status === 'ok').length;
  const totalCount = state.providers.length;

  const [mode, setModeState] = useState<'pill' | 'ring'>(() =>
    typeof window === 'undefined' ? 'pill' : (loadMode()),
  );
  // Mirror persisted prefs into the snapshot store on first mount so the
  // slot face (toggle/hotkey/settings) and local state stay consistent.
  useEffect(() => {
    props.setMode(mode);
    props.setVisible(loadVisible());
    try {
      const saved = window.localStorage.getItem(DISPLAY_KEY);
      if (saved === 'dock' || saved === 'floater') props.setDisplay(saved);
    } catch {
      /* private mode: keep snapshot default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alerts = alertCount(state);
  const toggleMode = (): void => {
    const next = mode === 'pill' ? 'ring' : 'pill';
    setModeState(next);
    props.setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private mode */
    }
  };

  // Hidden toggle unmounts BOTH the pill/ring AND the panel (acceptance).
  if (!state.visible) return null;
  // Dock mode moves the pill into the composer dock; the floater stays parked.
  if (state.display !== 'floater') return null;

  const summary = state.providers
    .filter((p) => p.status === 'ok')
    .map((p) => summarizeProvider(p))
    .filter((s) => s !== '')
    .slice(0, 2)
    .join(' · ');
  const firstOk = state.providers.find((p) => p.status === 'ok');

  const ringCandidates = state.providers.filter((p) => p.status === 'ok' && headlineItem(p) !== undefined);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [ringHover, setRingHover] = useState(false);
  useEffect(() => {
    if (mode !== 'ring' || ringHover || ringCandidates.length < 2) return;
    const timer = setInterval(() => {
      setCarouselIdx((i) => i + 1);
    }, RING_CAROUSEL_MS);
    return () => clearInterval(timer);
  }, [mode, ringHover, ringCandidates.length]);
  const ringFocus = ringCandidates[carouselIdx % Math.max(1, ringCandidates.length)];
  const ringItem = ringFocus ? headlineItem(ringFocus) : undefined;
  const ringPercent = ringItem?.percent;
  const ringRemaining = ringPercent !== undefined ? Math.max(0, Math.min(100, 100 - ringPercent)) : undefined;

  const [pos, setPos] = useState<FloaterPos | null>(() =>
    typeof window === 'undefined' ? null : loadPos(),
  );
  const [dragging, setDragging] = useState(false);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    base: FloaterPos;
    latest: FloaterPos;
    moved: boolean;
  } | null>(null);
  /** Drag end still fires a click on the pill — swallow exactly one. */
  const suppressClickRef = useRef(false);
  useEffect(() => {
    const measure = (): void => {
      const rect = pillRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos((p) =>
        p
          ? clampPos({ x: rect.left, y: rect.top, w: rect.width, h: rect.height })
          : p,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, []);
  const onPillPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const base: FloaterPos = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      base,
      latest: base,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPillPointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    setDragging(true);
    const next = clampPos({ ...d.base, x: d.base.x + dx, y: d.base.y + dy });
    d.latest = next;
    setPos(next);
  };
  const onPillPointerUp = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (d.moved) {
      suppressClickRef.current = true;
      try {
        window.localStorage.setItem(POS_KEY, JSON.stringify(d.latest));
      } catch {
        /* private mode */
      }
    }
  };

  const flip = pos !== null && pos.y < window.innerHeight / 2;
  const rootStyle: React.CSSProperties | undefined =
    pos === null
      ? undefined
      : flip
        ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', alignItems: 'flex-start' }
        : { right: window.innerWidth - pos.x - pos.w, bottom: window.innerHeight - pos.y - pos.h };
  const edge =
    pos !== null && !state.open
      ? pos.x <= 12
        ? 'l'
        : pos.x + pos.w >= window.innerWidth - 12
          ? 'r'
          : ''
      : '';
  const badge =
    alerts > 0 ? (
      <span className="dso-alert">{alerts > 99 ? '99+' : alerts}</span>
    ) : null;
  const dragHandlers = {
    onPointerDown: onPillPointerDown,
    onPointerMove: onPillPointerMove,
    onPointerUp: onPillPointerUp,
    onPointerCancel: onPillPointerUp,
    onClick: () => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      props.toggle();
    },
  };

  const pill = (
    <button
      ref={pillRef}
      type="button"
      className={`dso-pill${dragging ? ' dso-pill--dragging' : ''}${edge !== '' ? ` dso-floater--edge-${edge}` : ''}`}
      style={flip ? { order: -1 } : undefined}
      {...dragHandlers}
      title={summary !== '' ? t('pill.title.summary', { summary }) : t('pill.title.default')}
    >
      <span className={`dso-dot ${dotClass(state)}`} />
      <span className="dso-pill-name">{firstOk?.label ?? t('pill.defaultName')}</span>
      {summary !== '' && <span className="dso-pill-model">{summary}</span>}
      {badge}
    </button>
  );
  const ring = (
    <button
      ref={pillRef}
      type="button"
      className={`dso-ring${dragging ? ' dso-pill--dragging' : ''}${edge !== '' ? ` dso-floater--edge-${edge}` : ''}`}
      style={flip ? { order: -1 } : undefined}
      {...dragHandlers}
      onPointerEnter={() => {
        setRingHover(true);
      }}
      onPointerLeave={() => {
        setRingHover(false);
      }}
      title={
        ringFocus && ringItem
          ? t('ring.title.focus', {
              label: ringFocus.label,
              item: ringItem.label,
              percent: Math.round(ringRemaining ?? 0),
            })
          : t('pill.title.default')
      }
    >
      <svg viewBox="0 0 46 46" className="dso-ring-svg" aria-hidden="true">
        <circle className="dso-ring-track" cx="23" cy="23" r={RING_R} />
        {ringRemaining !== undefined && (
          <circle
            className={`dso-ring-arc ${
              ringPercent !== undefined && ringPercent >= state.alertPct
                ? 'dso-ring-arc--danger'
                : ringPercent !== undefined && ringPercent >= 60
                  ? 'dso-ring-arc--warn'
                  : 'dso-ring-arc--ok'
            }`}
            cx="23"
            cy="23"
            r={RING_R}
            transform="rotate(-90 23 23)"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - ringRemaining / 100)}
          />
        )}
      </svg>
      <span className="dso-ring-text">
        {ringRemaining !== undefined ? `${String(Math.round(ringRemaining))}%` : '—'}
      </span>
      {badge}
    </button>
  );
  const floater = mode === 'ring' ? ring : pill;

  return (
    <div className="dso-root" style={rootStyle}>
      {state.open && (
        <div className="dso-panel">
          <div className="dso-panel-head">
            <span className="dso-panel-title">{t('panel.title')}</span>
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              {totalCount > 0 ? t('panel.normalCount', { ok: okCount, total: totalCount }) : ''}
            </span>
            <button
              type="button"
              className="dso-btn dso-btn--ghost"
              title={mode === 'pill' ? t('mode.toRing') : t('mode.toPill')}
              onClick={toggleMode}
            >
              {mode === 'pill' ? '◯' : '▬'}
            </button>
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
              onClick={() => {
                props.close();
              }}
            >
              ✕
            </button>
          </div>
          <div className="dso-panel-body">
            {state.loaded && state.providers.length === 0 && (
              <div className="dso-empty">{t('panel.empty')}</div>
            )}
            {state.providers.map((p) =>
              p.id === 'commandcode' ? (
                <CommandcodeCard key={p.id} provider={p} state={state} t={t} />
              ) : (
                <ProviderCard key={p.id} provider={p} state={state} t={t} />
              ),
            )}
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
      )}
      {floater}
    </div>
  );
}

type T = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => string;

function ProviderCard({ provider, state, t }: { provider: ProviderState; state: OverlaySnapshot; t: T }): React.JSX.Element {
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
            <UsageRow key={`${item.label}-${i}`} item={item} alertPct={state.alertPct} t={t} />
          ))}
        </div>
      )}
      {provider.status === 'ok' && items.length === 0 && (
        <span className="dso-provider-msg">{t('panel.empty')}</span>
      )}
    </div>
  );
}

/**
 * CommandCode card: quota items (5h window/weekly with reset timers,
 * balance, plan, spend, tokens) plus optional probe diagnostics.
 */
function CommandcodeCard({
  provider,
  t,
  state,
}: {
  provider: ProviderState;
  state: OverlaySnapshot;
  t: T;
}): React.JSX.Element {
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
      {provider.status === 'ok' && Array.isArray(provider.items) && provider.items.length > 0 && (
        <div className="dso-items">
          {provider.items.map((item, i) => (
            <UsageRow key={`${item.label}-${i}`} item={item} alertPct={state.alertPct} t={t} />
          ))}
        </div>
      )}
      {provider.status === 'ok' && (!Array.isArray(provider.items) || provider.items.length === 0) && (
        <span className="dso-provider-msg">{t('panel.empty')}</span>
      )}
    </div>
  );
}

function UsageRow({ item, alertPct, t }: { item: StatusItem; alertPct: number; t: T }): React.JSX.Element {
  const percent =
    typeof item.percent === 'number' ? Math.max(0, Math.min(100, item.percent)) : undefined;
  const value =
    item.display ??
    (percent !== undefined
      ? `${Math.round(percent * 10) / 10}%`
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
          <span className={`dso-item-fill ${fillClass(percent, alertPct)}`} style={{ width: `${String(percent)}%` }} />
        </span>
      ) : (
        <span className="dso-item-bar" style={{ background: 'transparent' }} />
      )}
      <span className="dso-item-value">{value}</span>
      {reset !== '' && <span className="dso-item-reset">{reset}</span>}
    </div>
  );
}
