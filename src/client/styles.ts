/**
 * Stylesheet for the subscription pill/ring + panel. Consumes the shell's
 * alias tokens with local fallbacks, scoped under .dso- to avoid collisions
 * (quota uses .dq-).
 *
 * @module dsh-subscription-overlay/client/styles
 */

export const STYLE_TAG_ID = 'dsh-subscription-overlay/panel';

export const PANEL_CSS = `
.dso-root { position: fixed; right: 16px; bottom: 16px; z-index: 9999; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-family: inherit; }
.dso-pill {
  display: inline-flex; align-items: center; gap: 8px; cursor: grab; user-select: none;
  touch-action: none;
  padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
  background: var(--dsw-alias-bg-layer-2, rgba(20, 20, 28, 0.92)); color: var(--dsw-alias-label-primary, #eee);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  transition: transform 0.12s ease, border-color 0.12s ease;
}
.dso-pill:hover { transform: translateY(-1px); border-color: var(--dsw-alias-brand-primary, #5b6cff); }
.dso-pill--dragging { cursor: grabbing; transition: none; }
.dso-pill--dragging:hover { transform: none; }
.dso-pill .dso-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dso-dot--ok { background: #3ddc84; box-shadow: 0 0 6px rgba(61, 220, 132, 0.7); }
.dso-dot--warn { background: #f5a623; box-shadow: 0 0 6px rgba(245, 166, 35, 0.7); }
.dso-dot--err { background: #e74c3c; box-shadow: 0 0 6px rgba(231, 76, 60, 0.7); }
.dso-dot--idle { background: #888; }
.dso-pill .dso-pill-name { max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dso-pill { position: relative; }

/* Alert badge: error providers + over-threshold rows. */
.dso-alert {
  position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px;
  padding: 0 4px; border-radius: 999px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  background: #e74c3c; color: #fff; font-size: 10px; font-weight: 700; line-height: 1;
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-2, rgba(20, 20, 28, 0.92));
  animation: dso-alert-pulse 2s ease-in-out infinite; pointer-events: none;
}
@keyframes dso-alert-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}

/* HUD ring: SVG circular progress (remaining quota), center = remaining %. */
.dso-ring {
  position: relative; width: 52px; height: 52px; padding: 0; cursor: grab; user-select: none;
  touch-action: none; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35));
  background: var(--dsw-alias-bg-layer-2, rgba(20, 20, 28, 0.92));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  display: inline-flex; align-items: center; justify-content: center;
  transition: transform 0.12s ease, border-color 0.12s ease, opacity 0.2s ease;
}
.dso-ring:hover { transform: translateY(-1px); border-color: var(--dsw-alias-brand-primary, #5b6cff); }
.dso-ring-svg { width: 46px; height: 46px; display: block; }
.dso-ring-track { fill: none; stroke: rgba(128, 128, 128, 0.25); stroke-width: 4.5; }
.dso-ring-arc {
  fill: none; stroke-width: 4.5; stroke-linecap: round;
  transition: stroke-dashoffset 0.6s ease, stroke 0.3s ease;
}
.dso-ring-arc--ok { stroke: #3ddc84; }
.dso-ring-arc--warn { stroke: #f5a623; }
.dso-ring-arc--danger { stroke: #e74c3c; }
.dso-ring-text {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #eee); pointer-events: none;
  transition: opacity 0.3s ease;
}

/* Edge hugging: half-fade when dragged to a side edge, restore on hover. */
.dso-floater--edge-l { transform: translateX(-55%); opacity: 0.45; }
.dso-floater--edge-r { transform: translateX(55%); opacity: 0.45; }
.dso-floater--edge-l:hover, .dso-floater--edge-r:hover { transform: translateX(0); opacity: 1; }
.dso-pill .dso-pill-model {
  font-size: 11px; font-weight: 600; max-width: 210px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 1px 8px; border-radius: 999px;
  background: rgba(91, 108, 255, 0.14); color: var(--dsw-alias-brand-primary, #5b6cff);
}

.dso-panel {
  width: 340px; max-height: min(64vh, 600px); overflow-y: auto; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2, rgba(22, 22, 30, 0.97)); color: var(--dsw-alias-label-primary, #eee);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  display: flex; flex-direction: column;
}
.dso-panel-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2)); position: sticky; top: 0; background: inherit; border-radius: 14px 14px 0 0; }
.dso-panel-title { font-weight: 600; font-size: 14px; flex: 1; }
.dso-btn {
  padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 500; border: none; cursor: pointer;
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.15)); color: var(--dsw-alias-label-primary, #eee);
}
.dso-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.25)); }
.dso-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.dso-btn--primary { background: var(--dsw-static-blue-500, #3b82f6); color: #fff; }
.dso-btn--primary:hover:not(:disabled) { background: var(--dsw-static-blue-600, #2563eb); }
.dso-btn--ghost { background: transparent; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3)); }
.dso-btn--ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1)); }

.dso-panel-body { padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.dso-provider { border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22)); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.dso-provider-head { display: flex; align-items: center; gap: 8px; }
.dso-provider-name { font-weight: 600; font-size: 13px; flex: 1; }
.dso-badge { padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.dso-badge--ok { background: rgba(61, 220, 132, 0.16); color: #3ddc84; }
.dso-badge--error { background: rgba(231, 76, 60, 0.14); color: #e74c3c; }
.dso-badge--disabled { background: rgba(128, 128, 128, 0.16); color: #999; }
.dso-badge--loading { background: rgba(91, 108, 255, 0.14); color: #5b6cff; }
.dso-probe { padding: 2px 8px; font-size: 11px; flex: none; }
.dso-probe-line { font-size: 11px; font-variant-numeric: tabular-nums; word-break: break-all; color: var(--dsw-alias-label-secondary, #999); }
.dso-probe-line--err { color: #e74c3c; }
.dso-provider-msg { font-size: 11px; color: var(--dsw-alias-label-secondary, #999); word-break: break-all; }
.dso-items { display: flex; flex-direction: column; gap: 5px; }
.dso-item { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.dso-item-label { width: 96px; flex: none; color: var(--dsw-alias-label-secondary, #999); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dso-item-bar { flex: 1; min-width: 40px; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(128, 128, 128, 0.22); }
/* display: block is required — the fill is an empty <span>, so as an inline
   box it collapses to zero width/height and the bar never paints. */
.dso-item-fill { display: block; height: 100%; border-radius: 3px; transition: width 0.3s ease; }
.dso-item-fill--ok { background: linear-gradient(90deg, #3ddc84, #00b4d8); }
.dso-item-fill--warn { background: linear-gradient(90deg, #f5a623, #f7ce46); }
.dso-item-fill--danger { background: linear-gradient(90deg, #e74c3c, #ff7b54); }
.dso-item-value { flex: none; text-align: right; color: var(--dsw-alias-label-secondary, #999); font-variant-numeric: tabular-nums; font-size: 11px; }
.dso-item-reset { width: 100%; font-size: 10px; color: var(--dsw-alias-label-tertiary, #777); text-align: right; margin-top: -3px; }

.dso-burn { display: flex; flex-direction: column; gap: 5px; border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.25)); padding-top: 6px; }
.dso-burn-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #999); }
.dso-empty { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #999); padding: 8px 4px; }
.dso-foot { font-size: 11px; color: var(--dsw-alias-label-tertiary, #777); text-align: center; padding: 2px 0 4px; }

/* Settings section extras. */
.dso-section { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }
.dso-section-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dso-section-row label { flex: 1; }
.dso-section-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary, #777); }
.dso-section-error { font-size: 12px; color: #e74c3c; }
.dso-section-ok { font-size: 12px; color: #3ddc84; }
.dso-input {
  width: 90px; padding: 6px 8px; border-radius: 8px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary, inherit); outline: none;
}
.dso-input:focus { border-color: var(--dsw-alias-brand-primary, #5b6cff); }
.dso-switch { position: relative; width: 36px; height: 20px; flex: none; padding: 0; border: none; border-radius: 999px; cursor: pointer; background: rgba(128, 128, 128, 0.35); transition: background 0.15s ease; }
.dso-switch--on { background: var(--dsw-static-blue-500, #3b82f6); }
.dso-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.15s ease; }
.dso-switch--on .dso-switch-knob { left: 18px; }
.dso-switch:disabled { opacity: 0.45; cursor: not-allowed; }
.dso-section-group { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22)); border-radius: 10px; }
.dso-section-group-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary, #999); }
.dso-section-note { font-size: 11px; color: var(--dsw-alias-label-tertiary, #777); }
.dso-section-foot { justify-content: flex-end; margin-top: 2px; }
.dso-select {
  padding: 6px 8px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-2, rgba(20, 20, 28, 0.92)); color: var(--dsw-alias-label-primary, #eee); outline: none;
}
.dso-select:focus { border-color: var(--dsw-alias-brand-primary, #5b6cff); }
.dso-select option { background: var(--dsw-alias-bg-layer-2, #1a1a24); color: var(--dsw-alias-label-primary, #eee); }
`;

export const DOCK_STYLE_TAG_ID = 'dsh-subscription-overlay/dock';

export const DOCK_HIDE_TAG_ID = 'dsh-subscription-overlay/dock-hide';

/** Dock pill + dialog chrome. Mirrors the host stats-pill look; all --dsw-* tokens. */
export const DOCK_CSS = `
.dso-dock-anchor { display: inline-flex; min-width: 0; max-width: 100%; }
.dso-dock-pill {
  position: relative;
  box-sizing: border-box; max-width: 100%;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 1px 8px; border: none; border-radius: 24px; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: var(--dsh-content-font-size-secondary, 13px);
  font-variant-numeric: tabular-nums; line-height: 20px; white-space: nowrap;
}
.dso-dock-pill:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dso-dock-pill .dso-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dso-dock-label { text-overflow: ellipsis; min-width: 0; overflow: hidden; }
.dso-dock-dialog {
  position: fixed; z-index: 1100; box-sizing: border-box;
  display: flex; flex-direction: column;
  background: var(--dsw-specific-menu);
  min-width: min(300px, 100vw - 24px); max-width: min(440px, 100vw - 24px);
  max-height: min(560px, 100dvh - 24px); overflow-y: auto; overscroll-behavior: contain;
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-secondary);
  border: 0; border-radius: 12px; font-size: 12px; line-height: 18px;
}
`;

/**
 * Hides ONLY the upstream `subscription-usage` pill while our dock badge is
 * active. The upstream pill is an inline-styled `<button>` (no stable class),
 * so both selectors fingerprint its mount structure instead of matching bare
 * dialog buttons (a bare `button[aria-haspopup="dialog"]` selector also kills
 * the host context + cache pills — never re-add one):
 *
 * - Portaled case (host stats row exists): the badge anchors its pill in a
 *   plain inline-flex `<span>` portaled directly under `[data-composer-stats]`
 *   (`SubscriptionUsageBadge.js`: `createPortal(pill, statsRow)`, anchor
 *   `styles.anchor = { minWidth: 0, maxWidth: '100%', display: 'inline-flex' }`).
 * - In-place case (no stats row): the badge renders an invisible seat
 *   (`<span aria-hidden="true" style="display:none">`) immediately followed by
 *   the pill anchor span, both under the dock outlet.
 *
 * Both selectors exclude our own pill via `:not([data-dso-dock])`, and this
 * tag is only mounted while `display === 'dock'` (managed in
 * `src/client/index.ts`), so disabling dock mode restores the upstream pill.
 * Safe-failure direction is under-hide: if neither fingerprint matches (new
 * host markup), the upstream pill reappears instead of hiding something else.
 * llm-subscriptions itself stays ENABLED so OAuth refresh keeps auth.json alive.
 *
 * TODO(live-DOM): confirm against the real composer DOM (unreachable headless:
 * boot needs DSH_VAULT_PASSWORD, :3081 is token-fenced). If the shell stamps
 * per-entry ids (e.g. `[data-slot-item="subscription-usage"]`), prefer that.
 */
export const DOCK_HIDE_CSS = `
[data-composer-stats] > span[style*="inline-flex"] > button[aria-haspopup="dialog"][aria-label]:not([data-dso-dock]) {
  display: none !important;
}
[data-slot="conversation.composer.dock"] span[aria-hidden="true"] + span > button[aria-haspopup="dialog"]:not([data-dso-dock]) {
  display: none !important;
}
`;
