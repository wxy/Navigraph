import { Logger } from '../../lib/utils/logger.js';
import { NavigationManager } from '../navigation-manager.js';

const logger = new Logger('ContextMenus');

/**
 * 设置上下文菜单
 */
export function setupContextMenus(navigationManager: NavigationManager): void {
  // 添加调试上下文菜单
  setupDebugContextMenu();
  
  // 处理菜单点击事件
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    handleContextMenuClicked(info, tab);
  });
}

/**
 * 设置调试上下文菜单
 */
function setupDebugContextMenu(): void {
  // 移除可能存在的旧菜单
  chrome.contextMenus.removeAll(() => {
    // 创建父级菜单
    chrome.contextMenus.create({
      id: 'navigraph-debug',
      title: '🐞 Navigraph调试工具',
      contexts: ['action'] // 仅在扩展图标的右键菜单中显示
    });

    // 添加子菜单项
    chrome.contextMenus.create({
      id: 'debug-check-data',
      parentId: 'navigraph-debug',
      title: '检查数据',
      contexts: ['action']
    });

    chrome.contextMenus.create({
      id: 'debug-check-dom',
      parentId: 'navigraph-debug',
      title: '检查DOM',
      contexts: ['action']
    });

    chrome.contextMenus.create({
      id: 'debug-clear-data',
      parentId: 'navigraph-debug',
      title: '清除数据',
      contexts: ['action']
    });

    logger.log('创建调试上下文菜单完成');
  });
}

/**
 * 处理上下文菜单点击事件
 */
function handleContextMenuClicked(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): void {
  if (!tab?.id) return;
  
  // 根据不同菜单项执行相应操作
  switch (info.menuItemId) {
    case 'debug-check-data':
    case 'debug-check-dom':
    case 'debug-clear-data':
      handleDebugMenuAction(info.menuItemId as string);
      break;
  }
}

/**
 * 处理调试菜单操作
 */
function handleDebugMenuAction(command: string): void {
  // 检查是否已经打开了扩展页面
  chrome.tabs.query({ url: chrome.runtime.getURL('dist/content/index.html') + '*' }, (existingTabs) => {
    if (existingTabs && existingTabs.length > 0) {
      // 如果扩展页面已打开，尝试发送消息
      try {
        chrome.tabs.sendMessage(
          existingTabs[0].id!, // 使用非空断言，因为我们已经检查了数组长度
          {
            action: 'debug',
            command: command
          },
          (response) => {
            if (chrome.runtime.lastError) {
              logger.warn('发送到已打开页面失败，打开新标签页:', chrome.runtime.lastError);
              // 新开一个标签页
              chrome.tabs.create({
                url: chrome.runtime.getURL('dist/content/index.html') + `?debug=${command}`
              });
              return;
            }

            logger.log('调试命令已发送到现有标签页:', response);
            // 激活该标签页
            chrome.tabs.update(existingTabs[0].id!, { active: true });
          }
        );
      } catch (err) {
        logger.error('发送消息时出错:', err);
        // 出错时创建新标签
        chrome.tabs.create({
          url: chrome.runtime.getURL('dist/content/index.html') + `?debug=${command}`
        });
      }
    } else {
      // 如果扩展页面未打开，创建新标签
      chrome.tabs.create({
        url: chrome.runtime.getURL('dist/content/index.html') + `?debug=${command}`
      });
    }
  });
}