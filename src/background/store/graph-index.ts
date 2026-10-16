import { isTrackingUrl } from '../../lib/graph/query.js';
import type { NavNode, NavLink } from '../../types/session-types.js';

interface IndexedNode extends NavNode {
  _pageSession: string; _pageTime: number; _pageType: string; _pageClosed: number; _pageTracking: number;
  _restoreTab: number; _statsDomain: string; _statsUrl: string; _statsTime: number; _statsKnown: number; _timeUnknown: boolean;
}
interface IndexedEdge extends NavLink { _pageSession: string; _pageSource: string; _pageTarget: string; _pageTime: number; }
/** Use the same URL grouping for covering-index writes and exact URL reads. */
export function nodeUrlDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}
/** Covering keys let ordinary pages count/filter without reading node or edge values. */
export function indexedNode(node: NavNode): IndexedNode {
  const url = typeof node.url === 'string' ? node.url : '';
  const timestamp = Number.isFinite(node.timestamp) && Math.abs(node.timestamp) <= 8640000000000000 ? node.timestamp : 0;
  const domain = nodeUrlDomain(url);
  return { ...node, _pageSession: typeof node.sessionId === 'string' ? node.sessionId : '',
    _timeUnknown: !Number.isFinite(node.timestamp) || Math.abs(node.timestamp) > 8640000000000000,
    _pageTime: -timestamp, _pageType: typeof node.type === 'string' ? node.type : 'unknown',
    _pageClosed: node.isClosed === true ? 1 : 0, _pageTracking: isTrackingUrl(url) ? 1 : 0,
    _restoreTab: Number.isFinite(node.tabId) ? node.tabId : -1, _statsDomain: domain, _statsUrl: url, _statsTime: timestamp, _statsKnown: Number.isFinite(node.timestamp) && Math.abs(node.timestamp) <= 8640000000000000 ? 1 : 0 };
}
export function indexedEdge(edge: NavLink): IndexedEdge {
  return { ...edge, _pageSession: typeof edge.sessionId === 'string' ? edge.sessionId : '',
    _pageSource: typeof edge.source === 'string' ? edge.source : '',
    _pageTarget: typeof edge.target === 'string' ? edge.target : '',
    _pageTime: Number.isFinite(edge.timestamp) ? edge.timestamp : 0 };
}
