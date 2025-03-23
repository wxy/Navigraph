/**
 * 设置页面配置接口
 */
interface NavigraphSettings {
  // 会话管理
  sessionMode?: 'daily' | 'activity' | 'manual' | 'smart';
  
  // 视图与显示
  defaultView?: 'tree' | 'timeline';
  defaultZoom?: number;
  
  // 其他设置，后续可以扩展
  [key: string]: any;
}

/**
 * 默认设置
 */
const DEFAULT_SETTINGS: NavigraphSettings = {
  sessionMode: 'smart',
  defaultView: 'tree',
  defaultZoom: 1.0
};

/**
 * 当前加载的设置
 */
let currentSettings: NavigraphSettings = { ...DEFAULT_SETTINGS };

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', function(): void {
  // 初始化事件监听
  setupEventListeners();
  
  // 加载设置
  // loadSettings(); // 暂时注释，因为还没有真正的设置项
  
  // 显示初始化完成通知
  console.log('Navigraph 设置页面已初始化');
});

/**
 * 设置事件监听器
 */
function setupEventListeners(): void {
  // 保存按钮
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async function(): Promise<void> {
      // 保存设置 (暂时只是显示通知)
      if (await saveSettings()) {
        showNotification('设置已保存 (演示)');
      }
    });
  }
  
  // 重置按钮
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function(): void {
      if (confirm('确定要将所有设置重置为默认值吗？')) {
        resetToDefaults();
        showNotification('已恢复默认设置 (演示)');
      }
    });
  }
}

/**
 * 显示通知
 * @param message 通知消息
 * @param type 通知类型 ('success' 或 'error')
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
    
    // 3秒后隐藏通知
    setTimeout(function(): void {
      notification?.classList.add('hidden');
    }, 3000);
  }
}

/**
 * 加载设置
 * @returns Promise 表示加载操作的完成状态
 */
async function loadSettings(): Promise<void> {
  try {
    // 获取存储的设置或使用默认值
    const items = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    
    // 更新当前设置
    currentSettings = { ...items } as NavigraphSettings;
    
    // 应用设置到UI元素
    applySettingsToUI(currentSettings);
    
    console.log('设置已加载', currentSettings);
  } catch (error) {
    console.error('加载设置时出错:', error);
    showNotification('加载设置失败', 'error');
  }
}

/**
 * 将设置应用到UI元素
 * @param settings 要应用的设置对象
 */
function applySettingsToUI(settings: NavigraphSettings): void {
  // TODO: 将实际设置应用到UI元素
  // 例如:
  // const viewSelect = document.getElementById('default-view') as HTMLSelectElement;
  // if (viewSelect && settings.defaultView) {
  //   viewSelect.value = settings.defaultView;
  // }
  
  console.log('将在此处应用设置到UI', settings);
}

/**
 * 从UI元素收集设置
 * @returns 收集到的设置对象
 */
function collectSettingsFromUI(): NavigraphSettings {
  // TODO: 从UI元素中收集实际设置
  // 例如:
  // const viewSelect = document.getElementById('default-view') as HTMLSelectElement;
  // const defaultView = viewSelect ? viewSelect.value as 'tree' | 'timeline' : 'tree';
  
  // 暂时返回当前设置
  return { ...currentSettings };
}

/**
 * 保存设置
 * @returns 保存是否成功
 */
async function saveSettings(): Promise<boolean> {
  try {
    // 从UI收集设置
    const newSettings = collectSettingsFromUI();
    
    // 保存到Chrome存储
    await chrome.storage.sync.set(newSettings);
    
    // 更新当前设置
    currentSettings = newSettings;
    
    // 通知后台更新
    chrome.runtime.sendMessage({
      action: 'settingsUpdated',
      settings: newSettings
    });
    
    console.log('设置已保存', currentSettings);
    return true;
  } catch (error) {
    console.error('保存设置时出错:', error);
    showNotification('保存设置失败', 'error');
    return false;
  }
}

/**
 * 重置为默认设置
 */
async function resetToDefaults(): Promise<void> {
  try {
    // 重置为默认设置
    currentSettings = { ...DEFAULT_SETTINGS };
    
    // 应用默认设置到UI
    applySettingsToUI(currentSettings);
    
    // 保存默认设置
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    
    // 通知后台更新
    chrome.runtime.sendMessage({
      action: 'settingsUpdated',
      settings: DEFAULT_SETTINGS
    });
    
    console.log('设置已重置为默认值');
  } catch (error) {
    console.error('重置设置时出错:', error);
    showNotification('重置设置失败', 'error');
  }
}