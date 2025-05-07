/**
 * Navigraph - 浏览历史可视化扩展
 * 主入口文件
 */

// 使用立即执行的异步函数闭包
(async function() {
  // 用于控制页面活动事件频率的变量
  let lastActivityTime = 0;
  const MIN_ACTIVITY_INTERVAL = 5000; // 最少5秒触发一次

  // 集中导入所有需要的模块
  const { Logger } = await import('../lib/utils/logger.js');
  const { I18nUtils, i18n, I18nError } = await import('../lib/utils/i18n-utils.js');
  const { showErrorMessage, showDetailedErrorMessage } = await import('./utils/error-ui-manager.js');
  const { getSettingsService } = await import('../lib/settings/service.js');
  const { setupMessageService } = await import('./messaging/content-message-service.js');
  const { registerContentMessageHandlers } = await import('./messaging/index.js');
  const { getThemeManager } = await import('./utils/theme-manager.js');
  const { NavigationVisualizer } = await import('./core/navigation-visualizer.js');
  
  const logger = new Logger('ContentScript');

  /**
   * 初始化函数
   */
  async function initialize() {
    // 开始初始化
    logger.log('content_init_start');

    try {
      // 初始化配置管理器
      logger.log('content_config_init_start');
      try {
        const settingsService = getSettingsService();
        await settingsService.initialize();
        window.navigraphSettings = settingsService.getSettings();
        // 全局设置已加载
        logger.log('content_settings_loaded', JSON.stringify(window.navigraphSettings));
      } catch (error) {
        // 配置管理器初始化失败
        logger.error('content_config_init_failed', error);
        throw new I18nError(
          'content_config_load_failed',
          error instanceof Error ? error.message : String(error)
        );
      }

      // 初始化消息服务
      logger.log('content_message_service_init_start');
      try {
        setupMessageService();
        registerContentMessageHandlers();
        // 消息服务初始化完成
        logger.log('content_message_service_initialized');
      } catch (error) {
        logger.error('content_message_service_init_failed', error);
        throw new I18nError(
          'content_message_service_init_failed',
          error instanceof Error ? error.message : String(error)
        );
      }

      // 初始化主题管理器
      logger.log('content_theme_init_start');
      try {
        getThemeManager().initialize();
      } catch (error) {
        // 主题管理器初始化失败（警告）
        logger.warn('content_theme_init_failed', error);
      }

      // 创建并初始化可视化器
      try {
        window.visualizer = new NavigationVisualizer();
        window.NavigationVisualizer = NavigationVisualizer;
        await window.visualizer.initialize();
        // 可视化器初始化成功
        logger.log('content_visualizer_init_success');
      } catch (error) {
        logger.error('content_visualizer_init_failed', error);
        showDetailedErrorMessage('content_visualizer_init_failed', error);
        throw new I18nError(
          'content_visualizer_init_failed',
          error instanceof Error ? error.message : String(error)
        );
      }

      // 设置页面活动监听器
      logger.log('content_setup_page_activity_listeners_start');
      setupPageActivityListeners();

      // 所有初始化逻辑完成
      logger.log('content_init_complete');
    } catch (error) {
      // 处理错误逻辑保持不变
      logger.error('content_init_error', error);
      showErrorMessage(i18n('content_init_failed',"初始化失败:"),
        error instanceof Error ? error.message : String(error)
      );
      if (error instanceof Error && error.stack) {
        logger.error('content_init_stack', error.stack);
      }
    }
  }
  
  /**
   * 设置页面活动监听器
   * 监听页面可见性变化和焦点获取事件
   */
  function setupPageActivityListeners() {
    try {
      logger.log('content_listener_start');
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          logger.log('content_page_visible');
          triggerPageActivity('visibility');
        }
      });
      window.addEventListener('focus', () => {
        logger.log('content_page_focus');
        triggerPageActivity('focus');
      });
      logger.log('content_listener_ready');
    } catch (error) {
      logger.error('content_listener_failed', error);
    }
  }

  /**
   * 触发页面活动消息
   * @param source 触发源（'visibility' 或 'focus'）
   */
  function triggerPageActivity(source: string) {
    try {
      const now = Date.now();
      if (now - lastActivityTime > MIN_ACTIVITY_INTERVAL) {
        lastActivityTime = now;
        logger.log('content_page_activity_detected', source);
        
        // 修改为只刷新视图，不重新加载会话数据
        if (window.visualizer && typeof window.visualizer.refreshVisualization === 'function') {
          window.visualizer.refreshVisualization(undefined, { 
            skipSessionEvents: true,  // 防止触发会话事件
            source: 'pageActivity'
          });
        } else {
          logger.warn('content_visualizer_missing_or_invalid');
        }
      } else {
        logger.debug('content_page_activity_too_frequent', source, (now - lastActivityTime).toString());
      }
    } catch (error) {
      logger.error('content_page_activity_process_failed', source, error);
    }
  }
    
  // 启动初始化流程
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      await I18nUtils.getInstance().apply();
      await initialize();
    }
  } catch (error) {
    logger.error('content_startup_error', error);
    setTimeout(() => showErrorMessage(
      'content_startup_error',
      error instanceof Error ? error.message : String(error)
    ), 500);
  }
})().catch(error => {
  // 注意：此处故意保留英文，避免依赖本地化回退
  console.error('Critical error in content script:', error);
  // 尝试提供可见的错误反馈
  try {
    const msg = 'Navigraph extension error: ' + (error instanceof Error ? error.message : String(error));
    if (document.body) {
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;top:10px;right:10px;background:red;color:white;padding:10px;border-radius:5px;z-index:100000;';
      container.textContent = msg;
      document.body.appendChild(container);
    } else {
      // 如果DOM还不可用，等待它加载完成
      window.addEventListener('DOMContentLoaded', () => {
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;background:red;color:white;padding:10px;border-radius:5px;z-index:100000;';
        container.textContent = msg;
        document.body.appendChild(container);
      });
    }
  } catch (e) {
    // 最后的后备方案 - 至少显示一个警告
    setTimeout(() => alert('Navigraph extension error: ' + (error instanceof Error ? error.message : String(error))), 1000);
  }
});
