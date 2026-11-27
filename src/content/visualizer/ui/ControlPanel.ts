import type { Visualizer } from '../../types/navigation.js';
import { CalendarSessionSelector } from '../../../lib/graph/CalendarSessionSelector.js';
import { setGraphPanelOpen, setupGraphCalendar } from '../../../lib/graph/toolbar.js';
import { sessionServiceClient } from '../../core/session-service-client.js';
import { ViewSwitcher } from './ControlPanel/ViewSwitcher.js';
import { FilterPanel } from './ControlPanel/FilterPanel.js';

export class ControlPanel {
  private viewSwitcher: ViewSwitcher;
  private calendarSessionSelector: CalendarSessionSelector;
  private filterPanel: FilterPanel;

  constructor(private visualizer: Visualizer) {
    this.viewSwitcher = new ViewSwitcher(visualizer);
    this.calendarSessionSelector = new CalendarSessionSelector({
      get byDay() { return visualizer.currentView === 'tree'; },
      get day() { return visualizer.graphDate; },
      selectDay: day => void visualizer.selectTreeDay(day).catch(error => visualizer.showError(String(error))),
      selectSession: id => sessionServiceClient.switchSession(id),
    });
    this.filterPanel = new FilterPanel(visualizer);
  }

  initialize(container: HTMLElement): void {
    const calendar = document.getElementById('graph-calendar');
    const filters = document.getElementById('control-panel');
    const filterToggle = document.getElementById('graph-filter-toggle');
    if (!calendar || !filters || !filterToggle) return;

    const closeFilters = () => setGraphPanelOpen(filters, filterToggle, false);

    this.viewSwitcher.initialize();
    this.filterPanel.initialize();
    const closeCalendar = setupGraphCalendar(this.calendarSessionSelector, () => this.visualizer.switchToToday(), closeFilters);

    filterToggle.addEventListener('click', () => {
      if (!filters.hidden) {
        closeFilters();
        return;
      }
      closeCalendar();
      setGraphPanelOpen(filters, filterToggle, true);
      filters.querySelector('input')?.focus({ preventScroll: true });
    });

    container.addEventListener('click', closeFilters);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !filters.hidden) closeFilters();
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
