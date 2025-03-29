import * as tabHandlers from './tab.js';
import * as navigationHandlers from './navigation.js';
import { BackgroundMessageService } from '../bg-message-service.js';

// 导出所有处理程序
export { tabHandlers, navigationHandlers };

/**
 * 注册所有标签页相关处理程序
 */
export function registerTabHandlers(messageService: BackgroundMessageService): void {
  messageService.registerHandler('getTabId', tabHandlers.getTabId);
  
  console.log('标签页相关消息处理程序已注册');
}

/**
 * 注册所有导航相关处理程序
 */
export function registerNavigationHandlers(messageService: BackgroundMessageService): void {
  messageService.registerHandler('getNodeId', navigationHandlers.getNodeId);
  
  console.log('导航相关消息处理程序已注册');
}