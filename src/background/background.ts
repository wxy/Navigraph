import { TabTracker } from './tab-manager.js';
import { NavigationStorage } from '../lib/storage';
import { BrowsingSession } from '../types/webext'; // 假设类型在此文件中
import { IdGenerator } from '../lib/id-generator.js';

// 可以添加到文件顶部或单独的types文件中

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

// 创建并初始化标签页跟踪器
const tabTracker = new TabTracker();
console.log('Navigraph 扩展已启动');

// 使用tabTracker中的存储实例，而不是创建新实例
const storage = tabTracker.getStorage();

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

// 替换现有的消息监听器
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message.action, message.requestId ? `[ID:${message.requestId}]` : '');
  
  if (!message.action) {
    sendResponse({ 
      success: false, 
      error: '缺少action字段',
      requestId: message.requestId  // 返回原请求ID
    });
    return true;
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
          
          // 构建响应对象，包含请求ID
          const response = {
            success: true,
            sessions: sessionSummaries,
            requestId: message.requestId  // 返回原请求ID
          };
          
          console.log(`发送会话列表响应: ${sessionSummaries.length}个会话`, 
                      message.requestId ? `[ID:${message.requestId}]` : '');
          sendResponse(response);
        })
        .catch(error => {
          console.error('获取会话列表失败:', error);
          sendResponse({
            success: false,
            error: String(error),
            sessions: [],
            requestId: message.requestId  // 返回原请求ID
          });
        });
      break;
      
    // 修改 'getNodeId' 消息处理部分
    case 'getNodeId':
      Promise.resolve().then(() => {
        const tabId = sender.tab?.id;
        // 使用消息中的URL或标签页的URL
        const url = message.url || sender.tab?.url || '';
        
        if (!tabId) {
          console.error('获取节点ID失败：无法确定标签页ID');
          sendResponse({ 
            success: false, 
            error: '无法获取标签页信息',
            action: 'getNodeId',
            requestId: message.requestId
          });
          return;
        }
        
        // 使用TabTracker获取节点ID
        const nodeId = tabTracker.getNodeIdForTab(tabId, url);
        
        if (nodeId) {
          console.log(`内容脚本请求节点ID: 标签页=${tabId}, URL=${url}, 返回=${nodeId}`);
          sendResponse({
            success: true,
            nodeId: nodeId,
            tabId: tabId,
            action: 'getNodeId',
            requestId: message.requestId
          });
        } else {
          // 节点不存在，返回错误而非创建新节点
          console.log(`未找到标签页${tabId}的节点ID: ${url}，不创建新节点`);
          sendResponse({
            success: false,
            error: '未找到此页面的节点ID',
            action: 'getNodeId',
            requestId: message.requestId
          });
        }
      });
      break;
      
    // 处理页面标题更新
    case 'pageTitleUpdated':
      if (message.nodeId) {
        tabTracker.handleTitleUpdated(
          sender.tab?.id || 0,
          message.nodeId,
          message.title
        )
        .then(() => {
          sendResponse({ 
            success: true,
            requestId: message.requestId  // 返回原请求ID
          });
        })
        .catch(error => {
          sendResponse({ 
            success: false, 
            error: String(error),
            requestId: message.requestId  // 返回原请求ID
          });
        });
      } else {
        sendResponse({ 
          success: false, 
          error: '缺少节点ID或页面ID',
          requestId: message.requestId  // 返回原请求ID
        });
      }
      break;
      
    // 处理favicon更新
    case 'faviconUpdated':
      if (message.nodeId) {
        tabTracker.handleFaviconUpdated(
          sender.tab?.id || 0,
          message.nodeId,
          message.favicon
        )
        .then(() => {
          sendResponse({ 
            success: true,
            requestId: message.requestId  // 返回原请求ID
          });
        })
        .catch(error => {
          sendResponse({ 
            success: false, 
            error: String(error),
            requestId: message.requestId  // 返回原请求ID
          });
        });
      } else {
        sendResponse({ 
          success: false, 
          error: '缺少节点ID',
          requestId: message.requestId  // 返回原请求ID
        });
      }
      break;
      
    // 修改 'pageLoaded' 消息处理，确保返回正确的节点ID信息
    case 'pageLoaded':
      Promise.resolve().then(() => {
        const tabId = sender.tab?.id;
        const pageInfo = message.pageInfo || {};
        const url = pageInfo.url || sender.tab?.url || '';
        
        if (!tabId || !url) {
          sendResponse({ 
            success: false, 
            error: '缺少必要的页面信息',
            action: 'pageLoaded',
            requestId: message.requestId
          });
          return;
        }
        
        console.log(`处理页面加载事件: 标签页=${tabId}, URL=${url}`);
        
        // 先查找是否有现有的节点ID
        let nodeId = tabTracker.getNodeIdForTab(tabId, url);
        
        // 如果没有找到节点ID，仅记录日志并返回错误，不创建新节点
        if (!nodeId) {
          console.log(`未找到标签页${tabId}的节点ID: ${url}，不创建新节点`);
          sendResponse({
            success: false,
            error: '未找到此页面的节点ID',
            action: 'pageLoaded',
            requestId: message.requestId
          });
          return;
        }
        
        // 处理页面信息
        navigationTracker.handlePageLoaded(tabId, {
          ...pageInfo,
          url: url,
          nodeId: nodeId
        });
        
        // 返回节点ID给内容脚本
        sendResponse({ 
          success: true,
          nodeId: nodeId,
          action: 'pageLoaded',
          requestId: message.requestId
        });
      });
      break;
      
    // 处理链接点击
    case 'linkClicked':
      Promise.resolve().then(() => {
        if (sender.tab && message.linkInfo) {
          navigationTracker.handleLinkClicked(sender.tab.id, message.linkInfo);
          sendResponse({ 
            success: true,
            requestId: message.requestId  // 返回原请求ID
          });
        } else {
          sendResponse({ 
            success: false, 
            error: '缺少链接信息',
            requestId: message.requestId  // 返回原请求ID
          });
        }
      });
      break;
      
    // 处理表单提交
    case 'formSubmitted':
      Promise.resolve().then(() => {
        if (sender.tab && message.formInfo) {
          navigationTracker.handleFormSubmitted(sender.tab.id, message.formInfo);
          sendResponse({ 
            success: true,
            requestId: message.requestId  // 返回原请求ID
          });
        } else {
          sendResponse({ 
            success: false, 
            error: '缺少表单信息',
            requestId: message.requestId  // 返回原请求ID
          });
        }
      });
      break;
      
    // 处理JS导航
    case 'jsNavigation':
      Promise.resolve().then(() => {
        if (sender.tab) {
          navigationTracker.handleJsNavigation(sender.tab.id, message);
          sendResponse({ 
            success: true,
            requestId: message.requestId  // 返回原请求ID
          });
        } else {
          sendResponse({ 
            success: false, 
            error: '无效的消息来源',
            requestId: message.requestId  // 返回原请求ID
          });
        }
      });
      break;
      
    // 处理获取会话详情
    case 'getSessionDetails':
      console.log('处理获取会话详情请求', message.sessionId, message.requestId ? `[ID:${message.requestId}]` : '');
      if (!message.sessionId) {
        sendResponse({ 
          success: false, 
          error: '缺少会话ID',
          requestId: message.requestId  // 返回原请求ID
        });
        break;
      }
      
      storage.getSession(message.sessionId)
        .then(session => {
          if (session) {
            console.log(`成功获取会话 ${message.sessionId} 的详情`);
            sendResponse({ 
              success: true, 
              session,
              requestId: message.requestId  // 返回原请求ID
            });
          } else {
            console.log(`会话 ${message.sessionId} 不存在`);
            sendResponse({ 
              success: false, 
              error: '会话不存在',
              requestId: message.requestId  // 返回原请求ID
            });
          }
        })
        .catch(error => {
          console.error('获取会话详情失败:', error);
          sendResponse({ 
            success: false, 
            error: String(error),
            requestId: message.requestId  // 返回原请求ID
          });
        });
      break;
      
    // 处理获取导航树
    case 'getNavigationTree':
      handleGetNavigationTree(sendResponse, message.options, message.requestId);
      break;
      
    // 处理清除所有数据
    case 'clearAllData':
    case 'clearAllRecords':
      handleClearAllRecords(sendResponse, message.requestId);
      break;
      
    // 未知消息类型
    default:
      console.warn('未知的消息类型:', message.action);
      sendResponse({
        success: false,
        error: `未知的消息类型: ${message.action}`,
        requestId: message.requestId  // 返回原请求ID
      });
      break;
  }
  
  // 返回true保持消息通道开启，允许异步响应
  return true;
});

/**
 * 处理获取导航树数据请求
 */
async function handleGetNavigationTree(
  sendResponse: (response: any) => void, 
  options: any = {}, 
  requestId?: string
): Promise<void> {
  try {
    console.log('获取导航树数据...', options, requestId ? `[ID:${requestId}]` : '');
    
    // 获取导航树
    const treeData = await tabTracker.getStorage().getNavigationTree();
    
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
    
    // 发送响应
    sendResponse({
      success: true,
      data: treeData,
      timestamp: Date.now(), // 添加当前时间戳，客户端用于增量更新
      requestId: requestId  // 返回原请求ID
    });
  } catch (error) {
    console.error('获取导航树失败:', error);
    sendResponse({
      success: false,
      error: String(error),
      requestId: requestId  // 返回原请求ID
    });
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
async function handleClearAllRecords(
  sendResponse: (response: any) => void, 
  requestId?: string
): Promise<void> {
  try {
    console.log('清空所有导航记录...', requestId ? `[ID:${requestId}]` : '');
    
    // 清空所有记录
    const success = await tabTracker.getStorage().clearAllRecords();
    
    // 发送响应
    sendResponse({
      success: success,
      requestId: requestId  // 返回原请求ID
    });
  } catch (error) {
    console.error('清空记录失败:', error);
    sendResponse({
      success: false,
      error: String(error),
      requestId: requestId  // 返回原请求ID
    });
  }
}

/**
 * 获取数据库中的记录总数
 */
async function getRecordCount(): Promise<number> {
  try {
    // 使用存储API获取记录数量
    const session = await storage.getCurrentSession();
    if (session && session.records) {
      return Object.keys(session.records).length;
    }
    return 0;
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
    
    // 创建初始会话（如果不存在）
    const currentSession = await storage.getCurrentSession();
    if (!currentSession) {
      console.log('创建初始会话...');
      await storage.createSession();
    }
    
    console.log('导航图谱后台初始化成功');
  } catch (error) {
    console.error('导航图谱后台初始化失败:', error);
  }
})();

/**
 * 导航关系追踪器 - 处理从内容脚本收集的导航事件
 */
class NavigationTracker {
  private pendingNavigations = new Map<string, any[]>();
  private pageInfoMap = new Map<string, any>();
  private expirationTime = 10000; // 10秒
  private storage: NavigationStorage; // 添加存储对象引用
  
  constructor() {
    // 使用与主程序相同的存储对象
    this.storage = storage; // 使用外部已定义的storage变量
    
    // 设置监听导航完成事件
    this.setupNavgationListeners();

    // 定期清理过期的待处理导航
    setInterval(() => this.cleanupExpiredNavigations(), 30000);
    
    console.log('导航追踪器已初始化');
  }
  
  /**
   * 设置事件监听器 - 仅监听导航事件，不再处理消息
   */
  setupNavgationListeners() {
    // 监听导航完成事件
    chrome.webNavigation.onCommitted.addListener((details) => {
      // 忽略iframe导航
      if (details.frameId !== 0) return;
      
      this.processNavigation(details);
    });
  }
  
  /**
   * 处理页面加载消息
   */
  public handlePageLoaded(tabId: number | undefined, pageInfo: any) {
    if (!pageInfo || !tabId) return;
    
    // 存储页面信息，便于后续查找
    const key = `${tabId}-${pageInfo.pageId}`;
    this.pageInfoMap.set(key, {
      ...pageInfo,
      tabId
    });
    
    console.log(`页面已加载: ${pageInfo.url} (${key})`);
    
    // 如果有当前活跃会话，将页面添加到会话中
    this.getCurrentSession().then(session => {
      if (session) {
        // 创建页面节点
        const nodeId = IdGenerator.generateNodeId(tabId, pageInfo.url);
        
        // 检查节点是否已存在
        if (session.records && session.records[nodeId]) {
          return; // 避免重复
        }
        
        // 创建导航记录
        const record = {
          id: nodeId,
          url: pageInfo.url,
          title: pageInfo.title || this.extractTitle(pageInfo.url),
          timestamp: pageInfo.timestamp,
          tabId: tabId,
          referrer: pageInfo.referrer,
          navigationType: 'address_bar', // 默认类型，可能会在后续事件中更新
          openTarget: 'new_tab', // 默认目标
        };
        
        // 增加安全措施，如果有标题，立即保存
        if (pageInfo.title) {
          if (record) {
            record.title = pageInfo.title;
            console.log(`更新页面标题: ${nodeId} -> "${pageInfo.title}"`);
          }
        }
        
        // 更新会话
        if (!session.records) session.records = {};
        session.records[nodeId] = record;
        
        this.saveSession(session);
      }
    });
  }
  
  /**
   * 处理标题更新
   */
  public handleTitleUpdate(pageId: string, title: string) {
    // 查找页面记录并更新标题
    for (const [key, info] of this.pageInfoMap.entries()) {
      if (info.pageId === pageId) {
        info.title = title;
        
        // 更新会话中的记录
        this.getCurrentSession().then(session => {
          if (session && session.records) {
            const recordIds = Object.keys(session.records);
            for (const recordId of recordIds) {
              const record = session.records[recordId];
              if (record.tabId === info.tabId && 
                  Math.abs(record.timestamp - info.timestamp) < 1000) {
                record.title = title;
                this.saveSession(session);
                break;
              }
            }
          }
        });
        
        break;
      }
    }
  }
  
  /**
   * 处理链接点击事件
   */
  public handleLinkClicked(tabId: number | undefined, linkInfo: any) {
    if (!linkInfo || !tabId) return;
    
    const expiresAt = Date.now() + this.expirationTime;
    
    // 生成待处理导航记录
    const pendingNav = {
      type: 'link_click',
      sourcePageId: linkInfo.sourcePageId,
      sourceTabId: tabId,
      sourceUrl: linkInfo.sourceUrl,
      targetUrl: linkInfo.targetUrl,
      isNewTab: linkInfo.isNewTab,
      data: linkInfo,
      timestamp: linkInfo.timestamp,
      expiresAt
    };
    
    // 添加到待处理列表
    const targetUrl = this.normalizeUrl(linkInfo.targetUrl);
    if (!this.pendingNavigations.has(targetUrl)) {
      this.pendingNavigations.set(targetUrl, []);
    }
    this.pendingNavigations.get(targetUrl)?.push(pendingNav);
    
    console.log(`链接点击: ${linkInfo.sourceUrl} -> ${targetUrl}`);
  }
  
  /**
   * 处理表单提交事件
   */
  public handleFormSubmitted(tabId: number | undefined, formInfo: any) {
    if (!formInfo || !tabId) return;
    
    const expiresAt = Date.now() + this.expirationTime;
    
    // 生成待处理导航记录
    const pendingNav = {
      type: 'form_submit',
      sourcePageId: formInfo.sourcePageId,
      sourceTabId: tabId,
      sourceUrl: formInfo.sourceUrl,
      targetUrl: formInfo.formAction,
      data: formInfo,
      timestamp: formInfo.timestamp,
      expiresAt
    };
    
    // 添加到待处理列表 - 这里我们使用标签页ID，因为表单提交的目标URL可能不确定
    const key = `tab:${tabId}`;
    if (!this.pendingNavigations.has(key)) {
      this.pendingNavigations.set(key, []);
    }
    this.pendingNavigations.get(key)?.push(pendingNav);
    
    console.log(`表单提交: ${formInfo.sourceUrl} -> ${formInfo.formAction}`);
  }
  
  /**
   * 处理JS导航事件
   */
  public handleJsNavigation(tabId: number | undefined, message: any) {
    if (!message || !tabId) return;
    
    const expiresAt = Date.now() + this.expirationTime;
    
    // 生成待处理导航记录
    const pendingNav = {
      type: 'javascript',
      sourcePageId: message.sourcePageId,
      sourceTabId: tabId,
      sourceUrl: message.sourceUrl,
      targetUrl: message.targetUrl,
      navigationType: message.navigationType,
      data: message,
      timestamp: message.timestamp,
      expiresAt
    };
    
    // 添加到待处理列表
    const targetUrl = this.normalizeUrl(message.targetUrl);
    if (!this.pendingNavigations.has(targetUrl)) {
      this.pendingNavigations.set(targetUrl, []);
    }
    this.pendingNavigations.get(targetUrl)?.push(pendingNav);
    
    console.log(`JS导航: ${message.sourceUrl} -> ${targetUrl} (${message.navigationType})`);
  }
  
  /**
   * 处理实际导航事件
   */
  processNavigation(details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) {
    const { tabId, url, timeStamp } = details;
    
    // 标准化URL
    const normalizedUrl = this.normalizeUrl(url);
    
    // 查找匹配的待处理导航
    let foundNavigation = null;
    
    // 1. 首先尝试通过URL精确匹配
    if (this.pendingNavigations.has(normalizedUrl)) {
      const navigations = this.pendingNavigations.get(normalizedUrl) || [];
      
      // 找到最近的尚未过期的导航
      const now = Date.now();
      foundNavigation = navigations.find(nav => 
        nav.expiresAt > now && 
        (nav.isNewTab || nav.sourceTabId === tabId)
      );
      
      // 如果找到匹配项，从列表中移除
      if (foundNavigation) {
        const index = navigations.indexOf(foundNavigation);
        navigations.splice(index, 1);
      }
    }
    
    // 2. 如果没找到，尝试通过tabId匹配(适用于表单提交)
    if (!foundNavigation) {
      const tabKey = `tab:${tabId}`;
      if (this.pendingNavigations.has(tabKey)) {
        const navigations = this.pendingNavigations.get(tabKey) || [];
        
        // 找到最近的尚未过期的导航
        const now = Date.now();
        foundNavigation = navigations.find(nav => nav.expiresAt > now);
        
        // 如果找到匹配项，从列表中移除
        if (foundNavigation) {
          const index = navigations.indexOf(foundNavigation);
          navigations.splice(index, 1);
        }
      }
    }
    
    // 如果找到匹配的导航，创建关系记录
    if (foundNavigation) {
      // 更新会话中的关系
      this.getCurrentSession().then(session => {
        if (session) {
          const timestamp = Date.now();
          const sourceNodeId = this.findNodeIdByUrl(session, foundNavigation.sourceUrl);
          const targetNodeId = IdGenerator.generateNodeId(tabId, url);
          
          if (sourceNodeId) {
            // 创建边记录
            const edgeId = this.storage.generateEdgeId(sourceNodeId, targetNodeId, timestamp);
            
            if (!session.edges) session.edges = {};
            session.edges[edgeId] = {
              id: edgeId,
              sourceId: sourceNodeId,
              targetId: targetNodeId,
              timestamp: timestamp,
              action: foundNavigation.type
            };
            
            // 创建或更新目标节点
            if (!session.records) session.records = {};
            session.records[targetNodeId] = {
              id: targetNodeId,
              url: url,
              title: '', // 将在页面加载时更新
              timestamp: timestamp,
              tabId: tabId,
              navigationType: foundNavigation.type,
              parentId: sourceNodeId,
              openTarget: foundNavigation.isNewTab ? 'new_tab' : 'same_tab'
            };
            
            this.saveSession(session);
            console.log(`已创建导航关系: ${sourceNodeId} -> ${targetNodeId}`);
          }
        }
      });
    }
  }
  
  /**
   * 查找与URL匹配的节点ID
   */
  findNodeIdByUrl(session: any, url: string): string | null {
    if (!session || !session.records) return null;
    
    const normalized = this.normalizeUrl(url);
    // 使用类型断言告诉TypeScript这些记录的结构
    const records = Object.values(session.records) as Array<{
      id: string;
      url: string;
      timestamp: number;
    }>;
    
    // 按时间排序（最新优先）
    records.sort((a: any, b: any) => b.timestamp - a.timestamp);
    
    // 查找匹配URL的记录
    for (const record of records) {
      if (this.normalizeUrl(record.url) === normalized) {
        return record.id;
      }
    }
    
    return null;
  }
  
  /**
   * 获取当前活跃会话 - 修改为使用storage对象
   */
  async getCurrentSession(): Promise<any> {
    return this.storage.getCurrentSession();
  }
  
  /**
   * 保存会话 - 修改为使用storage对象
   */
  saveSession(session: any) {
    return this.storage.saveSession(session);
  }
  
  /**
   * 清理过期的待处理导航
   */
  cleanupExpiredNavigations() {
    const now = Date.now();
    
    for (const [url, navigations] of this.pendingNavigations.entries()) {
      // 过滤掉过期的导航
      const validNavigations = navigations.filter(nav => nav.expiresAt > now);
      
      if (validNavigations.length === 0) {
        // 如果没有有效导航，删除整个条目
        this.pendingNavigations.delete(url);
      } else {
        // 否则更新为有效的导航列表
        this.pendingNavigations.set(url, validNavigations);
      }
    }
    
    // 也清理页面信息Map
    for (const [key, info] of this.pageInfoMap.entries()) {
      if (now - info.timestamp > 3600000) { // 1小时后清理
        this.pageInfoMap.delete(key);
      }
    }
  }
  
  /**
   * 从URL中提取标题
   */
  extractTitle(url: string): string {
    try {
      if (!url) return '未知页面';
      
      // 移除协议
let domain = url.replace(/^(https?:\/\/)?(www\.)?/, '');
      
      // 提取域名部分
      domain = domain.split('/')[0];
      
      // 处理查询参数
      domain = domain.split('?')[0];
      
      return domain;
    } catch (e) {
      return '未知页面';
    }
  }
  
  /**
   * 标准化URL以便比较
   */
  normalizeUrl(url: string): string {
    try {
      // 移除URL末尾的斜杠和片段标识符
      return url.replace(/\/$/, '').split('#')[0];
    } catch(e) {
      return url;
    }
  }
}

// 初始化追踪器
const navigationTracker = new NavigationTracker();

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
      id: 'debug-test-render',
      parentId: 'navigraph-debug',
      title: '测试渲染',
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
    case 'debug-test-render':
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