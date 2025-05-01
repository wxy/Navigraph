import { Logger } from '../../lib/utils/logger.js';
import { BaseResponse } from '../../types/messages/common.js';
import { i18n } from '../../lib/utils/i18n-utils.js';    // 新增

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
    error: i18n(error), // 本地化错误消息
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
    error: (msgOrId: string, ...params: any[]) => {
      // 本地化错误消息
      const localized = i18n(msgOrId, ...params);
      logger.error('handler_response_error', localized);  // 日志也本地化
      sendResponse({
        success: false,
        requestId: message.requestId,
        error: localized
      } as TResponse);
    }
  };
}