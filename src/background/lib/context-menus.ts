import { Logger } from '../../lib/utils/logger.js';
import { isDev } from '../../lib/environment.js';
import { i18n } from '../../lib/utils/i18n-utils.js';

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
      title: i18n('debug_menu_title'),
      contexts: ['action'] // 仅在扩展图标的右键菜单中显示
    });

    // 添加子菜单项
    chrome.contextMenus.create({
      id: 'debug-check-data',
      parentId: 'navigraph-debug',
      title: i18n('debug_menu_check_data'),
      contexts: ['action']
    });

    chrome.contextMenus.create({
      id: 'debug-check-dom',
      parentId: 'navigraph-debug',
      title: i18n('debug_menu_check_dom'),
      contexts: ['action']
    });

    chrome.contextMenus.create({
      id: 'debug-clear-data',
      parentId: 'navigraph-debug',
      title: i18n('debug_menu_clear_data'),
      contexts: ['action']
    });

    logger.log('debug_menu_setup_complete');
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
      logger.log('debug_menu_found_tab', tab.id?.toString());
      
      // 激活标签页
      chrome.tabs.update(tab.id!, { active: true }, () => {
        // 使用Chrome存储API传递调试命令
        chrome.storage.local.set({
          'navigraph_debug_command': command,
          'navigraph_debug_timestamp': Date.now()
        }, () => {
          if (chrome.runtime.lastError) {
            logger.error('debug_menu_command_error', chrome.runtime.lastError.message || i18n('unknown_error'));
            return;
          }
          
          logger.log('debug_menu_command_sent', command);
        });
      });
    } else {
      // 如果没有找到扩展页面，创建新标签页
      logger.log('debug_menu_creating_tab');
      
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