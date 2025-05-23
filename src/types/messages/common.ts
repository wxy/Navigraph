/**
 * 消息目标类型
 */
export type MessageTarget = 'background' | 'content' | 'popup' | 'options';

/**
 * 基础消息接口
 */
export interface BaseMessage {
  /** 消息动作 */
  action: string;
  
  /** 请求ID */
  requestId: string;
  
  /** 目标接收者 */
  target: MessageTarget;
}

/**
 * 基础响应消息
 */
export interface BaseResponse {
  /** 操作是否成功 */
  success: boolean;
  
  /** 错误信息(如果有) */
  error?: string;
  
  /** 请求ID(用于匹配请求与响应) */
  requestId: string;
}

/**
 * 消息处理函数类型
 */
export type MessageHandler<TRequest extends BaseMessage, TResponse extends BaseResponse> = 
  (message: TRequest, sender: chrome.runtime.MessageSender, sendResponse: (response: TResponse) => void) => boolean;

/**
 * 消息重试相关信息
 */
export type RetryInfo = {
  /** 是否是重试请求 */
  isRetrying: boolean;
  /** 是否是最后一次尝试 */
  isLastAttempt: boolean;
  /** 当前是第几次尝试 (0表示首次尝试) */
  attempt: number;
  /** 最大尝试次数 */
  maxRetries: number;
};