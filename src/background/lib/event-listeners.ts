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
    logger.log('extension_installed');
    
    // 显示欢迎页面或教程
    chrome.tabs.create({
      url: chrome.runtime.getURL('content/index.html'),
      active: true
    });
  } else if (details.reason === 'update') {
    logger.log('extension_updated', chrome.runtime.getManifest().version);
  }
}

/**
 * 处理扩展图标点击事件
 */
async function handleActionClicked(): Promise<void> {
  logger.log('icon_clicked');
  
  try {
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 检查是否已经打开了导航树页面
    const indexUrl = chrome.runtime.getURL('content/index.html');
    const existingTab = tabs.find(tab => tab.url?.startsWith(indexUrl));
    
    if (existingTab && existingTab.id) {
      // 如果已经打开，切换到该标签页
      logger.log('tab_exists');
      await chrome.tabs.update(existingTab.id, { active: true });
      
      // 如果标签页在其他窗口，则聚焦该窗口
      if (existingTab.windowId) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
      }
    } else {
      // 如果没有打开，创建新标签页
      logger.log('create_new_tab');
      await chrome.tabs.create({ url: indexUrl });
    }
  } catch (error) {
    logger.error('open_tab_failed', error instanceof Error ? error.message : String(error));
  }
}