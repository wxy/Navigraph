import { NavigationManager } from '../navigation-manager.js';

/**
 * 设置扩展事件监听器
 */
export function setupEventListeners(navigationManager: NavigationManager): void {
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
    console.log('Navigraph 扩展首次安装');
    
    // 显示欢迎页面或教程
    chrome.tabs.create({
      url: chrome.runtime.getURL('dist/content/index.html'),
      active: true
    });
  } else if (details.reason === 'update') {
    console.log(`Navigraph 扩展已更新到版本 ${chrome.runtime.getManifest().version}`);
  }
}

/**
 * 处理扩展图标点击事件
 */
async function handleActionClicked(): Promise<void> {
  console.log('扩展图标被点击');
  
  try {
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 检查是否已经打开了导航树页面
    const indexUrl = chrome.runtime.getURL('dist/content/index.html');
    const existingTab = tabs.find(tab => tab.url?.startsWith(indexUrl));
    
    if (existingTab && existingTab.id) {
      // 如果已经打开，切换到该标签页
      console.log('导航树页面已打开，切换到该标签页');
      await chrome.tabs.update(existingTab.id, { active: true });
      
      // 如果标签页在其他窗口，则聚焦该窗口
      if (existingTab.windowId) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
      }
    } else {
      // 如果没有打开，创建新标签页
      console.log('创建新导航树页面');
      await chrome.tabs.create({ url: indexUrl });
    }
  } catch (error) {
    console.error('打开导航树页面失败:', error);
  }
}