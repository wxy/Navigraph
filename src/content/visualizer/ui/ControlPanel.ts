import type { Visualizer } from '../../types/navigation.js';
import { ViewSwitcher } from './ControlPanel/ViewSwitcher.js';
import { CalendarSessionSelector } from './ControlPanel/CalendarSessionSelector.js';
import { FilterPanel } from './ControlPanel/FilterPanel.js';

export class ControlPanel {
  private viewSwitcher: ViewSwitcher;
  private calendarSessionSelector: CalendarSessionSelector;
  private filterPanel: FilterPanel;

  constructor(private visualizer: Visualizer) {
    this.viewSwitcher = new ViewSwitcher(visualizer);
    this.calendarSessionSelector = new CalendarSessionSelector(visualizer);
    this.filterPanel = new FilterPanel(visualizer);
  }

  initialize(container: HTMLElement): void {
    const calendar = document.getElementById('graph-calendar');
    const dateToggle = document.getElementById('graph-date-toggle');
    const filters = document.getElementById('control-panel');
    const filterToggle = document.getElementById('graph-filter-toggle');
    if (!calendar || !dateToggle || !filters || !filterToggle) return;

    const setOpen = (panel: HTMLElement, trigger: HTMLElement, open: boolean) => {
      const restoreFocus = !open && panel.contains(document.activeElement);
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (restoreFocus) trigger.focus({ preventScroll: true });
    };
    const closeCalendar = () => {
      setOpen(calendar, dateToggle, false);
      this.calendarSessionSelector.hideSessionList();
    };
    const closeFilters = () => setOpen(filters, filterToggle, false);

    this.viewSwitcher.initialize();
    this.calendarSessionSelector.initialize(closeCalendar);
    this.filterPanel.initialize();

    dateToggle.addEventListener('click', () => {
      if (!calendar.hidden) {
        closeCalendar();
        return;
      }
      closeFilters();
      setOpen(calendar, dateToggle, true);
    });
    document.getElementById('graph-today')?.addEventListener('click', () => {
      closeCalendar();
      this.visualizer.switchToToday();
    });
    filterToggle.addEventListener('click', () => {
      if (!filters.hidden) {
        closeFilters();
        return;
      }
      closeCalendar();
      setOpen(filters, filterToggle, true);
      filters.querySelector('input')?.focus({ preventScroll: true });
    });

    container.addEventListener('click', closeFilters);
    document.addEventListener('click', event => {
      const target = event.target as Node;
      if (!calendar.hidden && !calendar.contains(target) && !dateToggle.contains(target)) closeCalendar();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (!calendar.hidden) closeCalendar();
        else if (!filters.hidden) closeFilters();
      }
    });
  }

  updateViewButtonsState(currentView: string): void {
    this.viewSwitcher.updateButtonsState(currentView);
  }

  updateSessionSelector(sessions: any[], currentSessionId?: string, latestSessionId?: string): void {
    if (sessions.length > 0) {
      requestAnimationFrame(() => this.calendarSessionSelector.update(sessions, currentSessionId, latestSessionId));
    } else {
      this.calendarSessionSelector.update(sessions, currentSessionId, latestSessionId);
    }
  }

  updateFilters(filters: any): void {
    this.filterPanel.updateUI(filters);
  }

  resetFilters(): void {
    this.filterPanel.resetFilters();
  }
}
