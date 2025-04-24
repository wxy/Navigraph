/**
 * 主要的后台脚本，负责初始化和协调各个组件
 */
import { Logger } from '../lib/utils/logger.js';
import { NavigationManager, setNavigationManager } from './navigation-manager.js';
import { getSettingsService } from '../lib/settings/service.js';
import { setupEventListeners } from './lib/event-listeners.js';
import { setupContextMenus } from './lib/context-menus.js';
import { getBackgroundMessageService, registerAllBackgroundHandlers } from './messaging/bg-message-service.js';
import { BackgroundSessionManager, getBackgroundSessionManager, setBackgroundSessionManager } from './session/bg-session-manager.js';
import { Session } from 'inspector/promises';
import { SessionMetadata } from '../types/session-types.js';

// 声明但不立即初始化（模块级别变量）
let settingsService: any;
let sessionManager: BackgroundSessionManager
let navigationManager: NavigationManager;
let messageService: ReturnType<typeof getBackgroundMessageService>; // 使用泛型而非具体类型
const logger = new Logger('Background');

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
    logger.log('Navigraph 扩展已启动');
    logger.log('导航图谱后台初始化开始...');
    
    // 1. 首先创建消息服务实例
    logger.log('初始化消息服务...');
    messageService = getBackgroundMessageService();    
    // 2. 注册基础消息处理程序（tab和settings相关）
    logger.log('注册基础消息处理程序...');
    registerAllBackgroundHandlers();
    
    // 3. 然后创建设置服务
    logger.log('初始化设置服务...');
    settingsService = getSettingsService();
    await settingsService.initialize();
        
    // 4. 会话管理器
    logger.log('初始化会话管理器...');
    sessionManager = new BackgroundSessionManager();
    setBackgroundSessionManager(sessionManager);

    // 5. 导航管理器
    logger.log('初始化导航管理器...');
    navigationManager = new NavigationManager(messageService);    
    setNavigationManager(navigationManager);

    // 初始化
    await sessionManager.initialize();
    await navigationManager.initialize();
    
    // 6. 注册会话管理器的消息处理程序
    logger.log('注册会话管理器消息处理程序...');
    sessionManager.registerMessageHandlers(messageService);
    
    // 7. 设置事件监听器和上下文菜单
    setupEventListeners();
    setupContextMenus();

    logger.log('导航图谱后台初始化成功');
  } catch (error) {
    logger.error('导航图谱后台初始化失败:', error);
  }
}

// 启动初始化
initialize();