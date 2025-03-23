/**
 * Navigraph - 浏览历史可视化扩展
 * 主入口文件
 */

// 更新导入的类型
import type { PageActivityRequestMessage } from './types/message-types.js';

// 用于控制页面活动事件频率的变量
let lastActivityTime = 0;
const MIN_ACTIVITY_INTERVAL = 5000; // 最少5秒触发一次

// 初始化函数
async function initialize() {
  console.log('初始化 Navigraph 可视化...');
  
  try {
    // 先导入并设置消息处理系统
    console.log('设置消息处理系统...');
    const messageHandlerModule = await import('./core/message-handler.js');
    messageHandlerModule.setupMessageListener();
    console.log('消息处理系统设置完成');
  
    // 初始化主题管理器
    console.log('初始化主题管理器...');
    const themeManagerModule = await import('./utils/theme-manager.js');
    const themeManager = themeManagerModule.getThemeManager();
    
    // 初始化主题管理器
    themeManager.initialize();
    
    // 从存储读取当前设置
    await loadAndApplyTheme(themeManager);
    
    // 然后导入并创建可视化器
    const visualizerModule = await import('./core/navigation-visualizer.js');
    const NavigationVisualizer = visualizerModule.NavigationVisualizer;
    
    // 创建可视化器实例
    window.visualizer = new NavigationVisualizer();
    
    // 为了兼容性考虑
    window.NavigationVisualizer = NavigationVisualizer;
    
    // 初始化视觉化器
    await window.visualizer.initialize();
    
    console.log('Navigraph 可视化器初始化成功');
    
    // 设置页面活动监听器
    setupPageActivityListeners();

    console.log('其他初始化逻辑完成');
  } catch (error) {
    console.error('初始化可视化器失败:', error);
    showErrorMessage('初始化失败: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 从存储加载并应用主题
 */
async function loadAndApplyTheme(themeManager: any): Promise<void> {
  try {
    // 尝试从本地存储直接读取主题
    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem('navigraph_theme');
      if (savedTheme) {
        console.log('从本地存储加载主题:', savedTheme);
        themeManager.applyTheme(savedTheme);
      }
    } catch (localError) {
      console.warn('从本地存储加载主题失败:', localError);
    }
    
    // 然后从 chrome.storage 读取设置（这样能保持同步，但稍慢）
    try {
      const settings = await chrome.storage.sync.get('navigraph_settings');
      if (settings && settings.navigraph_settings && settings.navigraph_settings.theme) {
        console.log('从 chrome.storage 加载主题设置:', settings.navigraph_settings.theme);
        themeManager.applyThemeSetting(settings.navigraph_settings.theme);
      } else {
        // 尝试单独获取 theme 键（向后兼容）
        const themeSettings = await chrome.storage.sync.get('theme');
        if (themeSettings && themeSettings.theme) {
          console.log('从 chrome.storage 加载主题设置(旧格式):', themeSettings.theme);
          themeManager.applyThemeSetting(themeSettings.theme);
        } else if (!savedTheme) {
          // 如果本地存储和chrome存储都没有设置，使用系统主题
          console.log('没有找到保存的主题设置，使用系统主题');
          themeManager.applyThemeSetting('system');
        }
      }
    } catch (storageError) {
      console.warn('从 chrome.storage 加载主题设置失败:', storageError);
      // 如果没有从本地存储成功加载，设置为系统主题
      if (!savedTheme) {
        themeManager.applyThemeSetting('system');
      }
    }
  } catch (error) {
    console.error('加载主题失败:', error);
    // 出错时尝试应用系统主题
    themeManager.applyThemeSetting('system');
  }
}

/**
 * 设置页面活动监听器
 * 监听页面可见性变化和焦点获取事件
 */
function setupPageActivityListeners() {
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
}

/**
 * 触发页面活动消息
 * @param source 触发源（'visibility' 或 'focus'）
 */
async function triggerPageActivity(source: string) {
  const now = Date.now();
  if (now - lastActivityTime > MIN_ACTIVITY_INTERVAL) {
    lastActivityTime = now;
    console.log(`检测到页面活动(${source})，触发刷新`);
    
    try {
      // 动态导入消息处理模块
      const messageModule = await import('./core/message-handler.js');
      
      // 使用新的类型定义并发送消息
      await messageModule.sendMessage('pageActivity', {
        source: source
      }).catch(err => {
        console.warn('发送页面活动消息失败:', err);
      });
    } catch (err) {
      console.error('触发页面活动失败:', err);
      
      // 尝试直接调用triggerRefresh作为备用方案
      if (window.visualizer && typeof window.visualizer.triggerRefresh === 'function') {
        console.log('使用备用方法刷新可视化');
        window.visualizer.triggerRefresh();
      }
    }
  } else {
    console.debug(`页面活动(${source})距离上次时间过短(${now - lastActivityTime}ms)，忽略`);
  }
}

/**
 * 显示错误消息
 */
function showErrorMessage(message: string): void {
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#333;color:#fff;padding:20px;border-radius:5px;text-align:center;z-index:1000;';
  container.innerHTML = `<h3>错误</h3><p>${message}</p><button onclick="location.reload()">刷新页面</button>`;
  document.body.appendChild(container);
}

// 文档加载完成后初始化
document.addEventListener('DOMContentLoaded', initialize);
