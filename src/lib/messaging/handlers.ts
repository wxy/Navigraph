import { Logger } from '../../lib/utils/logger.js';
import { BaseResponse } from '../../types/messages/common.js';

const logger = new Logger('MessageHandlers');
/**
 * 创建成功响应
 * @param action 消息动作
 * @param requestId 请求ID
 * @param data 响应数据
 */
export function createSuccessResponse<T extends Omit<BaseResponse, 'success' | 'requestId' | 'error'>>(
  action: string,
  requestId: string,
  data: T = {} as T
): T & BaseResponse {
  return {
    success: true,
    requestId,
    ...data
  };
}

/**
 * 创建错误响应
 * @param action 消息动作
 * @param requestId 请求ID
 * @param error 错误信息
 * @param data 额外数据
 */
export function createErrorResponse<T extends Omit<BaseResponse, 'success' | 'requestId' | 'error'>>(
  action: string,
  requestId: string,
  error: string,
  data: T = {} as T
): T & BaseResponse {
  return {
    success: false,
    requestId,
    error,
    ...data
  };
}

/**
 * 创建消息上下文
 * 提供便捷方法来创建成功和错误响应
 */
export function createMessageContext<TRequest, TResponse extends BaseResponse>(
  message: TRequest & { requestId: string; action: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: TResponse) => void
) {
  return {
    message,
    sender,
    success: (data: Omit<TResponse, 'success' | 'requestId' | 'error'> = {} as any) => {
      sendResponse({
        success: true,
        requestId: message.requestId,
        ...data
      } as TResponse);
    },
    error: (errorMessage: string, data: Partial<Omit<TResponse, 'success' | 'requestId' | 'error'>> = {}) => {
      sendResponse({
        success: false,
        requestId: message.requestId,
        error: errorMessage,
        ...data
      } as TResponse);
    }
  };
}