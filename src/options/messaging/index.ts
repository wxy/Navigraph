import { getOptionsMessageService } from './options-message-service.js';

/**
 * 注册所有选项页消息处理程序
 */
export function registerOptionsMessageHandlers(): void {
  const messageService = getOptionsMessageService();  

}

// 导出选项页消息服务获取函数
export { getOptionsMessageService } from './options-message-service.js';