import { NavigationManager } from './navigation-manager.js';
import { MessageContext } from './lib/message-context.js';
import { getSettingsService } from '../lib/settings/service.js';
import { setupEventListeners } from './lib/event-listeners.js';
import { setupContextMenus } from './lib/context-menus.js';
import { handleMessage } from './lib/message-handler.js';

/**
 * 主要的后台脚本，负责初始化和协调各个组件
 */

// 获取设置服务实例
const settingsService = getSettingsService();

// 创建导航节点管理器实例
const navigationManager = new NavigationManager();

// 导出以便其他模块使用
export { navigationManager };

/**
 * 初始化后台脚本
 */
async function initialize(): Promise<void> {
  try {
    console.log('Navigraph 扩展已启动');
    console.log('导航图谱后台初始化开始...');
    
    // 首先初始化设置服务
    await settingsService.initialize();
    
    // 获取存储实例
    const storage = navigationManager.getStorage();
    
    // 初始化存储
    await storage.initialize();
    
    // 初始化NavigationManager
    await navigationManager.initialize();
    
    // 设置事件监听器（包括扩展安装、图标点击等）
    setupEventListeners(navigationManager);
    
    // 设置上下文菜单
    setupContextMenus(navigationManager);
    
    // 设置消息处理
    setupMessageHandler();
    
    console.log('导航图谱后台初始化成功');
  } catch (error) {
    console.error('导航图谱后台初始化失败:', error);
  }
}

/**
 * 设置消息处理器
 */
function setupMessageHandler(): void {
  // 处理扩展消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 转发给消息处理模块
    return handleMessage(message, sender, sendResponse, navigationManager);
  });
}

// 启动初始化
initialize();