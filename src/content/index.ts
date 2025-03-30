/**
 * Navigraph - 浏览历史可视化扩展
 * 主入口文件
 */

// 使用立即执行的异步函数闭包
(async function() {
  // 用于控制页面活动事件频率的变量
  let lastActivityTime = 0;
  const MIN_ACTIVITY_INTERVAL = 5000; // 最少5秒触发一次

  /**
   * 初始化函数
   */
  async function initialize() {
    console.log('初始化 Navigraph 可视化...');
    
    try {
      // 初始化配置管理器
      console.log('初始化配置管理...');
      try {
        const settingsModule = await import('../lib/settings/service.js');
        const settingsService = settingsModule.getSettingsService();
        await settingsService.initialize();
        // 将设置保存为全局变量以便访问
        window.navigraphSettings = settingsService.getSettings();
        console.log('全局设置已加载:', window.navigraphSettings);
      } catch (error) {
        // 配置加载失败是关键错误，需要显示给用户
        console.error('配置管理初始化失败:', error);
        throw new Error('配置加载失败: ' + (error instanceof Error ? error.message : String(error)));
      }

      // 初始化消息服务
      console.log('初始化消息服务...');
      try {
        const messageServiceModule = await import('./messaging/content-message-service.js');
        messageServiceModule.setupMessageService();
        const handlerModule = await import('./messaging/index.js');
        handlerModule.registerContentMessageHandlers();
        console.log('消息服务初始化完成');
      } catch (error) {
        // 消息服务初始化失败是关键错误，需要显示给用户
        console.error('消息服务初始化失败:', error);
        throw new Error('消息系统初始化失败: ' + (error instanceof Error ? error.message : String(error)));
      }
    
      // 初始化主题管理器
      console.log('初始化主题管理器...');
      let themeManager;
      try {
        const themeManagerModule = await import('./utils/theme-manager.js');
        themeManager = themeManagerModule.getThemeManager();
        themeManager.initialize();
      } catch (error) {
        // 主题管理器失败不是关键错误，记录但继续
        console.error('主题管理器初始化失败:', error);
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
        
        console.log('Navigraph 可视化器初始化成功');
      } catch (error) {
        // 可视化器初始化失败是关键错误，需要显示给用户
        console.error('可视化器初始化失败:', error);
        showDetailedErrorMessage('可视化器初始化失败', error);
        throw error; // 重新抛出以确保后续代码不执行
      }
      
      // 设置页面活动监听器
      setupPageActivityListeners();

      console.log('所有初始化逻辑完成');
    } catch (error) {
      console.error('初始化过程中发生错误:', error);
      showErrorMessage('初始化失败: ' + (error instanceof Error ? error.message : String(error)));
      
      // 记录更详细的错误信息用于调试
      if (error instanceof Error && error.stack) {
        console.error('错误堆栈:', error.stack);
      }
    }
  }
      
  /**
   * 应用主题设置
   * 直接使用已加载的全局设置
   */
  function applyThemeFromSettings(themeManager: any): void {
    try {
      console.log('从全局设置应用主题...');
      
      // 从全局设置中获取主题设置
      if (window.navigraphSettings && window.navigraphSettings.theme) {
        const themeSetting = window.navigraphSettings.theme;
        console.log('应用主题设置:', themeSetting);
        themeManager.applyTheme(themeSetting);
      } else {
        // 如果全局设置中没有主题设置，使用系统主题
        console.log('全局设置中没有主题设置，使用系统主题');
        themeManager.applyTheme('system');
      }
    } catch (error) {
      console.error('应用主题设置失败:', error);
      // 出错时尝试应用系统主题
      try {
        themeManager.applyTheme('system');
      } catch (e) {
        // 如果连这个也失败，只记录错误
        console.error('无法应用系统主题:', e);
      }
    }
  }

  /**
   * 设置页面活动监听器
   * 监听页面可见性变化和焦点获取事件
   */
  function setupPageActivityListeners() {
    try {
      console.log('设置页面活动监听器...');
      
      // 监听页面可见性变化
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          console.log('页面变为可见状态');
          triggerPageActivity('visibility');
        }
      });
      
      // 监听页面获得焦点
      window.addEventListener('focus', () => {
        console.log('页面获得焦点');
        triggerPageActivity('focus');
      });
      
      console.log('页面活动监听器设置完成');
    } catch (error) {
      // 监听器设置失败不是关键错误，只记录
      console.error('设置页面活动监听器失败:', error);
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
        console.log(`检测到页面活动(${source})，触发刷新`);
        
        if (window.visualizer && typeof window.visualizer.triggerRefresh === 'function') {
          window.visualizer.triggerRefresh();
        } else {
          console.warn('可视化器实例不存在或没有刷新方法');
        }
      } else {
        console.debug(`页面活动(${source})距离上次时间过短(${now - lastActivityTime}ms)，忽略`);
      }
    } catch (error) {
      // 页面活动触发失败不需要用户可见反馈，只记录
      console.error(`处理页面活动(${source})失败:`, error);
    }
  }
    
  /**
   * 错误UI管理器
   * 管理预定义的错误UI组件
   */
  const ErrorUIManager = {
    /**
     * 显示标准错误消息
     * @param message 错误消息文本
     */
    showErrorMessage(message: string): void {
      try {
        const errorContainer = document.getElementById('navigraph-error');
        if (!errorContainer) {
          console.error('找不到错误UI容器，降级到alert');
          alert('Navigraph 扩展错误: ' + message);
          return;
        }
        
        const messageEl = errorContainer.querySelector('.error-message');
        if (messageEl) {
          messageEl.textContent = message;
        }
        
        errorContainer.style.display = 'block';
      } catch (err) {
        console.error('显示错误UI失败:', err);
        alert('Navigraph 扩展错误: ' + message);
      }
    },
    
    /**
     * 显示详细的错误消息
     * @param title 错误标题
     * @param error 错误对象
     */
    showDetailedErrorMessage(title: string, error: any): void {
      try {
        const errorContainer = document.getElementById('navigraph-error-detailed');
        if (!errorContainer) {
          this.showErrorMessage(title + ': ' + (error instanceof Error ? error.message : String(error)));
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
        console.error('显示详细错误UI失败:', err);
        this.showErrorMessage(title + ': ' + (error instanceof Error ? error.message : String(error)));
      }
    },
    
    /**
     * 显示通知消息
     * @param message 通知消息
     * @param duration 显示时长（毫秒）
     */
    showToast(message: string, duration: number = 5000): void {
      try {
        const toastEl = document.getElementById('navigraph-toast');
        if (!toastEl) return;
        
        toastEl.textContent = message;
        toastEl.style.display = 'block';
        
        // 设置自动隐藏
        setTimeout(() => {
          if (toastEl) {
            toastEl.style.display = 'none';
          }
        }, duration);
      } catch (err) {
        console.error('显示通知消息失败:', err);
      }
    }
  };

  /**
   * 显示标准错误消息（便捷方法）
   */
  function showErrorMessage(message: string): void {
    ErrorUIManager.showErrorMessage(message);
  }

  /**
   * 显示详细的错误消息（便捷方法）
   */
  function showDetailedErrorMessage(title: string, error: any): void {
    ErrorUIManager.showDetailedErrorMessage(title, error);
  }

  /**
   * 显示通知消息（便捷方法）
   */
  function showToast(message: string, duration?: number): void {
    ErrorUIManager.showToast(message, duration);
  }

  // 启动初始化流程
  try {
    // 检查 DOM 是否已经加载
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      // 如果 DOM 已加载完成，直接初始化
      await initialize();
    }
  } catch (error) {
    console.error('启动初始化过程失败:', error);
    // 尝试显示错误，即使在DOM加载前
    setTimeout(() => showErrorMessage('启动失败: ' + (error instanceof Error ? error.message : String(error))), 500);
  }
})().catch(error => {
  // 捕获闭包函数本身可能抛出的任何错误
  console.error('Navigraph 内容脚本执行失败:', error);
  // 尝试提供可见的错误反馈
  try {
    const msg = '内容脚本执行失败: ' + (error instanceof Error ? error.message : String(error));
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
    setTimeout(() => alert('Navigraph 扩展错误: ' + (error instanceof Error ? error.message : String(error))), 1000);
  }
});
