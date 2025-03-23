import { MessageContext } from './message-context.js';
import { NavigationManager } from '../navigation-manager.js';
import { refreshSettings, getSetting } from '../../lib/settings/service.js';

/**
 * 处理扩展消息
 */
export function handleMessage(
  message: any, 
  sender: chrome.runtime.MessageSender, 
  sendResponse: (response?: any) => void,
  navigationManager: NavigationManager
): boolean {
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
      handleGetSessions(ctx, navigationManager);
      break;
      
    // 获取节点ID
    case 'getNodeId':
      handleGetNodeId(ctx, message, navigationManager);
      break;
      
    // 处理页面标题更新
    case 'pageTitleUpdated':
      handlePageTitleUpdated(ctx, message, navigationManager);
      break;
      
    // 处理favicon更新
    case 'faviconUpdated':
      handleFaviconUpdated(ctx, message, navigationManager);
      break;
      
    // 处理页面加载
    case 'pageLoaded':
      handlePageLoaded(ctx, message, navigationManager);
      break;
      
    // 处理页面活动消息
    case 'pageActivity':
      handlePageActivity(ctx, message);
      break;
    
    // 处理链接点击
    case 'linkClicked':
      handleLinkClicked(ctx, message, navigationManager);
      break;
      
    // 处理表单提交
    case 'formSubmitted':
      handleFormSubmitted(ctx, message, navigationManager);
      break;
      
    // 处理JS导航
    case 'jsNavigation':
      handleJsNavigation(ctx, message, navigationManager);
      break;
      
    // 处理获取会话详情
    case 'getSessionDetails':
      handleGetSessionDetails(ctx, message, navigationManager);
      break;
      
    // 处理获取导航树
    case 'getNavigationTree':
      handleGetNavigationTree(ctx, message, navigationManager);
      break;
      
    // 处理清除所有数据
    case 'clearAllData':
    case 'clearAllRecords':
      handleClearAllRecords(ctx, navigationManager);
      break;
      
    // 未知消息类型
    default:
      console.warn('未知的消息类型:', message.action);
      return ctx.error(`未知的消息类型: ${message.action}`);
  }
  
  // 返回true保持消息通道开启，允许异步响应
  return true;
}

/**
 * 处理获取会话列表
 */
function handleGetSessions(
  ctx: MessageContext, 
  navigationManager: NavigationManager
): void {
  console.log('处理获取会话列表请求', ctx.requestId ? `[ID:${ctx.requestId}]` : '');
  
  navigationManager.getStorage().getSessions()
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
}

/**
 * 处理获取节点ID
 */
function handleGetNodeId(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
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
}

/**
 * 处理页面标题更新
 */
function handlePageTitleUpdated(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
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
}

/**
 * 处理favicon更新
 */
function handleFaviconUpdated(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
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
}

/**
 * 处理页面加载
 */
function handlePageLoaded(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
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
}

/**
 * 处理页面活动消息
 */
function handlePageActivity(
  ctx: MessageContext, 
  message: any
): void {
  Promise.resolve().then(() => {
    console.log(
      "收到页面活动消息:",
      message.source || "unknown source",
      message.timestamp
        ? new Date(message.timestamp).toLocaleTimeString()
        : "unknown time"
    );
    return ctx.success({ acknowledged: true });
  });
}

/**
 * 处理链接点击
 */
function handleLinkClicked(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
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
}

/**
 * 处理表单提交
 */
function handleFormSubmitted(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
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
}

/**
 * 处理JS导航
 */
function handleJsNavigation(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
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
}

/**
 * 处理获取会话详情
 */
function handleGetSessionDetails(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
  Promise.resolve().then(async () => {
    console.log(
      "处理获取会话详情请求",
      message.sessionId,
      ctx.requestId ? `[ID:${ctx.requestId}]` : ""
    );

    if (!message.sessionId) {
      return ctx.error("缺少会话ID");
    }

    try {
      const session = await navigationManager
        .getStorage()
        .getSession(message.sessionId);

      if (session) {
        console.log(`成功获取会话 ${message.sessionId} 的详情`);
        return ctx.success({ session });
      } else {
        console.log(`会话 ${message.sessionId} 不存在`);
        return ctx.error("会话不存在");
      }
    } catch (error) {
      console.error("获取会话详情失败:", error);
      return ctx.error(String(error));
    }
  });
}

/**
 * 处理获取导航树
 */
function handleGetNavigationTree(
  ctx: MessageContext, 
  message: any, 
  navigationManager: NavigationManager
): void {
  Promise.resolve().then(async () => {
    try {
      // 在关键操作前刷新设置，确保使用最新设置
      await refreshSettings();
      
      const options = message.options || {};
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
        const recordCount = await getRecordCount(navigationManager);
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
  });
}

/**
 * 处理清空所有记录
 */
function handleClearAllRecords(
  ctx: MessageContext,
  navigationManager: NavigationManager
): void {
  Promise.resolve().then(async () => {
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
  });
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
 * 获取数据库中的记录总数
 */
async function getRecordCount(navigationManager: NavigationManager): Promise<number> {
  try {
    // 使用NavigationManager获取记录数量
    return await navigationManager.getNodeCount();
  } catch (error) {
    console.error('获取记录数量失败:', error);
    return 0;
  }
}