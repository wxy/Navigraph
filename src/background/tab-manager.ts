import { NavigationStorage } from '../lib/storage.js';
import { IdGenerator } from '../lib/id-generator.js';
import { 
  NavigationRecord, 
  NavigationEdge, 
  NavigationType,
  OpenTarget,
  ExtendedCommittedDetails,
  ExtendedTransitionDetails
} from '../types/webext';

/**
 * 标签页跟踪器 - 负责监听和记录浏览器导航事件
 */
export class TabTracker {
  private storage: NavigationStorage;
  private activeTabId: number | null = null;
  private tabActiveTimes: Map<number, number> = new Map(); // 标签页ID -> 激活开始时间
  private lastFocusTime: number = Date.now(); // 上次窗口聚焦时间
  private navigationSequence: number = 0; // 导航序列号
  private tabNavigationHistory: Map<number, string[]> = new Map(); // 标签页ID -> 节点ID列表
  private windowFocused: boolean = true; // 当前窗口是否处于聚焦状态
  private pageIdMap: Map<string, {tabId: number, nodeId: string, timestamp: number}> = new Map();
  private pendingNavigations: Map<string, Array<{
    type: string,
    sourceNodeId: string,
    targetUrl: string,
    timestamp: number,
    sourceTabId: number,
    expireTime: number
  }>> = new Map();
  private lastClickSourceNodeIdMap = new Map<number, {nodeId: string, timestamp: number}>();
  private pendingUpdates: Map<number, string[]> = new Map<number, string[]>();
  private tabNodeIds = new Map<number, string>();
  private recentlyProcessedNavigations = new Map<string, number>();


  constructor() {
    this.storage = new NavigationStorage();
    
    this.initializeListeners();
    
    // 定期清理待更新列表
    setInterval(() => this.cleanupPendingUpdates(), 30000); // 每30秒清理一次
  }
  
  /**
   * 初始化所有事件监听器
   */
  private async initializeListeners(): Promise<void> {
    try {
      // 确保存储初始化
      await this.storage.initialize();
      
      // 标签页创建
      chrome.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
      
      // 标签页更新
      chrome.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
      
      // 标签页关闭
      chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
      
      // 标签页激活
      chrome.tabs.onActivated.addListener(this.handleTabActivated.bind(this));
      
      // 窗口焦点变化
      chrome.windows.onFocusChanged.addListener(this.handleWindowFocusChanged.bind(this));
      
      // 导航完成
      chrome.webNavigation.onCommitted.addListener((details) => 
        this.handleNavigationCommitted(details as unknown as ExtendedCommittedDetails));
      chrome.webNavigation.onCompleted.addListener((details) => 
        this.handleNavigationCompleted(details as unknown as ExtendedTransitionDetails));
      chrome.webNavigation.onHistoryStateUpdated.addListener((details) => 
        this.handleHistoryStateUpdated(details as unknown as ExtendedTransitionDetails));
      
      // 获取当前激活的标签页
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        this.activeTabId = tabs[0].id || null;
        if (this.activeTabId) {
          this.tabActiveTimes.set(this.activeTabId, Date.now());
        }
      }
      
      console.log('导航跟踪器初始化完成，包括内容脚本消息监听');
    } catch (error) {
      console.error('初始化导航跟踪器失败:', error);
    }
  }
  
  /**
   * 确定导航类型
   */
  private determineNavigationType(details: ExtendedTransitionDetails): NavigationType {
    // 转换Chrome的transition类型到我们的枚举
    const transitionType = details.transitionType || '';
    const transitionQualifiers = details.transitionQualifiers || [];
    
    if (transitionType === 'reload') {
      return 'reload';
    }
    
    if (transitionType === 'typed' || transitionType === 'generated') {
      return 'address_bar';
    }
    
    if (transitionType === 'form_submit') {
      return 'form_submit';
    }
    
    if (transitionType === 'auto_bookmark') {
      return 'link_click';
    }
    
    if (transitionType === 'link') {
      return 'link_click';
    }
    
    if (transitionType === 'auto_subframe' || transitionType === 'manual_subframe') {
      return 'javascript';
    }
    
    if (transitionQualifiers.includes('forward_back')) {
      return transitionQualifiers.includes('forward') ? 'history_forward' : 'history_back';
    }
    
    if (transitionQualifiers.includes('server_redirect') || 
        transitionQualifiers.includes('client_redirect')) {
      return 'redirect';
    }
    
    // 默认类型
    return 'initial';
  }
  
  /**
   * 确定页面打开位置
   */
  private determineOpenTarget(details: ExtendedTransitionDetails): OpenTarget {
    // 框架导航
    if (details.frameId > 0) {
      return 'frame';
    }
    
    // 通过标签历史推断是否是新标签
    const tabId = details.tabId;
    const hasHistory = this.tabNavigationHistory.has(tabId) && 
                      (this.tabNavigationHistory.get(tabId)?.length || 0) > 0;
    
    if (!hasHistory) {
      // 如果没有历史记录，是新标签或新窗口
      return 'new_tab'; // 简化，不区分新窗口和新标签
    }
    
    return 'same_tab';
  }
  
  /**
   * 处理标签页创建事件
   */
  private async handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
    try {
      console.log(`标签页创建: ${tab.id}`, tab.url || '无URL');
      
      // 将此标签添加到历史追踪
      if (tab.id) {
        this.tabNavigationHistory.set(tab.id, []);
      }
    } catch (error) {
      console.error('处理标签页创建失败:', error);
    }
  }
  
  /**
   * 处理标签页更新事件
   */
  private async handleTabUpdated(
    tabId: number, 
    changeInfo: chrome.tabs.TabChangeInfo, 
    tab: chrome.tabs.Tab
  ): Promise<void> {
    // 只有当标题或favicon更新时才处理
    if (!changeInfo.title && !changeInfo.favIconUrl) {
      console.log(`标签页 ${tabId} 更新不包含标题或图标变化，忽略`);
      return;
    }
    
    try {
      // 打印更详细的调试信息
      console.log(`标签页更新详情:`, {
        tabId,
        title: changeInfo.title || '无标题更新',
        faviconUpdated: !!changeInfo.favIconUrl,
        url: tab.url
      });

      // 获取该标签页关联的待更新节点ID列表
      const pendingNodeIds = this.pendingUpdates.get(tabId) || [];
      console.log(`待更新节点列表(原始): ${pendingNodeIds.join(', ') || '无'}`);
      
      // 获取当前会话以验证节点
      const session = await this.storage.getCurrentSession();
      const sessionData = await this.storage.getSessionDetails(session.id);
      
      if (!sessionData || !sessionData.records) {
        console.log('无法获取当前会话数据，跳过更新');
        return;
      }
      
      // 验证待更新节点是否存在于当前会话
      let validNodeIds = pendingNodeIds.filter(id => {
        const exists = sessionData.records ? !!sessionData.records[id] : false;
        if (!exists) {
          console.log(`节点 ${id} 在当前会话中不存在，将被忽略`);
        }
        return exists;
      });
      
      // 获取最近节点，并检查是否应加入更新列表
      const recentNodeId = this.getMostRecentNodeId(tabId);
      console.log(`当前标签页最近的节点ID: ${recentNodeId || '无'}`);
      
      // 如果最近节点存在且在当前会话中存在，且不在有效列表中，则添加
      if (recentNodeId && 
          sessionData.records[recentNodeId] &&
          !validNodeIds.includes(recentNodeId)) {
        validNodeIds.push(recentNodeId);
        console.log(`添加最近节点 ${recentNodeId} 到更新列表`);
      }
      
      // 如果有有效的URL，尝试通过URL匹配查找额外的节点
      if (tab.url && validNodeIds.length === 0) {
        // 获取当前会话中此标签页的所有节点
        const tabNodes = Object.values(sessionData.records)
          .filter(r => r.tabId === tabId && this.isSameUrl(r.url, tab.url))
          .sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序
        
        if (tabNodes.length > 0) {
          const matchedNodeId = tabNodes[0].id!;
          validNodeIds.push(matchedNodeId);
          console.log(`通过URL匹配找到节点: ${matchedNodeId}`);
        }
      }
      
      // 没有有效节点ID，退出
      if (validNodeIds.length === 0) {
        console.log('没有找到有效的节点ID，跳过更新');
        return;
      }
      
      console.log(`将更新这些有效节点: ${validNodeIds.join(', ')}`);
      
      // 准备更新数据
      const updates: Partial<NavigationRecord> = {};
      
      if (changeInfo.title) {
        updates.title = changeInfo.title;
      }
      
      if (changeInfo.favIconUrl) {
        updates.favicon = changeInfo.favIconUrl;
      }
      
      // 更新所有有效节点，但先检查现有值
      for (const nodeId of validNodeIds) {
        // 获取当前记录
        const record = await this.storage.getRecord(nodeId);
        if (!record) {
          console.log(`节点 ${nodeId} 不存在，跳过更新`);
          continue;
        }
        
        // 准备该节点的最终更新内容
        const finalUpdates: Partial<NavigationRecord> = {...updates};
        
        // 只在必要时更新标题（保留更长/更有意义的标题）
        if (finalUpdates.title && record.title && 
            record.title.length > finalUpdates.title.length) {
          console.log(`保留现有标题 "${record.title}"（长度${record.title.length}）而不是 "${finalUpdates.title}"（长度${finalUpdates.title.length}）`);
          delete finalUpdates.title;
        }
        
        // 只有有更新内容时才执行更新
        if (Object.keys(finalUpdates).length > 0) {
        await this.storage.updateRecord(nodeId, finalUpdates);
        console.log(`已更新节点[${nodeId}]: ${finalUpdates.title ? `标题="${finalUpdates.title}"` : ''} ${finalUpdates.favicon ? '图标已更新' : ''}`);
}
      }
      
      // 清理已更新的节点
      this.pendingUpdates.delete(tabId);
    } catch (error) {
      console.error('更新标签页标题/图标失败:', error);
    }
  }
  
  /**
   * 处理标签页关闭事件
   */
  private async handleTabRemoved(tabId: number): Promise<void> {
    try {
      // 停止活跃时间记录
      this.stopActiveTimeTracking(tabId);
      
      // 标记所有此标签页的节点为已关闭
      const records = await this.storage.queryRecords({ tabId });
      
      for (const record of records) {
        await this.storage.updateRecord(record.id!, { 
          isClosed: true 
        });
      }
      
      // 清理历史记录
      this.tabNavigationHistory.delete(tabId);
      
      console.log(`标签页关闭: ${tabId}`);
    } catch (error) {
      console.error('处理标签页关闭失败:', error);
    }
  }
  
  /**
   * 处理标签页激活事件
   */
  private handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
    return new Promise(async (resolve) => {
      try {
        // 停止之前标签页的活跃时间记录
        if (this.activeTabId && this.activeTabId !== activeInfo.tabId) {
          this.stopActiveTimeTracking(this.activeTabId);
        }
        
        // 开始新标签页的活跃时间记录
        this.activeTabId = activeInfo.tabId;
        if (this.windowFocused) {
          this.tabActiveTimes.set(activeInfo.tabId, Date.now());
        }
        
        console.log(`标签页激活: ${activeInfo.tabId}`);
        
        // 新增: 检查是否是扩展页面，如果是则触发刷新
        try {
          const tab = await chrome.tabs.get(activeInfo.tabId);
          const extensionUrl = chrome.runtime.getURL('dist/content/index.html');

          // 检查激活的标签页是否是扩展的可视化页面
          if (tab.url && tab.url.startsWith(extensionUrl)) {
            console.log('检测到扩展可视化页面被激活，触发自动刷新');
            
            // 稍微延迟，确保页面已经准备好接收消息
            setTimeout(() => {
              try {
                chrome.tabs.sendMessage(
                  activeInfo.tabId, 
                  {
                    action: 'refreshVisualization',
                    timestamp: Date.now()
                  },
                  (response) => {
                    // 正确处理回调响应
                    if (chrome.runtime.lastError) {
                      console.warn('发送刷新消息失败，可能页面尚未完全加载:', chrome.runtime.lastError.message);
                    } else {
                      console.log('刷新消息发送成功，响应:', response);
                    }
                  }
                );
              } catch (err) {
                console.warn('发送刷新消息出错:', err);
              }
            }, 300);
          }
        } catch (err) {
          console.warn('检查标签页URL失败:', err);
        }
        
        resolve();
      } catch (error) {
        console.error('处理标签页激活失败:', error);
        resolve();
      }
    });
  }
  
  /**
   * 处理窗口焦点变化事件
   */
  private handleWindowFocusChanged(windowId: number): Promise<void> {
    return new Promise(async (resolve) => {
      try {
        // 窗口失去焦点
        if (windowId === chrome.windows.WINDOW_ID_NONE) {
          this.windowFocused = false;
          
          // 停止活跃标签页的时间记录
          if (this.activeTabId) {
            this.stopActiveTimeTracking(this.activeTabId);
          }
          
          console.log('窗口失去焦点');
        } 
        // 窗口获得焦点
        else {
          this.windowFocused = true;
          
          // 查询当前活跃的标签页
          const tabs = await chrome.tabs.query({ active: true, windowId });
          
          if (tabs.length > 0 && tabs[0].id) {
            this.activeTabId = tabs[0].id;
            this.tabActiveTimes.set(this.activeTabId, Date.now());
            console.log(`窗口获得焦点，激活标签页: ${this.activeTabId}`);
          }
        }
        
        resolve();
      } catch (error) {
        console.error('处理窗口焦点变化失败:', error);
        resolve();
      }
    });
  }
  
  /**
   * 处理导航提交事件
   */
  private async handleNavigationCommitted(
    details: ExtendedCommittedDetails
  ): Promise<void> {
    try {
      // 过滤掉不需要记录的导航
      if (this.shouldSkipNavigation(details)) {
        return;
      }
      
      // 添加导航去重逻辑 - 防止短时间内对相同URL的重复处理
      const navigationKey = `${details.tabId}-${details.url}`;
      const now = Date.now();
      const lastProcessed = this.recentlyProcessedNavigations.get(navigationKey);
      
      if (lastProcessed && (now - lastProcessed) < 1000) { // 1秒内的相同导航将被忽略
        console.log(`忽略重复导航: ${details.url} (同一导航在1秒内被触发多次)`);
        return;
      }
      
      // 记录此次导航处理
      this.recentlyProcessedNavigations.set(navigationKey, now);
      
      // 清理超过5秒的记录
      setTimeout(() => {
        if (this.recentlyProcessedNavigations.get(navigationKey) === now) {
          this.recentlyProcessedNavigations.delete(navigationKey);
        }
      }, 5000);
      
      const navigationType = this.determineNavigationType(details);
      const openTarget = this.determineOpenTarget(details);
      
      console.log(`导航提交: ${details.url}, 类型: ${navigationType}, 打开位置: ${openTarget}`);
      
      // 处理不同类型的导航
      if (navigationType === 'reload') {
        await this.handleReload(details);
      } else if (navigationType === 'history_back' || navigationType === 'history_forward') {
        await this.handleHistoryNavigation(details, navigationType);
      } else {
        await this.handleRegularNavigation(details, navigationType, openTarget);
      }
    } catch (error) {
      console.error('处理导航提交失败:', error, details);
    }
  }
  
  /**
   * 处理常规导航
   */
  private async handleRegularNavigation(
    details: ExtendedCommittedDetails,
    navigationType: NavigationType,
    openTarget: OpenTarget
  ): Promise<void> {
  // 添加过滤检查
    if (this.shouldSkipNavigation(details)) {
      console.log(`跳过记录系统页面导航: ${details.url}`);
      return;
    }
    
    const tabId = details.tabId;

    // 生成基于标签ID和URL的节点ID
    const nodeId = IdGenerator.generateNodeId(tabId, details.url);
    
    console.log(`导航到: ${details.url} (ID: ${nodeId})`);
    
    // 检查是否已存在此节点
    const existingRecord = await this.storage.getRecord(nodeId);
    
    if (existingRecord) {
      console.log(`找到已存在的节点: ${nodeId}`);
      
      // 已存在的节点，可能是刷新或者其他导航
      // 只更新一些元数据，而不是创建新节点
      const updates: Partial<NavigationRecord> = {
        lastVisit: Date.now(),
        visitCount: (existingRecord.visitCount || 0) + 1
      };
      
      await this.storage.updateRecord(nodeId, updates);
      
      // 将此次访问添加到历史记录
      this.addToTabHistory(tabId, nodeId);
      
      // 处理导航关系 - 可能创建回环或返回边
      await this.handleExistingNodeNavigation(tabId, existingRecord, navigationType);
      
      return;
    }
    
    // 获取父节点 - 简化版
    let parentId = null;
    const now = Date.now();

    // 1. 首先尝试从当前标签页记录的点击源获取
    const clickSource = this.lastClickSourceNodeIdMap.get(tabId);
    if (clickSource && now - clickSource.timestamp < 30000) { // 30秒内的点击有效
      parentId = clickSource.nodeId;
      console.log(`使用标签页${tabId}的点击源节点: ${parentId}`);
      this.lastClickSourceNodeIdMap.delete(tabId);
    } 
    // 2. 如果没有找到，从待处理导航列表查找匹配URL的记录
    else {
      const normalizedUrl = this.normalizeUrl(details.url);
      
      console.log(`查找待处理导航, 标准化URL: ${normalizedUrl}`);
      
      // 尝试找到匹配的URL
      const pendingList = this.pendingNavigations.get(normalizedUrl);
      
      if (pendingList && pendingList.length > 0) {
        // 按时间戳排序，找出最近的一个
        const sortedPending = [...pendingList].sort((a, b) => b.timestamp - a.timestamp);
        const pendingNav = sortedPending[0];
        
        // 直接使用sourceNodeId
        parentId = pendingNav.sourceNodeId;
        console.log(`从待处理导航中获取父节点ID: ${parentId}`);
        
        // 使用后移除此条目
        this.pendingNavigations.delete(normalizedUrl);
      } else {
        console.log(`在待处理导航中未找到匹配项: ${normalizedUrl}`);
      }
    }

    // 创建新的导航记录
    const record: NavigationRecord = {
      id: nodeId,
      tabId: tabId,
      url: details.url,
      timestamp: now,
      sessionId: (await this.storage.getCurrentSession()).id,
      parentId: parentId,
      navigationType: navigationType,
      openTarget: openTarget,
      firstVisit: now,
      lastVisit: now,
      visitCount: 1,
      reloadCount: 0,
      frameId: details.frameId,
      parentFrameId: details.parentFrameId
    };
    
    // 保存记录
    const savedRecord = await this.storage.saveRecord(record);
    
    // 更新标签页历史
    this.addToTabHistory(tabId, savedRecord.id!);
    
    // 添加到待更新列表
    if (!this.pendingUpdates.has(tabId)) {
      this.pendingUpdates.set(tabId, []);
    }
    this.pendingUpdates.get(tabId)!.push(savedRecord.id!);
    
    // 如果有父节点，创建边
    if (parentId) {
      await this.createNavigationEdge(parentId, savedRecord.id!, Date.now(), navigationType);
    } else {
      // 没有父节点，这是一个根节点
      const session = await this.storage.getCurrentSession();
      await this.storage.addRootToSession(session.id, savedRecord.id!);
    }

    this.setNodeIdForTab(tabId, nodeId);
  }
  
  /**
   * 标准化URL，移除片段标识符、查询参数和尾部斜杠
   * 使得相似的URL可以被识别为同一目标
   */
  private normalizeUrl(url: string): string {
    try {
      // 如果URL无效或为空，直接返回
      if (!url) return '';
      
      // 解析URL
      const parsedUrl = new URL(url);
      
      // 构建标准化的URL：保留协议、主机名和路径，去除查询参数和片段标识符
      let normalizedUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
      
      // 去除尾部斜杠
      normalizedUrl = normalizedUrl.replace(/\/+$/, '');
      
      console.log(`标准化URL: ${url} -> ${normalizedUrl}`);
      return normalizedUrl;
    } catch (error) {
      // 如果URL解析失败，返回原始URL
      console.warn(`URL标准化失败: ${url}`, error);
      return url;
    }
  }
  /**
   * 处理导航到已存在节点的情况
   */
  private async handleExistingNodeNavigation(
    tabId: number, 
    targetRecord: NavigationRecord,
    navigationType: NavigationType
  ): Promise<void> {
    // 获取标签页的上一个节点
    const tabHistory = this.tabNavigationHistory.get(tabId) || [];
    if (tabHistory.length === 0) return;
    
    const sourceNodeId = tabHistory[tabHistory.length - 1];
    if (sourceNodeId === targetRecord.id) return; // 避免自环
    
    // 创建导航边
    await this.createNavigationEdge(
      sourceNodeId, 
      targetRecord.id!, 
      Date.now(), 
      navigationType
    );
  }

  /**
   * 处理刷新
   */
  private async handleReload(details: ExtendedCommittedDetails): Promise<void> {
    // 添加过滤检查
    if (this.shouldSkipNavigation(details)) {
      console.log(`跳过记录系统页面刷新: ${details.url}`);
      return;
    }

    const tabId = details.tabId;
    
    // 获取当前节点ID
    const tabHistory = this.tabNavigationHistory.get(tabId) || [];
    if (tabHistory.length === 0) {
      // 如果没有历史，当作常规导航处理
      await this.handleRegularNavigation(details, 'reload', 'same_tab');
      return;
    }
    
    const currentNodeId = tabHistory[tabHistory.length - 1];
    const record = await this.storage.getRecord(currentNodeId);
    
    if (!record) {
      // 找不到记录，当作新导航处理
      await this.handleRegularNavigation(details, 'reload', 'same_tab');
      return;
    }
    
    // 更新记录
    const updates: Partial<NavigationRecord> = {
      lastVisit: Date.now(),
      visitCount: (record.visitCount || 0) + 1,
      reloadCount: (record.reloadCount || 0) + 1
    };
    
    await this.storage.updateRecord(currentNodeId, updates);
    
    // 创建自环边代表刷新
    await this.createNavigationEdge(currentNodeId, currentNodeId, Date.now(), 'reload');
  }
  
  /**
   * 处理历史导航 (后退/前进)
   */
  private async handleHistoryNavigation(
    details: ExtendedCommittedDetails,
    navigationType: NavigationType
  ): Promise<void> {
    const tabId = details.tabId;
    const now = Date.now();
    
    // 获取标签页历史
    const history = this.tabNavigationHistory.get(tabId) || [];
    
    // 没有足够的历史，作为常规导航处理
    if (history.length < 2) {
      await this.handleRegularNavigation(details, navigationType, 'same_tab');
      return;
    }
    
    // 获取当前节点和上一个节点
    const currentNodeId = history[history.length - 1];
    
    // 尝试找到匹配URL的历史节点
    const targetRecord = await this.findHistoryNodeByUrl(history, details.url);
    
    if (!targetRecord) {
      // 没有找到历史节点，作为常规导航处理
      await this.handleRegularNavigation(details, navigationType, 'same_tab');
      return;
    }
    
    // 创建导航边
    this.navigationSequence++;
    
    const edge: NavigationEdge = {
      id: this.storage.generateEdgeId(currentNodeId, targetRecord.id!, now),
      sourceId: currentNodeId,
      targetId: targetRecord.id!,
      timestamp: now,
      action: navigationType,
      sequence: this.navigationSequence
    };
    
    await this.storage.saveEdge(edge);
    
    // 这确保回退后的页面能够被正确识别为新链接的源节点
    if (!this.pageIdMap) {
      this.pageIdMap = new Map();
    }
    // 生成一个临时页面ID，确保回退操作后该页面可以作为链接点击的源
    const tempPageId = `history-${targetRecord.id}-${now}`;
    this.pageIdMap.set(tempPageId, {
      tabId: tabId,
      nodeId: targetRecord.id!,
      timestamp: now
    });
    
    console.log(`历史导航后设置页面ID映射: ${tempPageId} -> 节点 ${targetRecord.id}`);
    
    // 更新标签页历史 - 添加目标节点
    this.addToTabHistory(tabId, targetRecord.id!);
    
    console.log(`记录历史导航(${navigationType}): ${details.url.substring(0, 50)}..., ID: ${targetRecord.id}`);
  }
  
  /**
   * 处理导航完成事件
   */
  private async handleNavigationCompleted(
    details: ExtendedTransitionDetails
  ): Promise<void> {
    try {
      // 过滤掉不需要记录的导航
      if (this.shouldSkipNavigation(details) || details.frameId !== 0) {
        return;
      }
      
      // 获取标签页信息，包括标题
      const tab = await chrome.tabs.get(details.tabId);
      const nodeId = this.getMostRecentNodeId(details.tabId);
      
      if (nodeId) {
        // 获取增强版favicon
        const favicon = await this.getFavicon(details.url, tab.favIconUrl);

        // 更新节点信息
        const updates: Partial<NavigationRecord> = {
          favicon: favicon
        };
        
        // 只有当标题不为空时才更新标题
        if (tab.title) {
          const record = await this.storage.getRecord(nodeId);
          // 如果记录已有标题并且当前标题不为空，保留较长的标题
          if (record && record.title && record.title.length > tab.title.length) {
            console.log(`保留现有标题"${record.title}"，不更新为"${tab.title}"`);
          } else {
            updates.title = tab.title;
            console.log(`更新标题为"${tab.title}"`);
          }
        }

        // 计算加载时间
        const record = await this.storage.getRecord(nodeId);
        if (record) {
          updates.loadTime = Date.now() - record.timestamp;
        }
        
        // 只有当有更新内容时才执行更新
        if (Object.keys(updates).length > 0) {
          await this.storage.updateRecord(nodeId, updates);
          console.log(`更新节点完成信息: ${nodeId}, 标题: ${tab.title}`);
        }
      }

      if (nodeId) {
        // 一秒后再次检查标题和图标
        setTimeout(async () => {
          try {
            // 再次获取标签页信息
            const updatedTab = await chrome.tabs.get(details.tabId);
            const updates: Partial<NavigationRecord> = {};
            
            if (updatedTab.title) {
              updates.title = updatedTab.title;
            }
            
            if (updatedTab.favIconUrl) {
              updates.favicon = updatedTab.favIconUrl;
            }
            
            if (Object.keys(updates).length > 0) {
              console.log(`延迟更新节点信息...`);
              await this.storage.updateRecord(nodeId, updates);
              console.log(`延迟更新节点信息: ${nodeId}`, updates);
            }
          } catch (err) {
            console.warn('延迟更新节点失败:', err);
          }
        }, 1000); // 延迟1秒
      }
    } catch (error) {
      console.error('处理导航完成失败:', error);
    }
  }
  
  /**
   * 处理历史状态更新 (SPA导航)
   */
  private async handleHistoryStateUpdated(
    details: ExtendedTransitionDetails
  ): Promise<void> {
    try {
      // 只处理主框架的更新
      if (details.frameId !== 0 || this.shouldSkipNavigation(details)) {
        return;
      }
      
      const tabId = details.tabId;
      const now = Date.now();
      
      // 获取当前标签页的最后一个节点ID
      const currentNodeId = this.getMostRecentNodeId(tabId);
      
      if (!currentNodeId) {
        // 如果没有当前节点，作为常规导航处理
        await this.handleRegularNavigation(
          details,  // 已经是正确类型，不需要转换
          'javascript',
          'same_tab'
        );
        return;
      }
      
      // 检查URL是否变化
      const currentRecord = await this.storage.getRecord(currentNodeId);
      
      if (currentRecord && currentRecord.url !== details.url) {
        // URL变化，作为新的导航处理
        const record: NavigationRecord = {
          id: IdGenerator.generateNodeId(tabId, details.url),
          tabId: tabId,
          url: details.url,
          timestamp: now,
          sessionId: currentRecord.sessionId,
          navigationType: 'javascript',
          openTarget: 'same_tab',
          parentId: currentNodeId
        };
        
        const savedRecord = await this.storage.saveRecord(record);
        
        // 更新标签页历史
        this.addToTabHistory(tabId, savedRecord.id!);
        
        // 创建导航边
        this.navigationSequence++;
        
        const edge: NavigationEdge = {
          id: this.storage.generateEdgeId(currentNodeId, savedRecord.id!, now),
          sourceId: currentNodeId,
          targetId: savedRecord.id!,
          timestamp: now,
          action: 'javascript',
          sequence: this.navigationSequence
        };
        
        await this.storage.saveEdge(edge);
        
        console.log(`记录SPA导航: ${details.url.substring(0, 50)}..., ID: ${savedRecord.id}`);
      }
    } catch (error) {
      console.error('处理历史状态更新失败:', error);
    }
  }
  
  /**
   * 停止标签页活跃时间跟踪
   */
  private async stopActiveTimeTracking(tabId: number): Promise<void> {
    try {
      const activeSince = this.tabActiveTimes.get(tabId);
      
      if (activeSince) {
        const now = Date.now();
        const activeTime = now - activeSince;
        
        // 获取最近的节点ID
        const nodeId = this.getMostRecentNodeId(tabId);
        
        if (nodeId) {
          // 获取当前记录
          const record = await this.storage.getRecord(nodeId);
          
          if (record) {
            // 更新活跃时间 (累加)
            const currentActiveTime = record.activeTime || 0;
            await this.storage.updateRecord(nodeId, {
              activeTime: currentActiveTime + activeTime
            });
            
            console.log(`更新节点活跃时间: ${nodeId}, +${activeTime}ms, 总计: ${currentActiveTime + activeTime}ms`);
          }
        }
        
        // 清除激活时间记录
        this.tabActiveTimes.delete(tabId);
      }
    } catch (error) {
      console.error('停止活跃时间跟踪失败:', error);
    }
  }
  
  /**
   * 获取标签页最近的节点ID
   */
  private getMostRecentNodeId(tabId: number): string | undefined {
    const history = this.tabNavigationHistory.get(tabId) || [];
    return history.length > 0 ? history[history.length - 1] : undefined;
  }
  
  /**
   * 添加节点ID到标签页历史
   */
  private addToTabHistory(tabId: number, nodeId: string): void {
    if (!this.tabNavigationHistory.has(tabId)) {
      this.tabNavigationHistory.set(tabId, []);
    }
    
    const history = this.tabNavigationHistory.get(tabId)!;
    
    // 避免重复添加相同的节点ID
    if (history.length === 0 || history[history.length - 1] !== nodeId) {
      history.push(nodeId);
      console.log(`更新标签页 ${tabId} 历史: 添加节点 ${nodeId}`);
    }
  }
  
  /**
   * 检查是否应该跳过此导航
   */
  private shouldSkipNavigation(details: ExtendedTransitionDetails): boolean {
    // 空URL检查
    if (!details.url || details.url === 'about:blank') {
      return true;
    }
    
    // 跳过浏览器内部页面
    const excludePatterns = [
      'chrome://',
      'chrome-extension://',
      'chrome-untrusted://', // 包含new-tab-page
      'chrome-devtools://',
      'chrome-error://',
      'chrome-search://',
      'devtools://',
      'edge://',             // 针对Edge浏览器
      'about:',              // Firefox的内部页面
      'vivaldi://',          // Vivaldi浏览器
      'opera://',            // Opera浏览器
      'data:',               // 数据URL
      'file://'              // 本地文件
    ];
    
    for (const pattern of excludePatterns) {
      if (details.url.startsWith(pattern)) {
        console.log(`跳过系统页面: ${details.url.substring(0, 50)}...`);
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 通过URL查找历史节点
   */
  private async findHistoryNodeByUrl(nodeIds: string[], url: string): Promise<NavigationRecord | null> {
    for (let i = nodeIds.length - 1; i >= 0; i--) {
      const nodeId = nodeIds[i];
      const record = await this.storage.getRecord(nodeId);
      
      if (record && record.url === url) {
        return record;
      }
    }
    
    return null;
  }

  /**
   * 获取存储实例
   * 用于允许外部代码访问存储功能
   */
  public getStorage(): NavigationStorage {
    return this.storage;
  }

  /**
   * 处理页面加载消息
   */
  private async handlePageLoaded(tabId: number, pageInfo: any): Promise<void> {
    try {
      // 添加系统页面过滤
      if (this.shouldSkipNavigation({ url: pageInfo.url } as any)) {
        console.log(`跳过处理系统页面加载: ${pageInfo.url}`);
        return;
      }
      console.log(`页面已加载: ${pageInfo.url} (${pageInfo.pageId})`);
      
      // 基于标签ID和URL查找对应节点
      const nodeId = IdGenerator.generateNodeId(tabId, pageInfo.url);
      console.log(`根据URL生成的节点ID: ${nodeId}`);
      
      // 检查节点是否存在
      const record = await this.storage.getRecord(nodeId);
      
      if (!record) {
        console.log(`未找到对应节点 ${nodeId}，可能是新导航`);
        return;
      }
      
      // 存储页面ID映射
      if (!this.pageIdMap) {
        this.pageIdMap = new Map();
      }
      
      this.pageIdMap.set(pageInfo.pageId, {
        tabId,
        nodeId,
        timestamp: pageInfo.timestamp
      });
      
      // 更新referrer信息
      if (pageInfo.referrer && !record.referrer) {
        await this.storage.updateRecord(nodeId, { referrer: pageInfo.referrer });
      }
      
      // 添加到待更新列表，确保标题和图标能更新到此节点
      if (!this.pendingUpdates.has(tabId)) {
        this.pendingUpdates.set(tabId, []);
      }
      
      if (!this.pendingUpdates.get(tabId)!.includes(nodeId)) {
        this.pendingUpdates.get(tabId)!.push(nodeId);
        console.log(`将节点 ${nodeId} 添加到待更新列表`);
      }
    } catch (error) {
      console.error('处理页面加载消息失败:', error);
    }
  }
  
  /**
   * 处理链接点击事件 - 增强版
   */
  private async handleLinkClicked(tabId: number, linkInfo: any): Promise<void> {
    try {
      console.log(`链接点击: ${linkInfo.targetUrl} (来自页面ID ${linkInfo.sourcePageId})`);
      
      let sourceNodeId = null;
      
      // 查找源节点
      const sourceNodeInfo = this.pageIdMap.get(linkInfo.sourcePageId);
      if (sourceNodeInfo && sourceNodeInfo.nodeId) {
        sourceNodeId = sourceNodeInfo.nodeId;
        console.log(`从pageIdMap找到源节点: ${sourceNodeId}`);
      } else {
        const tabHistory = this.tabNavigationHistory.get(tabId) || [];
        if (tabHistory.length > 0) {
          sourceNodeId = tabHistory[tabHistory.length - 1];
          console.log(`从标签页历史获取源节点: ${sourceNodeId}`);
        }
      }
      
      // 找到有效的源节点后
      if (sourceNodeId) {
        // 1. 记录到同一标签页的映射
        this.lastClickSourceNodeIdMap.set(tabId, {
          nodeId: sourceNodeId,
          timestamp: Date.now()
        });
        
        // 2. 同时保存到目标URL映射
        const targetUrl = this.normalizeUrl(linkInfo.targetUrl);
        if (!this.pendingNavigations.has(targetUrl)) {
          this.pendingNavigations.set(targetUrl, []);
        }
        
        // 保存导航关系
        this.pendingNavigations.get(targetUrl)!.push({
          type: 'link_click',
          sourceNodeId: sourceNodeId,
          targetUrl: targetUrl,
          timestamp: Date.now(),
          sourceTabId: tabId,
          expireTime: Date.now() + 30000
        });
        
        console.log(`保存导航关系: ${targetUrl} <- ${sourceNodeId}`);
        
        // 设置清理定时器
        setTimeout(() => {
          this.cleanupPendingNavigations(targetUrl);
        }, 30000);
      } else {
        console.warn(`无法找到源页面ID ${linkInfo.sourcePageId} 对应的节点信息`);
      }
    } catch (error) {
      console.error('处理链接点击失败:', error);
    }
  }
  
  // 添加辅助清理方法
  private cleanupPendingNavigations(url: string): void {
    const pendingList = this.pendingNavigations.get(url);
    if (pendingList) {
      const now = Date.now();
      const validEntries = pendingList.filter(entry => entry.expireTime > now);
      if (validEntries.length > 0) {
        this.pendingNavigations.set(url, validEntries);
      } else {
        this.pendingNavigations.delete(url);
        console.log(`清理过期的待处理导航: ${url}`);
      }
    }
  }
  
  /**
   * 处理表单提交事件
   */
  private async handleFormSubmitted(tabId: number, formInfo: any): Promise<void> {
    // 实现类似linkClicked的处理逻辑
    // ...
  }
  
  /**
   * 处理JS导航事件
   */
  private async handleJsNavigation(tabId: number, navigation: any): Promise<void> {
    // 实现类似linkClicked的处理逻辑
    // ...
  }

  // 辅助方法: 比较两个URL（忽略尾部斜杠和片段标识符）
  private isSameUrl(url1: string | undefined, url2: string | undefined): boolean {
    if (!url1 || !url2) return false;
    
    try {
      // 标准化URL
      url1 = url1.replace(/\/$/, '').split('#')[0];
      url2 = url2.replace(/\/$/, '').split('#')[0];
      
      return url1 === url2;
    } catch (e) {
      return false;
    }
  }

  /**
   * 增强版获取favicon的方法
   */
  private async getFavicon(url: string, tabFavIconUrl?: string): Promise<string | undefined> {
    try {
      // 先使用Chrome API提供的favicon（如果有）
      if (tabFavIconUrl && tabFavIconUrl.trim().length > 0) {
        console.log(`获取到API提供的favicon: ${tabFavIconUrl}`);
        return tabFavIconUrl;
      }
      
      // 2. 然后尝试Google的favicon服务
      const domain = new URL(url).hostname;
      const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
      console.log('使用Google favicon服务:', googleFaviconUrl);
      return googleFaviconUrl;
      
      // 注：如果需要，还可以尝试其他方法获取favicon
    } catch (error) {
      console.warn('获取favicon失败:', error);
      // 返回undefined，让前端使用默认图标
      return undefined;
    }
  }

  /**
   * 清理待更新列表中的无效节点
   */
  private async cleanupPendingUpdates(): Promise<void> {
    try {
      // 获取当前会话
      const session = await this.storage.getCurrentSession();
      if (!session) return;
      
      const sessionData = await this.storage.getSessionDetails(session.id);
      if (!sessionData || !sessionData.records) return;
      
      let totalRemoved = 0;
      
      // 遍历所有标签页的待更新列表
      for (const [tabId, nodeIds] of this.pendingUpdates.entries()) {
        // 保留在当前会话中存在的节点
        const validIds = nodeIds.filter(id => sessionData.records && !!sessionData.records[id]);
        
        if (validIds.length !== nodeIds.length) {
          totalRemoved += nodeIds.length - validIds.length;
          this.pendingUpdates.set(tabId, validIds);
        }
      }
      
      if (totalRemoved > 0) {
        console.log(`自动清理完成，从待更新列表中移除了 ${totalRemoved} 个无效节点`);
      }
    } catch (error) {
      console.error('清理待更新列表失败:', error);
    }
  }

  /**
   * 创建导航边
   */
  private async createNavigationEdge(
    sourceId: string,
    targetId: string,
    timestamp: number,
    navigationType: NavigationType
  ): Promise<NavigationEdge> {
    // 获取当前会话
    const session = await this.storage.getCurrentSession();
    
    // 创建边记录
    this.navigationSequence++;
    
    const edge: NavigationEdge = {
      id: this.storage.generateEdgeId(sourceId, targetId, timestamp),
      sourceId,
      targetId,
      timestamp,
      action: navigationType,
      sequence: this.navigationSequence,
      sessionId: session.id
    };
    
    // 保存边
    await this.storage.saveEdge(edge);
    console.log(`创建导航边: ${sourceId} -> ${targetId}, 类型: ${navigationType}`);
    
    return edge;
  }

  /**
   * 为标签页设置节点ID - 在handleRegularNavigation中调用
   */
  private setNodeIdForTab(tabId: number, nodeId: string): void {
    this.tabNodeIds.set(tabId, nodeId);
    console.log(`为标签页 ${tabId} 设置节点ID: ${nodeId}`);
  }

  /**
   * 获取标签页对应的节点ID - 供内容脚本使用
   */
  public getNodeIdForTab(tabId: number, url?: string): string | undefined {
    // 先尝试从映射表中获取
    const nodeId = this.tabNodeIds.get(tabId);
    
    if (nodeId) {
      console.log(`从映射表中找到标签页 ${tabId} 的节点ID: ${nodeId}`);
      return nodeId;
    }
    
    // 如果找不到且提供了URL，尝试重新生成节点ID
    if (url) {
      console.log(`未找到标签页 ${tabId} 的节点ID，基于URL重新生成`);
      // 生成与handleRegularNavigation中相同方式的ID
      return IdGenerator.generateNodeId(tabId, url);
    }
    
    console.log(`未能找到标签页 ${tabId} 的节点ID`);
    return undefined;
  }

  // 更新标题处理方法以接受直接的nodeId
  public async handleTitleUpdated(
    tabId: number, 
    nodeId: string, 
    title: string
  ): Promise<void> {
    try {
      if (!title) return;
      
      // 直接使用提供的nodeId更新记录
      console.log(`更新标题: ${nodeId} -> "${title}"`);
      
      // 更新记录
      const record = await this.storage.getRecord(nodeId);
      
      if (record) {
        // 更新记录标题
        await this.storage.updateRecord(nodeId, { title });
        console.log(`已更新节点[${nodeId}]: 标题="${title}"`);
      } else {
        console.log(`未找到节点 ${nodeId}，无法更新标题`);
      }
    } catch (error) {
      console.error('处理标题更新失败:', error);
    }
  }

  // 添加处理Favicon更新的方法
  public async handleFaviconUpdated(
    tabId: number, 
    nodeId: string, 
    favicon: string
  ): Promise<void> {
    try {
      if (!favicon) return;
      
      console.log(`更新Favicon: ${nodeId} -> "${favicon}"`);
      
      // 更新记录
      const record = await this.storage.getRecord(nodeId);
      
      if (record) {
        // 更新记录favicon
        await this.storage.updateRecord(nodeId, { favicon });
        console.log(`已更新节点[${nodeId}]: Favicon="${favicon.substring(0, 30)}..."`);
      } else {
        console.log(`未找到节点 ${nodeId}，无法更新Favicon`);
      }
    } catch (error) {
      console.error('处理Favicon更新失败:', error);
    }
  }
}
