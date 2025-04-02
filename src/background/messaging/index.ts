import { Logger } from '../../lib/utils/logger.js';
import { getBackgroundMessageService } from './bg-message-service.js';
import { registerTabHandlers, registerSettingsHandlers } from './handlers/index.js';

const logger = new Logger('BackgroundMessaging');
/**
 * 注册所有后台消息处理程序
 */
export function registerAllBackgroundHandlers(): void {
  const messageService = getBackgroundMessageService();
  
  logger.groupCollapsed('正在注册后台消息处理程序...');
  
  // 仅注册实际需要的处理程序
  registerTabHandlers(messageService);
  registerSettingsHandlers(messageService);
  
  logger.groupEnd();
}

// 导出后台消息服务获取函数
export { getBackgroundMessageService } from './bg-message-service.js';