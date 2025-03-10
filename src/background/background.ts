import { TabTracker } from './tab-manager.js';
import { NavigationStorage } from '../lib/storage';
import { BrowsingSession } from '../types/webext'; // 假设类型在此文件中

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

// 修改消息监听器，确保它处理所有类型的消息

// 主消息处理器
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message);
  
  (async () => {
    try {
      // 处理通过内容脚本注入的消息
      if (sender.tab && 
          (message.action === 'pageLoaded' || 
           message.action === 'linkClicked' || 
           message.action === 'formSubmitted' || 
           message.action === 'jsNavigation' || 
           message.action === 'pageTitleUpdated')) {
        // 这些消息由NavigationTracker处理
        return;
      }
      
      // 处理UI/可视化界面的消息
      switch (message.action) {
        case 'getSessions':
          console.log('处理获取会话列表请求');
          try {
            // 获取会话列表
            const sessions = await storage.getSessions();
            console.log(`成功获取${sessions.length}个会话`);
            
            // 创建可序列化的轻量级会话摘要对象
            const sessionSummaries = sessions.map(session => {
              // 使用try-catch确保每个属性访问都是安全的
              try {
                return {
                  id: session.id,
                  title: (session as any).title || '未命名会话', // 添加标题
                  startTime: session.startTime,
                  endTime: session.endTime,
                  // 安全地计算记录数
                  recordCount: session.records ? Object.keys(session.records).length : 0
                };
              } catch (err) {
                console.error('处理会话数据时出错:', err);
                // 返回最小化的会话对象
                return {
                  id: session.id || `session-${Date.now()}`,
                  title: '数据错误的会话',
                  startTime: session.startTime || Date.now(),
                  endTime: session.endTime,
                  recordCount: 0
                };
              }
            });
            
            // 验证可序列化性
            try {
              const testJSON = JSON.stringify({success: true, sessions: sessionSummaries});
              console.log('会话数据可序列化，长度:', testJSON.length);
            } catch (serializeError) {
              console.error('会话数据序列化失败:', serializeError);
            }
            
            console.log('返回会话摘要:', sessionSummaries.length, '个会话');
            sendResponse({ success: true, sessions: sessionSummaries });
          } catch (error) {
            console.error("获取会话失败:", error);
            sendResponse({ success: false, error: String(error) });
          }
          break;
          
        case 'getSessionDetails':
          console.log('处理获取会话详情请求', message.sessionId);
          if (!message.sessionId) {
            sendResponse({ success: false, error: '缺少会话ID' });
            return;
          }
          const session = await storage.getSession(message.sessionId);
          if (session) {
            sendResponse({ success: true, session });
          } else {
            sendResponse({ success: false, error: '会话不存在' });
          }
          break;
          
        case 'getNavigationTree':
          await handleGetNavigationTree(sendResponse, message.options);
          break;
          
        case 'clearAllData':
        case 'clearAllRecords': // 支持两种命名以兼容现有代码
          console.log('处理清除所有记录请求');
          await handleClearAllRecords(sendResponse);
          break;
          
        default:
          console.warn('未知的消息类型:', message.action);
          sendResponse({
            success: false,
            error: `未知的消息类型: ${message.action}`
          });
          break;
      }
    } catch (error) {
      console.error('处理消息失败:', error);
      sendResponse({
        success: false,
        error: String(error)
      });
    }
  })();
  
  return true; // 保持通道打开以支持异步响应
});

/**
 * 处理获取导航树数据请求
 */
async function handleGetNavigationTree(sendResponse: (response: any) => void, options: any = {}): Promise<void> {
  try {
    console.log('获取导航树数据...', options);
    
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
      timestamp: Date.now() // 添加当前时间戳，客户端用于增量更新
    });
  } catch (error) {
    console.error('获取导航树失败:', error);
    sendResponse({
      success: false,
      error: String(error)
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
async function handleClearAllRecords(sendResponse: (response: any) => void): Promise<void> {
  try {
    console.log('清空所有导航记录...');
    
    // 清空所有记录
    const success = await tabTracker.getStorage().clearAllRecords();
    
    // 发送响应
    sendResponse({
      success: success
    });
  } catch (error) {
    console.error('清空记录失败:', error);
    sendResponse({
      success: false,
      error: String(error)
    });
  }
}

/**
 * 处理搜索记录请求
 */
async function handleSearchRecords(
  criteria: { url?: string; tabId?: number; timeRange?: [number, number] },
  sendResponse: (response: any) => void
): Promise<void> {
  try {
    console.log('搜索记录:', criteria);
    
    // 搜索记录
    const records = await tabTracker.getStorage().findRecords(criteria);
    
    // 发送响应
    sendResponse({
      success: true,
      data: records
    });
  } catch (error) {
    console.error('搜索记录失败:', error);
    sendResponse({
      success: false,
      error: String(error)
    });
  }
}

/**
 * 处理保存测试记录请求
 */
async function handleSaveTestRecord(record: any, sendResponse: (response: any) => void): Promise<void> {
  try {
    console.log('保存测试记录:', record);
    
    // 保存测试记录
    const recordId = await tabTracker.getStorage().saveRecord(record);
    
    // 发送响应
    sendResponse({
      success: true,
      recordId: recordId
    });
  } catch (error) {
    console.error('保存测试记录失败:', error);
    sendResponse({
      success: false,
      error: String(error)
    });
  }
}

/**
 * 处理获取会话列表的请求
 */
async function handleGetSessions(sendResponse: (response: any) => void) {
  try {
    // 使用统一的存储对象获取会话列表
    const sessions = await storage.getSessions();
    
    // 如果没有获取到会话，返回空数组
    if (!sessions || !Array.isArray(sessions)) {
      console.log('没有找到会话记录，返回空数组');
      sendResponse({ success: true, sessions: [] });
      return;
    }
    
    // 发送成功响应
    sendResponse({ success: true, sessions });
  } catch (error) {
    console.error('获取会话列表失败:', error);
    sendResponse({ success: false, error: String(error) });
  }
}

/**
 * 处理获取会话详情的请求
 */
async function handleGetSessionDetails(sessionId: string, sendResponse: (response: any) => void) {
  try {
    // 使用统一的存储对象获取会话详情
    const session = await storage.getSession(sessionId);
    
    if (session) {
      // 返回会话详情
      sendResponse({ success: true, session });
    } else {
      console.log(`会话 ${sessionId} 不存在`);
      sendResponse({ success: false, error: '会话不存在' });
    }
  } catch (error) {
    console.error('获取会话详情失败:', error);
    sendResponse({ success: false, error: String(error) });
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
    
    // 设置消息监听
    this.setupMessageListeners();
    
    // 设置导航事件监听
    this.setupNavigationListeners();
    
    // 定期清理过期的待处理导航
    setInterval(() => this.cleanupExpiredNavigations(), 30000);
    
    console.log('导航追踪器已初始化');
  }
  
  /**
   * 设置消息监听器
   */
  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // 检查消息来源
      if (!sender.tab && !message.pageInfo) return;
      
      // 从页面内容脚本收到的消息
      switch (message.action) {
        case 'pageLoaded':
          this.handlePageLoaded(sender.tab?.id, message.pageInfo);
          break;
          
        case 'pageTitleUpdated':
          this.handleTitleUpdate(message.pageId, message.title);
          break;
          
        case 'linkClicked':
          this.handleLinkClicked(sender.tab?.id, message.linkInfo);
          break;
          
        case 'formSubmitted':
          this.handleFormSubmitted(sender.tab?.id, message.formInfo);
          break;
          
        case 'jsNavigation':
          this.handleJsNavigation(sender.tab?.id, message);
          break;
      }
      
      // 对于异步响应，始终返回true
      return true;
    });
  }
  
  /**
   * 设置导航事件监听器
   */
  setupNavigationListeners() {
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
  handlePageLoaded(tabId: number | undefined, pageInfo: any) {
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
        const nodeId = `${tabId}-${pageInfo.timestamp}`;
        
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
  handleTitleUpdate(pageId: string, title: string) {
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
  handleLinkClicked(tabId: number | undefined, linkInfo: any) {
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
  handleFormSubmitted(tabId: number | undefined, formInfo: any) {
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
  handleJsNavigation(tabId: number | undefined, message: any) {
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
          const targetNodeId = `${tabId}-${timestamp}`;
          
          if (sourceNodeId) {
            // 创建边记录
            const edgeId = `${sourceNodeId}-${targetNodeId}`;
            
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