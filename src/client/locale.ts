/**
 * Bilingual copy for the overlay pill/ring + panel.
 * Browser-derived language fallback (same posture as dsh-quota).
 *
 * @module dsh-subscription-overlay/client/locale
 */

export type Lang = 'zh' | 'en';

const zh = {
  'pill.defaultName': '订阅额度',
  'pill.title.default': '查看订阅额度（可拖拽移动）',
  'pill.title.summary': '{summary}（可拖拽移动）',
  'ring.title.focus': '{label} · {item}：剩 {percent}%（悬停暂停轮播，可拖拽移动）',
  'panel.title': '订阅额度',
  'panel.normalCount': '{ok}/{total} 正常',
  'panel.refresh': '刷新',
  'panel.refreshing': '刷新中…',
  'panel.empty': '还没有可显示的供应商——请在下方设置页开启供应商，或检查登录状态后刷新。',
  'panel.footer.refreshedAt': '刷新于 {time}',
  'panel.footer.never': '尚未刷新',
  'mode.toRing': '切换为悬浮环',
  'mode.toPill': '切换为药丸',
  'status.ok': '正常',
  'status.error': '失败',
  'status.disabled': '已关闭',
  'status.loading': '加载中',
  'probe.run': '探测',
  'probe.title': '探测 commandcode 模型服务可用性（仅在线/离线，不产生额度百分比）',
  'probe.running': '探测中…',
  'probe.ok': '✓ 在线 · {ms}ms · {n} 个模型',
  'probe.okNoModels': '✓ 在线 · {ms}ms',
  'probe.fail': '✗ {message}',
  'burn.title': '本月消耗',
  'burn.used': '已用 {used} / 预算 {budget} tokens',
  'burn.usedNoBudget': '本月已用 {used} tokens（未设置月预算，仅记录）',
  'burn.remaining': '剩余 {remaining} tokens',
  'probe.state.online': '模型服务在线',
  'probe.state.offline': '模型服务不可用',
  'probe.state.unknown': '尚未探测',
  'item.remaining': '剩{n}',
  'reset.today': '今天 {time} 重置',
  'reset.day': '{date} {time} 重置',
  'error.readStatus': '无法读取插件状态，请刷新页面',
  'error.requestFailed': '插件请求失败（HTTP {status}）',
};

const en: Record<keyof typeof zh, string> = {
  'pill.defaultName': 'Subscriptions',
  'pill.title.default': 'View subscription quotas (draggable)',
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
  'burn.title': 'This month',
  'burn.used': '{used} / {budget} tokens used',
  'burn.usedNoBudget': '{used} tokens used this month (no monthly budget set, tracking only)',
  'burn.remaining': '{remaining} tokens left',
  'probe.state.online': 'Model service online',
  'probe.state.offline': 'Model service unavailable',
  'probe.state.unknown': 'Not probed yet',
  'item.remaining': '{n} left',
  'reset.today': 'resets today {time}',
  'reset.day': 'resets {date} {time}',
  'error.readStatus': 'Could not read the plugin state — reload the page',
  'error.requestFailed': 'Plugin request failed (HTTP {status})',
};

export type LocaleKey = keyof typeof zh;

/** Translate one key, interpolating {param} placeholders. */
export function translate(lang: Lang, key: LocaleKey, params?: Record<string, string | number>): string {
  const dict = lang === 'en' ? en : zh;
  let text: string = dict[key] ?? zh[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

/** Browser-derived fallback when the official locale service is absent. */
export function browserLang(): Lang {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}
