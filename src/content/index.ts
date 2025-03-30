/**
 * Navigraph - 浏览历史可视化扩展
 * 主入口文件
 */


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
    const settingsModule = await import('../lib/settings/service.js');
    const settingsService = settingsModule.getSettingsService();
    await settingsService.initialize();
    // 将设置保存为全局变量以便访问
    window.navigraphSettings = settingsService.getSettings();
    console.log('全局设置已加载:', window.navigraphSettings);

    // 初始化消息服务
    console.log('初始化消息服务...');
    const messageServiceModule = await import('./messaging/content-message-service.js');
    messageServiceModule.setupMessageService();
    const handlerModule = await import('./messaging/index.js');
    handlerModule.registerContentMessageHandlers();
    // 注册消息处理程序
    console.log('消息服务初始化完成');
  
    // 初始化主题管理器
    console.log('初始化主题管理器...');
    const themeManagerModule = await import('./utils/theme-manager.js');
    const themeManager = themeManagerModule.getThemeManager();
    
    // 初始化主题管理器
    themeManager.initialize();
    
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
    themeManager.applyTheme('system');
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
    
    if (window.visualizer && typeof window.visualizer.triggerRefresh === 'function') {
      console.log('刷新可视化');
      window.visualizer.triggerRefresh();
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
