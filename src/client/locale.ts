/**
 * English-only locale strings for the overlay pill/ring + panel.
 *
 * @module dsh-subscription-overlay/client/locale
 */

const strings = {
  'pill.defaultName': 'Subscriptions',
  'pill.title.default': 'View subscription quotas (draggable)',
  'dock.title': 'Subscription quotas',
  'dock.unavailable': 'Quota unavailable',
  'dock.close': 'Close',
  'pill.title.summary': '{summary} (draggable)',
  'ring.title.focus': '{label} · {item}: {percent}% left (hover pauses carousel, draggable)',
  'panel.title': 'Subscriptions',
  'panel.normalCount': '{ok}/{total} OK',
  'panel.refresh': 'Refresh',
  'panel.refreshing': 'Refreshing…',
  'panel.empty': 'No providers to show yet — enable providers on the settings page, check login state, then refresh.',
  'panel.footer.refreshedAt': 'Refreshed at {time}',
  'panel.footer.never': 'Not refreshed yet',
  'mode.toRing': 'Switch to ring',
  'mode.toPill': 'Switch to pill',
  'status.ok': 'OK',
  'status.error': 'Failed',
  'status.disabled': 'Off',
  'status.loading': 'Loading',
  'probe.run': 'Probe',
  'probe.title': 'Probe commandcode model-service availability (online/offline only, never a quota percent)',
  'probe.running': 'Probing…',
  'probe.ok': '✓ online · {ms}ms · {n} models',
  'probe.okNoModels': '✓ online · {ms}ms',
  'probe.fail': '✗ {message}',
  'burn.title': 'This month (local ledger)',
  'burn.used': '{used} / {budget} tokens logged locally',
  'burn.usedNoBudget': '{used} tokens logged this month (no budget set — see commandcode.ai for actual usage)',
  'burn.remaining': '{remaining} tokens remaining (estimated)',
  'burn.dashboardHint': 'Real usage: commandcode.ai/settings/usage',
  'probe.state.online': 'Model service online',
  'probe.state.offline': 'Model service unavailable',
  'probe.state.unknown': 'Not probed yet',
  'item.remaining': '{n} left',
  'reset.today': 'resets today {time}',
  'reset.day': 'resets {date} {time}',
  'error.readStatus': 'Could not read the plugin state — reload the page',
  'error.requestFailed': 'Plugin request failed (HTTP {status})',
};

export type LocaleKey = keyof typeof strings;

/** Translate one key, interpolating {param} placeholders. */
export function translate(_lang: string, key: LocaleKey, params?: Record<string, string | number>): string {
  let text: string = strings[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

/** Always returns 'en' — kept for call-site compatibility. */
export function browserLang(): string {
  return 'en';
}
