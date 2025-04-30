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
    logger.log('初始化 Navigraph 可视化...');
    
    try {
      // 初始化配置管理器
      logger.log('初始化配置管理...');
      try {
        const settingsModule = await import('../lib/settings/service.js');
        const settingsService = settingsModule.getSettingsService();
        await settingsService.initialize();
        // 将设置保存为全局变量以便访问
        window.navigraphSettings = settingsService.getSettings();
        logger.log('全局设置已加载:', window.navigraphSettings);
      } catch (error) {
        logger.error(i18n('content_config_init_failed'), error);
        // 使用 I18nError 抛出本地化错误
        throw new I18nError(
          'content_config_load_failed',
          error instanceof Error ? error.message : String(error)
        );
      }

      // 初始化消息服务
      logger.log('初始化消息服务...');
      try {
        const messageServiceModule = await import('./messaging/content-message-service.js');
        messageServiceModule.setupMessageService();
        const handlerModule = await import('./messaging/index.js');
        handlerModule.registerContentMessageHandlers();
        logger.log('消息服务初始化完成');
      } catch (error) {
        logger.error(i18n('content_message_service_init_failed'), error);
        // 使用 I18nError 抛出本地化错误
        throw new I18nError(
          'content_message_service_init_failed',
          error instanceof Error ? error.message : String(error)
        );
      }
    
      // 初始化主题管理器
      logger.log('初始化主题管理器...');
      let themeManager;
      try {
        const themeManagerModule = await import('./utils/theme-manager.js');
        themeManager = themeManagerModule.getThemeManager();
        themeManager.initialize();
      } catch (error) {
        // 主题管理器失败不是关键错误，记录但继续
        logger.error('主题管理器初始化失败:', error);
        // 不抛出异常，继续执行
      }
      
      // 导入并创建可视化器
      let visualizerModule, NavigationVisualizer;
      try {
        visualizerModule = await import('./core/navigation-visualizer.js');
        NavigationVisualizer = visualizerModule.NavigationVisualizer;
        
        // 创建可视化器实例
        window.visualizer = new NavigationVisualizer();
        
        // 为了兼容性考虑
        window.NavigationVisualizer = NavigationVisualizer;
        
        // 初始化视觉化器
        await window.visualizer.initialize();
        
        logger.log('Navigraph 可视化器初始化成功');
      } catch (error) {
        logger.error(i18n('content_visualizer_init_failed'), error);
        showDetailedErrorMessage('content_visualizer_init_failed', error);
        // 使用 I18nError 抛出本地化错误
        throw new I18nError(
          'content_visualizer_init_failed',
          error instanceof Error ? error.message : String(error)
        );
      }
      
      // 设置页面活动监听器
      setupPageActivityListeners();

      logger.log('所有初始化逻辑完成');
    } catch (error) {
      logger.error('初始化过程中发生错误:', error);
      showErrorMessage('content_init_failed', (error instanceof Error ? error.message : String(error)));
      
      // 记录更详细的错误信息用于调试
      if (error instanceof Error && error.stack) {
        logger.error('错误堆栈:', error.stack);
      }
    }
  }
      
  /**
   * 应用主题设置
   * 直接使用已加载的全局设置
   */
  function applyThemeFromSettings(themeManager: any): void {
    try {
      logger.log('从全局设置应用主题...');
      
      // 从全局设置中获取主题设置
      if (window.navigraphSettings && window.navigraphSettings.theme) {
        const themeSetting = window.navigraphSettings.theme;
        logger.log('应用主题设置:', themeSetting);
        themeManager.applyTheme(themeSetting);
      } else {
        // 如果全局设置中没有主题设置，使用系统主题
        logger.log('全局设置中没有主题设置，使用系统主题');
        themeManager.applyTheme('system');
      }
    } catch (error) {
      logger.error('应用主题设置失败:', error);
      // 出错时尝试应用系统主题
      try {
        themeManager.applyTheme('system');
      } catch (e) {
        // 如果连这个也失败，只记录错误
        logger.error('无法应用系统主题:', e);
      }
    }
  }

  /**
   * 设置页面活动监听器
   * 监听页面可见性变化和焦点获取事件
   */
  function setupPageActivityListeners() {
    try {
      logger.log('设置页面活动监听器...');
      
      // 监听页面可见性变化
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          logger.log('页面变为可见状态');
          triggerPageActivity('visibility');
        }
      });
      
      // 监听页面获得焦点
      window.addEventListener('focus', () => {
        logger.log('页面获得焦点');
        triggerPageActivity('focus');
      });
      
      logger.log('页面活动监听器设置完成');
    } catch (error) {
      // 监听器设置失败不是关键错误，只记录
      logger.error('设置页面活动监听器失败:', error);
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
    // 检查 DOM 是否已经加载
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      // 如果 DOM 已加载完成，直接初始化
      await I18nUtils.getInstance().apply();
      await initialize();
    }
  } catch (error) {
    logger.error('启动初始化过程失败:', error);
    // 尝试显示错误，即使在DOM加载前
    setTimeout(() => showErrorMessage('content_startup_error', (error instanceof Error ? error.message : String(error))), 500);
  }
})().catch(error => {
  // 捕获闭包函数本身可能抛出的任何错误
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
