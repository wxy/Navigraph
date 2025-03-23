import { NavigraphSettings } from '../lib/settings/types.js';
import { DEFAULT_SETTINGS } from '../lib/settings/constants.js';
import { getSettingsService } from '../lib/settings/service.js';

// 获取设置服务
const settingsService = getSettingsService();

// 当前设置引用
let currentSettings: NavigraphSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async function(): Promise<void> {
  // 初始化UI
  setupTabs();
  setupEventListeners();
  
  // 加载设置
  await loadSettings();
  
  // 应用主题到选项页面
  applyThemeToOptionsPage();
  
  // 添加设置变更监听器
  settingsService.addChangeListener(settings => {
    currentSettings = { ...settings };
    applySettingsToUI();
    applyThemeToOptionsPage();
  });
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
    previewContainer.className = `preview-box ${view}-preview`;
  }
}

/**
 * 加载设置
 */
async function loadSettings(): Promise<void> {
  try {
    // 从设置服务加载
    currentSettings = settingsService.getSettings();
    
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
    
    // 显示保存成功通知
    showNotification('设置已保存');
    
    // 检查设置变更并显示相应提示
    checkSettingsChanges(oldSettings, newSettings);
  } catch (error) {
    console.error('保存设置时出错:', error);
    showNotification('保存设置失败', 'error');
  }
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
      
      // 显示重置成功通知
      showNotification('已恢复默认设置');
      
      // 检查设置变更并显示相应提示
      checkSettingsChanges(oldSettings, currentSettings);
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
 */
function showNotification(message: string, type: 'success' | 'error' = 'success'): void {
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
    }, 3000);
  }
}

/**
 * 检查设置变更类型并显示相应提示
 */
function checkSettingsChanges(oldSettings: NavigraphSettings, newSettings: NavigraphSettings): void {
  const affectsBackground = 
    oldSettings.sessionMode !== newSettings.sessionMode || 
    oldSettings.dataRetention !== newSettings.dataRetention;
    
  const affectsFrontend =
    oldSettings.theme !== newSettings.theme ||
    oldSettings.defaultView !== newSettings.defaultView ||
    oldSettings.defaultZoom !== newSettings.defaultZoom;
  
  if (affectsBackground) {
    showExtensionReloadNotice();
  } else if (affectsFrontend) {
    showTabReloadNotice();
  }
}

/**
 * 显示需要重新加载扩展的提示
 */
function showExtensionReloadNotice(): void {
  let notice = document.getElementById('extension-reload-notice');
  
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'extension-reload-notice';
    notice.className = 'reload-notice extension-reload';
    
    notice.innerHTML = `
      <div class="reload-content">
        <p><strong>重要设置已更改!</strong> 您修改的设置影响后台功能，需要重新加载扩展才能完全生效。</p>
        <div class="reload-actions">
          <button id="reload-extension" class="btn primary">立即重新加载扩展</button>
          <button id="dismiss-extension-notice" class="btn secondary">稍后手动重新加载</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(notice);
    
    // 添加重新加载扩展按钮事件
    const reloadBtn = document.getElementById('reload-extension');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        chrome.runtime.reload();
      });
    }
    
    // 添加关闭按钮事件
    const dismissBtn = document.getElementById('dismiss-extension-notice');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        notice?.classList.add('hidden');
      });
    }
  } else {
    // 如果提示已存在，确保它可见
    notice.classList.remove('hidden');
  }
}

/**
 * 显示需要重新加载标签页的提示
 */
function showTabReloadNotice(): void {
  let notice = document.getElementById('tab-reload-notice');
  
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'tab-reload-notice';
    notice.className = 'reload-notice tab-reload';
    
    notice.innerHTML = `
      <div class="reload-content">
        <p><strong>设置已更改!</strong> 请重新加载已打开的Navigraph标签页以应用新设置。</p>
        <button id="dismiss-tab-notice" class="btn secondary">我知道了</button>
      </div>
    `;
    
    document.body.appendChild(notice);
    
    // 添加关闭按钮事件
    const dismissBtn = document.getElementById('dismiss-tab-notice');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        notice?.classList.add('hidden');
      });
    }
  } else {
    // 如果提示已存在，确保它可见
    notice.classList.remove('hidden');
  }
}