import { getContentMessageService } from './content-message-service.js';
import { registerUIHandlers } from './handlers/ui-handlers.js';
import { registerTrackingHandlers } from './handlers/tracking-handlers.js';

/**
 * 注册所有内容脚本消息处理程序
 */
export function registerContentMessageHandlers(): void {
  const messageService = getContentMessageService();
  
  console.log('正在注册内容脚本消息处理程序...');
  
  try {
    // 注册UI相关处理程序
    registerUIHandlers(messageService);
    
    // 注册跟踪相关处理程序
    registerTrackingHandlers(messageService);
    
    console.log('内容脚本消息处理程序注册完成，已注册:', messageService.getRegisteredActions());
  } catch (error) {
    console.error('注册内容脚本消息处理程序失败:', error);
  }
}

// 导出内容脚本消息服务获取函数
export { getContentMessageService } from './content-message-service.js';