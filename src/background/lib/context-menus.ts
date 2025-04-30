import { Logger } from '../../lib/utils/logger.js';
import { isDev } from '../../lib/environment.js';
const logger = new Logger('ContextMenus');

/**
 * 设置上下文菜单
 */
export function setupContextMenus(): void {
  // 添加调试上下文菜单
  // 只在开发环境中设置调试菜单
  if (isDev()) {
    setupDebugContextMenu();
  
    // 处理菜单点击事件
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      handleContextMenuClicked(info, tab);
    });
  }
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
  chrome.tabs.query({ url: chrome.runtime.getURL('content/index.html') + '*' }, (existingTabs) => {
    if (existingTabs && existingTabs.length > 0) {
      // 找到现有标签页
      const tab = existingTabs[0];
      logger.log(`找到现有扩展页面: ${tab.id}`);
      
      // 激活标签页
      chrome.tabs.update(tab.id!, { active: true }, () => {
        // 使用Chrome存储API传递调试命令
        chrome.storage.local.set({
          'navigraph_debug_command': command,
          'navigraph_debug_timestamp': Date.now()
        }, () => {
          if (chrome.runtime.lastError) {
            logger.error('设置调试命令失败:', chrome.runtime.lastError);
            return;
          }
          
          logger.log(`已向存储API发送调试命令: ${command}`);
        });
      });
    } else {
      // 如果没有找到扩展页面，创建新标签页
      logger.log('未找到扩展页面，创建新标签页');
      
      // 先设置调试命令，然后创建页面
      chrome.storage.local.set({
        'navigraph_debug_command': command,
        'navigraph_debug_timestamp': Date.now()
      }, () => {
        chrome.tabs.create({
          url: chrome.runtime.getURL('content/index.html')
        });
      });
    }
  });
}