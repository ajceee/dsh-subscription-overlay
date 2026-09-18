/**
 * `settings.section` page for the overlay.
 *
 * Grouped layout: General / Appearance / Refresh / Alerts / Providers.
 * Provider rows render from the host `providerCatalog` (/status), so new
 * llm-pi-ai providers appear automatically (marked unsupported until a
 * bespoke quota fetcher exists). Poll interval, alert threshold and overlay
 * mode are dropdowns; the hotkey is display-only.
 * Reads the current config from GET /api/status and writes through
 * POST /api/settings (the host owns validation + persistence; the client
 * only sends well-formed values and surfaces host errors).
 *
 * API keys never live here — credential refs only.
 *
 * @module dsh-subscription-overlay/client/OverlaySettingsSection
 */
import { useEffect, useState } from 'react';
import { API_PREFIX } from './controller.ts';
import type { SettingsPatch, StatusResponse } from './types.ts';

const S = {
  'settings.title': 'Subscription Overlay',
  'settings.desc': 'Controls the desktop floater and the quota panel. New providers you configure under llm-pi-ai appear below automatically; quota bars need a dedicated fetcher per vendor.',
  'settings.general': 'General',
  'settings.enabled': 'Show overlay',
  'settings.enabledHint': 'Off unmounts the pill/ring and the panel and stops background refreshes.',
  'settings.appearance': 'Appearance',
  'settings.mode': 'Floater style',
  'settings.modeHint': 'Pill shows provider names; ring shows remaining quota as a circle.',
  'settings.mode.pill': 'Pill',
  'settings.mode.ring': 'Ring',
  'settings.hotkey': 'Toggle hotkey',
  'settings.hotkeyHint': 'Press anywhere to show or hide the overlay.',
  'settings.refresh': 'Auto-refresh',
  'settings.pollMinutes': 'Check quotas every',
  'settings.pollHint': 'Manual Refresh in the panel always fetches immediately.',
  'settings.poll.1': 'Every minute',
  'settings.poll.2': 'Every 2 minutes',
  'settings.poll.5': 'Every 5 minutes',
  'settings.poll.10': 'Every 10 minutes',
  'settings.poll.15': 'Every 15 minutes',
  'settings.poll.30': 'Every 30 minutes',
  'settings.poll.60': 'Every hour',
  'settings.alerts': 'Alerts',
  'settings.alertPct': 'Warn me at',
  'settings.alertHint': 'Bars turn red and the floater shows a badge once usage reaches this level.',
  'settings.alertSuffix': 'used',
  'settings.providers': 'Providers',
  'settings.providersHint': 'Switch a provider off to hide it from the panel.',
  'settings.unsupported': 'Quota not supported yet',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved',
  'settings.loadError': 'Failed to read settings: {message}',
  'settings.saveError': 'Failed to save: {message}',
} as const;

type ExtraKey = keyof typeof S;

function tx(key: ExtraKey, params?: Record<string, string | number>): string {
  let text: string = S[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

interface CatalogEntry {
  key: string;
  label: string;
  detail: string;
  supported: boolean;
}

interface SectionForm {
  enabled: boolean;
  providers: Record<string, boolean>;
  catalog: CatalogEntry[];
  pollMinutes: string;
  alertPct: string;
  mode: 'pill' | 'ring';
  hotkey: string;
}

const DEFAULT_FORM: SectionForm = {
  enabled: true,
  providers: { claude: true, codex: true, opencodeGo: true, commandcode: true },
  catalog: [],
  pollMinutes: '5',
  alertPct: '85',
  mode: 'pill',
  hotkey: 'Ctrl+Shift+S',
};

const POLL_OPTIONS = ['1', '2', '5', '10', '15', '30', '60'];
const ALERT_OPTIONS = ['50', '60', '70', '80', '85', '90', '95'];

function formFromStatus(status: StatusResponse): SectionForm {
  const raw = (status['settings'] ?? {}) as Record<string, unknown>;
  const saved = (raw['providers'] ?? {}) as Record<string, unknown>;
  const overlay = (raw['overlay'] ?? status['overlay'] ?? {}) as { mode?: 'pill' | 'ring'; hotkey?: string };
  const catalogRaw = status['providerCatalog'];
  const catalog: CatalogEntry[] = Array.isArray(catalogRaw)
    ? (catalogRaw as Record<string, unknown>[]).map((e) => ({
        key: typeof e['key'] === 'string' ? e['key'] : '',
        label: typeof e['label'] === 'string' ? e['label'] : String(e['key'] ?? ''),
        detail: typeof e['detail'] === 'string' ? e['detail'] : '',
        supported: e['supported'] === true,
      })).filter((e) => e.key !== '')
    : [];
  const providers: Record<string, boolean> = {};
  for (const e of catalog) {
    const v = saved[e.key];
    providers[e.key] = typeof v === 'boolean' ? v : true;
  }
  // Back-compat: keep known keys even if the catalog is missing (cold host).
  for (const k of ['claude', 'codex', 'opencodeGo', 'commandcode']) {
    if (!(k in providers)) {
      const v = saved[k];
      providers[k] = typeof v === 'boolean' ? v : true;
    }
  }
  const pick = (value: unknown, options: string[], fallback: string): string => {
    const s = typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
    return options.includes(s) ? s : fallback;
  };
  return {
    enabled: typeof raw['enabled'] === 'boolean' ? raw['enabled'] : (status['enabled'] ?? true),
    providers,
    catalog,
    pollMinutes: pick(raw['pollMinutes'] ?? status['pollMinutes'], POLL_OPTIONS, '5'),
    alertPct: pick(raw['alertPct'] ?? status['alertPct'], ALERT_OPTIONS, '85'),
    mode: overlay.mode === 'ring' ? 'ring' : 'pill',
    hotkey: typeof overlay.hotkey === 'string' && overlay.hotkey !== '' ? overlay.hotkey : 'Ctrl+Shift+S',
  };
}

/** Mirror persisted settings into the overlay's localStorage keys (no second GET). */
function mirrorSettingsToLocal(settings: Record<string, unknown> | undefined): void {
  if (!settings) return;
  try {
    if (typeof settings['enabled'] === 'boolean') {
      window.localStorage.setItem('dsh-subscription-overlay:visible', settings['enabled'] ? '1' : '0');
    }
    const overlay = settings['overlay'] as { mode?: unknown } | undefined;
    if (overlay?.mode === 'pill' || overlay?.mode === 'ring') {
      window.localStorage.setItem('dsh-subscription-overlay:mode', overlay.mode);
    }
  } catch {
    /* private mode: keep in-memory only */
  }
}

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
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
  if (!response.ok) {
    throw new Error('Plugin request failed');
  }
  const data = (await response.json()) as Record<string, unknown>;
  if (body !== undefined && typeof data['statusMessage'] === 'string') {
    throw new Error(data['statusMessage']);
  }
  return data;
}

/** Settings section body (the shell provides nav + header around it). */
export function OverlaySettingsSection(): React.JSX.Element {
  const [form, setForm] = useState<SectionForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    api('/status')
      .then((status) => {
        if (live) setForm(formFromStatus(status as StatusResponse));
      })
      .catch((err: unknown) => {
        if (live) setError(tx('loadError', { message: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setProvider = (key: string, value: boolean): void => {
    setForm((prev) => ({ ...prev, providers: { ...prev.providers, [key]: value } }));
    setSaved(false);
  };

  const set = <K extends keyof SectionForm>(key: K, value: SectionForm[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = (): void => {
    const patch: SettingsPatch = {
      enabled: form.enabled,
      pollMinutes: Number(form.pollMinutes),
      alertPct: Number(form.alertPct),
      providers: {
        claude: form.providers['claude'] ?? true,
        codex: form.providers['codex'] ?? true,
        opencodeGo: form.providers['opencodeGo'] ?? true,
        commandcode: form.providers['commandcode'] ?? true,
      },
      overlay: { mode: form.mode },
    };
    setSaving(true);
    setError('');
    api('/settings', patch)
      .then((result) => {
        // Mirror the persisted values into localStorage without a second
        // GET, so the overlay pill/ring picks them up immediately.
        mirrorSettingsToLocal(result['settings'] as Record<string, unknown> | undefined);
        setSaved(true);
      })
      .catch((err: unknown) => {
        setError(tx('saveError', { message: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  if (loading) {
    return (
      <div className="dso-section">
        <span className="dso-section-hint">{'Refreshing…'}</span>
      </div>
    );
  }

  const rows = form.catalog.length > 0
    ? form.catalog
    : ['claude', 'codex', 'opencodeGo', 'commandcode'].map((key) => ({
        key,
        label: key,
        detail: '',
        supported: true,
      }));

  return (
    <div className="dso-section">
      <span className="dso-section-hint">{tx('settings.desc')}</span>

      <div className="dso-section-group">
        <span className="dso-section-group-title">{tx('settings.general')}</span>
        <div className="dso-section-row">
          <label htmlFor="dso-settings-enabled">{tx('settings.enabled')}</label>
          <Switch id="dso-settings-enabled" on={form.enabled} onFlip={() => set('enabled', !form.enabled)} />
        </div>
        <span className="dso-section-hint">{tx('settings.enabledHint')}</span>
      </div>

      <div className="dso-section-group">
        <span className="dso-section-group-title">{tx('settings.appearance')}</span>
        <div className="dso-section-row">
          <label htmlFor="dso-settings-mode">{tx('settings.mode')}</label>
          <select
            id="dso-settings-mode"
            className="dso-select"
            value={form.mode}
            onChange={(e) => set('mode', e.currentTarget.value === 'ring' ? 'ring' : 'pill')}
          >
            <option value="pill">{tx('settings.mode.pill')}</option>
            <option value="ring">{tx('settings.mode.ring')}</option>
          </select>
        </div>
        <span className="dso-section-hint">{tx('settings.modeHint')}</span>
        <div className="dso-section-row">
          <span style={{ flex: 1 }}>{tx('settings.hotkey')}</span>
          <code>{form.hotkey}</code>
        </div>
        <span className="dso-section-hint">{tx('settings.hotkeyHint')}</span>
      </div>

      <div className="dso-section-group">
        <span className="dso-section-group-title">{tx('settings.refresh')}</span>
        <div className="dso-section-row">
          <label htmlFor="dso-settings-poll">{tx('settings.pollMinutes')}</label>
          <select
            id="dso-settings-poll"
            className="dso-select"
            value={form.pollMinutes}
            onChange={(e) => set('pollMinutes', e.currentTarget.value)}
          >
            {POLL_OPTIONS.map((v) => (
              <option key={v} value={v}>{tx(`settings.poll.${v}` as ExtraKey)}</option>
            ))}
          </select>
        </div>
        <span className="dso-section-hint">{tx('settings.pollHint')}</span>
      </div>

      <div className="dso-section-group">
        <span className="dso-section-group-title">{tx('settings.alerts')}</span>
        <div className="dso-section-row">
          <label htmlFor="dso-settings-alert">{tx('settings.alertPct')}</label>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <select
              id="dso-settings-alert"
              className="dso-select"
              value={form.alertPct}
              onChange={(e) => set('alertPct', e.currentTarget.value)}
            >
              {ALERT_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}%</option>
              ))}
            </select>
            <span className="dso-section-hint">{tx('settings.alertSuffix')}</span>
          </span>
        </div>
        <span className="dso-section-hint">{tx('settings.alertHint')}</span>
      </div>

      <div className="dso-section-group">
        <span className="dso-section-group-title">{tx('settings.providers')}</span>
        <span className="dso-section-hint">{tx('settings.providersHint')}</span>
        {rows.map((entry) => (
          <div className="dso-section-row" key={entry.key}>
            <span style={{ flex: 1 }}>
              <span>{entry.label}</span>
              {entry.detail !== '' && (
                <span className="dso-section-note">{entry.supported ? ` · ${entry.detail}` : ` · ${tx('settings.unsupported')}`}</span>
              )}
              {!entry.supported && entry.detail === '' && (
                <span className="dso-section-note">{` · ${tx('settings.unsupported')}`}</span>
              )}
            </span>
            <Switch
              id={`dso-settings-provider-${entry.key}`}
              on={entry.supported ? (form.providers[entry.key] ?? true) : false}
              onFlip={() => {
                if (entry.supported) setProvider(entry.key, !(form.providers[entry.key] ?? true));
              }}
              disabled={!entry.supported}
            />
          </div>
        ))}
      </div>

      {error !== '' && <span className="dso-section-error">{error}</span>}
      {saved && error === '' && <span className="dso-section-ok">{tx('settings.saved')}</span>}
      <div className="dso-section-row dso-section-foot">
        <button type="button" className="dso-btn dso-btn--primary" disabled={saving} onClick={save}>
          {saving ? tx('settings.saving') : tx('settings.save')}
        </button>
      </div>
    </div>
  );
}

function Switch({ id, on, onFlip, disabled }: { id: string; on: boolean; onFlip: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled === true}
      className={`dso-switch${on ? ' dso-switch--on' : ''}`}
      onClick={onFlip}
    >
      <span className="dso-switch-knob" />
    </button>
  );
}
