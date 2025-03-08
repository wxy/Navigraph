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
    try {
      // 仅处理状态和标题更新
      if (changeInfo.status === 'complete' || changeInfo.title) {
        const nodeId = this.getMostRecentNodeId(tabId);
        
        if (nodeId && changeInfo.title) {
          // 更新标题
          await this.storage.updateRecord(nodeId, { 
            title: changeInfo.title 
          });
          
          console.log(`更新标签页 ${tabId} 标题: ${changeInfo.title}`);
        }
      }
    } catch (error) {
      console.error('处理标签页更新失败:', error);
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
    
    // 获取父节点
    let parentId: string | undefined = undefined;
    
    if (navigationType !== 'address_bar' && navigationType !== 'initial') {
      // 尝试找到父节点 - 标签页中的最后一个节点
      parentId = this.getMostRecentNodeId(tabId);
    }
    
    if (parentId) {
      record.parentId = parentId;
    }
    
    // 保存记录
    const savedRecord = await this.storage.saveRecord(record);
    
    // 更新标签页历史
    this.addToTabHistory(tabId, savedRecord.id!);
    
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
        // 更新节点信息
        const updates: Partial<NavigationRecord> = {
          title: tab.title || '',
          favicon: tab.favIconUrl
        };
        
        // 计算加载时间
        const record = await this.storage.getRecord(nodeId);
        if (record) {
          updates.loadTime = Date.now() - record.timestamp;
        }
        
        await this.storage.updateRecord(nodeId, updates);
        console.log(`更新节点完成信息: ${nodeId}, 标题: ${tab.title}`);
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
}

// 创建并导出实例
export const tabTracker = new TabTracker();