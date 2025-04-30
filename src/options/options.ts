import { Logger } from '../lib/utils/logger.js';
import { i18n } from '../lib/utils/i18n-utils.js';
import { NavigraphSettings } from '../lib/settings/types.js';
import { DEFAULT_SETTINGS } from '../lib/settings/constants.js';
import { getSettingsService } from '../lib/settings/service.js';

const logger = new Logger('OptionsPage');
// 获取设置服务
const settingsService = getSettingsService();

// 当前设置引用
let currentSettings: NavigraphSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async function(): Promise<void> {
  logger.log('DOM已加载，开始初始化选项页...');
  
  // 初始化通知元素
  const notification = document.getElementById('notification');
  if (notification) {
    notification.className = 'notification hidden';
    notification.style.display = 'none';
  } else {
    logger.warn('未找到通知元素，可能会影响用户反馈');
  }
  
  // 初始化UI
  setupTabs();
  setupEventListeners();
  
  try {
    // 确保设置服务初始化完成
    await settingsService.initialize();
    
    // 加载设置
    await loadSettings();
    logger.log('配置加载成功:', currentSettings);
    
    // 应用主题到选项页面
    applyThemeToOptionsPage();
    
    // 添加设置变更监听器
    settingsService.addChangeListener(settings => {
      logger.log('检测到设置变更:', settings);
      currentSettings = { ...settings };
      applySettingsToUI();
      applyThemeToOptionsPage();
    });
  } catch (error) {
    logger.error('初始化选项页面失败:', error);
    showNotification('options_load_failed', 'error');
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
        .then(() => showNotification('options_theme_updated'))
        .catch(error => {
          logger.error('更新主题失败:', error);
          showNotification('options_update_theme_failed', 'error');
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
  
  // 会话模式选择
  const sessionModeSelect = document.getElementById('session-mode') as HTMLSelectElement;
  if (sessionModeSelect) {
    sessionModeSelect.addEventListener('change', () => {
      // 根据会话模式更新高级设置可见性
      const advancedSettings = document.getElementById('advanced-session-settings');
      if (advancedSettings) {
        // 只在每日模式下显示高级设置
        advancedSettings.style.display = sessionModeSelect.value === 'daily' ? 'block' : 'none';
      }
    });
  }
  
  // 空闲超时输入验证
  const idleTimeoutInput = document.getElementById('idle-timeout') as HTMLInputElement;
  if (idleTimeoutInput) {
    idleTimeoutInput.addEventListener('input', () => {
      // 确保值在有效范围内 (1-24小时)
      const value = parseInt(idleTimeoutInput.value);
      if (isNaN(value) || value < 1) {
        idleTimeoutInput.value = '1'; // 最小1小时
      } else if (value > 24) {
        idleTimeoutInput.value = '24'; // 最大24小时
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
    previewContainer.setAttribute('data-view-type', 
      view === 'tree' ? i18n('options_tree_view_label') : i18n('options_timeline_view_label'));
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
    
    logger.log('设置已加载', currentSettings);
  } catch (error) {
    logger.error('加载设置时出错:', error);
    showNotification('options_load_failed', 'error');
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
  
  // 会话模式
  const sessionModeSelect = document.getElementById('session-mode') as HTMLSelectElement;
  if (sessionModeSelect) {
    sessionModeSelect.value = currentSettings.sessionMode || 'daily';
    
    // 设置高级会话设置的可见性
    const advancedSettings = document.getElementById('advanced-session-settings');
    if (advancedSettings) {
      advancedSettings.style.display = 
        (currentSettings.sessionMode === 'daily') ? 'block' : 'none';
    }
  }
  
  // 空闲超时 - 以小时为单位
  const idleTimeoutInput = document.getElementById('idle-timeout') as HTMLInputElement;
  if (idleTimeoutInput) {
    idleTimeoutInput.value = String(currentSettings.idleTimeout || 6);
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
  
  // 会话模式 - 限制为 'daily' 或 'manual'
  const sessionMode = (document.getElementById('session-mode') as HTMLSelectElement)?.value as 'daily' | 'manual' || 'daily';
  
  // 数据保留
  const dataRetentionStr = (document.getElementById('data-retention') as HTMLSelectElement)?.value || '30';
  const dataRetention = parseInt(dataRetentionStr) as 7 | 14 | 30 | 90 | 180 | 365 | 0;
  
  // 空闲超时 - 输入为小时，存储为小时，内部处理再转分钟
  const idleTimeoutInput = document.getElementById('idle-timeout') as HTMLInputElement;
  const idleTimeout = idleTimeoutInput ? 
    Math.max(1, Math.min(24, parseInt(idleTimeoutInput.value) || 6)) : 
    currentSettings.idleTimeout || 6;
  
  return {
    theme,
    defaultView,
    sessionMode,
    dataRetention,
    idleTimeout, // 添加空闲超时设置
    maxNodes: currentSettings.maxNodes || 1000,
    trackAnonymous: currentSettings.trackAnonymous || false,
    animationEnabled: currentSettings.animationEnabled || true,
    showLabels: currentSettings.showLabels || true
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
    logger.error('保存设置时出错:', error);
    showNotification('options_save_failed', 'error', 3000);
  }
}
/**
 * 显示设置保存成功通知 - 使用单独的本地化字符串
 */
function showSettingsSavedNotification(oldSettings: NavigraphSettings, newSettings: NavigraphSettings): void {
  // 跟踪是否有任何设置发生变化
  const hasChanges = JSON.stringify(oldSettings) !== JSON.stringify(newSettings);
  
  // 如果没有变化，显示信息并返回
  if (!hasChanges) {
    showNotification('options_no_changes', 'success', 2000);
    return;
  }
  
  // 检查设置变更类型
  const affectsBackground = 
    oldSettings.sessionMode !== newSettings.sessionMode || 
    oldSettings.dataRetention !== newSettings.dataRetention ||
    oldSettings.idleTimeout !== newSettings.idleTimeout;
    
  const affectsFrontend =
    oldSettings.theme !== newSettings.theme ||
    oldSettings.defaultView !== newSettings.defaultView;
  
  // 根据情况选择适当的本地化消息ID
  let messageId: string;
  let type: 'success' | 'error' = 'success';
  let duration = 3000;
  
  if (affectsBackground) {
    // 使用完整的"需要重载"消息
    messageId = 'options_settings_saved_reload';
    duration = 5000;
    
    // 带按钮的复杂通知
    try {
      const notification = document.getElementById('notification');
      if (notification) {
        // 清除通知管理器的计时器
        notificationManager.clearTimer();
        
        // 初始化通知元素
        notification.className = 'notification';
        notification.style.cssText = 'display: block; opacity: 1; visibility: visible;';
        notification.innerHTML = '';
        
        // 添加消息文本，使用本地化字符串
        const msgElement = document.createElement('span');
        const translatedMsg = chrome.i18n.getMessage(messageId);
        msgElement.textContent = translatedMsg;
        notification.appendChild(msgElement);
        
        // 添加重载按钮，使用单独的本地化字符串
        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'notification-action';
        const buttonText = chrome.i18n.getMessage('options_reload_now');
        reloadBtn.textContent = buttonText;
        reloadBtn.onclick = () => {
          try {
            chrome.runtime.reload();
          } catch (e) {
            logger.error('重载扩展失败:', e);
            showNotification('options_reload_failed', 'error');
          }
        };
        notification.appendChild(reloadBtn);
        
        // 自动隐藏
        window.setTimeout(() => {
          notification.classList.add('hidden');
          window.setTimeout(() => {
            notification.style.display = 'none';
          }, 500);
        }, duration);
        
        // 标记通知管理器为活动状态
        notificationManager.isActive = true;
        
        return; // 提前返回
      }
    } catch (e) {
      logger.error('创建复杂通知失败，回退到标准通知:', e);
    }
  } else if (affectsFrontend) {
    // 使用完整的"需要刷新"消息
    messageId = 'options_settings_saved_refresh';
    duration = 4000;
  } else {
    // 基本的"设置已保存"消息
    messageId = 'options_settings_saved';
  }
  
  // 标准通知
  showNotification(messageId, type, duration);
}

/**
 * 重置设置
 */
async function resetSettings(): Promise<void> {
  try {
    if (confirm(i18n('options_confirm_reset'))) {
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
    logger.error('重置设置时出错:', error);
    showNotification('options_reset_failed', 'error');
  }
}

/**
 * 清除所有数据
 */
async function clearAllData(): Promise<void> {
  try {
    if (confirm(i18n('options_confirm_clear_data'))) {
      const response = await chrome.runtime.sendMessage({
        action: 'clearAllData'
      });
      
      if (response && response.success) {
        showNotification('options_data_cleared');
      } else {
        throw new Error(response?.error || '未知错误');
      }
    }
  } catch (error) {
    logger.error('清除数据时出错:', error);
    showNotification('options_clear_failed', 'error');
  }
}

/**
 * 通知管理器 - 简化版，统一管理所有通知逻辑
 */
const notificationManager = {
  timer: null as number | null,
  isActive: false,
  
  /**
   * 显示通知
   */
  show(message: string, type: 'success' | 'error' = 'success', duration: number = 3000): void {
    logger.log(`显示通知: "${message}" (${type})`);
    
    const notification = document.getElementById('notification');
    if (!notification) {
      logger.error('找不到通知元素');
      return;
    }
    
    // 取消现有计时器
    this.clearTimer();
    
    // 设置内容和样式
    notification.textContent = message;
    notification.className = 'notification';
    
    if (type === 'error') {
      notification.classList.add('error');
    }
    
    // 确保元素可见
    notification.style.display = 'block';
    notification.style.opacity = '1';
    notification.style.visibility = 'visible';
    
    this.isActive = true;
    
    // 设置自动隐藏
    this.timer = window.setTimeout(() => {
      this.hide();
    }, duration);
  },
  
  /**
   * 隐藏通知
   */
  hide(): void {
    const notification = document.getElementById('notification');
    if (!notification) return;
    
    // 添加隐藏类
    notification.classList.add('hidden');
    
    // 在过渡效果完成后完全隐藏
    window.setTimeout(() => {
      if (notification.classList.contains('hidden')) {
        notification.style.display = 'none';
        this.isActive = false;
      }
    }, 500);
  },
  
  /**
   * 清除现有计时器
   */
  clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
};

/**
 * 显示通知 - 简化版，使用通知管理器
 */
function showNotification(messageOrId: string, type: 'success' | 'error' = 'success', duration: number = 3000): void {
  const message = i18n(messageOrId);
  notificationManager.show(message, type, duration);
}
