/**
 * 主要的后台脚本，负责初始化和协调各个组件
 */
import { NavigationManager } from './navigation-manager.js';
import { getSettingsService } from '../lib/settings/service.js';
import { setupEventListeners } from './lib/event-listeners.js';
import { setupContextMenus } from './lib/context-menus.js';
// 修改导入，使用新的消息系统
import { getBackgroundMessageService } from './messaging/bg-message-service.js';
import { registerAllBackgroundHandlers } from './messaging/index.js';

// 声明但不立即初始化（模块级别变量）
let settingsService: any;
let navigationManager: NavigationManager;
let messageService: ReturnType<typeof getBackgroundMessageService>; // 使用泛型而非具体类型

// 导出访问器函数，而不是直接导出实例
export function getNavigationManager(): NavigationManager {
  if (!navigationManager) {
    throw new Error('NavigationManager 尚未初始化');
  }
  return navigationManager;
}

export function getMessageService() {
  if (!messageService) {
    throw new Error('MessageService 尚未初始化');
  }
  return messageService;
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
    
    // 2. 注册基础消息处理程序（tab和settings相关）
    console.log('注册基础消息处理程序...');
    registerAllBackgroundHandlers();
    console.log('基础消息处理程序注册完成');
    
    // 3. 然后创建设置服务
    console.log('初始化设置服务...');
    settingsService = getSettingsService();
    await settingsService.initialize();
    
    // 4. 最后创建导航管理器
    console.log('创建导航管理器...');
    navigationManager = new NavigationManager(messageService);
    
    // 导航管理器会在自己的构造函数中注册导航相关的消息处理程序
    
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