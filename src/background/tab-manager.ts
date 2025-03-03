// 从NavigationRecord属性提取类型，而不是直接导入
import type { NavigationRecord } from '../types/webext';

// 提取NavigationMethod类型
type NavigationMethod = NonNullable<NavigationRecord['openMethod']>;
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
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // 只关注标签页内容加载完成的状态
      if (changeInfo.status === 'complete' && tab.url && 
          !tab.url.startsWith('chrome://') && 
          !tab.url.startsWith('chrome-extension://')) {
        console.log(`标签页 ${tabId} 更新完成:`, tab.url);
        
        // 处理在当前标签页打开的链接
        if (this.pendingParentNodeId && !this.pendingOpenInNewTab) {
          console.log(`处理当前标签页导航: ${tabId}, 父节点: ${this.pendingParentNodeId}`);
          
          // 为当前导航记录父子关系
          this.storage.setParentChildRelation(
            this.pendingParentNodeId,
            tabId.toString(),
            this.pendingParentUrl || '',
            this.pendingParentTitle || ''
          );
          
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
    chrome.webNavigation.onCompleted.addListener((details) => {
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
    chrome.tabs.onCreated.addListener((tab) => {
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
        this.storage.setParentChildRelation(
          this.pendingParentNodeId,
          tab.id!.toString(),
          this.pendingParentUrl || '',
          this.pendingParentTitle || ''
        );
        
        // 清除待处理信息
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
    if (!tab.id || !tab.url) return;
    
    try {
      // 确定打开方式
      let openMethod: NavigationMethod = 'new_tab';
      
      if (tab.windowId && tab.windowId !== chrome.windows.WINDOW_ID_CURRENT) {
        openMethod = 'new_window';
      }
      
      const parentTabId = this.tabParents.get(tab.id);
      
      // 创建导航记录
      const record: NavigationRecord = {
        url: tab.url,
        title: tab.title || tab.url,
        timestamp: Date.now(),
        tabId: tab.id,
        windowId: tab.windowId,
        parentTabId: parentTabId,
        favicon: tab.favIconUrl,
        openMethod: openMethod,
        isNewTab: true
      };
      
      // 保存记录
      await this.storage.saveRecord(record);
      console.log(`已记录新标签页导航:`, record.url);
      
    } catch (error) {
      console.error('记录新标签页导航失败:', error);
    }
  }

  /**
   * 初始化标签页关闭监听器
   */
  private initTabCloseListener(): void {
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
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
    chrome.webNavigation.onBeforeNavigate.addListener((details) => {
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
  private handleNavigationCompleted(details: chrome.webNavigation.WebNavigationFramedCallbackDetails): void {
    // 获取标签页信息
    chrome.tabs.get(details.tabId, async (tab) => {
      if (!tab || !tab.id) {
        console.warn('获取标签页信息失败:', details.tabId);
        return;
      }
      
      try {
        // 计算加载时间
        let loadTime: number | undefined;
        const navigationStartTime = this.navigationStartTimes.get(details.tabId);
        if (navigationStartTime) {
          loadTime = details.timeStamp - navigationStartTime;
          this.navigationStartTimes.delete(details.tabId); // 清理数据
        }
        
        // 获取父标签页
        const parentTabId = this.tabParents.get(tab.id) || tab.openerTabId;
        
        // 获取上一个页面URL作为referrer
        const referrer = this.tabReferrers.get(details.tabId);
        
        // 确定页面打开方式 - 等待异步结果
        const openMethod = await this.determineOpenMethod(details, tab);
        
        // 判断是否是新标签页导航
        const isNewTab = this.isNewTabNavigation(tab, openMethod);
        
        // 创建导航记录
        const record: NavigationRecord = {
          url: details.url,
          title: tab.title || details.url,
          timestamp: Date.now(),
          tabId: tab.id,
          windowId: tab.windowId,
          parentTabId: parentTabId,
          referrer: referrer,
          favicon: tab.favIconUrl,
          openMethod: openMethod,
          isNewTab: isNewTab,
          loadTime: loadTime
        };
        
        // 保存记录
        await this.storage.saveRecord(record);
        console.log(`已记录页面导航:`, record.url, `打开方式:`, openMethod);
        
      } catch (error) {
        console.error('记录导航事件失败:', error);
      }
    });
  }

  /**
   * 确定页面打开方式
   */
  private async determineOpenMethod(
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
    tab: chrome.tabs.Tab
  ): Promise<NavigationMethod> {
    // 默认为同一标签页导航
    let openMethod: NavigationMethod = 'same_tab';
    
    // 检查是否有transition信息
    if ('transitionType' in details) {
      const transitionType = (details as any).transitionType;
      const transitionQualifiers = (details as any).transitionQualifiers || [];
      
      // 地址栏输入
      if (transitionType === 'typed' || this.hasQualifier(transitionQualifiers, 'from_address_bar')) {
        openMethod = 'address_bar';
      } 
      // 链接点击
      else if (transitionType === 'link') {
        openMethod = 'link';
      }
      // 表单提交
      else if (transitionType === 'form_submit') {
        openMethod = 'form_submit';
      }
      // 重新加载
      else if (transitionType === 'reload') {
        openMethod = 'reload';
      }
      // 历史前进/后退
      else if (this.hasQualifier(transitionQualifiers, 'forward_back')) {
        openMethod = (transitionType === 'forward_back' || transitionType === 'client_redirect') ? 
          'history_forward' : 'history_back';
      }
    }
    
    // 检查窗口类型确定是否是弹出窗口 - 改为异步等待
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
          openMethod = 'popup';
        }
      } catch (error) {
        console.warn('获取窗口信息失败:', error);
      }
    }
    
    return openMethod;
  }

  /**
   * 判断是否是新标签页导航
   */
  private isNewTabNavigation(tab: chrome.tabs.Tab, openMethod: NavigationMethod): boolean {
    // 已知为新标签页的打开方式
    if (openMethod === 'new_tab' || openMethod === 'new_window') {
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
    // 清除之前的超时
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
    }
    
    this.pendingParentNodeId = nodeId;
    this.pendingParentUrl = url;
    this.pendingParentTitle = title;
    this.pendingOpenInNewTab = openInNewTab;
    console.log(`设置待处理父节点: ${nodeId}, URL: ${url}, 打开方式: ${openInNewTab ? '新标签页' : '当前标签页'}`);
    
    // 添加超时清理，防止长时间未使用
    this.pendingTimeout = setTimeout(() => {
      if (this.pendingParentNodeId === nodeId) {
        console.log('清理未使用的父节点记录');
        this.clearPendingParentNode();
      }
    }, 30000); // 30秒超时
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
}
