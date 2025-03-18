/**
 * 消息类型定义
 * 提供类型安全的消息处理
 */

// 基础消息接口
export interface BaseMessage {
  action: string;
  requestId?: string;
  timestamp?: number;
}

// 刷新可视化消息
export interface RefreshVisualizationMessage extends BaseMessage {
  action: 'refreshVisualization';
}

// 调试消息
export interface DebugMessage extends BaseMessage {
  action: 'debug';
  command: string;
}

// 页面活动消息
export interface PageActivityMessage extends BaseMessage {
  action: 'pageActivity';
  source: string;
}

// 链接点击消息
export interface LinkClickedMessage extends BaseMessage {
  action: 'linkClicked';
  linkInfo: {
    sourceNodeId: string;
    sourceUrl: string;
    targetUrl: string;
    isNewTab: boolean;
    timestamp: number;
  };
}

// 表单提交消息
export interface FormSubmittedMessage extends BaseMessage {
  action: 'formSubmitted';
  formInfo: {
    sourceNodeId: string;
    sourceUrl: string;
    formAction: string;
    method: string;
    timestamp: number;
  };
}

// JS导航消息
export interface JsNavigationMessage extends BaseMessage {
  action: 'jsNavigation';
  sourceNodeId: string;
  sourceUrl: string;
  targetUrl: string;
  navigationType: 'pushState' | 'replaceState';
  timestamp: number;
}

// 消息响应接口
export interface ResponseMessage {
  success: boolean;
  action: string;
  requestId?: string;
  timestamp?: number;
  error?: string;
}

// 消息处理函数类型
export type MessageHandler<T extends BaseMessage = BaseMessage> = (
  message: T,
  sender: chrome.runtime.MessageSender | { source: string },
  sendResponse: (response: ResponseMessage) => void
) => boolean;

// 联合类型，包含所有可能的消息类型
export type Message = 
  | RefreshVisualizationMessage
  | DebugMessage
  | PageActivityMessage
  | LinkClickedMessage
  | FormSubmittedMessage
  | JsNavigationMessage;