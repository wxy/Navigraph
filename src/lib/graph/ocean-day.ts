export const OCEAN_DAY_LIMIT = 10_000;

export interface OceanDayNode {
  timestamp: number;
  tabId: number;
  sessionId: string;
  site: string;
  page: number;
}

export interface OceanDaySession {
  id: string;
  firstVisit: number;
  title?: string;
}

export interface OceanDay {
  start: number;
  nodes: OceanDayNode[];
  sessions: OceanDaySession[];
  truncated: boolean;
}
