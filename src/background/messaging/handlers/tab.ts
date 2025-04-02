import { Logger } from '../../../lib/utils/logger.js';
import type { BackgroundMessages, BackgroundResponses } from '../../../types/messages/background.js';
import { createSuccessResponse, createErrorResponse } from '../../../lib/messaging/handlers.js';

const logger = new Logger('TabHandlers');

/**
 * 获取当前标签页ID
 */
export function getTabId(
  message: BackgroundMessages.GetTabIdRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponses.GetTabIdResponse) => void
): boolean {
  logger.log('处理getTabId请求', sender.tab?.id);
  
  if (sender.tab && sender.tab.id !== undefined) {
    sendResponse(createSuccessResponse('getTabId', message.requestId, { 
      tabId: sender.tab.id 
    }));
  } else {
    logger.warn('getTabId请求未能获取到标签页ID，可能是从非标签页上下文发起的请求');
    sendResponse(createErrorResponse('getTabId', message.requestId,
      '无法确定标签页，请求可能来自扩展页面或弹出窗口'
    ));
  }
  
  return false; // 不需要异步响应
}
