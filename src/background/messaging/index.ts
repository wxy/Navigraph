import { getBackgroundMessageService } from './bg-message-service.js';
import { registerTabHandlers } from './handlers/tab-handlers.js';
import { registerSettingsHandlers } from './handlers/settings-handlers.js';

/**
 * 注册所有后台消息处理程序
 */
export function registerAllBackgroundHandlers(): void {
  const messageService = getBackgroundMessageService();
  
  console.log('正在注册后台消息处理程序...');
  
  // 仅注册实际需要的处理程序
  registerTabHandlers(messageService);
  registerSettingsHandlers(messageService);
  
  console.log('后台消息处理程序注册完成');
}

// 导出后台消息服务获取函数
export { getBackgroundMessageService } from './bg-message-service.js';