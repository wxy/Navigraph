import { Logger } from '../../lib/utils/logger.js';
import { getContentMessageService } from './content-message-service.js';
import { registerUIHandlers } from './handlers/ui-handlers.js';
import { registerTrackingHandlers } from './handlers/tracking-handlers.js';
import { i18n } from '../../lib/utils/i18n-utils.js';

const logger = new Logger('ContentMessageHandlers');

/**
 * 注册所有内容脚本消息处理程序
 */
export function registerContentMessageHandlers(): void {
  const messageService = getContentMessageService();
  
  logger.groupCollapsed('content_message_registering_handlers');
  
  try {
    // 注册UI相关处理程序
    registerUIHandlers(messageService);
    
    // 注册跟踪相关处理程序
    registerTrackingHandlers(messageService);
    
    logger.groupEnd();
  } catch (error) {
    logger.error('content_message_registration_failed', 
      error instanceof Error ? error.message : String(error));
  }
}

// 导出内容脚本消息服务获取函数
export { getContentMessageService } from './content-message-service.js';