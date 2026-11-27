import type { NavNode } from '../../types/session-types.js';
import type { SessionMetadata } from './query.js';

export const WATERFALL_TIMELINE_LIMIT = 10_000;

export interface WaterfallNode extends Pick<NavNode, 'id' | 'tabId' | 'timestamp' | 'type' | 'isClosed'> {
  site: string;
}

export interface WaterfallTimeline {
  session: SessionMetadata | null;
  nodes: WaterfallNode[];
  total: number;
  truncated: boolean;
}
