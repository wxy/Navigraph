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
    
    // 定期清理过期的待处理导航记录
    setInterval(() => this.cleanupPendingNavigationsAll(), 60000); // 每60秒清理一次
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
   * 处理常规导航 - 修复JavaScript导航处理逻辑
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
    const now = Date.now();
  
    // 生成基于标签ID和URL的节点ID
    const nodeId = IdGenerator.generateNodeId(tabId, details.url);
    
    console.log(`导航到: ${details.url} (ID: ${nodeId}, 类型: ${navigationType})`);
    
    // 检查是否已存在此节点
    const existingRecord = await this.storage.getRecord(nodeId);
    
    if (existingRecord) {
      console.log(`找到已存在的节点: ${nodeId}`);
      
      // 更新元数据
      const updates: Partial<NavigationRecord> = {
        lastVisit: now,
        visitCount: (existingRecord.visitCount || 0) + 1
      };
      
      await this.storage.updateRecord(nodeId, updates);
      
      // 将此次访问添加到历史记录
      this.addToTabHistory(tabId, nodeId);
      
      // 处理导航关系 - 可能创建回环或返回边
      await this.handleExistingNodeNavigation(tabId, existingRecord, navigationType);
      
      return;
    }
    
    // 获取父节点
    let parentId = '';
  
    // 重要改进：JavaScript 导航永远不应该成为根节点
    // 如果是JavaScript导航，强制寻找父节点
    const isJsNavigation = navigationType === 'javascript';
    const shouldBeRoot = !isJsNavigation && this.shouldBeRootNavigation(navigationType);
  
    // 1. 首先尝试从当前标签页记录的点击源获取
    const clickSource = this.lastClickSourceNodeIdMap.get(tabId);
    if (clickSource && now - clickSource.timestamp < 30000) { // 30秒内的点击有效
      parentId = clickSource.nodeId;
      console.log(`使用标签页${tabId}的点击源节点: ${parentId}`);
      this.lastClickSourceNodeIdMap.delete(tabId);
    } 
    // 2. 从待处理导航列表查找匹配URL的记录
    else if (!shouldBeRoot) {
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
  
    // 3. 如果是在同一标签页中导航，且不是应该成为根节点的类型，或是JavaScript导航，使用最近的节点作为父节点
    if (!parentId && (isJsNavigation || (!shouldBeRoot && openTarget === 'same_tab'))) {
      const tabHistory = this.tabNavigationHistory.get(tabId) || [];
      if (tabHistory.length > 0) {
        const lastNodeId = tabHistory[tabHistory.length - 1];
        // 防止自循环
        if (lastNodeId !== nodeId) {
          parentId = lastNodeId;
          console.log(`使用标签页历史中的最后节点作为父节点: ${parentId}`);
        }
      }
    }
  
    // 特别处理：如果是JavaScript导航，但仍然没找到父节点（极罕见情况）
    if (isJsNavigation && !parentId) {
      console.warn(`JavaScript导航未找到父节点，这是异常情况，尝试其他方法查找父节点`);
      
      // 获取当前会话中此标签页的所有节点，按时间倒序排列
      const session = await this.storage.getCurrentSession();
      const records = await this.storage.queryRecords({ 
        tabId: tabId,
        sessionId: session.id
      });
      
      if (records.length > 0) {
        // 按时间戳倒序排序
        records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        parentId = records[0].id;
        console.log(`通过查询会话记录找到JavaScript导航可能的父节点: ${parentId}`);
      }
    }
  
    // 创建新的导航记录
    const record: NavigationRecord = {
      id: nodeId,
      tabId: tabId,
      url: details.url,
      timestamp: now,
      sessionId: (await this.storage.getCurrentSession()).id,
      parentId: parentId || '',
      navigationType: navigationType,
      openTarget: openTarget,
      firstVisit: now,
      lastVisit: now,
      visitCount: 1,
      reloadCount: 0,
      frameId: details.frameId,
      parentFrameId: details.parentFrameId
    };
    
    // 记录导航类型的特殊处理
    if (isJsNavigation) {
      console.log(`JavaScript导航设置父节点为: ${parentId || '未找到，异常情况'}`);
    }
    
    // 保存记录
    const savedRecord = await this.storage.saveRecord(record);
    
    // 更新标签页历史
    this.addToTabHistory(tabId, savedRecord.id!);
    
    // 添加到待更新列表
    if (!this.pendingUpdates.has(tabId)) {
      this.pendingUpdates.set(tabId, []);
    }
    this.pendingUpdates.get(tabId)!.push(savedRecord.id!);
    
    // 如果有父节点，创建边（但要确保不会创建循环）
    if (parentId) {
      // 防止创建循环
      if (!await this.wouldCreateCycle(parentId, savedRecord.id!)) {
        await this.createNavigationEdge(parentId, savedRecord.id!, now, navigationType);
      } else {
        console.warn(`检测到创建边 ${parentId} -> ${savedRecord.id!} 会形成循环，已阻止`);
        
        // 对于JavaScript导航，使用更高级的父节点查找方法
        if (isJsNavigation) {
          console.log(`为JavaScript导航寻找替代父节点...`);
          parentId = await this.findBestParentForJsNavigation(tabId, savedRecord.id!) || '';
          
          if (parentId) {
            // 更新记录，使用新找到的父节点
            await this.storage.updateRecord(savedRecord.id!, { parentId });
            await this.createNavigationEdge(parentId, savedRecord.id!, now, navigationType);
            console.log(`为JavaScript导航设置替代父节点: ${parentId}`);
          } else {
            // 极少数情况：只有当真的找不到适合的父节点时，才设为根节点
            console.warn(`无法为JavaScript导航找到替代父节点，不得不将其设为根节点`);
            await this.storage.updateRecord(savedRecord.id!, { parentId: '' });
            
            // 将其作为根节点
            const session = await this.storage.getCurrentSession();
            await this.storage.addRootToSession(session.id, savedRecord.id!);
          }
        } else {
          // 非JavaScript导航，按原逻辑处理
          await this.storage.updateRecord(savedRecord.id!, { parentId: '' });
          
          // 将其作为根节点
          const session = await this.storage.getCurrentSession();
          await this.storage.addRootToSession(session.id, savedRecord.id!);
        }
      }
    } else {
      if (isJsNavigation) {
        // 对于JavaScript导航，这是异常情况，尝试最后努力找到父节点
        console.warn(`JavaScript导航未找到父节点，尝试应急方法查找父节点`);
        
        parentId = await this.findBestParentForJsNavigation(tabId, savedRecord.id!) || '';
        
        if (parentId) {
          // 更新记录使用新找到的父节点
          await this.storage.updateRecord(savedRecord.id!, { parentId });
          await this.createNavigationEdge(parentId, savedRecord.id!, now, navigationType);
          console.log(`为JavaScript导航设置应急父节点: ${parentId}`);
        } else {
          // 极少数情况：只有当真的找不到适合的父节点时，才设为根节点
          console.warn(`所有寻找父节点的尝试都失败，不得不将JavaScript导航设为根节点`);
          const session = await this.storage.getCurrentSession();
          await this.storage.addRootToSession(session.id, savedRecord.id!);
        }
      } else {
        // 没有父节点，作为根节点
        const session = await this.storage.getCurrentSession();
        await this.storage.addRootToSession(session.id, savedRecord.id!);
      }
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
    
    // 避免自环
    if (sourceNodeId === targetRecord.id) {
      console.log(`跳过自循环边: ${sourceNodeId} -> ${targetRecord.id}`);
      return;
    }
    
    // 检查是否会创建循环
    if (await this.wouldCreateCycle(sourceNodeId, targetRecord.id!)) {
      console.warn(`检测到创建边 ${sourceNodeId} -> ${targetRecord.id!} 会形成循环，已阻止`);
      return;
    }
    
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
    const now = Date.now();
    
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
      lastVisit: now,
      visitCount: (record.visitCount || 0) + 1,
      reloadCount: (record.reloadCount || 0) + 1
    };
    
    await this.storage.updateRecord(currentNodeId, updates);
    
    // 不再创建指向自身的边，避免循环
    console.log(`记录页面刷新: ${details.url} (节点ID: ${currentNodeId})`);
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
    
    // 获取当前节点
    const currentNodeId = history[history.length - 1];
    
    // 尝试找到匹配URL的历史节点
    const targetRecord = await this.findHistoryNodeByUrl(history, details.url);
    
    if (!targetRecord) {
      // 没有找到历史节点，作为常规导航处理
      await this.handleRegularNavigation(details, navigationType, 'same_tab');
      return;
    }
    
    // 避免创建自环
    if (currentNodeId === targetRecord.id) {
      console.log(`跳过历史导航自循环: ${currentNodeId} -> ${targetRecord.id}`);
      return;
    }
    
    // 检查是否会创建循环
    if (await this.wouldCreateCycle(currentNodeId, targetRecord.id!)) {
      console.warn(`检测到历史导航会创建循环: ${currentNodeId} -> ${targetRecord.id!}，不创建边`);
    } else {
      // 创建导航边
      await this.createNavigationEdge(
        currentNodeId, 
        targetRecord.id!, 
        now, 
        navigationType
      );
    }
    
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
   * 处理历史状态更新 (SPA导航) - 修复版本
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
        console.log('SPA导航: 找不到当前节点ID，将作为常规导航处理');
        await this.handleRegularNavigation(
          details,
          'javascript',
          'same_tab'
        );
        return;
      }
      
      // 检查URL是否变化
      const currentRecord = await this.storage.getRecord(currentNodeId);
      
      if (currentRecord && currentRecord.url !== details.url) {
        console.log(`SPA导航: 检测到URL变化，从 ${currentRecord.url} 到 ${details.url}`);
        
        // URL变化，作为新的导航处理
        const newNodeId = IdGenerator.generateNodeId(tabId, details.url);
        
        // 检查是否已存在此节点
        const existingRecord = await this.storage.getRecord(newNodeId);
        
        if (existingRecord) {
          console.log(`SPA导航: 节点已存在，处理与现有节点的关系 ${newNodeId}`);
          // 节点已存在，处理与已存在节点的导航关系
          await this.handleExistingNodeNavigation(tabId, existingRecord, 'javascript');
          return;
        }
        
        // 尝试设置父节点为当前节点
        let parentId = currentNodeId;
        
        // 检查是否会创建循环
        if (await this.wouldCreateCycle(parentId, newNodeId)) {
          console.warn(`SPA导航: 使用当前节点作为父节点会导致循环，尝试替代方案`);
          
          // 查找最佳父节点
          parentId = await this.findBestParentForJsNavigation(tabId, newNodeId);
        }
        
        // 创建新节点记录
        const record: NavigationRecord = {
          id: newNodeId,
          tabId: tabId,
          url: details.url,
          timestamp: now,
          sessionId: currentRecord.sessionId,
          navigationType: 'javascript',
          openTarget: 'same_tab',
          parentId: parentId, // 使用找到的最佳父节点
          firstVisit: now,
          lastVisit: now,
          visitCount: 1,
          reloadCount: 0
        };
        
        console.log(`SPA导航: 创建新节点 ${newNodeId}，父节点设为 ${parentId || '无(特殊情况)'}`);
        
        // 保存记录
        const savedRecord = await this.storage.saveRecord(record);
        
        // 更新标签页历史
        this.addToTabHistory(tabId, savedRecord.id!);
        
        // 如果有父节点，创建边（循环检测在findBestParentForJsNavigation中已完成）
        if (parentId) {
          await this.createNavigationEdge(
            parentId, 
            savedRecord.id!, 
            now,
            'javascript'
          );
          console.log(`SPA导航: 创建导航边 ${parentId} -> ${savedRecord.id!}`);
        } else {
          // 只有在极端情况下才将其设为根节点
          console.warn(`SPA导航: 无法找到合适的父节点，不得不将 ${savedRecord.id!} 设为根节点`);
          const session = await this.storage.getCurrentSession();
          await this.storage.addRootToSession(session.id, savedRecord.id!);
        }
      } else {
        console.log(`SPA导航: URL未变化或找不到当前记录，忽略`);
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

  /**
   * 检查添加某条边是否会导致循环
   * @param sourceId 源节点ID
   * @param targetId 目标节点ID
   * @returns 如果会创建循环则返回true
   */
  private async wouldCreateCycle(sourceId: string, targetId: string): Promise<boolean> {
    // 首先检查是否是自循环
    if (sourceId === targetId) {
      console.log(`检测到自循环: ${sourceId} -> ${targetId}`);
      return true;
    }
    
    // 检查更复杂的循环情况
    // 从目标节点开始沿父节点向上查找，如果能到达源节点，则会形成循环
    let currentId = targetId;
    const visited = new Set<string>();
    
    while (currentId) {
      // 防止无限循环
      if (visited.has(currentId)) {
        console.warn(`检测到现有数据中存在循环: ${currentId}`);
        return true;
      }
      
      visited.add(currentId);
      
      // 检查当前节点，如果已经是源节点，则会形成循环
      if (currentId === sourceId) {
        console.log(`检测到循环路径: ${targetId} -> ... -> ${sourceId}`);
        return true;
      }
      
      // 获取当前节点的记录
      const record = await this.storage.getRecord(currentId);
      if (!record || !record.parentId) {
        // 到达了根节点，没有形成循环
        break;
      }
      
      // 移动到父节点
      currentId = record.parentId;
      // 如果父节点ID是空字符串，表示已经到达根节点
      if (currentId === '') {
        break;
      }
    }
    
    return false;
  }
  /**
   * 判断导航是否应该成为根节点
   * @param navigationType 导航类型
   * @returns 如果应该成为根节点则返回true
   */
  private shouldBeRootNavigation(navigationType: NavigationType): boolean {
    // 只有这些导航类型可能是根节点
    return [
      'address_bar',      // 地址栏输入
      'initial',          // 初始页面加载
      'auto_bookmark'     // 从书签打开
    ].includes(navigationType);
  }
    /**
   * 识别是否是无上游的导航
   * @param tabId 标签页ID
   * @param url URL
   * @param navigationType 导航类型
   * @returns 如果是无上游的导航则返回true
   */
  private isNavigationWithoutUpstream(
    tabId: number,
    url: string,
    navigationType: NavigationType
  ): boolean {
    // 检查导航类型
    const isRootType = this.shouldBeRootNavigation(navigationType);
    if (!isRootType) {
      return false;
    }
    
    // 检查是否有等待处理的导航或点击源
    const normalizedUrl = this.normalizeUrl(url);
    const hasPendingNavigation = this.pendingNavigations.has(normalizedUrl);
    const hasClickSource = this.lastClickSourceNodeIdMap.has(tabId);
    
    // 如果既没有待处理导航也没有点击源，那么是"无上游"的导航
    return !(hasPendingNavigation || hasClickSource);
  }
    /**
   * 定期清理过期的待处理导航记录
   */
  private cleanupPendingNavigationsAll(): void {
    const now = Date.now();
    let totalCleared = 0;
    
    for (const [url, entries] of this.pendingNavigations.entries()) {
      const validEntries = entries.filter(entry => entry.expireTime > now);
      
      if (validEntries.length === 0) {
        this.pendingNavigations.delete(url);
        totalCleared++;
      } else if (validEntries.length < entries.length) {
        this.pendingNavigations.set(url, validEntries);
        totalCleared += (entries.length - validEntries.length);
      }
    }
    
    if (totalCleared > 0) {
      console.log(`清理了 ${totalCleared} 条过期的待处理导航记录`);
    }
  }
  /**
 * 更彻底地查找 JavaScript 导航的父节点
 * @param tabId 标签页ID
 * @param targetNodeId 目标节点ID
 * @returns 合适的父节点ID或空字符串
 */
private async findBestParentForJsNavigation(
  tabId: number,
  targetNodeId: string
): Promise<string> {
  console.log(`为JavaScript导航查找最佳父节点，目标节点: ${targetNodeId}`);
  
  // 尝试各种方法获取父节点
  
  // 1. 首先尝试从标签页历史中获取最近的节点
  const tabHistory = this.tabNavigationHistory.get(tabId) || [];
  if (tabHistory.length > 0) {
    // 从最近到最远，尝试找到一个不会导致循环的节点
    for (let i = tabHistory.length - 1; i >= 0; i--) {
      const potentialParent = tabHistory[i];
      
      // 确保不与自身形成循环
      if (potentialParent === targetNodeId) {
        continue;
      }
      
      // 检查是否会导致循环
      if (!await this.wouldCreateCycle(potentialParent, targetNodeId)) {
        console.log(`从标签页历史中找到合适的父节点: ${potentialParent}`);
        return potentialParent;
      }
    }
  }
  
  // 2. 如果标签页历史中没有合适的节点，尝试获取当前会话中此标签页的所有节点
  try {
    const session = await this.storage.getCurrentSession();
    const records = await this.storage.queryRecords({ 
      tabId: tabId,
      sessionId: session.id
    });
    
    // 按时间戳倒序排序
    records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    // 尝试每个节点作为父节点
    for (const record of records) {
      if (record.id && record.id !== targetNodeId && !await this.wouldCreateCycle(record.id, targetNodeId)) {
        console.log(`从会话记录中找到合适的父节点: ${record.id}`);
        return record.id;
      }
    }
  } catch (error) {
    console.error('查询会话记录失败:', error);
  }
  
  // 3. 如果以上方法都失败，尝试获取会话中的所有节点
  try {
    const session = await this.storage.getCurrentSession();
    const sessionDetails = await this.storage.getSessionDetails(session.id);
    
    // 安全地检查 sessionDetails 并尝试找到根节点
    if (sessionDetails && sessionDetails.records) {
      // 尝试找出所有没有父节点的节点作为潜在的根节点
      const allNodeIds = Object.keys(sessionDetails.records);
      const potentialRootNodes: string[] = [];
      
      for (const nodeId of allNodeIds) {
        const record = sessionDetails.records[nodeId];
        // 如果节点没有父节点或父节点为空字符串，可能是根节点
        if (!record.parentId || record.parentId === '') {
          potentialRootNodes.push(nodeId);
        }
      }
      
      console.log(`通过查询找到 ${potentialRootNodes.length} 个可能的根节点`);
      
      // 尝试使用这些潜在根节点作为父节点
      for (const rootNodeId of potentialRootNodes) {
        if (rootNodeId !== targetNodeId && !await this.wouldCreateCycle(rootNodeId, targetNodeId)) {
          console.log(`使用会话中的根节点作为父节点: ${rootNodeId}`);
          return rootNodeId;
        }
      }
      
      // 如果没有找到合适的根节点，可以尝试使用任何节点
      for (const nodeId of allNodeIds) {
        if (nodeId !== targetNodeId && !await this.wouldCreateCycle(nodeId, targetNodeId)) {
          console.log(`使用会话中的任意节点作为父节点: ${nodeId}`);
          return nodeId;
        }
      }
    } else {
      console.log('无法从会话详情中检索节点信息');
    }
  } catch (error) {
    console.error('查询会话节点失败:', error);
  }
  
  // 4. 如果仍然没有找到合适的父节点，尝试获取其他会话的节点
  try {
    const sessions = await this.storage.getSessions();
    
    // 尝试其他会话中的节点
    for (const session of sessions) {
      const sessionDetails = await this.storage.getSessionDetails(session.id);
      if (sessionDetails && sessionDetails.records) {
        const nodeIds = Object.keys(sessionDetails.records);
        
        // 随机选择一个不会导致循环的节点
        for (const nodeId of nodeIds) {
          if (nodeId !== targetNodeId && !await this.wouldCreateCycle(nodeId, targetNodeId)) {
            console.log(`使用其他会话的节点作为应急父节点: ${nodeId}`);
            return nodeId;
          }
        }
      }
    }
  } catch (error) {
    console.error('查询其他会话节点失败:', error);
  }
  
  // 如果上述所有方法都失败，才返回空字符串
  console.warn(`穷尽所有方法，无法为JavaScript导航找到合适的父节点，将使用空字符串表示根节点`);
  return '';
}
}
