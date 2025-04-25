/**
 * 会话类型定义文件
 * 包含与会话管理相关的所有类型
 */

// 在文件顶部添加 Chrome API 相关类型增强

/**
 * Chrome扩展API类型增强
 */
export interface ExtendedNavigationDetails {
  tabId: number;
  url: string;
  processId: number;
  frameId: number;
  timeStamp: number;
  parentFrameId?: number;
  transitionType?: string;
  transitionQualifiers?: string[];
}

export type ExtendedCommittedDetails = ExtendedNavigationDetails;
export type ExtendedTransitionDetails = ExtendedNavigationDetails;
export type ExtendedCompletedDetails = ExtendedNavigationDetails;

// Chrome原生API类型扩展
declare namespace chrome {
  namespace webNavigation {
    interface WebNavigationFramedCallbackDetails {
      transitionQualifiers?: string[];
      transitionType?: string;
    }
  }
}

// 添加标签页状态类型
export interface TabState {
  id: number;                  // 标签页ID
  url: string;                 // 当前URL
  title?: string;              // 标题
  activated?: number;          // 激活时间
  created?: number;            // 创建时间
  lastNavigation?: number;     // 最后导航时间
  lastNodeId?: string;         // 最后节点ID 
  favicon?: string;            // 图标URL
  lastActiveTime?: number;     // 最后活跃时间
}

// 添加待处理导航类型
export interface PendingNavigation {
  type: NavigationType;        // 导航类型
  sourceNodeId?: string;       // 源节点ID
  sourceTabId: number;         // 源标签页ID
  sourceUrl: string;           // 源URL
  targetUrl: string;           // 目标URL
  isNewTab?: boolean;          // 是否在新标签页打开
  data: any;                   // 相关数据
  timestamp: number;           // 时间戳
  expiresAt: number;           // 过期时间
  targetTabId?: number;        // 目标标签页ID
}

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
  lastActivity?: number; // 添加最后活动时间字段

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

  // 会话类型
  type?: string;              // 'daily', 'manual', 'project', 或其他类型
  
  // 日期信息（时间戳）
  date?: number;
  
  // 最后活动时间
  lastActivityTime?: number;
  
  // 扩展属性，允许添加其他未来可能需要的元数据
  [key: string]: any;
}

// ============ 会话操作选项 ============

/**
 * 会话创建选项
 */
export interface SessionCreationOptions {
  /**
   * 会话标题
   */
  title?: string;

  /**
   * 会话描述
   */
  description?: string;

  /**
   * 是否设为活跃会话
   */
  makeActive?: boolean;

  /**
   * 是否同时更新当前查看会话
   * 当makeActive=true时，此属性决定是否也将新会话设为当前查看会话
   * 默认为true
   */
  updateCurrent?: boolean;

  /**
   * 会话元数据
   */
  metadata?: Record<string, any>;
}

/**
 * 会话更新选项
 */
export interface SessionUpdateOptions {
  title?: string;             // 更新标题
  description?: string;       // 更新描述
  isActive?: boolean;         // 更新活跃状态
  metadata?: SessionMetadata; // 使用更明确的类型
  lastActivity?: number;      // 更新最后活动时间
}

/**
 * 会话查询选项
 */
export interface SessionQueryOptions {
  includeInactive?: boolean; // 是否包含非活跃会话
  limit?: number; // 结果数量限制
  offset?: number; // 结果偏移量
  sortBy?: 'startTime' | 'endTime' | 'title' | 'nodeCount' | 'lastActivity'; // 排序字段
  sortOrder?: 'asc' | 'desc'; // 排序方向
  fromDate?: number; // 开始日期过滤
  toDate?: number; // 结束日期过滤
  search?: string; // 搜索关键词
}

/**
 * 会话过滤器
 */
export interface SessionFilter {
  startAfter?: number;        // 开始时间晚于
  startBefore?: number;        // 开始时间早于
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
  Deactivated = 'session.deactivated',
  Viewed = 'session:viewed'
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

// 确保导航类型与旧的保持兼容
export type NavigationType = "unknown" | "link_click" | "form_submit" | "address_bar" | 
  "history_back" | "history_forward" | "reload" | "javascript" | 
  "redirect" | "initial" | "bookmark";

export type OpenTarget = "same_tab" | "new_tab" | "popup" | "frame";

/**
 * 导航节点
 * 表示一个浏览器导航事件
 */
export interface NavNode {
  id: string;                // 唯一标识符
  tabId: number;             // 所属标签页ID
  url: string;               // URL
  timestamp: number;         // 时间戳
  sessionId: string;         // 所属会话ID
  parentId?: string;         // 父节点ID
  
  // 核心字段
  type: NavigationType;      // 导航类型
  openTarget: OpenTarget;    // 打开目标
  source: string;            // 数据来源: chrome_api | content_script | navigation_event
  
  // 元数据
  title?: string;            // 页面标题
  favicon?: string;          // 网站图标URL
  description?: string;      // 网站描述
  keywords?: string;         // 关键词
  referrer?: string;         // 引用页URL
  
  // 访问信息
  firstVisit: number;        // 首次访问时间
  lastVisit: number;        // 最近访问时间
  visitCount: number;        // 访问次数
  reloadCount: number;       // 重新加载次数
  loadTime?: number;         // 加载时间(毫秒)
  activeTime?: number;       // 活跃时间(毫秒)
  
  // 框架信息
  frameId: number;           // 框架ID
  parentFrameId: number;     // 父框架ID
  
  // 状态
  isClosed?: boolean;        // 是否已关闭
  closeTime?: number;        // 关闭时间

  children?: NavNode[];      // 子节点列表
  depth?: number;            // 深度
}

/**
 * 导航边 - 表示节点之间的关系
 */
export interface NavLink {
  id: string;            // 唯一标识符
  source: string;        // 源节点ID
  target: string;        // 目标节点ID
  type: NavigationType;  // 边类型
  timestamp: number;     // 创建时间
  sequence: number;      // 序列号(用于排序)
  sessionId: string;     // 所属会话ID
  data?: any;            // 可选附加数据
}

/**
 * 导航数据查询选项
 * 用于过滤导航节点和边的查询
 */
export interface NavDataQueryOptions {
  // 会话相关
  sessionId?: string;   // 会话ID过滤
  
  // 节点相关
  tabId?: number;       // 标签页ID过滤
  url?: string;         // URL过滤
  isClosed?: boolean;  // 是否已关闭
  
  // 边相关
  source?: string;      // 源节点ID
  target?: string;      // 目标节点ID
  type?: string;        // 类型过滤
  
  // 时间范围
  startTime?: number;   // 开始时间戳（含）
  endTime?: number;     // 结束时间戳（含）
  
  // 分页和排序
  limit?: number;       // 结果数量限制
  offset?: number;      // 结果偏移量
  sortBy?: string;      // 排序字段
  sortOrder?: 'asc' | 'desc'; // 排序顺序
}