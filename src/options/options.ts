import { Logger } from '../lib/utils/logger.js';
import { _, _Error, I18n } from '../lib/utils/i18n.js';
import { NavigraphSettings } from '../lib/settings/types.js';
import type { ViewType } from '../lib/settings/types.js';
import { DEFAULT_SETTINGS } from '../lib/settings/constants.js';
import { getSettingsService } from '../lib/settings/service.js';
import { sendMessage, sendToBackground } from '../lib/messaging/index.js';

const logger = new Logger('OptionsPage');
// 获取设置服务
const settingsService = getSettingsService();

// 当前设置引用
let currentSettings: NavigraphSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async function(): Promise<void> {
  logger.log(_('options_dom_loaded_init_start', 'DOM已加载，开始初始化选项页...'));
  
  // 初始化通知元素
  const notification = document.getElementById('notification');
  if (notification) {
    notification.className = 'notification hidden';
    notification.style.display = 'none';
  } else {
    logger.warn(_('options_notification_element_not_found', '未找到通知元素，可能会影响用户反馈'));
  }
  
  // 初始化UI
  setupTabs();
  setupEventListeners();
  
  try {
    // 确保设置服务初始化完成
    await settingsService.initialize();
    
    // 加载设置
    await loadSettings();
    logger.log(_('options_settings_loaded_success', '配置加载成功: {0}'), currentSettings);
    
    // 应用主题到选项页面
    applyThemeToOptionsPage();
    
    // 添加设置变更监听器
    settingsService.addChangeListener(settings => {
      logger.log(_('options_settings_change_detected', '检测到设置变更: {0}'), settings);
      currentSettings = { ...settings };
      applySettingsToUI();
      applyThemeToOptionsPage();
    });
  } catch (error) {
    logger.error(_('options_page_init_failed', '初始化选项页面失败: {0}'), error);
    showNotification(_('options_load_failed', '加载设置失败，请重试'), 'error');
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
        .then(() => showNotification(_('options_theme_updated', '主题已更新')))
        .catch(error => {
          logger.error(_('options_update_theme_error', '更新主题失败'), error);
          showNotification(_('options_update_theme_failed', '更新主题失败'), 'error');
        });
    });
  }
  
  // 默认视图选择
  const viewSelect = document.getElementById('default-view') as HTMLSelectElement;
  if (viewSelect) {
    viewSelect.addEventListener('change', () => {
      updateViewPreview(viewSelect.value as ViewType);
    });
  }

  // 强制语言选择（立即生效于选项页）
  const forceLangSelect = document.getElementById('force-language') as HTMLSelectElement;
  if (forceLangSelect) {
    forceLangSelect.addEventListener('change', async () => {
      const locale = forceLangSelect.value || 'system';
      // 立即应用到当前选项页
      try {
        await I18n.getInstance().setLocale(locale === 'system' ? null : locale);
      } catch (e) {
        logger.error(_('options_force_language_error', '切换语言时出错: {0}'), e);
      }

      // 将首选项保存在设置中（后台/后续页面可读取）
      settingsService.updateSettings({ forcedLocale: locale })
        .catch(err => logger.error(_('options_save_force_language_failed', '保存强制语言失败: {0}'), err));
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
  
  // 帮助按钮
  const helpBtn = document.getElementById('help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', openHelp);
  }
}

/**
 * 打开帮助文档
 */
async function openHelp(): Promise<void> {
  try {
    // 获取当前浏览器语言
    const userLanguage = chrome.i18n.getUILanguage();
    
    // 通过规则确定README文件路径
    const readmeFilePath = await findAppropriateReadmeFile(userLanguage);
    
    logger.log(_('options_help_opening', '正在打开帮助文档'), readmeFilePath);
    
    // 构建GitHub仓库中文档的URL
    const githubRepoUrl = 'https://github.com/wxy/Navigraph/blob/master/';
    const githubDocUrl = githubRepoUrl + readmeFilePath;
    
    // 打开新标签页显示GitHub上的README
    chrome.tabs.create({ url: githubDocUrl });
  } catch (error) {
    logger.error(_('options_help_open_error', '打开帮助文档时出错'), error);
    showNotification(_('options_help_load_failed', '加载帮助文档失败'), 'error');
  }
}

/**
 * 查找适合当前语言的README文件
 * 使用智能回退策略，确保总能找到一个合适的文件
 */
async function findAppropriateReadmeFile(language: string): Promise<string> {
  // 将连字符格式(zh-CN)转换为下划线格式(zh_CN)
  const normalizedLanguage = language.replace(/-/g, '_');
  
  // 提取主要语言部分(zh_CN -> zh)和国家/地区部分(zh_CN -> CN)
  const [mainLang, region] = normalizedLanguage.split('_');
  
  // 准备一个查找顺序数组，从最精确到最通用
  const candidateFiles = [];
  
  // 1. 完整语言代码，如zh_CN
  if (region) {
    candidateFiles.push(`docs/README-${normalizedLanguage}.md`);
  }
  
  // 2. 主语言部分，如zh
  candidateFiles.push(`docs/README-${mainLang}.md`);
  
  // 3. 英语版本（如果当前不是英语）
  if (mainLang !== 'en') {
    candidateFiles.push('docs/README-en.md');
  }
  
  // 4. 最终回退到根目录的README.md
  candidateFiles.push('README.md');
  
  logger.log(_('options_help_log_candidates', 'README文件候选列表'), candidateFiles);
  
  // 检查扩展内部文件是否存在
  for (const filePath of candidateFiles) {
    try {
      const url = chrome.runtime.getURL(filePath);
      
      // 使用fetch检查文件是否存在
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        logger.log(_('options_help_log_file_found', '找到有效的README文件'), filePath);
        return filePath;
      }
    } catch (e) {
      // 忽略错误，继续检查下一个候选文件
      logger.warn(_('options_help_log_file_not_found', '未找到README文件'), e);
    }
  }
  
  // 所有文件都不存在，返回默认的README.md
  logger.warn(_('options_help_log_fallback', '所有候选README文件都不存在，使用默认README.md'));
  return 'README.md';
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
function updateViewPreview(view: ViewType): void {
  const previewContainer = document.getElementById('view-preview');
  if (previewContainer) {
    // 直接支持 'waterfall' 作为预览类型（timeline 已废弃）
    const previewType = view;

    // 更新类名
    previewContainer.className = `preview-box ${previewType}-preview`;
    
  // 不再在预览中显示视图名称标签，避免为其做国际化处理
    // 插入内联 SVG 示意图（waterfall 与 tree），以便更灵活地美化示意
    // 插入内联 SVG：根据预览类型渲染更加丰富的示意图
    if (previewType === 'waterfall') {
      // 瀑布图：每条泳道节点数量与宽度可变，颜色与大小体现不同重要性
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 150" preserveAspectRatio="xMidYMid meet" width="100%" height="100%">
          <rect x="0" y="0" width="260" height="150" fill="transparent" />
          <!-- lanes -->
          <rect x="14" y="16" width="232" height="26" rx="6" fill="#f5f7ff" stroke="#e8eefc" />
          <rect x="14" y="58" width="232" height="26" rx="6" fill="#fbfbff" stroke="#eef3fb" />
          <rect x="14" y="100" width="232" height="26" rx="6" fill="#f6f8ff" stroke="#eef3fb" />

          <!-- lane 1: 4 medium nodes -->
          <rect x="24" y="20" width="36" height="18" rx="4" fill="#4a6ee0" />
          <rect x="68" y="20" width="52" height="18" rx="4" fill="#7aa2ff" />
          <rect x="126" y="20" width="24" height="18" rx="4" fill="#4a6ee0" />
          <rect x="156" y="20" width="60" height="18" rx="4" fill="#34a853" />

          <!-- lane 2: 2 larger nodes -->
          <rect x="30" y="62" width="90" height="18" rx="4" fill="#ffb703" />
          <rect x="126" y="62" width="70" height="18" rx="4" fill="#ff6b6b" />

          <!-- lane 3: many small nodes -->
          <rect x="22" y="104" width="18" height="14" rx="3" fill="#9b59b6" />
          <rect x="46" y="104" width="26" height="14" rx="3" fill="#00aaff" />
          <rect x="78" y="104" width="36" height="14" rx="3" fill="#34a853" />
          <rect x="118" y="104" width="20" height="14" rx="3" fill="#ff7f50" />
          <rect x="144" y="104" width="56" height="14" rx="3" fill="#4a6ee0" />

          <!-- subtle separators -->
          <line x1="14" y1="44" x2="246" y2="44" stroke="#ffffff" stroke-opacity="0.6" />
          <line x1="14" y1="86" x2="246" y2="86" stroke="#ffffff" stroke-opacity="0.6" />
        </svg>
      `;

      previewContainer.innerHTML = svg;
    } else if (previewType === 'tree') {
      // 左右平衡树：根节点在中间，左右对称展开，颜色分组
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" preserveAspectRatio="xMidYMid meet" width="100%" height="100%">
          <rect x="0" y="0" width="240" height="140" fill="transparent" />
          <!-- center root -->
          <circle cx="120" cy="28" r="12" fill="#4a6ee0" stroke="#fff" stroke-width="2" />

          <!-- left branch -->
          <path d="M120 36 C100 46 88 62 68 76" stroke="#d0d7ef" stroke-width="2" fill="none" />
          <circle cx="72" cy="78" r="10" fill="#ff6b6b" stroke="#fff" stroke-width="2" />
          <path d="M72 88 C60 98 52 110 40 120" stroke="#e9eef8" stroke-width="1.5" fill="none" />
          <circle cx="44" cy="120" r="7" fill="#fbbc05" stroke="#fff" stroke-width="1.5" />
          <circle cx="56" cy="106" r="7" fill="#9b59b6" stroke="#fff" stroke-width="1.5" />

          <!-- right branch (mirror) -->
          <path d="M120 36 C140 46 152 62 172 76" stroke="#d0d7ef" stroke-width="2" fill="none" />
          <circle cx="168" cy="78" r="10" fill="#34a853" stroke="#fff" stroke-width="2" />
          <path d="M168 88 C180 98 188 110 200 120" stroke="#e9eef8" stroke-width="1.5" fill="none" />
          <circle cx="196" cy="120" r="7" fill="#00aaff" stroke="#fff" stroke-width="1.5" />
          <circle cx="184" cy="106" r="7" fill="#ff7f50" stroke="#fff" stroke-width="1.5" />

          <!-- subtle connectors near root -->
          <line x1="96" y1="48" x2="104" y2="56" stroke="#dfe8fb" stroke-width="1.5" />
          <line x1="136" y1="56" x2="144" y2="48" stroke="#dfe8fb" stroke-width="1.5" />
        </svg>
      `;

      previewContainer.innerHTML = svg;
    } else {
      previewContainer.innerHTML = '';
    }
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
    
    logger.log(_('options_settings_loaded', '设置已加载 {0}'), currentSettings);
  } catch (error) {
    logger.error(_('options_settings_load_error', '加载设置时出错: {0}'), error);
    showNotification(_('options_load_failed', '加载设置失败，请重试'), 'error');
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

  // 强制语言 UI
  const forceLangSelect = document.getElementById('force-language') as HTMLSelectElement;
  if (forceLangSelect) {
    // 设置UI值，后端使用 'system' 表示跟随系统
    forceLangSelect.value = (currentSettings.forcedLocale || 'system');
    // 在加载设置时立即应用强制语言（如果有），以确保选项页在刷新后仍使用该语言
    try {
      const forced = currentSettings.forcedLocale;
      // 非阻塞地应用语言，失败时记录警告
      I18n.getInstance().setLocale(forced && forced !== 'system' ? forced : null)
        .catch(err => logger.warn(_('options_apply_forced_locale_failed', '应用强制语言失败: {0}'), String(err)));
    } catch (e) {
      logger.warn(_('options_apply_forced_locale_failed', '应用强制语言失败: {0}'), String(e));
    }
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
  
  // 默认视图（仅支持 tree 与 waterfall）
  const defaultView = (document.getElementById('default-view') as HTMLSelectElement)?.value as 'tree' | 'waterfall' || 'tree';
  
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
    forcedLocale: (document.getElementById('force-language') as HTMLSelectElement)?.value || 'system',
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
    logger.error(_('options_save_error', '保存设置时出错'), error);
    showNotification(_('options_save_failed', '保存设置失败'), 'error', 3000);
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
    showNotification(_('options_no_changes', '没有设置被更改'), 'success', 2000);
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
  let message: string;
  let type: 'success' | 'error' = 'success';
  let duration = 3000;
  
  if (affectsBackground) {
    // 使用完整的"需要重载"消息
    message = _('options_settings_saved_reload', '设置已保存 - 需要重新加载扩展才能完全生效');
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
        msgElement.textContent = message;
        notification.appendChild(msgElement);
        
        // 添加重载按钮，使用单独的本地化字符串
        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'notification-action';
        reloadBtn.textContent = _('options_reload_now', '立即重载');
        reloadBtn.onclick = () => {
          try {
            chrome.runtime.reload();
          } catch (e) {
            logger.error(_('options_extension_reload_failed', '重载扩展失败: {0}'), e);
            showNotification(_('options_reload_failed', '重载扩展失败，请手动刷新'), 'error');
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
      logger.error(_('options_complex_notification_failed', '创建复杂通知失败，回退到标准通知: {0}'), e);
    }
  } else if (affectsFrontend) {
    // 使用完整的"需要刷新"消息
    message = _('options_settings_saved_refresh', '设置已保存 - 请刷新已打开的扩展页以应用新设置');
    duration = 4000;
  } else {
    // 基本的"设置已保存"消息
    message = _('options_settings_saved', '设置已保存');
  }
  
  // 标准通知
  showNotification(message, type, duration);
}

/**
 * 重置设置
 */
async function resetSettings(): Promise<void> {
  try {
    if (confirm(_('options_confirm_reset', '确定要恢复所有默认设置吗？'))) {
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
    logger.error(_('options_reset_error', '重置设置时出错'), error);
    showNotification(_('options_reset_failed', '重置设置失败'), 'error');
  }
}

/**
 * 清除所有数据
 */
async function clearAllData(): Promise<void> {
  try {
    if (confirm(_('options_confirm_clear_data', '确定要清除所有导航数据吗？此操作无法撤销！'))) {
      // 显示加载状态
      const loadingOverlay = document.getElementById('loading-overlay');
      if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
      }
      
      try {
        // 使用正确的消息格式
        const response = await sendToBackground('clearAllData', {
          timestamp: Date.now()
        });
        
        if (response && response.success) {
          showNotification(_('options_data_cleared', '所有数据已清除'), 'success', 5000);
        } else {
          throw new Error(response?.error || _('options_unknown_error', '未知错误'));
        }
      } catch (error) {
        logger.error(_('options_clear_error', '清除数据时出错'), error);
        throw error;
      } finally {
        // 隐藏加载状态
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
          loadingOverlay.style.display = 'none';
        }
      }
    }
  } catch (error) {
    logger.error(_('options_clear_error', '清除数据时出错'), error);
    showNotification(_('options_clear_failed', '清除数据失败'), 'error');
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
    logger.log(_('options_notification_showing', '显示通知: {0} ({1})'), message, type);
    
    const notification = document.getElementById('notification');
    if (!notification) {
      logger.error(_('options_notification_element_missing', '找不到通知元素'));
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
function showNotification(message: string, type: 'success' | 'error' = 'success', duration: number = 3000): void {
  notificationManager.show(message, type, duration);
}
