/**
 * 主要的后台脚本，负责初始化和协调各个组件
 */
import { NavigationManager } from './navigation-manager.js';
import { getSettingsService } from '../lib/settings/service.js';
import { setupEventListeners } from './lib/event-listeners.js';
import { setupContextMenus } from './lib/context-menus.js';
import { getBackgroundMessageService, BackgroundMessageService } from './lib/bg-message-service.js';

// 声明但不立即初始化（模块级别变量）
let settingsService: any;
let navigationManager: NavigationManager;
let messageService: BackgroundMessageService; // 使用正确的类型

// 导出访问器函数，而不是直接导出实例
export function getNavigationManager(): NavigationManager {
  if (!navigationManager) {
    throw new Error('NavigationManager 尚未初始化');
  }
  return navigationManager;
}

export function getMessageService(): BackgroundMessageService {
  if (!messageService) {
    throw new Error('MessageService 尚未初始化');
  }
  return messageService;
}

/**
 * 注册基础消息处理程序
 * @param service 消息服务实例
 */
function registerBasicMessageHandlers(service: BackgroundMessageService): void {
  // 获取当前标签页ID的工具函数
  service.registerHandler('getTabId', (message, sender, sendResponse) => {
    const ctx = service.createMessageContext(message, sender, sendResponse);
    
    if (sender.tab && sender.tab.id !== undefined) {
      ctx.success({ tabId: sender.tab.id });
    } else {
      console.warn('getTabId请求未能获取到标签页ID，可能是从非标签页上下文发起的请求');
      ctx.error('无法确定标签页，请求可能来自扩展页面或弹出窗口');
    }
    
    return false; // 不需要异步响应
  });
  
  // 可以在这里添加其他基础消息处理程序
}

/**
 * 初始化后台脚本
 */
async function initialize(): Promise<void> {
  try {
    console.log('Navigraph 扩展已启动');
    console.log('导航图谱后台初始化开始...');
    
    // 1. 首先创建消息服务实例
    console.log('初始化消息服务...');
    messageService = getBackgroundMessageService();
    
    // 2. 立即注册基础消息处理程序
    console.log('注册基础消息处理程序...');
    registerBasicMessageHandlers(messageService); // 传入消息服务实例
    console.log('基础消息处理程序注册完成');
    
    // 3. 然后创建设置服务
    console.log('初始化设置服务...');
    settingsService = getSettingsService();
    await settingsService.initialize();
    
    // 4. 最后创建导航管理器
    console.log('创建导航管理器...');
    // 将消息服务作为依赖传入，确保导航管理器使用已初始化的消息服务
    navigationManager = new NavigationManager(messageService);
    
    // 5. 初始化存储和导航管理器
    const storage = navigationManager.getStorage();
    await storage.initialize();
    await navigationManager.initialize();
    
    // 6. 设置事件监听器和上下文菜单
    setupEventListeners(navigationManager);
    setupContextMenus(navigationManager);
    
    console.log('导航图谱后台初始化成功');
  } catch (error) {
    console.error('导航图谱后台初始化失败:', error);
  }
}

// 启动初始化
initialize();