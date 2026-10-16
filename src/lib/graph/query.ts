import type { BrowsingSession, NavNode, NavLink } from '../../types/session-types.js';

export interface GraphFilters {
  reload: boolean; history: boolean; closed: boolean; showTracking: boolean;
  typeLink: boolean; typeAddress: boolean; typeForm: boolean; typeJs: boolean;
}
export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  reload: true, history: true, closed: false, showTracking: false,
  typeLink: true, typeAddress: true, typeForm: true, typeJs: true
};
export const TRACKING_KEYWORDS = [
  '/track/', '/pixel/', '/analytics/', '/beacon/', '/telemetry/', '/stats/', '/log/', '/metrics/',
  '/collect/', '/monitor/', 'piwik.', 'matomo.', 'ga.js', 'gtm.js', 'fbevents', 'insight.', '/counter/', 'www.google-analytics.com'
];
export function isTrackingUrl(url: string): boolean {
  return TRACKING_KEYWORDS.some(keyword => url.toLowerCase().includes(keyword));
}
export function matchesGraphFilters(type: string, closed: boolean, tracking: boolean, filters: GraphFilters): boolean {
  if ((!filters.reload && type === 'reload') || (!filters.history && ['history', 'history_back', 'history_forward'].includes(type))) return false;
  if ((!filters.closed && closed) || (!filters.showTracking && tracking)) return false;
  return !((type === 'link_click' && !filters.typeLink) || (type === 'address_bar' && !filters.typeAddress)
    || (type === 'form_submit' && !filters.typeForm) || (type === 'javascript' && !filters.typeJs));
}
export type SessionMetadata = Omit<BrowsingSession, 'records' | 'edges' | 'rootIds'>;
export function sessionMetadata(session: BrowsingSession): SessionMetadata {
  const { records, edges, rootIds, ...metadata } = session;
  return metadata;
}
export interface GraphPageQuery {
  sessionId: string; filters: GraphFilters; page: number; limit: number; edgePage: number;
}
export interface GraphPageInfo {
  page: number; limit: number; total: number; matched: number;
  edgePage: number; edgeLimit: number; edgeTotal: number;
}
export interface GraphPageResult {
  session: SessionMetadata | null; nodes: NavNode[]; edges: NavLink[]; pageInfo: GraphPageInfo;
}
export interface GraphPageResponse extends GraphPageResult { success: boolean; error?: string; }
