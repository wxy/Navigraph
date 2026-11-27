import type { NavNode } from '../../content/types/navigation.js';
import { _ } from '../utils/i18n.js';

export function renderNodeDetails(node: NavNode, isTracking: boolean): DocumentFragment {
  const title = document.createElement('h3');
  title.className = 'node-details-title';
  title.textContent = node.title || _('content_unnamed_page', '无标题');

  const content = document.createElement('div');
  const table = document.createElement('table');
  table.className = 'details-table';
  if (node.url) {
    const label = _('content_url_label', 'URL');
    const text = formatUrl(node.url);
    if (/^https?:\/\//i.test(node.url)) {
      const link = document.createElement('a');
      link.href = node.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = node.url;
      link.textContent = text;
      link.style.wordBreak = 'break-all';
      addRow(table, label, link).classList.add('break-all');
    } else {
      const cell = addRow(table, label, text);
      cell.classList.add('break-all');
      cell.title = node.url;
    }
  }
  if (node.type) addRow(table, _('content_type_label', '类型'), formatNavigationType(node.type));
  if (node._timeUnknown) {
    addRow(table, _('content_time_label', '时间'), _('content_unknown_time', '未知时间'));
  } else if (node.timestamp) {
    const date = new Date(node.timestamp);
    addRow(table, _('content_time_label', '时间'), `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`);
  }
  addRow(table, _('content_status_label', '状态'),
    node.isClosed ? _('content_status_closed', '已关闭') : _('content_status_active', '活跃'));
  if (isTracking) addRow(table, _('content_tracking_page_label', '跟踪页面'), _('content_yes', '是'));
  if (node.visitDuration) {
    addRow(table, _('content_duration_label', '时长'), formatDuration(node.visitDuration));
  } else if (!node.isClosed && node.timestamp) {
    addRow(table, _('content_duration_label', '时长'), `${formatDuration(Date.now() - node.timestamp)} ...`);
  }
  if (node.visitCount) addRow(table, _('content_count_label', '次数'), String(node.visitCount));
  if (node.spaRequestCount) addRow(table, _('content_spa_request_count', '请求'), String(node.spaRequestCount));

  const details = document.createElement('details');
  details.className = 'technical-details';
  const summary = document.createElement('summary');
  summary.textContent = _('content_technical_details', '技术详情');
  const technical = document.createElement('table');
  technical.className = 'tech-details-table';
  if (node.tabId) addRow(technical, _('content_tab_id_label', '标签ID'), String(node.tabId));
  addRow(technical, _('content_node_id_label', '节点ID'), node.id);
  if (node.parentId) addRow(technical, _('content_parent_id_label', '父节点ID'), node.parentId);
  if (node.referrer) addRow(technical, _('content_referrer_label', '引用来源'), node.referrer);
  details.append(summary, technical);
  const techCell = table.insertRow().insertCell();
  techCell.colSpan = 2;
  techCell.append(details);

  content.append(table);
  const fragment = document.createDocumentFragment();
  fragment.append(title, content);
  return fragment;
}

function addRow(table: HTMLTableElement, label: string, value: string | HTMLElement): HTMLTableCellElement {
  const row = table.insertRow();
  const labelCell = row.insertCell();
  labelCell.className = 'detail-label';
  labelCell.textContent = label;
  const valueCell = row.insertCell();
  valueCell.className = 'detail-value';
  valueCell.append(value);
  return valueCell;
}

function formatUrl(url: string): string {
  const maxLength = 50;
  if (url.length <= maxLength) return url;
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      const base = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
      return base.length > maxLength - 3 ? `${base.slice(0, maxLength - 3)}...` : `${base}?...`;
    }
  } catch {
    // Imported history can contain a display URL that cannot be parsed.
  }
  return `${url.slice(0, maxLength - 3)}...`;
}

function formatNavigationType(type: string): string {
  const labels: Record<string, string> = {
    initial: _('content_nav_type_initial', '外部打开'),
    link_click: _('content_nav_type_link_click', '链接点击'),
    address_bar: _('content_nav_type_address_bar', '地址栏输入'),
    form_submit: _('content_nav_type_form_submit', '表单提交'),
    history_back: _('content_nav_type_history_back', '历史后退'),
    history_forward: _('content_nav_type_history_forward', '历史前进'),
    reload: _('content_nav_type_reload', '页面刷新'),
    javascript: _('content_nav_type_javascript', 'JavaScript导航'),
    redirect: _('content_nav_type_redirect', '重定向'),
  };
  return labels[type] ?? type;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}${_('content_unit_millisecond', '毫秒')}`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  let result = '';
  if (days > 0) result += days + _('content_unit_day', '天');
  if (hours > 0 || days > 0) result += hours + _('content_unit_hour', '小时');
  if (minutes > 0 || hours > 0 || days > 0) result += minutes + _('content_unit_minute', '分钟');
  return result + seconds + _('content_unit_second', '秒');
}
