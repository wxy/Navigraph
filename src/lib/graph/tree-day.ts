import type { NavNode } from '../../types/session-types.js';

export const TREE_DAY_LIMIT = 10_000;
export const TREE_LAYOUT_LIMIT = 50;

export interface TreeDayNode extends Pick<NavNode, 'id' | 'parentId' | 'sessionId' | 'tabId' | 'timestamp' | 'type' | 'isClosed'> {
  site: string;
  tracking: boolean;
  keep?: boolean;
}

export interface TreeDay {
  start: number;
  nodes: TreeDayNode[];
  truncated: boolean;
}

export interface FilteredTreeDay extends TreeDay {
  total: number;
  oldest?: number;
  newest?: number;
}

export function localDayRange(timestamp: number): [number, number] {
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  const start = day.getTime();
  day.setDate(day.getDate() + 1);
  return [start, day.getTime()];
}
