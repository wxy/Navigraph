import { NavigraphSettings } from '../lib/settings/types.js';
import { DEFAULT_SETTINGS } from '../lib/settings/constants.js';
import { getSettingsService } from '../lib/settings/service.js';

// 获取设置服务
const settingsService = getSettingsService();

// 当前设置引用
let currentSettings: NavigraphSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async function(): Promise<void> {
  console.log('DOM已加载，开始初始化选项页...');
  
  // 初始化UI
  setupTabs();
  setupEventListeners();
  
  try {
    // 确保设置服务初始化完成
    await settingsService.initialize();
    
    // 加载设置
    await loadSettings();
    console.log('配置加载成功:', currentSettings);
    
    // 应用主题到选项页面
    applyThemeToOptionsPage();
    
    // 添加设置变更监听器
    settingsService.addChangeListener(settings => {
      console.log('检测到设置变更:', settings);
      currentSettings = { ...settings };
      applySettingsToUI();
      applyThemeToOptionsPage();
    });
  } catch (error) {
    console.error('初始化选项页面失败:', error);
    showNotification('加载设置失败，请重试', 'error');
  }
});

/**
 * 初始化选项卡
 */
function setupTabs(): void {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabPanes = document.querySelectorAll('.tab-pane');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // 移除所有活动状态
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabPanes.forEach(pane => pane.classList.remove('active'));
      
      // 激活当前标签
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      if (tabId) {
        const pane = document.getElementById(tabId);
        if (pane) pane.classList.add('active');
      }
    });
  });
}

/**
 * 设置事件监听器
 */
function setupEventListeners(): void {
  // 主题选择
  const themeSelect = document.getElementById('theme') as HTMLSelectElement;
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      const theme = themeSelect.value as 'light' | 'dark' | 'system';
      applyThemeToOptionsPage(theme);
      
      // 立即更新主题设置
      settingsService.updateSettings({ theme })
        .then(() => showNotification('主题已更新'))
        .catch(error => {
          console.error('更新主题失败:', error);
          showNotification('更新主题失败', 'error');
        });
    });
  }
  
  // 默认视图选择
  const viewSelect = document.getElementById('default-view') as HTMLSelectElement;
  if (viewSelect) {
    viewSelect.addEventListener('change', () => {
      updateViewPreview(viewSelect.value as 'tree' | 'timeline');
    });
  }
  
  // 缩放级别滑块
  const zoomSlider = document.getElementById('default-zoom') as HTMLInputElement;
  const zoomValue = document.getElementById('zoom-value');
  if (zoomSlider && zoomValue) {
    zoomSlider.addEventListener('input', () => {
      zoomValue.textContent = `${Number(zoomSlider.value).toFixed(1)}x`;
    });
  }
  
  // 会话模式选择
  const sessionModeSelect = document.getElementById('session-mode') as HTMLSelectElement;
  if (sessionModeSelect) {
    sessionModeSelect.addEventListener('change', () => {
      // 根据会话模式更新高级设置可见性
      const advancedSettings = document.getElementById('advanced-session-settings');
      if (advancedSettings) {
        const mode = sessionModeSelect.value;
        advancedSettings.style.display = 
          (mode === 'daily' || mode === 'smart') ? 'block' : 'none';
      }
    });
  }
  
  // 保存按钮
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveSettings);
  }
  
  // 重置按钮
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetSettings);
  }
  
  // 清除数据按钮
  const clearDataBtn = document.getElementById('clear-data-btn');
  if (clearDataBtn) {
    clearDataBtn.addEventListener('click', clearAllData);
  }
}

/**
 * 应用主题到选项页面
 */
function applyThemeToOptionsPage(theme?: 'light' | 'dark' | 'system'): void {
  const currentTheme = theme || currentSettings.theme || 'system';
  
  let appliedTheme: 'light' | 'dark';
  
  if (currentTheme === 'system') {
    // 使用系统主题
    appliedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    appliedTheme = currentTheme;
  }
  
  document.documentElement.setAttribute('data-theme', appliedTheme);
}

/**
 * 更新视图预览
 */
function updateViewPreview(view: 'tree' | 'timeline'): void {
  const previewContainer = document.getElementById('view-preview');
  if (previewContainer) {
    // 更新类名
    previewContainer.className = `preview-box ${view}-preview`;
    
    // 添加数据属性以支持 ::before 伪元素的内容
    previewContainer.setAttribute('data-view-type', view === 'tree' ? '树形图视图' : '时间线视图');
  }
}

/**
 * 加载设置
 */
async function loadSettings(): Promise<void> {
  try {
    // 从设置服务加载
    currentSettings = await settingsService.getSettings();
    
    // 应用设置到UI
    applySettingsToUI();
    
    console.log('设置已加载', currentSettings);
  } catch (error) {
    console.error('加载设置时出错:', error);
    showNotification('加载设置失败', 'error');
  }
}

/**
 * 将设置应用到UI
 */
function applySettingsToUI(): void {
  // 主题
  const themeSelect = document.getElementById('theme') as HTMLSelectElement;
  if (themeSelect) {
    themeSelect.value = currentSettings.theme || 'system';
  }
  
  // 默认视图
  const viewSelect = document.getElementById('default-view') as HTMLSelectElement;
  if (viewSelect) {
    viewSelect.value = currentSettings.defaultView || 'tree';
    updateViewPreview(currentSettings.defaultView || 'tree');
  }
  
  // 缩放级别
  const zoomSlider = document.getElementById('default-zoom') as HTMLInputElement;
  const zoomValue = document.getElementById('zoom-value');
  if (zoomSlider && zoomValue) {
    zoomSlider.value = currentSettings.defaultZoom?.toString() || '1.0';
    zoomValue.textContent = `${Number(zoomSlider.value).toFixed(1)}x`;
  }
  
  // 会话模式
  const sessionModeSelect = document.getElementById('session-mode') as HTMLSelectElement;
  if (sessionModeSelect) {
    sessionModeSelect.value = currentSettings.sessionMode || 'smart';
    
    // 设置高级会话设置的可见性
    const advancedSettings = document.getElementById('advanced-session-settings');
    if (advancedSettings) {
      advancedSettings.style.display = 
        (currentSettings.sessionMode === 'daily' || currentSettings.sessionMode === 'smart') ? 
        'block' : 'none';
    }
  }
  
  // 数据保留
  const dataRetentionSelect = document.getElementById('data-retention') as HTMLSelectElement;
  if (dataRetentionSelect) {
    dataRetentionSelect.value = (currentSettings.dataRetention || 30).toString();
  }
}

/**
 * 从UI收集设置
 */
function collectSettingsFromUI(): NavigraphSettings {
  // 主题
  const theme = (document.getElementById('theme') as HTMLSelectElement)?.value as 'light' | 'dark' | 'system' || 'system';
  
  // 默认视图
  const defaultView = (document.getElementById('default-view') as HTMLSelectElement)?.value as 'tree' | 'timeline' || 'tree';
  
  // 缩放级别
  const defaultZoomStr = (document.getElementById('default-zoom') as HTMLInputElement)?.value || '1.0';
  const defaultZoom = parseFloat(defaultZoomStr);
  
  // 会话模式
  const sessionMode = (document.getElementById('session-mode') as HTMLSelectElement)?.value as 'daily' | 'activity' | 'smart' | 'manual' || 'smart';
  
  // 数据保留
  const dataRetentionStr = (document.getElementById('data-retention') as HTMLSelectElement)?.value || '30';
  const dataRetention = parseInt(dataRetentionStr) as 7 | 14 | 30 | 90 | 180 | 365 | 0;
  
  return {
    theme,
    defaultView,
    defaultZoom,
    sessionMode,
    dataRetention
  };
}

/**
 * 保存设置
 */
async function saveSettings(): Promise<void> {
  try {
    // 从UI收集设置
    const newSettings = collectSettingsFromUI();
    
    // 保存现有设置的副本用于比较
    const oldSettings = { ...currentSettings };
    
    // 使用设置服务保存
    await settingsService.updateSettings(newSettings);
    
    // 更新当前设置引用
    currentSettings = { ...newSettings };
    
    // 检查设置变更并显示综合通知
    showSettingsSavedNotification(oldSettings, newSettings);
  } catch (error) {
    console.error('保存设置时出错:', error);
    showNotification('保存设置失败', 'error', 3000);
  }
}
/**
 * 显示设置保存成功通知，根据变更类型自动添加相应的刷新提示
 */
function showSettingsSavedNotification(oldSettings: NavigraphSettings, newSettings: NavigraphSettings): void {
  // 检查设置变更类型
  const affectsBackground = 
    oldSettings.sessionMode !== newSettings.sessionMode || 
    oldSettings.dataRetention !== newSettings.dataRetention;
    
  const affectsFrontend =
    oldSettings.theme !== newSettings.theme ||
    oldSettings.defaultView !== newSettings.defaultView ||
    oldSettings.defaultZoom !== newSettings.defaultZoom;
  
  let message = '设置已保存';
  let type: 'success' | 'error' = 'success'; // 显式添加类型注解
  let duration = 3000; // 基础持续时间：3秒
  
  // 根据变更类型添加额外提示
  if (affectsBackground) {
    message += ' - 需要重新加载扩展才能完全生效';
    duration = 5000; // 增加显示时间
    
    // 创建并添加重载按钮（可选）
    const notification = document.getElementById('notification');
    if (notification) {
      // 清除现有内容
      notification.innerHTML = '';
      
      // 添加消息
      const messageSpan = document.createElement('span');
      messageSpan.textContent = message;
      notification.appendChild(messageSpan);
      
      // 添加重载按钮
      const reloadBtn = document.createElement('button');
      reloadBtn.className = 'notification-action';
      reloadBtn.textContent = '立即重载';
      reloadBtn.onclick = () => chrome.runtime.reload();
      notification.appendChild(reloadBtn);
      
      // 显示通知
      notification.className = 'notification';
      notification.classList.remove('error'); // 确保移除error类
      notification.classList.remove('hidden');
      
      // 设置自动隐藏
      setTimeout(() => {
        notification?.classList.add('hidden');
      }, duration);
      
      return; // 提前返回，因为已手动处理了通知
    }
  } else if (affectsFrontend) {
    message += ' - 请刷新已打开的扩展页以应用新设置';
    duration = 4000; // 增加显示时间
  }
  
  // 显示通知
  showNotification(message, type, duration);
}
/**
 * 重置设置
 */
async function resetSettings(): Promise<void> {
  try {
    if (confirm('确定要恢复所有默认设置吗？')) {
      // 保存现有设置的副本用于比较
      const oldSettings = { ...currentSettings };
      
      // 使用设置服务重置
      await settingsService.resetSettings();
      
      // 更新当前设置引用
      currentSettings = settingsService.getSettings();
      
      // 重新应用到UI
      applySettingsToUI();
      
      // 显示综合重置通知
      showSettingsSavedNotification(oldSettings, currentSettings);
    }
  } catch (error) {
    console.error('重置设置时出错:', error);
    showNotification('重置设置失败', 'error');
  }
}

/**
 * 清除所有数据
 */
async function clearAllData(): Promise<void> {
  try {
    if (confirm('确定要清除所有导航数据吗？此操作无法撤销！')) {
      const response = await chrome.runtime.sendMessage({
        action: 'clearAllData'
      });
      
      if (response && response.success) {
        showNotification('所有数据已清除');
      } else {
        throw new Error(response?.error || '未知错误');
      }
    }
  } catch (error) {
    console.error('清除数据时出错:', error);
    showNotification('清除数据失败', 'error');
  }
}

/**
 * 显示通知
 * @param message 通知消息
 * @param type 通知类型
 * @param duration 显示持续时间（毫秒）
 */
function showNotification(message: string, type: 'success' | 'error' = 'success', duration: number = 3000): void {
  const notification = document.getElementById('notification');
  if (notification) {
    notification.textContent = message;
    notification.className = 'notification';
    if (type === 'error') {
      notification.classList.add('error');
    }
    notification.classList.remove('hidden');
    
    setTimeout(() => {
      notification?.classList.add('hidden');
    }, duration);
  }
}
