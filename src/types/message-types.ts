/**
 * 系统消息类型定义
 * 为前后台通信提供类型安全的接口
 */

import {
  BrowsingSession,
  SessionSummary,
  SessionCreationOptions,
  SessionUpdateOptions,
  SessionQueryOptions,
  SessionStatistics
} from './session-types.js';

// ============ 基础消息类型 ============

/**
 * 基础消息接口
 * 所有消息的基本结构
 */
export interface BaseMessage {
  action: string;             // 消息动作类型
  requestId?: string;         // 请求ID，用于关联请求和响应
  timestamp?: number;         // 消息时间戳
}

/**
 * 基础响应消息接口
 * 所有响应消息的基本结构
 */
export interface BaseResponseMessage extends BaseMessage {
  success: boolean;           // 操作是否成功
  error?: string;             // 错误信息(如果操作失败)
}

// ============ 会话相关消息 ============

/**
 * 获取会话列表请求
 */
export interface GetSessionsRequest extends BaseMessage {
  action: 'getSessions';
  options?: SessionQueryOptions; // 使用新定义的查询选项
}

/**
 * 获取会话列表响应
 */
export interface GetSessionsResponse extends BaseResponseMessage {
  sessions: SessionSummary[]; // 使用新定义的会话摘要类型
}

/**
 * 获取会话详情请求
 */
export interface GetSessionDetailsRequest extends BaseMessage {
  action: 'getSessionDetails';
  sessionId: string;          // 会话ID
}

/**
 * 获取会话详情响应
 */
export interface GetSessionDetailsResponse extends BaseResponseMessage {
  session?: BrowsingSession;  // 使用新定义的完整会话类型
}

/**
 * 创建会话请求
 */
export interface CreateSessionRequest extends BaseMessage {
  action: 'createSession';
  options?: SessionCreationOptions; // 使用新定义的创建选项
}

/**
 * 创建会话响应
 */
export interface CreateSessionResponse extends BaseResponseMessage {
  session?: BrowsingSession;   // 使用新定义的完整会话类型
}

/**
 * 更新会话请求
 */
export interface UpdateSessionRequest extends BaseMessage {
  action: 'updateSession';
  sessionId: string;           // 会话ID
  updates: SessionUpdateOptions; // 使用新定义的更新选项
}

/**
 * 更新会话响应
 */
export interface UpdateSessionResponse extends BaseResponseMessage {
  session?: BrowsingSession;   // 更新后的会话
}

/**
 * 结束会话请求
 */
export interface EndSessionRequest extends BaseMessage {
  action: 'endSession';
  sessionId: string;          // 要结束的会话ID
}

/**
 * 结束会话响应
 */
export interface EndSessionResponse extends BaseResponseMessage {
  sessionId: string;          // 已结束的会话ID
  session?: BrowsingSession;  // 结束后的会话对象
}

/**
 * 设置当前会话请求
 */
export interface SetCurrentSessionRequest extends BaseMessage {
  action: 'setCurrentSession';
  sessionId: string | null;   // 要设置为当前会话的ID，null表示清除当前会话
}

/**
 * 设置当前会话响应
 */
export interface SetCurrentSessionResponse extends BaseResponseMessage {
  sessionId: string | null;   // 设置的会话ID
  session?: BrowsingSession;  // 设置的会话信息
}

/**
 * 获取当前会话请求
 */
export interface GetCurrentSessionRequest extends BaseMessage {
  action: 'getCurrentSession';
}

/**
 * 获取当前会话响应
 */
export interface GetCurrentSessionResponse extends BaseResponseMessage {
  session?: BrowsingSession;  // 当前会话信息
  sessionId?: string | null;  // 当前会话ID
}

/**
 * 删除会话请求
 */
export interface DeleteSessionRequest extends BaseMessage {
  action: 'deleteSession';
  sessionId: string;          // 要删除的会话ID
  confirm?: boolean;          // 是否确认删除
}

/**
 * 删除会话响应
 */
export interface DeleteSessionResponse extends BaseResponseMessage {
  sessionId: string;          // 已删除的会话ID
}

/**
 * 获取会话统计信息请求
 */
export interface GetSessionStatsRequest extends BaseMessage {
  action: 'getSessionStats';
  sessionId: string;          // 会话ID
}

/**
 * 获取会话统计信息响应
 */
export interface GetSessionStatsResponse extends BaseResponseMessage {
  sessionId: string;          // 会话ID
  statistics?: SessionStatistics; // 统计信息
}

/**
 * 页面活动请求
 * 由内容脚本发送，通知后台用户在页面上有活动
 */
export interface PageActivityRequest extends BaseMessage {
  action: 'pageActivity';
  source: string;             // 活动来源(例如: 'click', 'focus', 'visibility')
  timestamp: number;          // 活动发生的时间戳
}

/**
 * 页面活动响应
 */
export interface PageActivityResponse extends BaseResponseMessage {
  acknowledged: boolean;      // 活动是否已确认
}

// ============ 标签页相关消息 ============
/**
 * 获取标签页ID请求
 */
export interface GetTabIdRequest extends BaseMessage {
  action: 'getTabId';
}

/**
 * 获取标签页ID响应
 */
export interface GetTabIdResponse extends BaseResponseMessage {
  tabId: number;
}

// ============ 导航相关消息 ============

/**
 * 获取节点ID请求
 */
export interface GetNodeIdRequest extends BaseMessage {
  action: 'getNodeId';
  tabId: number;              // 标签页ID
  url: string;                // 页面URL
  referrer?: string;          // 引用页URL
  timestamp?: number;         // 时间戳
}

/**
 * 获取节点ID响应
 */
export interface GetNodeIdResponse extends BaseResponseMessage {
  nodeId: string;             // 节点ID
  isNew?: boolean;            // 是否是新创建的节点
}

/**
 * 页面标题更新请求
 */
export interface PageTitleUpdatedRequest extends BaseMessage {
  action: 'pageTitleUpdated';
  nodeId: string;             // 节点ID
  title: string;              // 新标题
}

/**
 * 页面图标更新请求
 */
export interface FaviconUpdatedRequest extends BaseMessage {
  action: 'faviconUpdated';
  nodeId: string;             // 节点ID
  favicon: string;            // 新图标URL
}

/**
 * 页面加载请求
 */
export interface PageLoadedRequest extends BaseMessage {
  action: 'pageLoaded';
  tabId: number;              // 标签页ID
  url: string;                // 页面URL
  title?: string;             // 页面标题
  favicon?: string;           // 页面图标
  referrer?: string;          // 引用页URL
}

/**
 * 链接点击请求
 */
export interface LinkClickedRequest extends BaseMessage {
  action: 'linkClicked';
  tabId: number;              // 标签页ID
  url: string;                // 链接URL
  text?: string;              // 链接文本
  sourceUrl?: string;         // 源页面URL
}

/**
 * 表单提交请求
 */
export interface FormSubmittedRequest extends BaseMessage {
  action: 'formSubmitted';
  tabId: number;              // 标签页ID
  url: string;                // 表单提交URL
  formData?: any;             // 表单数据(可选)
  sourceUrl?: string;         // 源页面URL
}

/**
 * JS导航请求
 * 通知后台JavaScript引发的导航
 */
export interface JsNavigationRequest extends BaseMessage {
  action: 'jsNavigation';
  tabId: number;              // 标签页ID
  url: string;                // 目标URL
  sourceUrl?: string;         // 源页面URL
  cause?: string;             // 导航原因(例如: 'history.pushState')
}

// ============ 设置相关消息 ============

/**
 * 获取设置请求
 */
export interface GetSettingsRequest extends BaseMessage {
  action: 'getSettings';
}

/**
 * 获取设置响应
 */
export interface GetSettingsResponse extends BaseResponseMessage {
  settings: Record<string, any>; // 所有设置
}

/**
 * 更新设置请求
 */
export interface UpdateSettingsRequest extends BaseMessage {
  action: 'updateSettings';
  settings: Record<string, any>; // 要更新的设置
}

/**
 * 更新设置响应
 */
export interface UpdateSettingsResponse extends BaseResponseMessage {
  settings: Record<string, any>; // 更新后的设置
}

// ============ 导航数据相关消息 ============

// 添加 clearAllData 相关定义
export interface ClearAllDataRequest extends BaseMessage {
  action: 'clearAllData';
  timestamp?: number;
}

export interface ClearAllDataResponse extends BaseResponseMessage {
  // 使用 BaseResponseMessage 中的标准字段
}

// message-types.ts 中的定义
export interface DebugRequest extends BaseMessage {
  action: 'debug';
  command: string;           // 调试命令
}

export interface DebugResponse extends BaseResponseMessage {
  // 使用基本响应即可
}

// ============ 消息处理器类型 ============

/**
 * 消息处理函数类型
 * 用于处理收到的消息
 */
export type MessageHandler = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
) => boolean | void;

/**
 * 类型安全的消息处理函数
 * 针对特定消息类型的处理函数
 */
export type TypedMessageHandler<T extends keyof RequestResponseMap> = (
  message: RequestResponseMap[T]['request'],
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: RequestResponseMap[T]['response']) => void
) => boolean | void;

// ============ 请求响应映射 ============

/**
 * 请求响应映射接口
 * 将每种请求类型映射到对应的响应类型
 */
export interface RequestResponseMap {
  // 会话相关
  getSessions: {
    request: GetSessionsRequest;
    response: GetSessionsResponse;
  };
  getSessionDetails: {
    request: GetSessionDetailsRequest;
    response: GetSessionDetailsResponse;
  };
  createSession: {
    request: CreateSessionRequest;
    response: CreateSessionResponse;
  };
  updateSession: {
    request: UpdateSessionRequest;
    response: UpdateSessionResponse;
  };
  endSession: {
    request: EndSessionRequest;
    response: EndSessionResponse;
  };
  setCurrentSession: {
    request: SetCurrentSessionRequest;
    response: SetCurrentSessionResponse;
  };
  getCurrentSession: {
    request: GetCurrentSessionRequest;
    response: GetCurrentSessionResponse;
  };
  deleteSession: {
    request: DeleteSessionRequest;
    response: DeleteSessionResponse;
  };
  getSessionStats: {
    request: GetSessionStatsRequest;
    response: GetSessionStatsResponse;
  };
  pageActivity: {
    request: PageActivityRequest;
    response: PageActivityResponse;
  };
  // 标签页消息
  getTabId: {
    request: GetTabIdRequest;
    response: GetTabIdResponse;
  };
  // 导航相关
  getNodeId: {
    request: GetNodeIdRequest;
    response: GetNodeIdResponse;
  };
  pageTitleUpdated: {
    request: PageTitleUpdatedRequest;
    response: BaseResponseMessage;
  };
  faviconUpdated: {
    request: FaviconUpdatedRequest;
    response: BaseResponseMessage;
  };
  pageLoaded: {
    request: PageLoadedRequest;
    response: BaseResponseMessage;
  };
  linkClicked: {
    request: LinkClickedRequest;
    response: BaseResponseMessage;
  };
  formSubmitted: {
    request: FormSubmittedRequest;
    response: BaseResponseMessage;
  };
  jsNavigation: {
    request: JsNavigationRequest;
    response: BaseResponseMessage;
  };

  // 设置相关
  getSettings: {
    request: GetSettingsRequest;
    response: GetSettingsResponse;
  };
  updateSettings: {
    request: UpdateSettingsRequest;
    response: UpdateSettingsResponse;
  };

  // 数据管理
  clearAllData: {
    request: ClearAllDataRequest;
    response: ClearAllDataResponse;
  };

  // 调试相关
  debug: {
    request: DebugRequest;
    response: DebugResponse;
  };
}