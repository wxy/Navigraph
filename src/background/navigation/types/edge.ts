import { NavigationType } from '../../../types/session-types.js';

/**
 * 边创建选项
 */
export interface EdgeCreationOptions {
  /** 源节点ID */
  sourceId: string;
  
  /** 目标节点ID */
  targetId: string;
  
  /** 创建时间戳 */
  timestamp?: number;
  
  /** 导航类型 */
  navigationType?: NavigationType;
  
  /** 会话ID */
  sessionId: string;
}

/**
 * 边检索选项
 */
export interface EdgeQueryOptions {
  /** 会话ID */
  sessionId?: string;
  
  /** 源节点ID */
  source?: string;
  
  /** 目标节点ID */
  target?: string;
  
  /** 导航类型 */
  navigationType?: NavigationType;
  
  /** 限制返回结果数量 */
  limit?: number;
}

/**
 * 边统计信息
 */
export interface EdgeStats {
  /** 总边数 */
  total: number;
  
  /** 按类型统计 */
  byType: Record<NavigationType, number>;
  
  /** 节点间连接统计 */
  connections: {
    /** 最大出度 */
    maxOutDegree: number;
    /** 最大入度 */
    maxInDegree: number;
    /** 平均出度 */
    avgOutDegree: number;
    /** 平均入度 */
    avgInDegree: number;
  };
}