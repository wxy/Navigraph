/**
 * 主要的后台脚本，负责初始化和协调各个组件
 */
import { Logger } from '../lib/utils/logger.js';
import { _, _Error, I18n } from '../lib/utils/i18n.js';
import { NavigationManager, setNavigationManager } from './navigation/navigation-manager.js';
import { getSettingsService } from '../lib/settings/service.js';
import { setupEventListeners } from './lib/event-listeners.js';
import { setupContextMenus } from './lib/context-menus.js';
import { getBackgroundMessageService, registerAllBackgroundHandlers } from './messaging/bg-message-service.js';
import { SessionManager, setSessionManager } from './session/session-manager.js';

// 声明但不立即初始化（模块级别变量）
let settingsService: any;
let sessionManager: SessionManager;
let navigationManager: NavigationManager;
let messageService: ReturnType<typeof getBackgroundMessageService>; // 使用泛型而非具体类型
const logger = new Logger('Background');

export function getMessageService() {
  if (!messageService) {
    throw new _Error('background_message_service_not_initialized', 'MessageService 尚未初始化');
  }
  return messageService;
}

/**
 * 初始化后台脚本
 */
async function initialize(): Promise<void> {
  try {
    logger.log(_('background_startup_begin', 'Navigraph 后台脚本启动'));
    logger.log(_('background_init_start', '初始化后台服务...'));
    
    // 1. 首先创建消息服务实例
    logger.log(_('background_message_service_init_start', '初始化消息服务...'));
    messageService = getBackgroundMessageService();    
    // 2. 注册基础消息处理程序（tab和settings相关）
    logger.log(_('background_register_base_handlers_start', '注册基础消息处理程序...'));
    registerAllBackgroundHandlers();
    
    // 3. 然后创建设置服务
    logger.log(_('background_settings_service_init_start', '初始化设置服务...'));
    settingsService = getSettingsService();
    await settingsService.initialize();
    // 如果管理员/用户通过设置强制了语言，应用到后台上下文（有助于后台消息或调试输出的一致性）
    try {
      const forced = settingsService.getSetting('forcedLocale') as string | undefined;
      if (forced && forced !== 'system') {
        await I18n.getInstance().setLocale(forced);
      } else if (forced === 'system') {
        await I18n.getInstance().setLocale(null);
      }
    } catch (e) {
      logger.debug(_('background_apply_forced_locale_failed', '后台应用强制语言失败: {0}'), String(e));
    }
        
    // 4. 会话管理器
    logger.log(_('background_session_manager_init_start', '初始化会话管理器...'));
    sessionManager = new SessionManager();
    setSessionManager(sessionManager);

    // 5. 导航管理器
    logger.log(_('background_nav_manager_init_start', '初始化导航管理器...'));
    navigationManager = new NavigationManager(messageService);    
    setNavigationManager(navigationManager);

    // 为避免交叉依赖，一起初始化
    await sessionManager.initialize();
    await navigationManager.initialize();

    // 6. 注册会话管理器消息处理程序
    logger.log(_('background_register_session_handlers_start', '注册会话管理器消息处理程序...'));
    sessionManager.registerMessageHandlers(messageService);
    
    // 7. 设置事件监听器和上下文菜单
    setupEventListeners();
    setupContextMenus();

    logger.log(_('background_init_complete', '导航图谱后台初始化成功'));
  } catch (error) {
    logger.error(_('background_init_failed', '导航图谱后台初始化失败'), error);
  }
}

// 启动初始化
initialize();