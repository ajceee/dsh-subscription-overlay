/**
 * `settings.section` page for the overlay (order ~56, next to Task Router).
 *
 * Controls (SPIKE §4): master overlay toggle, four provider toggles, poll
 * interval, alert %, commandcode monthly budget input, hotkey hint.
 * Reads the current config from GET /api/status and writes through
 * POST /api/settings (the t2 host owns validation + persistence; the client
 * only sends well-formed values and surfaces host errors).
 *
 * API keys never live here — credential refs only (SPIKE §4 rules).
 *
 * @module dsh-subscription-overlay/client/OverlaySettingsSection
 */
import { useEffect, useState } from 'react';
import { API_PREFIX } from './controller.ts';
import { browserLang, translate } from './locale.ts';
import type { SettingsPatch, StatusResponse } from './types.ts';

type SectionLang = ReturnType<typeof browserLang>;

const zhExtra = {
  'settings.title': '订阅额度浮层',
  'settings.desc': '控制桌面浮层与四家供应商额度面板。API Key 不在此存放——凭证走 DSH 凭证域。',
  'settings.enabled': '显示浮层',
  'settings.enabledHint': '关闭后药丸/悬浮环与面板同时卸载，且停止轮询。',
  'settings.providers': '供应商',
  'settings.provider.claude': 'Claude（5h / 7d）',
  'settings.provider.codex': 'Codex（主 / 次）',
  'settings.provider.opencodeGo': 'opencode-go（5h / 7d / 月）',
  'settings.provider.commandcode': 'commandcode（探测 + 本月消耗）',
  'settings.pollMinutes': '轮询间隔（分钟）',
  'settings.pollHint': '1–60 分钟。',
  'settings.alertPct': '告警阈值（%）',
  'settings.alertHint': '用量达到该百分比时进度条变红、药丸显示红点。',
  'settings.budget': 'commandcode 月预算（tokens）',
  'settings.budgetHint': '0 = 仅记录消耗，不显示百分比。',
  'settings.hotkey': '快捷键',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.saved': '已保存',
  'settings.loadError': '读取配置失败：{message}',
  'settings.saveError': '保存失败：{message}',
  'settings.invalidPoll': '轮询间隔须为 1–60 的整数。',
  'settings.invalidAlert': '告警阈值须为 1–100 的整数。',
  'settings.invalidBudget': '月预算须为 ≥ 0 的整数。',
};

const enExtra: Record<keyof typeof zhExtra, string> = {
  'settings.title': 'Subscription Overlay',
  'settings.desc': 'Controls the desktop floater and the 4-provider quota panel. No API keys live here — credentials stay in the DSH credentials domain.',
  'settings.enabled': 'Show overlay',
  'settings.enabledHint': 'Off unmounts the pill/ring AND the panel and stops polling.',
  'settings.providers': 'Providers',
  'settings.provider.claude': 'Claude (5h / 7d)',
  'settings.provider.codex': 'Codex (primary / secondary)',
  'settings.provider.opencodeGo': 'opencode-go (5h / 7d / monthly)',
  'settings.provider.commandcode': 'commandcode (probe + monthly burn)',
  'settings.pollMinutes': 'Poll interval (minutes)',
  'settings.pollHint': '1–60 minutes.',
  'settings.alertPct': 'Alert threshold (%)',
  'settings.alertHint': 'Bars turn red and the pill shows a badge at/above this usage.',
  'settings.budget': 'commandcode monthly budget (tokens)',
  'settings.budgetHint': '0 = track burn only, no percentage.',
  'settings.hotkey': 'Hotkey',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved',
  'settings.loadError': 'Failed to read settings: {message}',
  'settings.saveError': 'Failed to save: {message}',
  'settings.invalidPoll': 'Poll interval must be an integer 1–60.',
  'settings.invalidAlert': 'Alert threshold must be an integer 1–100.',
  'settings.invalidBudget': 'Monthly budget must be an integer ≥ 0.',
};

type ExtraKey = keyof typeof zhExtra;

function tx(lang: SectionLang, key: ExtraKey | 'loadError' | 'saveError' | 'invalidPoll' | 'invalidAlert' | 'invalidBudget', params?: Record<string, string | number>): string {
  const full = (key.startsWith('settings.') ? key : `settings.${key}`) as ExtraKey;
  const dict = lang === 'en' ? enExtra : zhExtra;
  let text: string = dict[full] ?? zhExtra[full] ?? full;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

interface SectionForm {
  enabled: boolean;
  claude: boolean;
  codex: boolean;
  opencodeGo: boolean;
  commandcode: boolean;
  pollMinutes: string;
  alertPct: string;
  budget: string;
  mode: 'pill' | 'ring';
  hotkey: string;
}

const DEFAULT_FORM: SectionForm = {
  enabled: true,
  claude: true,
  codex: true,
  opencodeGo: true,
  commandcode: true,
  pollMinutes: '5',
  alertPct: '85',
  budget: '0',
  mode: 'pill',
  hotkey: 'Ctrl+Shift+S',
};

function formFromStatus(status: StatusResponse): SectionForm {
  const raw = (status['settings'] ?? {}) as Record<string, unknown>;
  const providers = (raw['providers'] ?? {}) as Record<string, unknown>;
  const overlay = (raw['overlay'] ?? status['overlay'] ?? {}) as { mode?: 'pill' | 'ring'; hotkey?: string };
  const pick = (value: unknown, fallback: string): string =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
  return {
    enabled: typeof raw['enabled'] === 'boolean' ? raw['enabled'] : (status['enabled'] ?? true),
    claude: typeof providers['claude'] === 'boolean' ? providers['claude'] : true,
    codex: typeof providers['codex'] === 'boolean' ? providers['codex'] : true,
    opencodeGo: typeof providers['opencodeGo'] === 'boolean' ? providers['opencodeGo'] : true,
    commandcode: typeof providers['commandcode'] === 'boolean' ? providers['commandcode'] : true,
    pollMinutes: pick(raw['pollMinutes'] ?? status['pollMinutes'], '5'),
    alertPct: pick(raw['alertPct'] ?? status['alertPct'], '85'),
    budget: pick(raw['commandcodeMonthlyBudget'], '0'),
    mode: overlay.mode === 'ring' ? 'ring' : 'pill',
    hotkey: typeof overlay.hotkey === 'string' && overlay.hotkey !== '' ? overlay.hotkey : 'Ctrl+Shift+S',
  };
}

/** Mirror persisted t6 settings into the overlay's localStorage keys (no second GET). */
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
    throw new Error(translate(browserLang(), 'error.requestFailed', { status: response.status }));
  }
  const data = (await response.json()) as Record<string, unknown>;
  if (body !== undefined && typeof data['statusMessage'] === 'string') {
    throw new Error(data['statusMessage']);
  }
  return data;
}

/** Settings section body (the shell provides nav + header around it). */
export function OverlaySettingsSection(): React.JSX.Element {
  const lang = browserLang();
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
        if (live) setError(tx(lang, 'loadError', { message: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof SectionForm>(key: K, value: SectionForm[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = (): void => {
    const poll = Number(form.pollMinutes);
    const alert = Number(form.alertPct);
    const budget = Number(form.budget);
    if (!Number.isInteger(poll) || poll < 1 || poll > 60) {
      setError(tx(lang, 'invalidPoll'));
      return;
    }
    if (!Number.isInteger(alert) || alert < 1 || alert > 100) {
      setError(tx(lang, 'invalidAlert'));
      return;
    }
    if (!Number.isInteger(budget) || budget < 0) {
      setError(tx(lang, 'invalidBudget'));
      return;
    }
    const patch: SettingsPatch = {
      enabled: form.enabled,
      pollMinutes: poll,
      alertPct: alert,
      providers: {
        claude: form.claude,
        codex: form.codex,
        opencodeGo: form.opencodeGo,
        commandcode: form.commandcode,
      },
      commandcodeMonthlyBudget: budget,
      overlay: { mode: form.mode },
    };
    setSaving(true);
    setError('');
    api('/settings', patch)
      .then((result) => {
        // t6 seam responds { ok: true, settings }: mirror the persisted
        // values into localStorage without a second GET, so the overlay
        // pill/ring picks them up immediately.
        mirrorSettingsToLocal(result['settings'] as Record<string, unknown> | undefined);
        setSaved(true);
      })
      .catch((err: unknown) => {
        setError(tx(lang, 'saveError', { message: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  if (loading) {
    return (
      <div className="dso-section">
        <span className="dso-section-hint">{translate(lang, 'panel.refreshing')}</span>
      </div>
    );
  }

  return (
    <div className="dso-section">
      <span className="dso-section-hint">{tx(lang, 'settings.desc')}</span>
      <div className="dso-section-row">
        <label htmlFor="dso-settings-enabled">{tx(lang, 'settings.enabled')}</label>
        <Switch id="dso-settings-enabled" on={form.enabled} onFlip={() => set('enabled', !form.enabled)} />
      </div>
      <span className="dso-section-hint">{tx(lang, 'settings.enabledHint')}</span>
      <div className="dso-section-row">
        <span style={{ flex: 1 }}>{tx(lang, 'settings.providers')}</span>
      </div>
      <div className="dso-section-row">
        <label htmlFor="dso-settings-claude">{tx(lang, 'settings.provider.claude')}</label>
        <Switch id="dso-settings-claude" on={form.claude} onFlip={() => set('claude', !form.claude)} />
      </div>
      <div className="dso-section-row">
        <label htmlFor="dso-settings-codex">{tx(lang, 'settings.provider.codex')}</label>
        <Switch id="dso-settings-codex" on={form.codex} onFlip={() => set('codex', !form.codex)} />
      </div>
      <div className="dso-section-row">
        <label htmlFor="dso-settings-opencode">{tx(lang, 'settings.provider.opencodeGo')}</label>
        <Switch id="dso-settings-opencode" on={form.opencodeGo} onFlip={() => set('opencodeGo', !form.opencodeGo)} />
      </div>
      <div className="dso-section-row">
        <label htmlFor="dso-settings-commandcode">{tx(lang, 'settings.provider.commandcode')}</label>
        <Switch id="dso-settings-commandcode" on={form.commandcode} onFlip={() => set('commandcode', !form.commandcode)} />
      </div>
      <div className="dso-section-row">
        <label htmlFor="dso-settings-poll">{tx(lang, 'settings.pollMinutes')}</label>
        <input
          id="dso-settings-poll"
          className="dso-input"
          inputMode="numeric"
          value={form.pollMinutes}
          onChange={(e) => set('pollMinutes', e.currentTarget.value)}
        />
      </div>
      <span className="dso-section-hint">{tx(lang, 'settings.pollHint')}</span>
      <div className="dso-section-row">
        <label htmlFor="dso-settings-alert">{tx(lang, 'settings.alertPct')}</label>
        <input
          id="dso-settings-alert"
          className="dso-input"
          inputMode="numeric"
          value={form.alertPct}
          onChange={(e) => set('alertPct', e.currentTarget.value)}
        />
      </div>
      <span className="dso-section-hint">{tx(lang, 'settings.alertHint')}</span>
      <div className="dso-section-row">
        <label htmlFor="dso-settings-budget">{tx(lang, 'settings.budget')}</label>
        <input
          id="dso-settings-budget"
          className="dso-input"
          inputMode="numeric"
          value={form.budget}
          onChange={(e) => set('budget', e.currentTarget.value)}
        />
      </div>
      <span className="dso-section-hint">{tx(lang, 'settings.budgetHint')}</span>
      <div className="dso-section-row">
        <span style={{ flex: 1 }}>{tx(lang, 'settings.hotkey')}</span>
        <code>{form.hotkey}</code>
      </div>
      {error !== '' && <span className="dso-section-error">{error}</span>}
      {saved && error === '' && <span className="dso-section-ok">{tx(lang, 'settings.saved')}</span>}
      <div className="dso-section-row">
        <button type="button" className="dso-btn dso-btn--primary" disabled={saving} onClick={save}>
          {saving ? tx(lang, 'settings.saving') : tx(lang, 'settings.save')}
        </button>
      </div>
    </div>
  );
}

function Switch({ id, on, onFlip }: { id: string; on: boolean; onFlip: () => void }): React.JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      className={`dso-switch${on ? ' dso-switch--on' : ''}`}
      onClick={onFlip}
    >
      <span className="dso-switch-knob" />
    </button>
  );
}
