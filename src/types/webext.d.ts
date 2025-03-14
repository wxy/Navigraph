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
  parentId: string | null;     // 必需: 父节点ID，根节点为null
  navigationType: NavigationType; // 必需: 导航类型
  openTarget: OpenTarget;      // 必需: 打开目标

  title?: string;
  favicon?: string;
  firstVisit?: number;  // 首次访问时间
  lastVisit?: number;   // 最后访问时间
  visitCount?: number;  // 访问计数
  reloadCount?: number; // 重新加载计数
  activeTime?: number;
  loadTime?: number;
  referrer?: string;
  frameId?: number;
  parentFrameId?: number;
  isClosed?: boolean;
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