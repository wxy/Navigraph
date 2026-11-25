import { _ } from '../../../lib/utils/i18n.js';
import type { Visualizer } from '../../types/navigation.js';

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export class GraphToolbar {
  constructor(private visualizer: Visualizer) {}

  initialize(): void {
    document.getElementById('graph-show-hidden')?.addEventListener('click', () => this.visualizer.toggleHiddenNodes());
  }

  update(): void {
    const { visualizer } = this;
    const tree = visualizer.currentView === 'tree';
    const day = tree ? visualizer.treeDay : null;
    const session = tree ? undefined : visualizer.currentSession;
    const start = day?.start ?? session?.startTime;

    const graphCounts = visualizer.graphCounts;
    const count = graphCounts?.matched ?? (tree ? day?.nodes.length ?? 0 : visualizer.nodes.length);
    const hiddenCount = Math.max(0, (graphCounts?.total ?? count) - count);
    const countLabel = document.getElementById('graph-record-count');
    if (countLabel) countLabel.textContent = _('waterfall_record_count', '{0} 条记录', count.toLocaleString());

    const hidden = document.querySelector<HTMLButtonElement>('#graph-show-hidden');
    if (hidden) {
      hidden.disabled = hiddenCount === 0 && !visualizer.canRestoreFilters;
      hidden.textContent = visualizer.canRestoreFilters
        ? _('content_restore_filters', '恢复筛选')
        : _('content_hidden_count', '已隐藏: {0}', hiddenCount.toLocaleString());
    }

    const dateLabel = document.getElementById('graph-date-value');
    const duration = document.getElementById('graph-duration');
    const today = document.getElementById('graph-today');
    if (start !== undefined) {
      const date = dateFormat.format(start);
      if (dateLabel) dateLabel.textContent = session ? `${date} · ${timeFormat.format(start)}` : date;
      if (duration) {
        const span = day
          ? (day.nodes[0]?.timestamp ?? 0) - (day.nodes.at(-1)?.timestamp ?? 0)
          : (session?.endTime ?? Date.now()) - start;
        duration.textContent = _('content_session_duration_label', '时长: {0}', this.formatDuration(span));
      }
    } else {
      if (dateLabel) dateLabel.textContent = _('content_session_date', '会话日期');
      if (duration) duration.textContent = '';
    }
    if (today) today.hidden = start === undefined || new Date(start).toDateString() === new Date().toDateString();

    if (tree) {
      const zoom = document.getElementById('tree-zoom-value');
      if (zoom) zoom.textContent = `${Math.round((visualizer.currentTransform?.k ?? 1) * 100)}%`;
    } else {
      const range = document.getElementById('waterfall-observation-range');
      const timeRange = visualizer.getObservationWindowTimeRange();
      if (range) range.textContent = timeRange
        ? _('content_observation_time_label', '查看: {0}', timeRange)
        : _('content_observation_time_placeholder', '查看: -');
    }
  }

  private formatDuration(ms: number): string {
    const minutes = Math.floor(Math.max(0, ms) / 60_000);
    const hours = Math.floor(minutes / 60);
    if (!hours) return _('content_duration_minutes', '{0} 分钟', String(minutes));
    return minutes % 60
      ? _('calendar_duration_hours_minutes', '{0}小时 {1}分钟', String(hours), String(minutes % 60))
      : _('content_duration_hours', '{0} 小时', String(hours));
  }
}
