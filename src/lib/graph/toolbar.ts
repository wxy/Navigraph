import type { CalendarSessionSelector } from './CalendarSessionSelector.js';
import { _ } from '../utils/i18n.js';

export const graphDateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function formatGraphDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  if (!hours) return _('content_duration_minutes', '{0} 分钟', String(minutes));
  return minutes % 60
    ? _('calendar_duration_hours_minutes', '{0}小时 {1}分钟', String(hours), String(minutes % 60))
    : _('content_duration_hours', '{0} 小时', String(hours));
}

export function setGraphPanelOpen(panel: HTMLElement, trigger: HTMLElement, open: boolean): void {
  const restoreFocus = !open && panel.contains(document.activeElement);
  panel.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (restoreFocus) trigger.focus({ preventScroll: true });
}

export function setupGraphCalendar(selector: CalendarSessionSelector, today: () => void, onOpen: () => void): () => void {
  const panel = document.getElementById('graph-calendar')!;
  const trigger = document.getElementById('graph-date-toggle')!;
  const close = () => {
    setGraphPanelOpen(panel, trigger, false);
    selector.hideSessionList();
  };
  selector.initialize(close);
  trigger.addEventListener('click', () => {
    if (!panel.hidden) close();
    else {
      onOpen();
      setGraphPanelOpen(panel, trigger, true);
    }
  });
  document.getElementById('graph-today')!.addEventListener('click', () => {
    close();
    today();
  });
  document.addEventListener('click', event => {
    const target = event.target as Node;
    if (!panel.hidden && !panel.contains(target) && !trigger.contains(target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });
  return close;
}

export function setupGraphOptions(): void {
  document.getElementById('graph-options')!.addEventListener('click', () => {
    chrome.runtime.openOptionsPage(() => {
      const error = chrome.runtime.lastError;
      if (error) console.error('Unable to open Navigraph options', error.message);
    });
  });
}
