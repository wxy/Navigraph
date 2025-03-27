/**
 * 会话类型定义
 * 确保与后端定义兼容
 */

// 导入后端定义的类型，确保一致性
import { 
  BrowsingSession as BackendSession,
  NavNode,
  NavLink
} from '../../types/session-types';

// 导出会话摘要类型 - 用于会话列表
export interface Session {
  id: string;
  title: string;
  startTime: number;
  endTime?: number;
  isActive: boolean;
  nodeCount?: number;
  recordCount?: number; // 兼容旧代码
}

// 导出会话详情类型 - 使用后端定义的类型
export interface SessionDetails extends BackendSession {
  // 确保包含前端代码需要的字段
  records: Record<string, NavNode>;
  edges: Record<string, NavLink>;
  rootIds: string[];
}

// 导航节点类型
export interface NodeRecord extends NavNode {}

// 导航边类型
export interface EdgeRecord extends NavLink {}

