import { localDayRange } from './tree-day.js';

export const GRAPH_PAGE = 'content/index.html';
export const OCEAN_PAGE = 'ocean/index.html';

export function readHistoryDay(params: URLSearchParams): number | undefined {
  const value = params.get('day');
  if (!value?.trim()) return undefined;
  const [start, end] = localDayRange(Number(value));
  return Number.isFinite(end) ? start : undefined;
}

export function graphViewUrl(view: 'tree' | 'waterfall' | 'ocean', day?: number, sessionId?: string): URL {
  const url = new URL(chrome.runtime.getURL(view === 'ocean' ? OCEAN_PAGE : GRAPH_PAGE));
  if (view !== 'ocean') url.searchParams.set('view', view);
  if (day !== undefined) url.searchParams.set('day', String(day));
  if (sessionId) url.searchParams.set('session', sessionId);
  return url;
}

export function replaceHistorySelection(day: number, sessionId?: string): void {
  const url = new URL(location.href);
  url.searchParams.set('day', String(day));
  if (sessionId) url.searchParams.set('session', sessionId);
  else url.searchParams.delete('session');
  history.replaceState(history.state, '', url);
}
