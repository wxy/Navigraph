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
  //registerSettingsHandlers(messageService);
  
  // 不再直接注册navigation处理程序，而是通过NavigationManager来处理
  // registerNavigationHandlers(messageService); // 移除此行
  
  console.log('后台消息处理程序注册完成');
}

// 导出后台消息服务获取函数
export { getBackgroundMessageService } from './bg-message-service.js';