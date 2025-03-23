import { NavigationManager } from './navigation-manager.js';
import { BrowsingSession } from './types/webext.js'; // 假设类型在此文件中
import { MessageContext } from './lib/message-context.js'

interface SessionSummary {
  id: string;
  title?: string;
  startTime: number;
  endTime?: number;
  recordCount?: number;
}

interface GetSessionsResponse {
  success: boolean;
  sessions?: SessionSummary[];
  error?: string;
}

interface GetSessionDetailsResponse {
  success: boolean;
  session?: BrowsingSession; // 使用您现有的BrowsingSession类型
  error?: string;
}

/**
 * 主要的后台脚本，负责初始化跟踪器和处理消息
 */

// 创建并初始化导航节点管理器
const navigationManager = new NavigationManager();
console.log('Navigraph 扩展已启动');

// 使用navigationManager中的存储实例，而不是创建新实例
const storage = navigationManager.getStorage();

// 处理扩展安装或更新
chrome.runtime.onInstalled.addListener((details) => {
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
  setupDebugContextMenu();
});

// 处理扩展图标点击事件
chrome.action.onClicked.addListener(async () => {
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
});

// 处理消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message.action, message.requestId ? `[ID:${message.requestId}]` : '');
  
  // 创建消息上下文
  const ctx = new MessageContext(message, sender, sendResponse);
  
  if (!message.action) {
    return ctx.error('缺少action字段');
  }
  
  // 所有消息统一使用Promise处理
  switch (message.action) {
    // 处理获取会话列表
    case 'getSessions':
      console.log('处理获取会话列表请求', message.requestId ? `[ID:${message.requestId}]` : '');
      storage.getSessions()
        .then(sessions => {
          console.log('原始sessions数据结构:', 
            sessions ? `数组长度=${Array.isArray(sessions) ? sessions.length : '非数组'}` : '未定义');
          
          // 确保sessions是数组
          const sessionsArray = Array.isArray(sessions) ? sessions : [];
          
          // 创建简化的会话摘要
          const sessionSummaries = sessionsArray.map(session => ({
            id: session.id,
            title: session.title || session.id,
            startTime: session.startTime,
            endTime: session.endTime || 0,
            recordCount: session.records ? Object.keys(session.records).length : 0
          }));
          
          console.log(`发送会话列表响应: ${sessionSummaries.length}个会话`, 
                      ctx.requestId ? `[ID:${ctx.requestId}]` : '');
                      
          return ctx.success({ sessions: sessionSummaries });
        })
        .catch(error => {
          console.error('获取会话列表失败:', error);
          return ctx.error(String(error));
        });
      break;
      
    // 修改 'getNodeId' 消息处理部分
    case 'getNodeId':
      Promise.resolve().then(async () => {
        const tabId = ctx.getTabId();
        const url = message.url || ctx.getUrl() || '';
        
        if (!tabId) {
          console.error('获取节点ID失败：无法确定标签页ID');
          return ctx.error('无法获取标签页信息');
        }
        
        try {
          // 使用 await 等待异步操作完成
          const nodeId = await navigationManager.getNodeIdForTab(tabId, url);
          
          if (nodeId) {
            console.log(`内容脚本请求节点ID: 标签页=${tabId}, URL=${url}, 返回=${nodeId}`);
            return ctx.success({ nodeId, tabId });
          } else {
            // 节点不存在，返回错误而非创建新节点
            console.log(`未找到标签页${tabId}的节点ID: ${url}，不创建新节点`);
            return ctx.error('未找到此页面的节点ID');
          }
        } catch (error) {
          console.error(`获取节点ID失败:`, error);
          return ctx.error(`获取节点ID时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      break;
      
    // 处理页面标题更新
    case 'pageTitleUpdated':
      Promise.resolve().then(async () => {
        if (message.nodeId && message.title) {
          await navigationManager.updateNodeMetadata(
            message.nodeId,
            { title: message.title },
            'content_script'
          );
          return ctx.success();
        } else {
          return ctx.error('缺少节点ID或标题');
        }
      });
      break;
      
    // 处理favicon更新
    case 'faviconUpdated':
      Promise.resolve().then(async () => {
        if (message.nodeId && message.favicon) {
          await navigationManager.updateNodeMetadata(
            message.nodeId,
            { favicon: message.favicon },
            'content_script'
          );
          return ctx.success();
        } else {
          return ctx.error('缺少节点ID或图标');
        }
      });
      break;
      
    // 修改 'pageLoaded' 消息处理
    case 'pageLoaded':
      Promise.resolve().then(async () => {
        const tabId = ctx.getTabId();
        const pageInfo = message.pageInfo || {};
        const url = pageInfo.url || ctx.getUrl() || '';
        
        if (!tabId || !url) {
          return ctx.error('缺少必要的页面信息');
        }
        
        console.log(`处理页面加载事件: 标签页=${tabId}, URL=${url}`);
        
        // 使用 navigationManager 更新页面元数据
        const nodeId = await navigationManager.updatePageMetadata(tabId, {
          ...pageInfo,
          url: url
        });
        
        if (nodeId) {
          return ctx.success({ nodeId });
        } else {
          return ctx.error('未找到此页面的节点ID');
        }
      });
      break;
      
    // 处理页面活动消息
    case 'pageActivity':
      console.log('收到页面活动消息:', message.source || 'unknown source', 
                message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : 'unknown time');
      return ctx.success({ acknowledged: true });
    
    // 处理链接点击
    case 'linkClicked':
      Promise.resolve().then(async () => {
        const tabId = ctx.getTabId();
        if (tabId !== undefined && message.linkInfo) {
          try {
            await navigationManager.handleLinkClicked(tabId, message.linkInfo);
            return ctx.success();
          } catch (error) {
            console.error('处理链接点击失败:', error);
            return ctx.error(`处理链接点击失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          return ctx.error('缺少链接信息或标签页ID');
        }
      });
      break;
      
    // 处理表单提交
    case 'formSubmitted':
      Promise.resolve().then(async () => {
        const tabId = ctx.getTabId();
        if (tabId !== undefined && message.formInfo) {
          try {
            await navigationManager.handleFormSubmitted(tabId, message.formInfo);
            return ctx.success();
          } catch (error) {
            console.error('处理表单提交失败:', error);
            return ctx.error(`处理表单提交失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          return ctx.error('缺少表单信息或标签页ID');
        }
      });
      break;
      
    // 处理JS导航
    case 'jsNavigation':
      Promise.resolve().then(async () => {
        const tabId = ctx.getTabId();
        if (tabId !== undefined) {
          try {
            await navigationManager.handleJsNavigation(tabId, message);
            return ctx.success();
          } catch (error) {
            console.error('处理JS导航失败:', error);
            return ctx.error(`处理JS导航失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          return ctx.error('无效的消息来源或标签页ID');
        }
      });
      break;
      
    // 处理获取会话详情
    case 'getSessionDetails':
      console.log('处理获取会话详情请求', message.sessionId, ctx.requestId ? `[ID:${ctx.requestId}]` : '');
      
      if (!message.sessionId) {
        return ctx.error('缺少会话ID');
      }
      
      storage.getSession(message.sessionId)
        .then(session => {
          if (session) {
            console.log(`成功获取会话 ${message.sessionId} 的详情`);
            return ctx.success({ session });
          } else {
            console.log(`会话 ${message.sessionId} 不存在`);
            return ctx.error('会话不存在');
          }
        })
        .catch(error => {
          console.error('获取会话详情失败:', error);
          return ctx.error(String(error));
        });
      break;
      
    // 处理获取导航树
    case 'getNavigationTree':
      handleGetNavigationTreeWithContext(ctx, message.options);
      break;
      
    // 处理清除所有数据
    case 'clearAllData':
    case 'clearAllRecords':
      handleClearAllRecordsWithContext(ctx);
      break;
      
    // 未知消息类型
    default:
      console.warn('未知的消息类型:', message.action);
      return ctx.error(`未知的消息类型: ${message.action}`);
  }
  
  // 返回true保持消息通道开启，允许异步响应
  return true;
});

/**
 * 处理获取导航树数据请求
 */
async function handleGetNavigationTreeWithContext(
  ctx: MessageContext, 
  options: any = {}
): Promise<void> {
  try {
    console.log('获取导航树数据...', options, ctx.requestId ? `[ID:${ctx.requestId}]` : '');
    
    // 获取导航树
    const treeData = await navigationManager.getStorage().getNavigationTree();
    
    // 检查是否需要提供上次更新时间（用于增量更新）
    if (options && options.lastUpdate) {
      // 如果客户端提供了上次更新时间，标记在此时间后更新的节点
      const lastUpdateTime = parseInt(options.lastUpdate);
      if (!isNaN(lastUpdateTime)) {
        markUpdatedNodes(treeData, lastUpdateTime);
      }
    }
    
    // 记录调试信息
    const nodeCount = treeData.nodes.length;
    const edgeCount = treeData.edges.length;
    
    // 如果数据为空，记录特别调试信息
    if (nodeCount === 0) {
      console.warn('返回的导航树没有节点数据');
      const recordCount = await getRecordCount();
      console.log(`数据库中有 ${recordCount} 条记录`);
    } else {
      console.log(`导航树数据已准备好: ${nodeCount} 个节点, ${edgeCount} 条边`);
    }
    
    // 发送响应，包含更丰富的数据
    ctx.success({
      data: {
        nodes: treeData.nodes,
        edges: treeData.edges
      },
      timestamp: Date.now() // 添加当前时间戳，客户端用于增量更新
    });
  } catch (error) {
    console.error('获取导航树失败:', error);
    ctx.error(String(error));
  }
}

/**
 * 标记指定时间后更新的节点
 */
function markUpdatedNodes(treeData: { nodes: any[]; edges: any[] }, lastUpdateTime: number): void {
  // 遍历所有节点，标记新增或更新的
  for (const node of treeData.nodes) {
    if (node.timestamp > lastUpdateTime) {
      node.isUpdated = true;
    }
  }
  
  // 遍历所有边，标记新增或更新的
  for (const edge of treeData.edges) {
    if (edge.timestamp > lastUpdateTime) {
      edge.isUpdated = true;
    }
  }
}

/**
 * 处理清空所有记录请求
 */
async function handleClearAllRecordsWithContext(
  ctx: MessageContext
): Promise<void> {
  try {
    console.log('清空所有导航记录...', ctx.requestId ? `[ID:${ctx.requestId}]` : '');
    
    // 清空所有记录
    const success = await navigationManager.getStorage().clearAllRecords();
    
    // 发送响应
    ctx.success();
  } catch (error) {
    console.error('清空记录失败:', error);
    ctx.error(String(error));
  }
}

/**
 * 获取数据库中的记录总数
 */
async function getRecordCount(): Promise<number> {
  try {
    // 使用NavigationManager获取记录数量
    return await navigationManager.getNodeCount();
  } catch (error) {
    console.error('获取记录数量失败:', error);
    return 0;
  }
}

/**
 * 初始化导航图谱后台
 */
(async () => {
  try {
    console.log('导航图谱后台初始化开始...');
    await storage.initialize();
    
    // 初始化NavigationManager
    await navigationManager.initialize();
    
    console.log('导航图谱后台初始化成功');
  } catch (error) {
    console.error('导航图谱后台初始化失败:', error);
  }
})();

// 添加到文件合适位置 - 通常是在初始化时
function setupDebugContextMenu() {
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

    console.log('创建调试上下文菜单完成');
  });
}

// 处理菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  
  // 根据不同菜单项执行相应操作
  switch (info.menuItemId) {
    case 'debug-check-data':
    case 'debug-check-dom':
    case 'debug-clear-data':
      // 检查是否已经打开了扩展页面
      chrome.tabs.query({ url: chrome.runtime.getURL('dist/content/index.html') + '*' }, (existingTabs) => {
        if (existingTabs && existingTabs.length > 0) {
          // 如果扩展页面已打开，尝试发送消息
          try {
            chrome.tabs.sendMessage(
              existingTabs[0].id!, // 使用非空断言，因为我们已经检查了数组长度
              {
                action: 'debug',
                command: info.menuItemId
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  console.warn('发送到已打开页面失败，打开新标签页:', chrome.runtime.lastError);
                  // 新开一个标签页
                  chrome.tabs.create({
                    url: chrome.runtime.getURL('dist/content/index.html') + `?debug=${info.menuItemId}`
                  });
                  return;
                }

                console.log('调试命令已发送到现有标签页:', response);
                // 激活该标签页
                chrome.tabs.update(existingTabs[0].id!, { active: true });
              }
            );
          } catch (err) {
            console.error('发送消息时出错:', err);
            // 出错时创建新标签
            chrome.tabs.create({
              url: chrome.runtime.getURL('dist/content/index.html') + `?debug=${info.menuItemId}`
            });
          }
        } else {
          // 如果扩展页面未打开，创建新标签
          chrome.tabs.create({
            url: chrome.runtime.getURL('dist/content/index.html') + `?debug=${info.menuItemId}`
          });
        }
      });
      break;
  }
});