/**
 * 消息类型定义
 * 提供类型安全的消息处理
 */

// 导入其他必要类型
import type { Session, SessionDetails } from './session.js';

// ===== 基础消息类型 =====

// 基础消息接口 - 所有消息的公共基础
export interface BaseMessage {
  action: string;
  requestId?: string;
  timestamp?: number;
}

// 基础响应消息接口 - 扩展自基础消息
export interface BaseResponseMessage extends BaseMessage {
  success: boolean;
  error?: string;
}

// 保持向后兼容
export type ResponseMessage = BaseResponseMessage;

// ===== 请求消息类型 =====

// 刷新可视化请求
export interface RefreshVisualizationRequestMessage extends BaseMessage {
  action: 'refreshVisualization';
}

// 调试请求
export interface DebugRequestMessage extends BaseMessage {
  action: 'debug';
  command: string;
}

// 获取会话列表请求
export interface GetSessionsRequestMessage extends BaseMessage {
  action: 'getSessions';
}

// 获取会话详情请求
export interface GetSessionDetailsRequestMessage extends BaseMessage {
  action: 'getSessionDetails';
  sessionId: string;
}

// 获取节点ID请求
export interface GetNodeIdRequestMessage extends BaseMessage {
  action: 'getNodeId';
  url: string;
}

// 页面加载请求
export interface PageLoadedRequestMessage extends BaseMessage {
  action: 'pageLoaded';
  pageInfo: {
    url: string;
    title?: string;
    referrer?: string;
    timestamp?: number;
    favicon?: string;
  };
}

// Favicon更新请求
export interface FaviconUpdatedRequestMessage extends BaseMessage {
  action: 'faviconUpdated';
  url: string;
  favicon: string;
}

/**
 * 页面活动请求消息
 */
export interface PageActivityRequestMessage extends BaseMessage {
  action: 'pageActivity';
  source: string;  // 这允许我们存储活动来源
}

/**
 * 链接点击请求消息
 */
export interface LinkClickedRequestMessage extends BaseMessage {
  action: 'linkClicked';
  linkInfo: {
    sourceNodeId: string;
    sourceUrl: string;
    targetUrl: string;
    isNewTab: boolean;
    timestamp: number;
  };
}

// ===== 响应消息类型 =====

// 基本成功响应
export interface SuccessResponseMessage extends BaseResponseMessage {
  success: true;
}

// 基本失败响应
export interface ErrorResponseMessage extends BaseResponseMessage {
  success: false;
  error: string;
}

// 会话列表响应
export interface GetSessionsResponseMessage extends BaseResponseMessage {
  action: 'getSessions';
  sessions?: Session[];
}

// 会话详情响应
export interface GetSessionDetailsResponseMessage extends BaseResponseMessage {
  action: 'getSessionDetails';
  session?: SessionDetails;
}

// 节点ID响应
export interface GetNodeIdResponseMessage extends BaseResponseMessage {
  action: 'getNodeId';
  nodeId?: string | null;  // 允许null值
  tabId?: number;
}

// 刷新可视化响应
export interface RefreshVisualizationResponseMessage extends BaseResponseMessage {
  action: 'refreshVisualization';
}

// 页面加载响应
export interface PageLoadedResponseMessage extends BaseResponseMessage {
  action: 'pageLoaded';
  nodeId?: string;
}

// 通用数据操作响应
export interface DataOperationResponseMessage extends BaseResponseMessage {
  action: string;
  affectedCount?: number;
}

/**
 * 页面活动响应消息
 */
export interface PageActivityResponseMessage extends BaseResponseMessage {
  action: 'pageActivity';
  acknowledged?: boolean;
}

// ===== 请求-响应类型映射 =====

/**
 * 请求-响应类型映射
 */
export interface RequestResponseMap {
  'getSessions': {
    request: GetSessionsRequestMessage;
    response: GetSessionsResponseMessage;
  };
  'getSessionDetails': {
    request: GetSessionDetailsRequestMessage;
    response: GetSessionDetailsResponseMessage;
  };
  'getNodeId': {
    request: GetNodeIdRequestMessage;
    response: GetNodeIdResponseMessage;
  };
  'refreshVisualization': {
    request: RefreshVisualizationRequestMessage;
    response: RefreshVisualizationResponseMessage;
  };
  'pageLoaded': {
    request: PageLoadedRequestMessage;
    response: PageLoadedResponseMessage;
  };
  'faviconUpdated': {
    request: FaviconUpdatedRequestMessage;
    response: BaseResponseMessage;
  };
  'debug': {
    request: DebugRequestMessage;
    response: BaseResponseMessage;
  };
  'clearAllData': {
    request: BaseMessage & { action: 'clearAllData' };
    response: DataOperationResponseMessage;
  };
  'clearSessionData': {
    request: BaseMessage & { action: 'clearSessionData'; sessionId: string };
    response: DataOperationResponseMessage;
  };
  'pageActivity': {
    request: PageActivityRequestMessage;
    response: PageActivityResponseMessage;
  };
  'linkClicked': {
    request: LinkClickedRequestMessage;
    response: BaseResponseMessage;
  };
  [key: string]: {
    request: BaseMessage;
    response: BaseResponseMessage;
  };
}

// ===== 类型联合 =====

// 所有请求消息类型联合
export type RequestMessage = 
  | RefreshVisualizationRequestMessage
  | DebugRequestMessage
  | GetSessionsRequestMessage
  | GetSessionDetailsRequestMessage
  | GetNodeIdRequestMessage
  | PageLoadedRequestMessage
  | FaviconUpdatedRequestMessage
  | PageActivityRequestMessage
  | LinkClickedRequestMessage;

// 所有响应消息类型联合
export type ResponseMessageType = 
  | GetSessionsResponseMessage
  | GetSessionDetailsResponseMessage
  | GetNodeIdResponseMessage
  | RefreshVisualizationResponseMessage
  | PageLoadedResponseMessage
  | DataOperationResponseMessage
  | PageActivityResponseMessage
  | BaseResponseMessage;

// ===== 消息处理函数类型 =====

// 一般消息处理函数类型
export type MessageHandler<T extends BaseMessage = BaseMessage> = (
  message: T,
  sender: chrome.runtime.MessageSender | { source: string },
  sendResponse: (response: ResponseMessage) => void
) => boolean;

// 类型安全的消息处理函数
export type TypedMessageHandler<T extends keyof RequestResponseMap> = (
  message: RequestResponseMap[T]['request'],
  sender: chrome.runtime.MessageSender | { source: string },
  sendResponse: (response: RequestResponseMap[T]['response']) => void
) => boolean;