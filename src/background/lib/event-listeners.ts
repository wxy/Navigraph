import { Logger } from '../../lib/utils/logger.js';
import { NavigationManager } from '../navigation/navigation-manager.js';
import { i18n } from '../../lib/utils/i18n-utils.js';

const logger = new Logger('EventListeners');

/**
 * 设置扩展事件监听器
 */
export function setupEventListeners(): void {
  // 处理扩展安装或更新
  chrome.runtime.onInstalled.addListener((details) => {
    handleExtensionInstalled(details);
  });
  
  // 处理扩展图标点击事件
  chrome.action.onClicked.addListener(async () => {
    handleActionClicked();
  });
}

/**
 * 处理扩展安装或更新事件
 */
function handleExtensionInstalled(details: chrome.runtime.InstalledDetails): void {
  if (details.reason === 'install') {
    logger.log(i18n('extension_installed', '导航图谱（Navigraph）扩展首次安装'));
    
    // 显示欢迎页面或教程
    chrome.tabs.create({
      url: chrome.runtime.getURL('content/index.html'),
      active: true
    });
  } else if (details.reason === 'update') {
    logger.log(i18n('extension_updated', '导航图谱（Navigraph）扩展已更新到版本 {0}'), chrome.runtime.getManifest().version);
  }
}

/**
 * 处理扩展图标点击事件
 */
async function handleActionClicked(): Promise<void> {
  logger.log(i18n('icon_clicked', '导航图谱（Navigraph）扩展图标被点击'));
  
  try {
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 检查是否已经打开了导航树页面
    const indexUrl = chrome.runtime.getURL('content/index.html');
    const existingTab = tabs.find(tab => tab.url?.startsWith(indexUrl));
    
    if (existingTab && existingTab.id) {
      // 如果已经打开，切换到该标签页
      logger.log(i18n('tab_exists', '导航图谱页面已打开，切换到该标签页'));
      await chrome.tabs.update(existingTab.id, { active: true });
      
      // 如果标签页在其他窗口，则聚焦该窗口
      if (existingTab.windowId) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
      }
    } else {
      // 如果没有打开，创建新标签页
      logger.log(i18n('create_new_tab', '创建新导航图谱页面'));
      await chrome.tabs.create({ url: indexUrl });
    }
  } catch (error) {
    logger.error(i18n('open_tab_failed', '打开导航图谱页面失败'), error instanceof Error ? error.message : String(error));
  }
}