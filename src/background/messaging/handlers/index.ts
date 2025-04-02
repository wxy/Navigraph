import { Logger } from '../../../lib/utils/logger.js';
import * as tabHandlers from './tab.js';
import { BackgroundMessageService } from '../bg-message-service.js';

const logger = new Logger('TabHandlers');
// 导出所有处理程序
export { tabHandlers };

/**
 * 注册所有标签页相关处理程序
 */
export function registerTabHandlers(messageService: BackgroundMessageService): void {
  messageService.registerHandler('getTabId', tabHandlers.getTabId);
  
  logger.log('标签页相关消息处理程序已注册');
}
