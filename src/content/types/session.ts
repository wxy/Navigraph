/**
 * 会话相关类型定义
 */

// 会话基本信息
export interface Session {
  id: string;
  startTime: number;
  endTime?: number;
  title?: string;
}

// 会话详细信息
export interface SessionDetails {
  id: string;
  startTime: number;
  endTime?: number;
  title?: string;
  records: { [key: string]: NodeRecord };
  edges: { [key: string]: EdgeRecord };
  [key: string]: any;
}

// 节点记录
export interface NodeRecord {
  id: string;
  url: string;
  title?: string;
  favicon?: string;
  navigationType?: string;
  timestamp: number;
  tabId: string;
  parentId?: string | null;
  referrer?: string;
  isClosed?: boolean;
  activeTime?: number;
  loadTime?: number;
  [key: string]: any;
}

// 边记录
export interface EdgeRecord {
  id: string;
  sourceId: string;
  targetId: string;
  timestamp: number;
  action?: string;
  [key: string]: any;
}

