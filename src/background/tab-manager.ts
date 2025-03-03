// 从NavigationRecord属性提取类型，使用新字段
import type { NavigationRecord, NavigationType, OpenTarget } from '../types/webext';

// 提取类型并确保向后兼容
type NavigationMethod = string; // 临时兼容旧代码
import { SecureStorage } from '../lib/storage.js';

export class TabTracker {
  private storage: SecureStorage;
  private navigationStartTimes: Map<number, number>;
  private tabReferrers: Map<number, string>;
  private tabParents: Map<number, number>; // 存储标签页的父标签页ID
  private cleanupInterval: number = 7 * 24 * 60 * 60 * 1000; // 7天
  private pendingParentNodeId: string | null = null;
  private pendingParentUrl: string | null = null;
  private pendingParentTitle: string | null = null;
  private pendingOpenInNewTab: boolean = true;
  private pendingTimeout: any = null;

  constructor() {
    this.storage = new SecureStorage();
    this.navigationStartTimes = new Map();
    this.tabReferrers = new Map();
    this.tabParents = new Map();
    
    this.initEventListeners();
    this.startCleanupTask();
    console.log('TabTracker 初始化完成');
  }

  /**
   * 获取存储实例
   */
  public getStorage(): SecureStorage {
    return this.storage;
  }

  /**
   * 初始化所有事件监听器
   */
  private initEventListeners(): void {
    this.initTabUpdateListener();
    this.initNavigationListener();
    this.initTabCreateListener();
    this.initTabCloseListener();
    this.initBeforeNavigateListener();
  }

  /**
   * 初始化标签页更新监听器
   */
  private initTabUpdateListener(): void {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      // 只关注标签页内容加载完成的状态
      if (changeInfo.status === 'complete' && tab.url && 
          !tab.url.startsWith('chrome://') && 
          !tab.url.startsWith('chrome-extension://')) {
        console.log(`标签页 ${tabId} 更新完成:`, tab.url);
        
        // 处理在当前标签页打开的链接
        if (this.pendingParentNodeId && !this.pendingOpenInNewTab) {
          console.log(`处理当前标签页导航: ${tabId}, 父节点: ${this.pendingParentNodeId}`);
          
          // 为当前导航记录父子关系
          const childTimestamp = Date.now();
          if (this.pendingParentNodeId && this.pendingParentNodeId.includes('-')) {
            // 从pendingParentNodeId解析出tabId和timestamp
            const [parentTabIdStr, parentTimestampStr] = this.pendingParentNodeId.split('-');
            const parentTabId = parseInt(parentTabIdStr);
            const parentTimestamp = parseInt(parentTimestampStr);
            
            if (!isNaN(parentTabId) && !isNaN(parentTimestamp)) {
              await this.storeParentChildRelation(
                tabId,               // 子节点标签页ID
                childTimestamp,      // 子节点时间戳
                parentTabId         // 父节点标签页ID
              );
            }
          }
          
          // 清除待处理信息
          this.clearPendingParentNode();
        }
      }
    });
  }

  /**
   * 初始化导航监听器
   */
  private initNavigationListener(): void {
    chrome.webNavigation.onCompleted.addListener(async (details) => {
      // 只处理主框架的导航完成事件
      if (details.frameId === 0 && 
          !details.url.startsWith('chrome://') && 
          !details.url.startsWith('chrome-extension://')) {
        this.handleNavigationCompleted(details);
      }
    });
  }

  /**
   * 初始化标签页创建监听器
   */
  private initTabCreateListener(): void {
    chrome.tabs.onCreated.addListener(async (tab) => {
      console.log(`创建新标签页:`, tab);
      
      // 记录标签页的父标签页ID
      if (tab.openerTabId !== undefined) {
        this.tabParents.set(tab.id!, tab.openerTabId);
        console.log(`标签页 ${tab.id} 的父标签页: ${tab.openerTabId}`);
      }
      
      // 检查是否有待处理的父节点信息 (仅处理新标签页)
      if (this.pendingParentNodeId && this.pendingOpenInNewTab) {
        console.log(`应用待处理父节点 ${this.pendingParentNodeId} 到新标签页 ${tab.id}`);
        
        // 存储父子关系，用于构建导航树
        const childTimestamp = Date.now();
        if (this.pendingParentNodeId && this.pendingParentNodeId.includes('-')) {
          // 从pendingParentNodeId解析出tabId和timestamp
          const [parentTabIdStr, parentTimestampStr] = this.pendingParentNodeId.split('-');
          const parentTabId = parseInt(parentTabIdStr);
          const parentTimestamp = parseInt(parentTimestampStr);
          
          if (!isNaN(parentTabId) && !isNaN(parentTimestamp)) {
            await this.storeParentChildRelation(
              tab.id!,               // 子节点标签页ID
              childTimestamp,      // 子节点时间戳
              parentTabId         // 父节点标签页ID
            );
          }
        }
        this.clearPendingParentNode();
      }
      
      // 检测是否是空白新标签页
      const isNewTab = tab.url === 'chrome://newtab/' || tab.url === 'about:blank';
      
      // 不为空白标签页记录导航日志
      if (!isNewTab && tab.url && !tab.url.startsWith('chrome://')) {
        this.recordNewTabNavigation(tab);
      }
    });
  }

  /**
   * 记录新标签页的导航
   */
  private async recordNewTabNavigation(tab: chrome.tabs.Tab): Promise<void> {
    // 添加早期检查确保 tab.id 有效
    if (!tab.id || !tab.url) {
      console.error('无效的标签页数据 - 缺少ID或URL:', tab);
      return;
    }
    
    try {
      // 现在我们确认 tab.id 不为 undefined
      const record: NavigationRecord = {
        url: tab.url,
        title: tab.title || tab.url,
        timestamp: Date.now(),
        tabId: tab.id, // 此时已确定为 number 类型
        windowId: tab.windowId,
        favicon: tab.favIconUrl,
        navigationType: 'initial', 
        openTarget: tab.openerTabId ? 'new_tab' : 'same_tab',
        loadTime: 0
      };
      
      // 保存记录
      await this.storage.saveRecord(record);
      console.log(`已记录新标签页导航:`, record.url);
      
      // 获取父标签页ID
      const parentTabId = this.tabParents.get(tab.id) || tab.openerTabId;
      
      // 如果有父标签页，单独存储父子关系
      if (parentTabId) {
        // tab.id 现在已确认为有效的 number
        await this.storeParentChildRelation(parentTabId, tab.id, record.timestamp);
      }
    } catch (error) {
      console.error('记录新标签页导航失败:', error);
    }
  }

  /**
   * 初始化标签页关闭监听器
   */
  private initTabCloseListener(): void {
    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
      console.log(`标签页 ${tabId} 关闭`);
      
      // 清理该标签页的缓存数据
      this.navigationStartTimes.delete(tabId);
      this.tabReferrers.delete(tabId);
      this.tabParents.delete(tabId);
    });
  }

  /**
   * 初始化导航开始监听器
   */
  private initBeforeNavigateListener(): void {
    chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
      if (details.frameId === 0) {
        // 记录导航开始时间，用于计算加载时长
        this.navigationStartTimes.set(details.tabId, details.timeStamp);
        
        // 存储当前页面作为referrer
        chrome.tabs.get(details.tabId, (tab) => {
          if (tab && tab.url) {
            this.tabReferrers.set(details.tabId, tab.url);
          }
        });
      }
    });
  }

  /**
   * 处理导航完成事件
   */
  private async handleNavigationCompleted(
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails
  ): Promise<void> {
    // 获取标签页信息
    const tab = await this.getTab(details.tabId);
    if (!tab || !tab.url || !tab.id) { // 添加对 tab.id 的检查
      console.warn(`无法处理导航完成事件: 标签页 ${details.tabId} 数据无效`);
      return;
    }
    
    // 继续处理，现在 tab.id 已确认为有效
    try {
      // 计算加载时间
      let loadTime: number | undefined;
      const navigationStartTime = this.navigationStartTimes.get(details.tabId);
      if (navigationStartTime) {
        loadTime = details.timeStamp - navigationStartTime;
        this.navigationStartTimes.delete(details.tabId);
      }
      
      // 获取referrer
      const referrer = this.tabReferrers.get(details.tabId);
      
      // 确定导航类型和打开位置
      const { navigationType, openTarget } = await this.determineNavigationInfo(details, tab);
      
      // 创建导航记录 - 删除废弃字段
      const record: NavigationRecord = {
        url: details.url,
        title: tab.title || details.url,
        timestamp: Date.now(),
        tabId: tab.id, // 现在确认为 number 类型
        windowId: tab.windowId,
        referrer: referrer,
        favicon: tab.favIconUrl,
        navigationType: navigationType,
        openTarget: openTarget,
        loadTime: loadTime
      };
      
      // 获取父标签页ID (仅用于记录父子关系)
      const parentTabId = tab.id ? (this.tabParents.get(tab.id) || tab.openerTabId) : undefined;
      
      // 保存记录
      const savedRecord = await this.storage.saveRecord(record);
      
      // 如果有父标签页，单独存储父子关系
      if (parentTabId && tab.id) {
        // 查找父标签页的最后一条记录
        const parentRecords = await this.storage.findRecords({ tabId: parentTabId });
        
        if (parentRecords && parentRecords.length > 0) {
          // 获取最近的父记录
          const parentRecord = parentRecords.sort((a, b) => b.timestamp - a.timestamp)[0];
          
          // 使用统一方法保存父子关系
          await this.storeParentChildRelation(
            tab.id,                   // 子节点标签页ID
            record.timestamp,         // 子节点时间戳
            parentTabId              // 父节点标签页ID
          );
        }
      }
      
      console.log(`已记录页面导航: ${record.url}, 导航类型: ${navigationType}, 打开位置: ${openTarget}`);
    } catch (error) {
      console.error('记录导航事件失败:', error);
    }
  }

  /**
   * 存储父子关系
   * @param childTabId 子节点标签页ID
   * @param childTimestamp 子节点时间戳
   * @param parentTabId 父节点标签页ID
   */
  private async storeParentChildRelation(
    childTabId: number,
    childTimestamp: number,
    parentTabId: number
  ): Promise<void> {
    try {
      // 获取父标签页的最新记录
      const parentRecords = await this.storage.findRecords({ tabId: parentTabId });
      
      if (parentRecords && parentRecords.length > 0) {
        const latestParentRecord = parentRecords.sort((a, b) => b.timestamp - a.timestamp)[0];
        const parentTimestamp = latestParentRecord.timestamp;
        
        // 生成节点ID
        const childNodeId = this.getNodeId(childTabId, childTimestamp);
        const parentNodeId = this.getNodeId(parentTabId, parentTimestamp);
        
        // 保存关系
        await this.storage.setParentChildRelation(childNodeId, parentNodeId);
        console.log(`保存父子关系: ${childNodeId} <- ${parentNodeId}`);
      } else {
        console.warn(`找不到父标签页 ${parentTabId} 的记录，无法建立父子关系`);
      }
    } catch (error) {
      console.error('存储父子关系失败:', error);
    }
  }

  /**
   * 确定页面的导航类型和打开位置
   */
  private async determineNavigationInfo(
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
    tab: chrome.tabs.Tab
  ): Promise<{navigationType: NavigationType, openTarget: OpenTarget}> {
    // 默认值
    let navigationType: NavigationType = 'link_click';
    let openTarget: OpenTarget = 'same_tab';
    
    // 检查是否有transition信息
    if ('transitionType' in details) {
      const transitionType = (details as any).transitionType;
      const transitionQualifiers = (details as any).transitionQualifiers || [];
      
      // 确定导航类型
      if (transitionType === 'typed' || this.hasQualifier(transitionQualifiers, 'from_address_bar')) {
        navigationType = 'address_bar';
      } else if (transitionType === 'link') {
        navigationType = 'link_click';
      } else if (transitionType === 'form_submit') {
        navigationType = 'form_submit';
      } else if (transitionType === 'reload') {
        navigationType = 'reload';
      } else if (this.hasQualifier(transitionQualifiers, 'forward_back')) {
        navigationType = transitionType === 'forward_back' ? 'history_forward' : 'history_back';
      }
    }
    
    // 确定打开位置
    if (tab.openerTabId !== undefined) {
      openTarget = 'new_tab';
    }
    
    // 检查窗口类型确定是否是弹出窗口或新窗口
    if (tab.windowId && tab.windowId !== chrome.windows.WINDOW_ID_CURRENT) {
      try {
        const window = await new Promise<chrome.windows.Window>((resolve, reject) => {
          chrome.windows.get(tab.windowId, { populate: false }, win => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(win);
            }
          });
        });
        
        if (window && window.type === 'popup') {
          openTarget = 'popup';
        } else {
          openTarget = 'new_window';
        }
      } catch (error) {
        console.warn('获取窗口信息失败:', error);
      }
    }
    
    // 提供兼容旧代码的转换
    const openMethod = this.mapToLegacyOpenMethod(navigationType, openTarget);
    
    return { navigationType, openTarget };
  }

  /**
   * 将新的导航类型和打开位置映射到旧的openMethod格式
   * 临时方法，用于兼容旧代码
   */
  private mapToLegacyOpenMethod(navigationType: NavigationType, openTarget: OpenTarget): NavigationMethod {
    if (openTarget === 'new_tab') return 'new_tab';
    if (openTarget === 'new_window') return 'new_window';
    if (openTarget === 'popup') return 'popup';
    
    if (navigationType === 'address_bar') return 'address_bar';
    if (navigationType === 'form_submit') return 'form_submit';
    if (navigationType === 'history_back') return 'history_back';
    if (navigationType === 'history_forward') return 'history_forward';
    if (navigationType === 'reload') return 'reload';
    
    return 'same_tab'; // 默认
  }

  /**
   * 判断是否是新标签页导航
   */
  private isNewTabNavigation(tab: chrome.tabs.Tab, openTarget: OpenTarget): boolean {
    // 已知为新标签页的打开位置
    if (openTarget === 'new_tab' || openTarget === 'new_window') {
      return true;
    }
    
    // 特殊URL模式
    const isSpecialUrl = 
      tab.url === 'chrome://newtab/' || 
      tab.url === 'about:blank' ||
      tab.pendingUrl === 'chrome://newtab/';
    
    // 没有父标签页，且是特殊URL
    return !tab.openerTabId && isSpecialUrl;
  }

  /**
   * 辅助方法：检查转换限定符
   */
  private hasQualifier(qualifiers: string[] | undefined, qualifier: string): boolean {
    return Array.isArray(qualifiers) && qualifiers.includes(qualifier);
  }

  /**
   * 启动定期清理任务
   */
  private startCleanupTask(): void {
    // 每天检查一次过期记录
    setInterval(async () => {
      try {
        const cutoffTime = Date.now() - this.cleanupInterval;
        const deletedCount = await this.storage.cleanupOldRecords(cutoffTime);
        console.log(`定期清理: 删除了 ${deletedCount} 条过期记录`);
      } catch (error) {
        console.error('定期清理任务失败:', error);
      }
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * 设置待处理的父节点信息
   */
  public setPendingParentNode(
    nodeId: string, 
    url: string, 
    title: string, 
    openInNewTab: boolean = true
  ): void {
    try {
      // 清除之前的超时
      if (this.pendingTimeout) {
        clearTimeout(this.pendingTimeout);
      }
      
      // 验证nodeId格式是否符合"tabId-timestamp"
      if (!nodeId.includes('-')) {
        console.error('无效的节点ID格式:', nodeId);
        return;
      }
      
      this.pendingParentNodeId = nodeId;
      this.pendingParentUrl = url;
      this.pendingParentTitle = title;
      this.pendingOpenInNewTab = openInNewTab;
      
      // 添加更详细的日志
      console.log({
        action: '设置待处理父节点',
        nodeId,
        url: url.substring(0, 100), // 只显示部分URL避免日志过长
        title,
        openInNewTab,
        timestamp: Date.now()
      });
      
      // 增加超时时间到2分钟
      this.pendingTimeout = setTimeout(() => {
        if (this.pendingParentNodeId === nodeId) {
          console.warn('父节点记录超时未使用，清理:', nodeId);
          this.clearPendingParentNode();
        }
      }, 120000);
    } catch (error) {
      console.error('设置待处理父节点失败:', error);
    }
  }
  
  /**
   * 清除待处理的父节点信息
   */
  private clearPendingParentNode(): void {
    this.pendingParentNodeId = null;
    this.pendingParentUrl = null;
    this.pendingParentTitle = null;
    this.pendingOpenInNewTab = true;
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  /**
   * 处理标签页/导航事件
   * 需要在多个事件中检查父节点关系
   */
  private handleTabNavigation(
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
    isNewTab: boolean = false
  ): void {
    try {
      // 仅处理主框架导航
      if (details.frameId !== 0) return;
      
      const { tabId, url, timeStamp } = details;
      
      // 获取标签页信息
      chrome.tabs.get(tabId, async (tab) => {
        if (chrome.runtime.lastError || !tab) {
          console.warn('无法获取标签页信息:', chrome.runtime.lastError);
          return;
        }
        
        // 确定导航类型和打开位置
        const { navigationType, openTarget } = await this.determineNavigationInfo(details, tab);
        
        // 检查是否有父节点关系
        let parentNodeId = null;
        let isDirectChild = false;
        
        // 检查是否有待处理的父节点关系
        if (this.pendingParentNodeId) {
          console.log({
            action: '发现待处理父节点关系',
            pendingParentNodeId: this.pendingParentNodeId,
            forTabId: tabId,
            pendingTabExpectation: this.pendingOpenInNewTab ? '新标签页' : '当前标签页',
            actualIsNewTab: isNewTab,
            timestamp: Date.now()
          });
          
          // 根据标签页打开方式决定是否应用父子关系
          if ((this.pendingOpenInNewTab && isNewTab) || 
              (!this.pendingOpenInNewTab && !isNewTab)) {
            parentNodeId = this.pendingParentNodeId;
            isDirectChild = true;
            
            console.log({
              action: '应用父子关系',
              parentNodeId,
              childTabId: tabId,
              timestamp: Date.now()
            });
            
            // 清除待处理父节点
            this.clearPendingParentNode();
          }
        }
        
        // 创建导航记录
        const record: NavigationRecord = {
          url: url,
          title: tab.title || url,
          timestamp: timeStamp,
          tabId: tabId,
          windowId: tab.windowId,
          favicon: tab.favIconUrl,
          navigationType: navigationType,
          openTarget: openTarget,
          loadTime: 0 // 在这个阶段无法计算加载时间
        };
        
        // 保存记录
        const savedNodeId = await this.storage.saveRecord(record);
        
        // 如果有确定的父节点关系，存储它
        if (parentNodeId && savedNodeId) {
          await this.storage.setParentChildRelation(this.getNodeId(record.tabId, record.timestamp), parentNodeId);
        }
      });
    } catch (error) {
      console.error('处理标签页导航失败:', error);
    }
  }

  /**
   * 获取标签页信息的辅助方法
   */
  private getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          console.warn(`获取标签页 ${tabId} 信息失败:`, chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(tab);
        }
      });
    });
  }

  // 在所有生成节点ID的地方使用一致的格式
  private getNodeId(tabId: number, timestamp: number): string {
    return `${tabId}-${timestamp}`;
  }
}
