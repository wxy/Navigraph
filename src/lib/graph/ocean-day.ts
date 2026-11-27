export const OCEAN_DAY_LIMIT = 10_000;

export interface OceanDayNode {
  timestamp: number;
  tabId: number;
  site: string;
  page: number;
}

export interface OceanDay {
  start: number;
  nodes: OceanDayNode[];
  truncated: boolean;
}
