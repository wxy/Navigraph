import { Logger } from '../../../lib/utils/logger.js';
import { UrlUtils } from '../../../lib/utils/url-utils.js';
import { TabStateManager } from './tab-state-manager.js';
import { NodeTracker } from './node-tracker.js';
import { EdgeTracker } from './edge-tracker.js';
import { PendingNavigationTracker } from './pending-navigation-tracker.js';
import { NavigationStorage } from '../../store/navigation-storage.js';
import { IdGenerator } from '../../lib/id-generator.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { 
  NavigationType,
  OpenTarget,
  ExtendedCommittedDetails,
  ExtendedCompletedDetails,
  ExtendedTransitionDetails,
  NavNode
} from '../../../types/session-types.js';

const logger = new Logger('NavigationEventHandler');

/**
 * 导航事件处理器
 * 
 * 负责处理所有Chrome API的导航和标签页事件，
 * 这些事件原本在NavigationManager中处理
 */
export class NavigationEventHandler {
  // 事件监听器是否已设置
  private eventListenersSet = false;

  // 存储预绑定的事件处理器引用
  private boundHandlers: {
    tabCreated: (tab: chrome.tabs.Tab) => void;
    tabUpdated: (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => void;
    tabActivated: (activeInfo: chrome.tabs.TabActiveInfo) => void;
    tabRemoved: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void;
    navigationCommitted: (
      details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
    ) => void;
    navigationCompleted: (
      details: chrome.webNavigation.WebNavigationFramedCallbackDetails
    ) => void;
    historyStateUpdated: (
      details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
    ) => void;
    redirect: (details: chrome.webRequest.WebResponseHeadersDetails) => void;
  };

  /**
   * 构造函数
   */
  constructor(
    private tabStateManager: TabStateManager,
    private nodeTracker: NodeTracker,
    private edgeTracker: EdgeTracker,
    private pendingNavigationTracker: PendingNavigationTracker,
    private navigationStorage: NavigationStorage,
    private currentSessionId: string
  ) {
    // 预绑定所有事件处理方法
    this.boundHandlers = {
      tabCreated: this.handleTabCreated.bind(this),
      tabUpdated: this.handleTabUpdated.bind(this),
      tabActivated: this.handleTabActivated.bind(this),
      tabRemoved: this.handleTabRemoved.bind(this),
      navigationCommitted: this.handleNavigationCommitted.bind(this),
      navigationCompleted: this.handleNavigationCompleted.bind(this),
      historyStateUpdated: this.handleHistoryStateUpdated.bind(this),
      redirect: this.handleRedirect.bind(this),
    };
  }

  /**
   * 更新会话ID
   */
  public setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  /**
   * 设置事件监听器
   */
  public setupEventListeners(): void {
    if (this.eventListenersSet) {
      logger.warn(_('nav_event_handler_listeners_already_set', '事件监听器已经设置，不会重复设置'));
      return;
    }

    // 标签页事件
    chrome.tabs.onCreated.addListener(this.boundHandlers.tabCreated);
    chrome.tabs.onUpdated.addListener(this.boundHandlers.tabUpdated);
    chrome.tabs.onActivated.addListener(this.boundHandlers.tabActivated);
    chrome.tabs.onRemoved.addListener(this.boundHandlers.tabRemoved);

    // 导航事件
    chrome.webNavigation.onCommitted.addListener(
      this.boundHandlers.navigationCommitted
    );
    chrome.webNavigation.onCompleted.addListener(
      this.boundHandlers.navigationCompleted
    );
    chrome.webNavigation.onHistoryStateUpdated.addListener(
      this.boundHandlers.historyStateUpdated
    );

    // 重定向事件
    chrome.webRequest.onBeforeRedirect.addListener(
      this.boundHandlers.redirect,
      { urls: ["<all_urls>"] }
    );

    this.eventListenersSet = true;
    logger.log(_('nav_event_handler_listeners_setup', '已设置所有导航事件监听器'));
  }

  /**
   * 移除事件监听器
   */
  public removeEventListeners(): void {
    if (!this.eventListenersSet) return;

    // 标签页事件
    chrome.tabs.onCreated.removeListener(this.boundHandlers.tabCreated);
    chrome.tabs.onUpdated.removeListener(this.boundHandlers.tabUpdated);
    chrome.tabs.onActivated.removeListener(this.boundHandlers.tabActivated);
    chrome.tabs.onRemoved.removeListener(this.boundHandlers.tabRemoved);

    // 导航事件
    chrome.webNavigation.onCommitted.removeListener(
      this.boundHandlers.navigationCommitted
    );
    chrome.webNavigation.onCompleted.removeListener(
      this.boundHandlers.navigationCompleted
    );
    chrome.webNavigation.onHistoryStateUpdated.removeListener(
      this.boundHandlers.historyStateUpdated
    );

    // 重定向事件
    chrome.webRequest.onBeforeRedirect.removeListener(
      this.boundHandlers.redirect
    );

    this.eventListenersSet = false;
    logger.log(_('nav_event_handler_listeners_removed', '已移除所有导航事件监听器'));
  }

  /**
   * 重置状态
   */
  public reset(): void {
    // 清理资源
    if (this.eventListenersSet) {
      this.removeEventListeners();
    }

    logger.log(_('nav_event_handler_reset', '导航事件处理器已重置'));
  }

  /**
   * 处理标签页创建事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
    try {
      const tabId = tab.id;
      if (!tabId) return;

      // 记录标签页创建时间
      this.tabStateManager.addTabState(tabId, {
        id: tabId,
        url: tab.url || "",
        title: tab.title,
        created: Date.now(),
      });

      // 如果创建时已有URL，且不是空白页或新标签页，尝试创建初始导航记录
      const url = tab.url || "";
      if (url && !UrlUtils.isEmptyTabUrl(url) && !UrlUtils.isSystemPage(url)) {
        // 获取可能的opener标签页作为父节点来源
        let parentNodeId = "";
        if (tab.openerTabId) {
          const openerState = this.tabStateManager.getTabState(tab.openerTabId);
          if (openerState && openerState.lastNodeId) {
            parentNodeId = openerState.lastNodeId;
          }
        }

        // 创建一个初始导航节点
        await this.handleInitialNavigation(tabId, url, parentNodeId);
      }
    } catch (error) {
      logger.error(_('nav_event_handler_tab_create_failed', '处理标签页创建失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理标签页更新事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleTabUpdated(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ): Promise<void> {
    try {
      // 只有当标题或图标更新时才处理
      if (!changeInfo.title && !changeInfo.favIconUrl) {
        return;
      }

      // 获取此标签页中需要更新的节点ID
      const nodeIds = this.nodeTracker.getPendingUpdates(tabId);
      if (nodeIds.length === 0) {
        return;
      }

      // 使用统一方法更新元数据
      for (const nodeId of nodeIds) {
        await this.nodeTracker.updateNodeMetadata(
          nodeId,
          {
            title: changeInfo.title,
            favicon: changeInfo.favIconUrl,
          },
          "chrome_api"
        );
      }

      // 更新标签页状态
      this.tabStateManager.updateTabState(tabId, {
        title: changeInfo.title,
        favicon: changeInfo.favIconUrl,
      });

      // 清理已更新的节点
      this.nodeTracker.clearPendingUpdates(tabId);
    } catch (error) {
      logger.error(_('nav_event_handler_tab_update_failed', '处理标签页更新失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理标签页激活事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleTabActivated(
    activeInfo: chrome.tabs.TabActiveInfo
  ): Promise<void> {
    const { tabId, windowId } = activeInfo;
    const now = Date.now();

    try {
      // 更新标签页激活时间
      this.tabStateManager.setTabActiveTime(tabId, now);

      // 更新标签页状态
      const tabState = this.tabStateManager.getTabState(tabId);
      if (tabState) {
        this.tabStateManager.updateTabState(tabId, {
          activated: now,
          lastActiveTime: now,
        });
      } else {
        // 如果没有找到状态，创建一个新的
        try {
          const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
            chrome.tabs.get(tabId, (tab) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
              }
              resolve(tab);
            });
          });

          this.tabStateManager.addTabState(tabId, {
            id: tabId,
            url: tab.url || "",
            title: tab.title,
            activated: now,
            lastActiveTime: now,
          });
        } catch (err) {
          logger.warn(_('nav_event_handler_get_tab_failed', '获取标签页信息失败: {0}'), err instanceof Error ? err.message : String(err));
        }
      }
    } catch (error) {
      logger.error(_('nav_event_handler_tab_activate_failed', '处理标签页激活失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理标签页移除事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleTabRemoved(
    tabId: number,
    removeInfo: chrome.tabs.TabRemoveInfo
  ): Promise<void> {
    try {
      // 记录标签页活跃时间
      const activeTime = this.tabStateManager.getTabActiveElapsed(tabId);
      if (activeTime > 0) {
        await this.updateTabActiveTime(tabId, activeTime);
      }

      // 标记所有此标签页的节点为关闭状态
      const history = this.tabStateManager.getTabHistory(tabId);
      for (const nodeId of history) {
        try {
          const record = await this.navigationStorage.getNode(nodeId);
          if (record && !record.isClosed) {
            await this.navigationStorage.updateNode(nodeId, { isClosed: true });
          }
        } catch (e) {
          logger.warn(_('nav_event_handler_update_node_close_failed', '更新节点关闭状态失败: {0}'), nodeId);
        }
      }

      // 标记标签页已移除
      this.tabStateManager.markTabRemoved(tabId);

      // 清理标签页相关数据
      this.nodeTracker.clearPendingUpdates(tabId);
      this.pendingNavigationTracker.clearTabNavigations(tabId);
    } catch (error) {
      logger.error(_('nav_event_handler_tab_remove_failed', '处理标签页移除失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理导航提交事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleNavigationCommitted(
    details: ExtendedCommittedDetails
  ): Promise<void> {
    try {
      // 如果不是主框架或是错误页面，忽略此事件
      if (
        details.frameId !== 0 ||
        UrlUtils.isErrorPage(details.url) ||
        UrlUtils.isSystemPage(details.url)
      ) {
        return;
      }

      const tabId = details.tabId;
      if (this.tabStateManager.isTabRemoved(tabId)) {
        return;
      }

      const url = details.url;
      // 获取过渡类型和限定词
      const transitionType = details.transitionType || "";
      const transitionQualifiers = details.transitionQualifiers || [];

      // 确定导航类型和打开目标
      let navigationType: NavigationType = "initial";
      let openTarget: OpenTarget = "same_tab";

      if (transitionType === "reload") {
        navigationType = "reload";
      } else if (transitionType === "link") {
        navigationType = "link_click";
      } else if (transitionType === "form_submit") {
        navigationType = "form_submit";
      } else if (transitionType === "typed") {
        navigationType = "address_bar";
      } else if (transitionType === "auto_bookmark") {
        navigationType = "link_click"; // 视为链接点击
      } else if (
        transitionType === "generated" ||
        transitionType === "auto_subframe"
      ) {
        navigationType = "javascript";
      } else if (transitionType === "manual_subframe") {
        navigationType = "link_click";
        openTarget = "frame";
      } else if (transitionType === "start_page") {
        navigationType = "initial";
      }

      // 覆盖基于限定词的导航类型
      if (transitionQualifiers.includes("forward_back")) {
        if (transitionQualifiers.includes("forward")) {
          navigationType = "history_forward";
        } else {
          navigationType = "history_back";
        }
      } else if (transitionQualifiers.includes("from_address_bar")) {
        navigationType = "address_bar";
      } else if (
        transitionQualifiers.includes("client_redirect") ||
        transitionQualifiers.includes("server_redirect")
      ) {
        navigationType = "redirect";
      }

      // 检查是否在新窗口打开
      if (transitionQualifiers.includes("from_api")) {
        if (this.isNewPopupWindow(tabId)) {
          openTarget = "popup";
        } else {
          openTarget = "new_tab";
        }
      }

      // 处理常规导航
      await this.handleRegularNavigation(details, navigationType, openTarget);
    } catch (error) {
      logger.error(_('nav_event_handler_commit_failed', '处理导航提交事件失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理导航完成事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleNavigationCompleted(
    details: ExtendedCompletedDetails
  ): Promise<void> {
    try {
      // 过滤掉不需要记录的导航
      if (
        details.frameId !== 0 ||
        UrlUtils.isErrorPage(details.url) ||
        UrlUtils.isSystemPage(details.url)
      ) {
        return;
      }

      const tabId = details.tabId;
      const url = details.url;

      if (this.tabStateManager.isTabRemoved(tabId)) {
        return;
      }

      // 委托给 NodeTracker 处理所有节点相关的逻辑
      await this.nodeTracker.handleNavigationCompleted(details);
    } catch (error) {
      logger.error(_('nav_event_handler_complete_failed', '处理导航完成失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理历史状态更新事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleHistoryStateUpdated(
    details: ExtendedTransitionDetails
  ): Promise<void> {
    try {
      if (
        details.frameId !== 0 ||
        UrlUtils.isErrorPage(details.url) ||
        UrlUtils.isSystemPage(details.url)
      ) {
        return;
      }

      const tabId = details.tabId;
      const url = details.url;

      if (this.tabStateManager.isTabRemoved(tabId)) {
        return;
      }

      // 检查是否已有相同URL的节点
      const existingNodeId = await this.nodeTracker.getNodeIdForTab(tabId, url);
      if (existingNodeId) {
        // 更新现有节点的访问时间和计数
        const now = Date.now();
        try {
          // 同时将此类 historyState 更新视为页面内请求，增加 spaRequestCount
          const existing = await this.navigationStorage.getNode(existingNodeId);
          const newSpaCount = (existing?.spaRequestCount || 0) + 1;

          // For SPA history updates we treat this as an in-page request: increment spaRequestCount only
          const updates: any = {
            lastVisit: now,
            spaRequestCount: newSpaCount,
          };
          if (url && existing && existing.url !== url) {
            updates.url = url;
          }

          await this.navigationStorage.updateNode(existingNodeId, updates);

          // Also update tab state and caches so UI reflects the new URL immediately
          try {
            this.tabStateManager.updateTabState(tabId, {
              url: url,
              lastNodeId: existingNodeId,
              lastNavigation: now,
            });
            this.nodeTracker.addTabNodeCache(tabId, url, existingNodeId);
          } catch (cacheErr) {
            // Don't fail the whole flow if cache update fails
            logger.warn(_('nav_event_handler_cache_update_failed', '更新缓存失败: {0}'), cacheErr instanceof Error ? cacheErr.message : String(cacheErr));
          }
        } catch (e) {
          // 如果更新 spaRequestCount 失败，仍尝试保证 lastVisit 被更新
          const now2 = Date.now();
          await this.navigationStorage.updateNode(existingNodeId, {
            lastVisit: now2,
          });
        }

        return;
      }

      // 找到父节点
      const parentId = await this.findLastNodeIdForTab(tabId);

      // 如果没有找到父节点，则忽略
      if (!parentId) {
        return;
      }

      // 创建新节点记录
      const now = Date.now();
      const nodeId = IdGenerator.generateNodeId(tabId, url);

      // 获取标签页信息
      let title: string | undefined;
      let favicon: string | undefined;

      try {
        const tab = await chrome.tabs.get(tabId);
        title = tab.title;
        favicon = tab.favIconUrl;

        if (!favicon) {
          favicon = UrlUtils.getFaviconUrl(url, tab.favIconUrl);
        }
      } catch (e) {
        logger.warn(_('nav_event_handler_get_tab_failed', '获取标签页信息失败: {0}'), e instanceof Error ? e.message : String(e));
      }

      // 创建导航记录
      const record: NavNode = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: now,
        sessionId: this.currentSessionId,
        parentId: parentId,
        title: title,
        favicon: favicon,
        type: "javascript",
        openTarget: "same_tab",
        source: "chrome_api",
        firstVisit: now,
        lastVisit: now,
        visitCount: 1,
        reloadCount: 0,
        frameId: details.frameId,
        parentFrameId: details.parentFrameId ?? -1,
      };

      // 保存记录并使用返回的实际ID
      const savedIdAfter = await this.navigationStorage.saveNode(record).catch((e) => {
        logger.error(_('nav_event_handler_save_node_failed', '保存节点失败: {0}'), e instanceof Error ? e.message : String(e));
        return nodeId;
      });

      const finalIdAfter = savedIdAfter || nodeId;

      // 使用最终ID更新历史、状态与缓存（若发生合并，finalIdAfter 可能与 nodeId 不同）
      this.tabStateManager.addToNavigationHistory(tabId, finalIdAfter);
      this.tabStateManager.updateTabState(tabId, {
        url: url,
        lastNodeId: finalIdAfter,
        lastNavigation: now,
      });
      this.nodeTracker.addToPendingUpdates(tabId, finalIdAfter);
      this.nodeTracker.addTabNodeCache(tabId, url, finalIdAfter);

      // 创建边
      await this.edgeTracker.createNavigationEdge({
        sourceId: parentId,
        targetId: finalIdAfter,
        timestamp: now,
        navigationType: "javascript",
        sessionId: this.currentSessionId,
      });
    } catch (error) {
      logger.error(_('nav_event_handler_history_update_failed', '处理历史状态更新失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理重定向事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleRedirect(
    details: chrome.webRequest.WebResponseHeadersDetails
  ): Promise<void> {
    try {
      // 忽略子框架的重定向
      if (details.frameId !== 0) {
        return;
      }

      // 检查是否是重定向状态码
      const isRedirectStatus =
        details.statusCode >= 300 && details.statusCode < 400;
      if (!isRedirectStatus) {
        return;
      }

      // 从响应头中获取重定向目标
      let redirectUrl = "";

      if (details.responseHeaders) {
        // 查找Location响应头
        const locationHeader = details.responseHeaders.find(
          (header) => header.name.toLowerCase() === "location"
        );

        if (locationHeader && locationHeader.value) {
          redirectUrl = locationHeader.value;

          // 如果是相对URL，转换为绝对URL
          if (redirectUrl.startsWith("/")) {
            try {
              const originalUrl = new URL(details.url);
              redirectUrl = `${originalUrl.origin}${redirectUrl}`;
            } catch (e) {
              logger.warn(_('nav_event_handler_relative_url_failed', '无法将相对路径转换为绝对URL: {0}'), redirectUrl);
            }
          }
        }
      }

      // 如果找不到重定向URL，退出
      if (!redirectUrl) {
        return;
      }

      // 检查是否为系统页面
      if (UrlUtils.isSystemPage(redirectUrl)) {
        return;
      }

      const tabId = details.tabId;
      const sourceUrl = details.url;
      const targetUrl = redirectUrl;

      // 添加待处理导航记录，使得onCommitted事件能够使用这些信息
      // 1. 尝试找到源URL对应的节点
      const sourceNodeId = await this.nodeTracker.getNodeIdForTab(
        tabId,
        sourceUrl
      );

      // 2. 添加重定向记录，让onCommitted事件处理时能够检测到
      if (sourceNodeId) {
        // 添加到待处理导航中
        this.pendingNavigationTracker.addRedirectNavigation({
          sourceNodeId,
          sourceUrl,
          targetUrl,
          tabId,
          timestamp: Date.now(),
        });
      } else {
        // 如果没有找到源节点，仍然记录重定向信息，但不包含源节点ID
        this.pendingNavigationTracker.addRedirectNavigation({
          sourceUrl,
          targetUrl,
          tabId,
          timestamp: Date.now(),
        });
      }

      // 重定向事件本身并不创建节点，而是记录信息供onCommitted事件使用
      // 在onCommitted事件中，会根据找到的待处理导航信息完成节点和边的创建
    } catch (error) {
      logger.error(_('nav_event_handler_redirect_failed', '处理重定向事件失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理初始导航
   * 从NavigationManager直接复制的原始实现
   */
  private async handleInitialNavigation(
    tabId: number,
    url: string,
    parentNodeId: string = ""
  ): Promise<string | null> {
    try {
      // 如果是空白页或新标签页，忽略
      if (UrlUtils.isEmptyTabUrl(url) || UrlUtils.isSystemPage(url)) {
        return null;
      }

      const now = Date.now();

      // 生成新的节点ID
      const nodeId = IdGenerator.generateNodeId(tabId, url);

      // 记录节点ID到标签页历史
      this.tabStateManager.addToNavigationHistory(tabId, nodeId);

      // 更新标签页状态
      this.tabStateManager.updateTabState(tabId, {
        url: url,
        lastNodeId: nodeId,
        lastNavigation: now,
      });

      // 添加到待更新列表
      this.nodeTracker.addToPendingUpdates(tabId, nodeId);

      // 更新缓存
      this.nodeTracker.addTabNodeCache(tabId, url, nodeId);

      // 获取标签页信息
      let title: string | undefined;
      let favicon: string | undefined;

      try {
        const tab = await chrome.tabs.get(tabId);
        title = tab.title;
        favicon = tab.favIconUrl;

        if (!favicon) {
          favicon = UrlUtils.getFaviconUrl(url, tab.favIconUrl);
        }
      } catch (e) {
        logger.warn(_('nav_event_handler_get_tab_failed', '获取标签页信息失败: {0}'), e instanceof Error ? e.message : String(e));
      }

      // 创建导航记录
      const record: NavNode = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: now,
        sessionId: this.currentSessionId,
        parentId: parentNodeId,
        title: title,
        favicon: favicon,
        type: "initial",
        openTarget: "same_tab",
        source: "chrome_api",
        firstVisit: now,
        lastVisit: now,
        visitCount: 1,
        reloadCount: 0,
        frameId: 0,
        parentFrameId: -1,
      };

      // 保存记录并使用返回的实际ID
      const savedId = await this.navigationStorage.saveNode(record).catch((e) => {
        logger.error(_('nav_event_handler_save_node_failed', '保存节点失败: {0}'), e instanceof Error ? e.message : String(e));
        return nodeId;
      });

      const finalId = savedId || nodeId;

      // 如果存在父节点，创建边（使用最终ID）
      if (parentNodeId) {
        await this.edgeTracker.createNavigationEdge({
          sourceId: parentNodeId,
          targetId: finalId,
          timestamp: now,
          navigationType: "initial",
          sessionId: this.currentSessionId,
        });
      }

      return finalId;
    } catch (error) {
      logger.error(_('nav_event_handler_initial_nav_failed', '处理初始导航失败: {0}'), error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * 处理常规导航事件
   * 从NavigationManager直接复制的原始实现
   */
  private async handleRegularNavigation(
    details: ExtendedCommittedDetails,
    navigationType: NavigationType,
    openTarget: OpenTarget
  ): Promise<void> {
    try {
      const tabId = details.tabId;
      const now = Date.now();
      const url = details.url;

      // 如果是空白页或新标签页，忽略
      if (UrlUtils.isEmptyTabUrl(url)) {
        return;
      }

      // 1. 尝试查找上一个节点作为父节点
      let parentId = await this.findLastNodeIdForTab(tabId);

      // 2. 查找待处理导航
      const pendingNav =
        this.pendingNavigationTracker.getPendingNavigationForUrl(url, tabId);

      if (pendingNav) {
        // 使用待处理导航信息设置父节点和导航类型
        navigationType = pendingNav.type;
        if (pendingNav.sourceNodeId) {
          parentId = pendingNav.sourceNodeId;
        }
      }

      // 3. 如果是JS导航，尝试找到更好的父节点
      if (navigationType === "javascript") {
        const matchResult =
          this.pendingNavigationTracker.findMatchingJsNavigation(tabId, url);
        if (matchResult) {
          const jsNav = matchResult.record;
          // 从当前标签页的节点历史中查找源节点
          const history = this.tabStateManager.getTabHistory(tabId);
          let sourceNodeId = null;
          for (const id of history) {
            if (await this.nodeTracker.isSameNodeUrl(id, jsNav.from)) {
              sourceNodeId = id;
              break;
            }
          }

          if (sourceNodeId) {
            parentId = sourceNodeId;

            // 移除已使用的JS导航记录
            this.pendingNavigationTracker.removeJsNavigation(
              tabId,
              matchResult.index
            );
          }
        }
      }

      // 4. 如果是首次导航或地址栏导航，检查是否应该为根导航
      if (navigationType === "initial" || navigationType === "address_bar") {
        if (this.shouldBeRootNavigation(navigationType, url)) {
          parentId = ""; // 置为根节点
        }
      }

      // 5. 生成新的节点ID
      const nodeId = IdGenerator.generateNodeId(tabId, url);

      // 6. 记录节点ID到标签页历史
      this.tabStateManager.addToNavigationHistory(tabId, nodeId);

      // 7. 更新标签页状态
      this.tabStateManager.updateTabState(tabId, {
        url: url,
        lastNodeId: nodeId,
        lastNavigation: now,
      });

      // 8. 添加到待更新列表
      this.nodeTracker.addToPendingUpdates(tabId, nodeId);

      // 9. 更新缓存
      this.nodeTracker.addTabNodeCache(tabId, url, nodeId);

      // 10. 创建导航记录

      const record: NavNode = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: now,
        sessionId: this.currentSessionId,
        parentId: parentId || "",
        type: navigationType,
        openTarget: openTarget,
        source: "chrome_api",
        firstVisit: now,
        lastVisit: now,
        visitCount: 1,
        reloadCount: 0,
        frameId: details.frameId,
        parentFrameId: details.parentFrameId ?? -1,
      };

      // 11. 根据导航类型设置其他字段
      if (navigationType === "reload") {
        // 对于刷新，查找之前的记录并更新计数
        if (parentId) {
          const parentRecord = await this.navigationStorage.getNode(parentId);
          if (parentRecord) {
            record.reloadCount = (parentRecord.reloadCount || 0) + 1;
            record.firstVisit = parentRecord.firstVisit || now;
            record.visitCount = (parentRecord.visitCount || 0) + 1;
          }
        }
      }

      // 12. 尝试获取标题和favicon
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab) {
          record.title = tab.title;
          record.favicon = tab.favIconUrl;

          // 如果没有favicon，尝试获取
          if (!record.favicon) {
            record.favicon = UrlUtils.getFaviconUrl(
              url,
              tab.favIconUrl
            );
          }
        }
      } catch (e) {
        logger.warn(_('nav_event_handler_get_tab_failed', '获取标签页信息失败: {0}'), e instanceof Error ? e.message : String(e));
      }

      // 13. 保存记录并使用返回的实际ID
      const savedId = await this.navigationStorage.saveNode(record).catch((e) => {
        logger.error(_('nav_event_handler_save_node_failed', '保存节点失败: {0}'), e instanceof Error ? e.message : String(e));
        return nodeId;
      });

      const finalId = savedId || nodeId;

      // 14. 如果存在父节点，创建边（使用最终ID）
      if (parentId) {
        await this.edgeTracker.createNavigationEdge({
          sourceId: parentId,
          targetId: finalId,
          timestamp: now,
          navigationType: navigationType,
          sessionId: this.currentSessionId,
        });
      }
    } catch (error) {
      logger.error(_('nav_event_handler_regular_nav_failed', '处理常规导航失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 找到标签页的最后一个节点ID
   * 从NavigationManager直接复制的原始实现
   */
  private async findLastNodeIdForTab(tabId: number): Promise<string | null> {
    return this.tabStateManager.getLastNodeId(tabId);
  }

  /**
   * 更新标签页活跃时间
   * 从NavigationManager直接复制的原始实现
   */
  private async updateTabActiveTime(
    tabId: number,
    elapsedTime: number
  ): Promise<void> {
    try {
      // 查找活跃标签页中的所有节点
      const history = this.tabStateManager.getTabHistory(tabId);
      if (history.length === 0) return;

      // 更新最后一个节点的活跃时间
      const lastNodeId = history[history.length - 1];
      const record = await this.navigationStorage.getNode(lastNodeId);

      if (record) {
        await this.navigationStorage.updateNode(lastNodeId, {
          activeTime: (record.activeTime || 0) + elapsedTime,
        });
      }
    } catch (error) {
      logger.warn(_('nav_event_handler_update_active_time_failed', '更新标签页活跃时间失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 判断是否为新弹出窗口
   * 从NavigationManager直接复制的原始实现
   */
  private isNewPopupWindow(tabId: number): boolean {
    // 此方法可以通过检查标签页所在窗口的属性来确定
    // 目前使用简单实现，未来可以扩展
    return false;
  }

  /**
   * 判断当前导航是否应该作为根节点
   * 从NavigationManager直接复制的原始实现
   */
  private shouldBeRootNavigation(
    navigationType: NavigationType,
    url: string
  ): boolean {
    // 地址栏输入的通常是根节点，除非有明确的父节点
    if (navigationType === "address_bar") {
      return true;
    }

    // 初始导航也通常是根节点
    if (navigationType === "initial") {
      return true;
    }

    return false;
  }

  /**
   * 清理已过期的待处理导航记录
   * 从NavigationManager直接复制的原始实现
   */
  public cleanupExpiredNavigations(): void {
    try {
      const removed = this.pendingNavigationTracker.cleanupExpiredNavigations();

      if (removed > 0) {
        logger.log(_('nav_event_handler_expired_cleanup', '清理了 {0} 个过期的待处理导航记录'), removed.toString());
      }
    } catch (error) {
      logger.error(_('nav_event_handler_cleanup_failed', '清理过期导航失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理链接点击事件
   */
  public handleLinkClick(linkInfo: {
    sourcePageId: string;
    sourceUrl: string;
    targetUrl: string;
    anchorText: string;
    isNewTab: boolean;
    timestamp: number;
  }): void {
    try {
      this.pendingNavigationTracker.addLinkNavigation(linkInfo);
    } catch (error) {
      logger.error(_('nav_event_handler_link_click_failed', '处理链接点击失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理表单提交事件
   * 内容脚本发送的事件
   */
  public handleFormSubmitted(tabId: number, formInfo: any): void {
    if (!formInfo || !tabId) return;

    try {
      this.pendingNavigationTracker.addFormSubmission(tabId, formInfo);
    } catch (error) {
      logger.error(_('nav_event_handler_form_submit_failed', '处理表单提交失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 处理JS导航事件
   * 内容脚本发送的事件
   */
  public handleJsNavigation(tabId: number, message: any): void {
    if (!message || !tabId) return;

    try {
      this.pendingNavigationTracker.addJsNavigation(tabId, {
        sourcePageId: message.sourcePageId,
        sourceUrl: message.sourceUrl,
        targetUrl: message.targetUrl,
        timestamp: message.timestamp,
      });
    } catch (error) {
      logger.error(_('nav_event_handler_js_nav_failed', '处理JS导航失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }
}