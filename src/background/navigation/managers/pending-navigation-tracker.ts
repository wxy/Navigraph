import { Logger } from '../../../lib/utils/logger.js';
import { UrlUtils } from '../utils/url-utils.js';
import { 
  PendingNavigation, 
  JsNavigationRecord, 
  LinkClickInfo,
  FormSubmitInfo
} from '../types/pending-navigation.js';

const logger = new Logger('PendingNavigationTracker');

/**
 * 待处理导航追踪器
 * 
 * 负责管理用户操作触发的导航意图，在实际导航发生时将它们与导航事件匹配。
 * 主要处理三种导航类型：
 * 1. 链接点击导航
 * 2. 表单提交导航 
 * 3. JavaScript触发的导航
 */
export class PendingNavigationTracker {
  /** URL -> 待处理导航数组 */
  private pendingNavigations = new Map<string, PendingNavigation[]>();
  
  /** 标签页ID -> JS导航记录数组 */
  private pendingJsNavigations = new Map<number, JsNavigationRecord[]>();
  
  /** 导航记录过期时间(毫秒) */
  private expirationTime = 10000; // 默认10秒
  
  /**
   * 构造函数
   * @param expirationTime 导航记录过期时间(毫秒)，默认为10秒
   */
  constructor(expirationTime?: number) {
    if (expirationTime !== undefined) {
      this.expirationTime = expirationTime;
    }
    
    logger.log('待处理导航追踪器初始化完成');
  }
  
  /**
   * 添加链接点击导航
   * @param linkInfo 链接点击信息
   */
  addLinkNavigation(linkInfo: LinkClickInfo): void {
    const { 
      sourcePageId, 
      sourceUrl, 
      targetUrl, 
      anchorText, 
      isNewTab, 
      timestamp = Date.now() 
    } = linkInfo;
    
    // 创建一个待处理导航记录
    const expiresAt = timestamp + this.expirationTime;
    const pendingNav: PendingNavigation = {
      type: "link_click",
      sourceNodeId: sourcePageId,
      sourceUrl,
      targetUrl,
      data: {
        anchorText,
        isNewTab
      },
      timestamp,
      expiresAt,
      isNewTab
    };
    
    // 添加到待处理导航列表
    this.addPendingNavigation(targetUrl, pendingNav);
  }
  
  /**
   * 添加表单提交导航
   * @param tabId 标签页ID
   * @param formInfo 表单提交信息
   */
  addFormSubmission(tabId: number, formInfo: FormSubmitInfo): void {
    if (!formInfo || !tabId) return;

    const expiresAt = Date.now() + this.expirationTime;

    // 生成待处理导航记录
    const pendingNav: PendingNavigation = {
      type: "form_submit",
      sourceNodeId: formInfo.sourcePageId,
      sourceTabId: tabId,
      sourceUrl: formInfo.sourceUrl,
      targetUrl: formInfo.formAction,
      data: formInfo,
      timestamp: formInfo.timestamp || Date.now(),
      expiresAt
    };

    // 添加到待处理列表 - 使用标签页ID作为键
    const key = `tab:${tabId}`;
    this.addPendingNavigation(key, pendingNav);
  }
  
  /**
   * 添加JavaScript导航
   * @param tabId 标签页ID
   * @param jsNavInfo JavaScript导航信息
   */
  addJsNavigation(tabId: number, jsNavInfo: {
    sourcePageId: string;
    sourceUrl: string;
    targetUrl: string;
    timestamp?: number;
  }): void {
    if (!jsNavInfo || !tabId) return;

    // 记录JavaScript导航以用于确定父子关系
    const jsNavRecord: JsNavigationRecord = {
      from: jsNavInfo.sourceUrl,
      to: jsNavInfo.targetUrl,
      timestamp: jsNavInfo.timestamp || Date.now()
    };

    // 添加到JS导航记录列表
    this.addJsNavigationRecord(tabId, jsNavRecord);

    // 同时也加入待处理导航
    const expiresAt = Date.now() + this.expirationTime;

    // 生成待处理导航记录
    const pendingNav: PendingNavigation = {
      type: "javascript",
      sourceNodeId: jsNavInfo.sourcePageId,
      sourceTabId: tabId,
      sourceUrl: jsNavInfo.sourceUrl,
      targetUrl: jsNavInfo.targetUrl,
      data: jsNavInfo,
      timestamp: jsNavInfo.timestamp || Date.now(),
      expiresAt
    };

    // 添加到待处理列表
    this.addPendingNavigation(jsNavInfo.targetUrl, pendingNav);
  }
  
  /**
   * 添加重定向导航记录
   * 记录HTTP重定向信息，供后续导航事件使用
   */
  public addRedirectNavigation(redirectInfo: {
    sourceNodeId?: string; // 可选的源节点ID
    sourceUrl: string;
    targetUrl: string;
    tabId: number;
    timestamp: number;
  }): void {
    // 添加到待处理导航记录中
    const expiresAt = redirectInfo.timestamp + this.expirationTime;
    const pendingNav: PendingNavigation = {
      type: "redirect",
      sourceNodeId: redirectInfo.sourceNodeId ?? '',
      sourceUrl: redirectInfo.sourceUrl,
      targetUrl: redirectInfo.targetUrl,
      sourceTabId: redirectInfo.tabId,
      timestamp: redirectInfo.timestamp,
      expiresAt
    };

    this.addPendingNavigation(redirectInfo.targetUrl, pendingNav);

    logger.log(
      `添加重定向导航记录: 从 ${redirectInfo.sourceUrl} 到 ${redirectInfo.targetUrl}, 标签页=${redirectInfo.tabId}`
    );
  }
  
  /**
   * 查找与URL匹配的待处理导航
   * @param url 目标URL
   * @param tabId 可选的标签页ID
   * @returns 匹配的待处理导航，如果没有找到则返回null
   */
  getPendingNavigationForUrl(
    url: string,
    tabId?: number
  ): PendingNavigation | null {
    // 标准化URL
    const normalizedUrl = UrlUtils.normalizeUrl(url);

    // 1. 首先尝试通过URL精确匹配
    if (this.pendingNavigations.has(normalizedUrl)) {
      const navigations = this.pendingNavigations.get(normalizedUrl) || [];

      // 找到最近的尚未过期的导航
      const now = Date.now();
      const foundNavigation = navigations.find(
        (nav) =>
          nav.expiresAt > now &&
          (!tabId ||
            nav.isNewTab ||
            nav.sourceTabId === tabId ||
            nav.targetTabId === tabId)
      );

      // 如果找到匹配项，从列表中移除
      if (foundNavigation) {
        const index = navigations.indexOf(foundNavigation);
        navigations.splice(index, 1);
        
        // 如果列表为空，删除整个条目
        if (navigations.length === 0) {
          this.pendingNavigations.delete(normalizedUrl);
        } else {
          this.pendingNavigations.set(normalizedUrl, navigations);
        }
        
        return foundNavigation;
      }
    }

    // 2. 如果提供了tabId，尝试通过tabId匹配(适用于表单提交)
    if (tabId) {
      const tabKey = `tab:${tabId}`;
      if (this.pendingNavigations.has(tabKey)) {
        const navigations = this.pendingNavigations.get(tabKey) || [];

        // 找到最近的尚未过期的导航
        const now = Date.now();
        const foundNavigation = navigations.find((nav) => nav.expiresAt > now);

        // 如果找到匹配项，从列表中移除
        if (foundNavigation) {
          const index = navigations.indexOf(foundNavigation);
          navigations.splice(index, 1);
          
          // 如果列表为空，删除整个条目
          if (navigations.length === 0) {
            this.pendingNavigations.delete(tabKey);
          } else {
            this.pendingNavigations.set(tabKey, navigations);
          }
          
          return foundNavigation;
        }
      }
    }

    return null;
  }
  
  /**
   * 获取标签页的待处理JS导航记录
   * @param tabId 标签页ID
   * @returns JS导航记录数组
   */
  getPendingJsNavigations(tabId: number): JsNavigationRecord[] {
    return this.pendingJsNavigations.get(tabId) || [];
  }
  
  /**
   * 查找与URL匹配的JS导航记录
   * @param tabId 标签页ID
   * @param targetUrl 目标URL
   * @returns 匹配的JS导航记录和索引，如果没有找到则返回null
   */
  findMatchingJsNavigation(tabId: number, targetUrl: string): { 
    record: JsNavigationRecord; 
    index: number 
  } | null {
    const pendingJsNavs = this.pendingJsNavigations.get(tabId) || [];
    if (pendingJsNavs.length === 0) return null;
    
    // 标准化URL以便比较
    const normalizedUrl = UrlUtils.normalizeUrl(targetUrl);
    
    // 查找匹配的JS导航
    for (let i = pendingJsNavs.length - 1; i >= 0; i--) {
      const jsNav = pendingJsNavs[i];
      const normalizedToUrl = UrlUtils.normalizeUrl(jsNav.to);
      
      if (normalizedToUrl === normalizedUrl) {
        return { record: jsNav, index: i };
      }
    }
    
    return null;
  }
  
  /**
   * 移除JS导航记录
   * @param tabId 标签页ID
   * @param index 要移除的记录索引
   */
  removeJsNavigation(tabId: number, index: number): void {
    const pendingJsNavs = this.pendingJsNavigations.get(tabId) || [];
    if (index >= 0 && index < pendingJsNavs.length) {
      pendingJsNavs.splice(index, 1);
      this.pendingJsNavigations.set(tabId, pendingJsNavs);
    }
  }
  
  /**
   * 清理已过期的待处理导航记录
   * @returns 已清理的记录数量
   */
  cleanupExpiredNavigations(): number {
    try {
      const now = Date.now();
      let totalRemoved = 0;
      
      // 遍历所有待处理导航
      for (const [url, navigations] of this.pendingNavigations.entries()) {
        // 过滤出未过期的导航
        const validNavigations = navigations.filter(nav => nav.expiresAt > now);
        
        // 计算已删除的数量
        const removed = navigations.length - validNavigations.length;
        totalRemoved += removed;
        
        // 如果有导航被删除，更新列表
        if (removed > 0) {
          if (validNavigations.length > 0) {
            this.pendingNavigations.set(url, validNavigations);
          } else {
            // 如果没有有效导航，完全删除此URL的条目
            this.pendingNavigations.delete(url);
          }
        }
      }
      
      // 如果有导航被删除且在调试模式，记录日志
      if (totalRemoved > 0) {
        logger.log(`清理了 ${totalRemoved} 个过期的待处理导航记录`);
      }
      
      return totalRemoved;
    } catch (error) {
      logger.error("清理过期导航失败:", error);
      return 0;
    }
  }
  
  /**
   * 获取待处理导航统计信息
   * @returns 统计信息对象
   */
  getStats(): {
    pendingNavigations: number;
    pendingJsNavigations: number;
    urlCount: number;
    tabCount: number;
  } {
    return {
      pendingNavigations: Array.from(this.pendingNavigations.values())
        .reduce((total, navs) => total + navs.length, 0),
      pendingJsNavigations: Array.from(this.pendingJsNavigations.values())
        .reduce((total, navs) => total + navs.length, 0),
      urlCount: this.pendingNavigations.size,
      tabCount: this.pendingJsNavigations.size
    };
  }
  
  /**
   * 重置所有状态
   */
  reset(): void {
    this.pendingNavigations.clear();
    this.pendingJsNavigations.clear();
    logger.log('待处理导航追踪器状态已重置');
  }
  
  /**
   * 清理指定标签页的所有导航记录
   * @param tabId 标签页ID
   */
  clearTabNavigations(tabId: number): void {
    // 清理JS导航记录
    this.pendingJsNavigations.delete(tabId);
    
    // 清理与此标签页相关的待处理导航
    const tabKey = `tab:${tabId}`;
    this.pendingNavigations.delete(tabKey);
    
    // 还可以遍历其他待处理导航并删除与此标签页相关的记录
    // 但这可能比较耗时，如果数量不多可以在定期清理中处理
  }
  
  /**
   * 内部方法：添加待处理导航记录
   * @param key URL或标签页键
   * @param navigation 待处理导航记录
   */
  private addPendingNavigation(key: string, navigation: PendingNavigation): void {
    // 标准化URL键
    const normalizedKey = key.startsWith('tab:') ? key : UrlUtils.normalizeUrl(key);
    
    // 添加到待处理导航列表
    if (!this.pendingNavigations.has(normalizedKey)) {
      this.pendingNavigations.set(normalizedKey, []);
    }
    this.pendingNavigations.get(normalizedKey)!.push(navigation);
  }
  
  /**
   * 内部方法：添加JS导航记录到标签页
   * @param tabId 标签页ID
   * @param record JS导航记录
   */
  private addJsNavigationRecord(tabId: number, record: JsNavigationRecord): void {
    if (!this.pendingJsNavigations.has(tabId)) {
      this.pendingJsNavigations.set(tabId, []);
    }

    // 添加到JS导航记录列表，限制大小
    const jsNavs = this.pendingJsNavigations.get(tabId)!;
    jsNavs.push(record);

    // 保持列表不超过10项
    if (jsNavs.length > 10) {
      jsNavs.shift();
    }
  }
}