import { Logger } from '../../../lib/utils/logger.js';
import { BackgroundMessageService } from '../bg-message-service.js';
import { BackgroundMessages, BackgroundResponses } from '../../../types/messages/background.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';

const logger = new Logger('TabHandlers');

/**
 * 注册标签页相关的消息处理程序
 */

export function registerTabHandlers(messageService: BackgroundMessageService): void {
  // 保留原有的getTabId处理程序实现方式，确保功能一致
  messageService.registerHandler('getTabId', (
    message: BackgroundMessages.GetTabIdRequest, 
    sender: chrome.runtime.MessageSender, 
    sendResponse: (response: BackgroundResponses.GetTabIdResponse) => void
  ) => {
    const ctx = messageService.createMessageContext(message, sender, sendResponse);
    
    if (sender.tab && sender.tab.id !== undefined) {
      ctx.success({ tabId: sender.tab.id });
    } else {
      logger.warn(i18n('tab_handlers_warn_no_tab_id', 'getTabId请求未能获取到标签页ID，可能是从非标签页上下文发起的请求'));
      ctx.error(i18n('tab_handlers_error_unknown_tab', '无法确定标签页，请求可能来自扩展页面或弹出窗口'));
    }
    
    return false; // 不需要异步响应
  });
  logger.log(i18n('tab_handlers_log_registered', '标签页相关消息处理程序已注册'));
}

