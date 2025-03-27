/**
 * 会话类型定义文件
 * 包含与会话管理相关的所有类型
 */

// ============ 会话核心类型 ============

/**
 * 浏览会话类型
 * 表示用户一段连续的浏览行为
 */
export interface BrowsingSession {
  id: string;                 // 会话ID
  title: string;              // 会话标题
  description?: string;       // 会话描述
  startTime: number;          // 开始时间戳
  endTime?: number;           // 结束时间戳(未定义表示未结束)
  isActive: boolean;          // 是否为活跃会话
  nodeCount?: number;         // 节点数量
  tabCount?: number;          // 标签页数量
  metadata?: SessionMetadata; // 会话元数据
  
  // 兼容前端可视化所需的字段
  records?: Record<string, NavNode>;   // 导航节点记录映射 (ID -> 节点)
  edges?: Record<string, NavLink>;     // 导航边记录映射 (ID -> 边)
  rootIds?: string[];                 // 根节点ID列表
}

/**
 * 会话摘要信息
 * 用于会话列表展示的简化版
 */
export interface SessionSummary {
  id: string;                 // 会话ID
  title: string;              // 会话标题
  startTime: number;          // 开始时间戳
  endTime?: number;           // 结束时间戳
  isActive: boolean;          // 是否为活跃会话
  nodeCount?: number;         // 节点数量
  recordCount?: number;       // 兼容现有代码的记录数量
}

/**
 * 会话元数据
 * 存储与会话相关的额外信息
 */
export interface SessionMetadata {
  tags?: string[];            // 会话标签
  category?: string;          // 会话分类
  source?: string;            // 来源信息
  customFields?: Record<string, any>; // 自定义字段
  createdBy?: string;         // 创建者
  lastModified?: number;      // 最后修改时间
}

// ============ 会话操作选项 ============

/**
 * 会话创建选项
 */
export interface SessionCreationOptions {
  title?: string;             // 会话标题
  description?: string;       // 会话描述
  metadata?: SessionMetadata; // 会话元数据
  makeActive?: boolean;       // 是否设为活跃会话(默认:true)
}

/**
 * 会话更新选项
 */
export interface SessionUpdateOptions {
  title?: string;             // 更新标题
  description?: string;       // 更新描述
  isActive?: boolean;         // 更新活跃状态
  metadata?: Partial<SessionMetadata>; // 更新元数据
}

/**
 * 会话查询选项
 */
export interface SessionQueryOptions {
  includeInactive?: boolean;  // 是否包含非活跃会话
  limit?: number;             // 返回结果数量限制
  sortBy?: 'startTime' | 'endTime' | 'title'; // 排序字段
  sortDirection?: 'asc' | 'desc'; // 排序方向
  filter?: SessionFilter;     // 过滤条件
}

/**
 * 会话过滤器
 */
export interface SessionFilter {
  startAfter?: number;        // 开始时间晚于
  startBefore?: number;       // 开始时间早于
  endAfter?: number;          // 结束时间晚于
  endBefore?: number;         // 结束时间早于
  title?: string;             // 标题包含
  tags?: string[];            // 包含指定标签
  category?: string;          // 指定分类
}

// ============ 会话存储相关类型 ============

/**
 * 会话存储接口
 * 定义会话持久化存储的方法
 */
export interface SessionStorage {
  /**
   * 保存会话
   * @param session 要保存的会话
   */
  saveSession(session: BrowsingSession): Promise<void>;

  /**
   * 获取指定ID的会话
   * @param sessionId 会话ID
   */
  getSession(sessionId: string): Promise<BrowsingSession | null>;

  /**
   * 获取所有会话
   * @param options 查询选项
   */
  getSessions(options?: SessionQueryOptions): Promise<BrowsingSession[]>;

  /**
   * 删除会话
   * @param sessionId 要删除的会话ID
   */
  deleteSession(sessionId: string): Promise<boolean>;

  /**
   * 清除所有会话数据
   */
  clearAllSessions(): Promise<void>;
}

// ============ 会话事件类型 ============

/**
 * 会话事件类型
 * 用于会话状态变更通知
 */
export enum SessionEventType {
  Created = 'session.created',
  Updated = 'session.updated',
  Ended = 'session.ended',
  Deleted = 'session.deleted',
  Activated = 'session.activated',
  Deactivated = 'session.deactivated'
}

/**
 * 会话事件接口
 */
export interface SessionEvent {
  type: SessionEventType;     // 事件类型
  sessionId: string;          // 相关会话ID
  timestamp: number;          // 事件时间戳
  data?: any;                 // 事件相关数据
}

// ============ 会话统计类型 ============

/**
 * 会话统计信息
 */
export interface SessionStatistics {
  totalNodes: number;         // 总节点数
  uniqueDomains: number;      // 唯一域名数
  duration: number;           // 持续时间(毫秒)
  topDomains: {domain: string, count: number}[]; // 访问最多的域名
  mostVisitedPages: {url: string, title: string, visits: number}[]; // 访问最多的页面
  activityByHour: {hour: number, count: number}[]; // 按小时的活动统计
}

/**
 * 导航节点
 * 表示浏览历史中的一个页面
 */
export interface NavNode {
  id: string;                  // 节点ID
  url: string;                 // 页面URL
  title: string;               // 页面标题
  tabId: number;               // 标签页ID
  timestamp: number;           // 创建时间戳
  sessionId: string;           // 所属会话ID
  parentId?: string;           // 父节点ID
  favIconUrl?: string;         // 网站图标URL
  type: string;                // 节点类型
  metadata?: Record<string, any>; // 节点元数据
}

/**
 * 导航边
 * 表示节点之间的连接关系
 */
export interface NavLink {
  id: string;                  // 边ID
  source: string;              // 源节点ID
  target: string;              // 目标节点ID
  timestamp: number;           // 创建时间戳
  sessionId: string;           // 所属会话ID
  type: string;                // 边类型
  metadata?: Record<string, any>; // 边元数据
}