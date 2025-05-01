/**
 * Navigraph - 浏览历史可视化扩展
 * 主入口文件
 */

// 使用立即执行的异步函数闭包
(async function() {
  // 用于控制页面活动事件频率的变量
  let lastActivityTime = 0;
  const MIN_ACTIVITY_INTERVAL = 5000; // 最少5秒触发一次

  const { Logger } = await import('../lib/utils/logger.js');
  const logger = new Logger('ContentScript');

  const { I18nUtils, i18n, I18nError } = await import('../lib/utils/i18n-utils.js');

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
        const settingsModule = await import('../lib/settings/service.js');
        const settingsService = settingsModule.getSettingsService();
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
        const messageServiceModule = await import('./messaging/content-message-service.js');
        messageServiceModule.setupMessageService();
        const handlerModule = await import('./messaging/index.js');
        handlerModule.registerContentMessageHandlers();
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
      let themeManager;
      try {
        const themeManagerModule = await import('./utils/theme-manager.js');
        themeManager = themeManagerModule.getThemeManager();
        themeManager.initialize();
      } catch (error) {
        // 主题管理器初始化失败（警告）
        logger.warn('content_theme_init_failed', error);
      }

      // 导入并创建可视化器
      let NavigationVisualizer;
      try {
        const visualizerModule = await import('./core/navigation-visualizer.js');
        NavigationVisualizer = visualizerModule.NavigationVisualizer;
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
      // 初始化过程中发生错误
      logger.error('content_init_error', error);
      showErrorMessage('content_init_failed',
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
        logger.log(`检测到页面活动(${source})，触发刷新`);
        
        // 修改为只刷新视图，不重新加载会话数据
        if (window.visualizer && typeof window.visualizer.refreshVisualization === 'function') {
          window.visualizer.refreshVisualization(undefined, { 
            skipSessionEvents: true,  // 防止触发会话事件
            source: 'pageActivity'
          });
        } else {
          logger.warn('可视化器实例不存在或没有刷新方法');
        }
      } else {
        logger.debug(`页面活动(${source})距离上次时间过短(${now - lastActivityTime}ms)，忽略`);
      }
    } catch (error) {
      logger.error(`处理页面活动(${source})失败:`, error);
    }
  }
    
  /**
   * 错误UI管理器
   * 管理预定义的错误UI组件
   */
  const ErrorUIManager = {
    /**
     * 显示标准错误消息
     * @param messageId 错误消息ID
     * @param params 消息替换参数
     */
    showErrorMessage(messageId: string, ...params: string[]): void {
      try {
        // 获取本地化消息
        const message = i18n(messageId);
        const formattedMessage = this.formatMessage(message, params);
        
        const errorContainer = document.getElementById('navigraph-error');
        if (!errorContainer) {
          logger.error('找不到错误UI容器，降级到alert');
          this.showNativeAlert('content_extension_error', formattedMessage);
          return;
        }
        
        const messageEl = errorContainer.querySelector('.error-message');
        if (messageEl) {
          messageEl.textContent = formattedMessage;
        }
        
        errorContainer.style.display = 'block';
      } catch (err) {
        logger.error('显示错误UI失败:', err);
        alert(messageId); // 直接显示消息ID，以便快速发现问题
      }
    },
    
    /**
     * 显示详细的错误消息
     * @param titleId 标题消息ID
     * @param error 错误对象
     */
    showDetailedErrorMessage(titleId: string, error: any): void {
      try {
        const title = i18n(titleId);
        
        const errorContainer = document.getElementById('navigraph-error-detailed');
        if (!errorContainer) {
          this.showErrorMessage(titleId, (error instanceof Error ? error.message : String(error)));
          return;
        }
        
        // 设置标题
        const titleEl = errorContainer.querySelector('.error-title');
        if (titleEl) {
          titleEl.textContent = title;
        }
        
        // 设置错误消息
        const messageEl = errorContainer.querySelector('.error-message');
        if (messageEl) {
          messageEl.textContent = error instanceof Error ? error.message : String(error);
        }
        
        // 检查是否有堆栈信息
        const hasStack = error instanceof Error && error.stack;
        
        // 设置错误堆栈
        const stackEl = errorContainer.querySelector('.error-stack');
        if (stackEl) {
          stackEl.textContent = hasStack ? (error.stack ?? '') : '';
        }
        
        // 控制详情元素
        const detailsEl = errorContainer.querySelector('details');
        if (detailsEl) {
          // 如果有堆栈信息，则设置open属性
          if (hasStack) {
            detailsEl.setAttribute('open', '');  // 打开详情
          } else {
            detailsEl.removeAttribute('open');   // 关闭详情
            detailsEl.style.display = 'none';    // 完全隐藏详情部分
          }
        }
        
        // 显示容器
        errorContainer.style.display = 'block';
      } catch (err) {
        logger.error('显示详细错误UI失败:', err);
        this.showErrorMessage(titleId, (error instanceof Error ? error.message : String(error)));
      }
    },
    
    /**
     * 显示通知消息
     * @param messageId 通知消息ID
     * @param duration 显示时长（毫秒）
     * @param params 消息替换参数
     */
    showToast(messageId: string, duration: number = 5000, ...params: string[]): void {
      try {
        const message = i18n(messageId);
        const formattedMessage = this.formatMessage(message, params);
        
        const toastEl = document.getElementById('navigraph-toast');
        if (!toastEl) return;
        
        toastEl.textContent = formattedMessage;
        toastEl.style.display = 'block';
        
        // 设置自动隐藏
        setTimeout(() => {
          if (toastEl) {
            toastEl.style.display = 'none';
          }
        }, duration);
      } catch (err) {
        logger.error('显示通知消息失败:', err);
      }
    },

    /**
     * 显示系统原生警告框
     * @param prefixId 前缀消息ID
     * @param message 消息内容
     */
    showNativeAlert(prefixId: string, message: string): void {
      const prefix = i18n(prefixId);
      alert(`${prefix} ${message}`);
    },

    /**
     * 格式化消息，替换参数标记
     * @param message 消息模板
     * @param params 替换参数
     * @returns 格式化后的消息
     */
    formatMessage(message: string, params: string[] = []): string {
      if (!params || params.length === 0) return message;
      
      let result = message;
      for (let i = 0; i < params.length; i++) {
        result = result.replace(new RegExp(`\\{${i}\\}`, 'g'), params[i]);
      }
      return result;
    }
  };

  /**
   * 显示标准错误消息（便捷方法）
   * @param messageId 错误消息ID
   * @param params 消息替换参数
   */
  function showErrorMessage(messageId: string, ...params: string[]): void {
    ErrorUIManager.showErrorMessage(messageId, ...params);
  }

  /**
   * 显示详细的错误消息（便捷方法）
   * @param titleId 标题消息ID
   * @param error 错误对象
   */
  function showDetailedErrorMessage(titleId: string, error: any): void {
    ErrorUIManager.showDetailedErrorMessage(titleId, error);
  }

  /**
   * 显示通知消息（便捷方法）
   * @param messageId 通知消息ID
   * @param duration 显示时长（毫秒）
   * @param params 消息替换参数
   */
  function showToast(messageId: string, duration?: number, ...params: string[]): void {
    ErrorUIManager.showToast(messageId, duration || 5000, ...params);
  }

  /**
   * 显示系统原生警告框（便捷方法）
   * @param prefixId 前缀消息ID
   * @param message 消息内容
   */
  function showNativeAlert(prefixId: string, message: string): void {
    ErrorUIManager.showNativeAlert(prefixId, message);
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
