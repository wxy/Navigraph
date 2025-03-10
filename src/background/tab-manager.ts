import { NavigationStorage } from '../lib/storage.js';
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
    sourcePageId: string,
    targetUrl: string,
    timestamp: number,
    sourceTabId: number,
    expireTime: number
  }>> = new Map();
  private lastClickSourceNodeId?: string;
  private pendingUpdates: Map<number, string[]> = new Map<number, string[]>();
  
  constructor() {
    this.storage = new NavigationStorage();
    this.initializeListeners();
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
      
      console.log('导航跟踪器初始化完成');
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
    // 更全面的调试日志
    console.log(`标签页更新事件: ${tabId}`, changeInfo);
    // 只有当标题或favicon更新时才处理
    if (!changeInfo.title && !changeInfo.favIconUrl) {
      console.log(`标签页 ${tabId} 更新不包含标题或图标变化，忽略`);
      return;
    }
    
    try {
      // 获取该标签页关联的待更新节点ID列表
      const nodeIds = this.pendingUpdates.get(tabId) || [];
      console.log(`待更新节点列表: ${nodeIds.join(', ') || '无'}`);
      // 也检查最近的节点
      const recentNodeId = this.getMostRecentNodeId(tabId);
      if (recentNodeId && !nodeIds.includes(recentNodeId)) {
        nodeIds.push(recentNodeId);
      }
      
      // 如果没有待更新的节点，则退出
      if (nodeIds.length === 0) return;
      
      console.log(`标签页[${tabId}]更新: ${changeInfo.title ? '标题' : ''}${changeInfo.favIconUrl ? ' 图标' : ''}`);
      
      // 准备更新数据
      const updates: Partial<NavigationRecord> = {};
      
      if (changeInfo.title) {
        updates.title = changeInfo.title;
      }
      
      if (changeInfo.favIconUrl) {
        updates.favicon = changeInfo.favIconUrl;
      }
      
      // 更新所有相关节点
      for (const nodeId of nodeIds) {
        await this.storage.updateRecord(nodeId, updates);
        console.log(`已更新节点[${nodeId}]: ${updates.title ? `标题="${updates.title}"` : ''} ${updates.favicon ? '图标' : ''}`);
      }
      
      // 清除已更新的节点
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
          const extensionUrl = chrome.runtime.getURL('content/index.html');
          
          // 检查激活的标签页是否是扩展的可视化页面
          if (tab.url && tab.url.startsWith(extensionUrl)) {
            console.log('检测到扩展可视化页面被激活，触发自动刷新');
            
            // 稍微延迟，确保页面已经准备好接收消息
            setTimeout(() => {
              chrome.tabs.sendMessage(activeInfo.tabId, {
                action: 'refreshVisualization',
                timestamp: Date.now()
              }).catch(err => {
                console.warn('发送刷新消息失败，可能页面尚未完全加载:', err);
              });
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
   * 处理常规导航 (不是刷新或历史导航)
   */
  private async handleRegularNavigation(
    details: ExtendedCommittedDetails,
    navigationType: NavigationType,
    openTarget: OpenTarget
  ): Promise<void> {
    const now = Date.now();
    const tabId = details.tabId;
    
    // 创建新的导航记录
    const record: NavigationRecord = {
      tabId,
      url: details.url,
      timestamp: now,
      navigationType,
      openTarget,
      frameId: details.frameId,
      parentFrameId: details.parentFrameId
    };
    
    // 获取父节点 - 增强版
    let parentId: string | undefined = undefined;
    
    // 1. 首先尝试从最近的点击事件中获取源节点
    if (this.lastClickSourceNodeId) {
      parentId = this.lastClickSourceNodeId;
      // 使用后清除
      this.lastClickSourceNodeId = undefined;
    } 
    // 2. 然后尝试从待处理导航中找到匹配项
    else if (navigationType !== 'address_bar' && navigationType !== 'initial') {
      // 检查是否有匹配的待处理导航
      const normalizedUrl = this.normalizeUrl(details.url);
      const pendingNavs = this.pendingNavigations.get(normalizedUrl);
      
      if (pendingNavs && pendingNavs.length > 0) {
        // 找到最近的未过期条目
        const now = Date.now();
        const validNav = pendingNavs.find(nav => nav.expireTime > now);
        
        if (validNav) {
          // 从映射中获取源节点ID
          const sourceInfo = this.pageIdMap.get(validNav.sourcePageId);
          if (sourceInfo && sourceInfo.nodeId) {
            parentId = sourceInfo.nodeId;
          }
          
          // 从队列中移除已使用的导航请求
          const index = pendingNavs.indexOf(validNav);
          pendingNavs.splice(index, 1);
          if (pendingNavs.length === 0) {
            this.pendingNavigations.delete(normalizedUrl);
          }
        }
      }
    }
    
    // 3. 如果前两种方法都失败，尝试使用标签页历史中的最后一个节点
    if (!parentId) {
      parentId = this.getMostRecentNodeId(tabId);
    }
    
    if (parentId) {
      record.parentId = parentId;
    }
    
    // 保存记录
    const savedRecord = await this.storage.saveRecord(record);
    
    // 更新标签页历史
    this.addToTabHistory(tabId, savedRecord.id!);
    
    // 添加到待更新列表，确保后续的标题和图标更新能应用到此节点 - 新增代码
    if (!this.pendingUpdates.has(tabId)) {
      this.pendingUpdates.set(tabId, []);
    }
    this.pendingUpdates.get(tabId)!.push(savedRecord.id!);
    console.log(`将节点 ${savedRecord.id} 添加到待更新列表`);

    // 如果有父节点，创建导航边
    if (parentId) {
      this.navigationSequence++;
      
      const edge: NavigationEdge = {
        id: `${parentId}-${savedRecord.id}-${now}`,
        sourceId: parentId,
        targetId: savedRecord.id!,
        timestamp: now,
        action: navigationType,
        sequence: this.navigationSequence
      };
      
      await this.storage.saveEdge(edge);
    } 
    // 如果是根节点，将其添加到当前会话
    else {
      const session = await this.storage.getCurrentSession();
      await this.storage.addRootToSession(session.id, savedRecord.id!);
    }
    
    console.log(`记录导航: ${details.url.substring(0, 50)}..., ID: ${savedRecord.id}`);
  }
  
  /**
   * 处理页面刷新
   */
  private async handleReload(
    details: ExtendedCommittedDetails
  ): Promise<void> {
    const tabId = details.tabId;
    const now = Date.now();
    
    // 获取当前标签页的最后一个节点
    const currentNodeId = this.getMostRecentNodeId(tabId);
    
    // 如果找不到现有节点，则作为常规导航处理
    if (!currentNodeId) {
      await this.handleRegularNavigation(details, 'reload', 'same_tab');
      return;
    }
    
    // 创建指向自身的导航边，表示刷新
    this.navigationSequence++;
    
    const edge: NavigationEdge = {
      id: `${currentNodeId}-${currentNodeId}-${now}`,
      sourceId: currentNodeId,
      targetId: currentNodeId,
      timestamp: now,
      action: 'reload',
      sequence: this.navigationSequence
    };
    
    await this.storage.saveEdge(edge);
    console.log(`记录页面刷新: ${details.url.substring(0, 50)}..., ID: ${currentNodeId}`);
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
      id: `${currentNodeId}-${targetRecord.id}-${now}`,
      sourceId: currentNodeId,
      targetId: targetRecord.id!,
      timestamp: now,
      action: navigationType,
      sequence: this.navigationSequence
    };
    
    await this.storage.saveEdge(edge);
    
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
          tabId,
          url: details.url,
          timestamp: now,
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
          id: `${currentNodeId}-${savedRecord.id}-${now}`,
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
    // 跳过扩展自身的页面
    if (details.url.startsWith('chrome-extension://') || 
        details.url.startsWith('chrome://') || 
        details.url.startsWith('about:')) {
      return true;
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

  // 在TabTracker类中添加新方法，用于处理内容脚本消息

  /**
   * 处理从内容脚本发送的消息
   */
  public async handleContentScriptMessage(message: any, sender: chrome.runtime.MessageSender): Promise<void> {
    try {
      const tabId = sender.tab?.id;
      if (!tabId) return;
  
      switch (message.action) {
        case 'pageLoaded':
          await this.handlePageLoaded(tabId, message.pageInfo);
          break;
        
        case 'pageTitleUpdated':
          await this.handleTitleUpdated(tabId, message.pageId, message.title, message.isDirectAccess, message.url);
          break;

        case 'linkClicked':
          await this.handleLinkClicked(tabId, message.linkInfo);
          break;
          
        case 'formSubmitted':
          await this.handleFormSubmitted(tabId, message.formInfo);
          break;
          
        case 'jsNavigation':
          await this.handleJsNavigation(tabId, message);
          break;
      }
    } catch (error) {
      console.error('处理内容脚本消息失败:', error);
    }
  }
  /**
   * 处理标题更新消息
   */
  private async handleTitleUpdated(tabId: number, pageId: string, title: string, isDirectAccess?: boolean, url?: string): Promise<void> {
    try {
      // 忽略空标题
      if (!title) {
        console.log(`忽略空标题更新: ${pageId}`);
        return;
      }
      
      console.log(`处理标题更新: ${pageId}, "${title}"${isDirectAccess ? ' (直接访问)' : ''}`);
      
      // 标记为直接访问的页面（刷新或URL输入）需要特殊处理
      if (isDirectAccess && url) {
        // 尝试通过URL查找最近创建的节点
        const records = await this.storage.getRecentRecords(5); // 获取最近5条记录
        
        for (const record of records) {
          // 比较URL
          if (this.isSameUrl(record.url, url)) {
            // 找到匹配记录，更新标题
            await this.storage.updateRecord(record.id!, { title });
            console.log(`直接访问页面标题更新: ${record.id} -> "${title}"`);
            return;
          }
        }
      }
      
      // 常规处理逻辑...
      const pageInfo = this.pageIdMap.get(pageId);
      
      if (pageInfo && pageInfo.nodeId) {
        // 获取当前记录
        const record = await this.storage.getRecord(pageInfo.nodeId);
        
        // 只有当记录存在且标题为空或不同时才更新
        if (record && (!record.title || record.title !== title)) {
          await this.storage.updateRecord(pageInfo.nodeId, { title });
          console.log(`更新节点[${pageInfo.nodeId}]标题: "${title}"`);
        }
      } else {
        // 尝试查找相应的标签页最近节点
        const nodeId = this.getMostRecentNodeId(tabId);
        if (nodeId) {
          const record = await this.storage.getRecord(nodeId);
          if (record && (!record.title || record.title.length < title.length)) {
            await this.storage.updateRecord(nodeId, { title });
            console.log(`通过标签页ID更新节点[${nodeId}]标题: "${title}"`);
          }
        }
      }
    } catch (error) {
      console.error('处理标题更新失败:', error);
    }
  }

  /**
   * 处理页面加载消息
   */
  private async handlePageLoaded(tabId: number, pageInfo: any): Promise<void> {
    try {
      console.log(`页面加载: ${pageInfo.url} (${pageInfo.pageId})`);
      
      // 存储页面ID与tabId、nodeId的映射关系
      if (!this.pageIdMap) {
        this.pageIdMap = new Map();
      }
      
      // 通常此时节点可能已经创建，获取最近的节点ID
      const nodeId = this.getMostRecentNodeId(tabId);
      
      if (nodeId) {
        this.pageIdMap.set(pageInfo.pageId, {
          tabId,
          nodeId,
          timestamp: pageInfo.timestamp
        });
        
        // 更新节点referrer信息
        if (pageInfo.referrer) {
          await this.storage.updateRecord(nodeId, {
            referrer: pageInfo.referrer
          });
        }

        // 添加到待更新列表
        if (!this.pendingUpdates.has(tabId)) {
          this.pendingUpdates.set(tabId, []);
        }
        this.pendingUpdates.get(tabId)!.push(nodeId);
      }
    } catch (error) {
      console.error('处理页面加载消息失败:', error);
    }
  }
  
  /**
   * 处理链接点击事件
   */
  private async handleLinkClicked(tabId: number, linkInfo: any): Promise<void> {
    try {
      console.log(`链接点击: ${linkInfo.targetUrl} (来自${linkInfo.sourcePageId})`);
      
      // 存储点击信息，用于后续匹配导航
      if (!this.pendingNavigations) {
        this.pendingNavigations = new Map();
      }
      
      // 用URL作为键存储多个待处理导航
      const normalizedUrl = this.normalizeUrl(linkInfo.targetUrl);
      if (!this.pendingNavigations.has(normalizedUrl)) {
        this.pendingNavigations.set(normalizedUrl, []);
      }
      
      // 添加到待处理队列
      this.pendingNavigations.get(normalizedUrl)!.push({
        type: 'link_click',
        sourcePageId: linkInfo.sourcePageId,
        targetUrl: linkInfo.targetUrl,
        timestamp: linkInfo.timestamp,
        sourceTabId: tabId,
        expireTime: Date.now() + 10000 // 10秒后过期
      });
      
      // 存储点击时页面的节点ID，用于后续建立导航关系
      const sourceNodeInfo = this.pageIdMap.get(linkInfo.sourcePageId);
      if (sourceNodeInfo && sourceNodeInfo.nodeId) {
        // 将此源节点ID临时保存，以便在下一次导航中使用
        this.lastClickSourceNodeId = sourceNodeInfo.nodeId;
        
        // 定时清除，避免错误关联
        setTimeout(() => {
          if (this.lastClickSourceNodeId === sourceNodeInfo.nodeId) {
            this.lastClickSourceNodeId = undefined;
          }
        }, 10000); // 10秒后清除
      }
    } catch (error) {
      console.error('处理链接点击失败:', error);
    }
  }
  
  /**
   * 规范化URL以便比较
   */
  private normalizeUrl(url: string): string {
    try {
      return url.split('#')[0].replace(/\/$/, '');
    } catch {
      return url;
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
  private isSameUrl(url1: string, url2: string): boolean {
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
}

// 创建并导出实例
export const tabTracker = new TabTracker();