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
  id?: string;                 // 节点ID (格式: "tabId-timestamp")，可选，会自动生成
  url: string;                 // 页面URL
  title?: string;              // 页面标题
  timestamp: number;           // 创建时间戳 
  tabId: number;               // 标签页ID
  windowId?: number;           // 窗口ID
  sessionId?: string;          // 所属会话ID，可选，会自动设置
  frameId?: number;            // 框架ID (0表示主框架)
  parentFrameId?: number;      // 父框架ID
  referrer?: string;           // 来源URL
  favicon?: string;            // 网站图标URL
  navigationType: NavigationType; // 导航类型
  openTarget: OpenTarget;      // 打开位置
  loadTime?: number;           // 加载时间(毫秒)
  parentId?: string;           // 父节点ID (格式: "tabId-timestamp")
  activeTime?: number;         // 活跃时间(毫秒)
  isClosed?: boolean;          // 页面是否已关闭
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
  startTime: number;           // 开始时间戳
  endTime?: number;            // 结束时间戳
  records: Record<string, NavigationRecord>; // 节点记录 (ID -> 记录)
  edges: Record<string, NavigationEdge>;     // 导航边 (ID -> 边)
  rootIds: string[];           // 根节点ID列表
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