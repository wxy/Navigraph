/**
 * 导航方式类型
 */
export type NavigationType = 
  'link_click' |     // 点击链接
  'address_bar' |    // 地址栏输入
  'form_submit' |    // 表单提交
  'history_back' |   // 历史后退
  'history_forward' | // 历史前进
  'reload' |         // 页面刷新
  'redirect' |       // 服务器端跳转
  'javascript' |     // JavaScript触发导航
  'initial';         // 初始加载

/**
 * 页面打开位置
 */
export type OpenTarget = 
  'same_tab' |       // 当前标签页
  'new_tab' |        // 新标签页
  'new_window' |     // 新窗口
  'popup' |          // 弹出窗口
  'frame';           // 框架/内嵌框架

/**
 * 导航记录
 */
export interface NavigationRecord {
  id: string;                  // 必需: 记录ID
  tabId: number;               // 必需: 标签页ID
  url: string;                 // 必需: URL
  timestamp: number;           // 必需: 时间戳
  sessionId: string;           // 必需: 所属会话ID
  parentId: string;            // 必需: 父节点ID，根节点为 ''
  navigationType: NavigationType; // 必需: 导航类型
  openTarget: OpenTarget;      // 必需: 打开目标
  source: string;              // 必需: 来源 ('chrome_api'|'content_script'|'navigation_event')
  
  // 可选字段 - 基本信息
  title?: string;              // 页面标题
  favicon?: string;            // 网站图标URL
  
  // 可选字段 - 时间与计数统计
  firstVisit?: number;         // 首次访问时间
  lastVisit?: number;          // 最后访问时间
  visitCount?: number;         // 访问次数
  reloadCount?: number;        // 重新加载次数
  activeTime?: number;         // 活跃时间(毫秒)
  loadTime?: number;           // 页面加载时间(毫秒)
  
  // 可选字段 - 状态
  isClosed?: boolean;          // 是否已关闭
  
  // 可选字段 - 内容与关系
  referrer?: string;           // 引用页面
  description?: string;        // 页面描述
  keywords?: string;           // 页面关键词
  
  // 可选字段 - 框架信息
  frameId?: number;            // 框架ID
  parentFrameId?: number;      // 父框架ID
}

/**
 * 导航边 - 表示节点间的导航行为
 */
export interface NavigationEdge {
  id: string;                  // 边ID (格式: "source-target-timestamp")
  sourceId: string;            // 起始节点ID
  targetId: string;            // 目标节点ID
  timestamp: number;           // 发生时间戳
  sessionId?: string;          // 所属会话ID
  action: NavigationType;      // 导航动作
  sequence: number;            // 序列号
}

/**
 * 浏览会话
 */
export interface BrowsingSession {
  id: string;                  // 会话ID
  title?: string;              // 会话标题，可选
  startTime: number;           // 开始时间戳
  endTime?: number;            // 结束时间戳
  records?: Record<string, NavigationRecord>; // 节点记录 (ID -> 记录)，可选
  edges?: Record<string, NavigationEdge>;     // 导航边 (ID -> 边)，可选
  rootIds?: string[];          // 根节点ID列表，可选
  recordCount?: number;        // 记录数量，用于API响应
}

/**
 * 导航查询条件
 */
export interface NavigationQueryCriteria {
  url?: string;                // URL包含
  tabId?: number;              // 标签页ID
  timeRange?: [number, number]; // 时间范围 [开始, 结束]
  sessionId?: string;          // 会话ID
}

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
/**
 * Chrome原生API类型扩展
 */
declare namespace chrome {
  namespace webNavigation {
    interface WebNavigationFramedCallbackDetails {
      transitionQualifiers?: string[];
      transitionType?: string;
    }
  }
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