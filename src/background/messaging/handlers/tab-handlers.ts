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
      logger.warn('tab_handlers_warn_no_tab_id');
      ctx.error('tab_handlers_error_unknown_tab');
    }
    
    return false; // 不需要异步响应
  });
  logger.log('tab_handlers_log_registered');
}

