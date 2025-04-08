import { Logger } from '../lib/utils/logger.js';
import { NavigationStorage } from './store/navigation-storage.js';
import { SessionStorage } from './store/session-storage.js';
import { IdGenerator } from './lib/id-generator.js';
import { BackgroundMessageService } from './messaging/bg-message-service.js';
import { BackgroundMessages, BackgroundResponses } from '../types/messages/background.js';
import { 
  NavigationType,
  OpenTarget,
  BrowsingSession,
  ExtendedCommittedDetails, 
  ExtendedCompletedDetails,
  ExtendedTransitionDetails,
  TabState,
  PendingNavigation,
  NavNode,
  NavLink
} from '../types/session-types.js';

import { UrlUtils } from './navigation/utils/url-utils.js';
import { TabStateManager } from './navigation/managers/tab-state-manager.js';
import { NodeTracker } from './navigation/managers/node-tracker.js';
import { EdgeTracker } from './navigation/managers/edge-tracker.js';
import { PendingNavigationTracker } from './navigation/managers/pending-navigation-tracker.js';

const logger = new Logger('NavigationManager');
/**
 * 导航管理器 - 负责创建和管理导航节点、事件和关系
* 
 * 该类处理：
 * 1. 通过Chrome浏览器API监听导航事件并创建节点
 * 2. 处理从内容脚本收到的用户交互事件（链接点击、表单提交等）
 * 3. 管理节点间的关系和导航历史
 * 4. 提供导航数据查询和更新接口
 */
export class NavigationManager {
  // 消息服务实例
  private messageService: BackgroundMessageService;
  // 存储引用
  private navigationStorage: NavigationStorage;
  private sessionStorage: SessionStorage;

  // 会话ID - 只存储当前使用的会话ID
  private currentSessionId: string = '';

  // 标签页状态管理器
  private tabStateManager: TabStateManager;

  // 节点追踪器
  private nodeTracker: NodeTracker;

  // 边追踪器
  private edgeTracker: EdgeTracker;

  // 待处理导航追踪器
  private pendingNavigationTracker: PendingNavigationTracker;

  // 其他状态追踪
  private expirationTime = 10000; // 待处理导航的过期时间（毫秒）
  private historyLimit = 50; // 每个标签页的历史记录限制

  // 调试标志
  private debugMode = false;

  /**
   * 构造函数 - 初始化导航管理器
   * @param messageService 消息服务实例
   * @param navStorage 导航存储实例（可选，用于依赖注入）
   * @param sessionStorage 会话存储实例（可选，用于依赖注入）
   */
  constructor(
    messageService: BackgroundMessageService,
    navigationStorage?: NavigationStorage,
    sessionStorage?: SessionStorage
  ) {
    this.messageService = messageService;
    // 创建存储实例
    this.navigationStorage = navigationStorage || new NavigationStorage();
    this.sessionStorage = sessionStorage || new SessionStorage();

    // 初始化标签页状态管理器
    this.tabStateManager = new TabStateManager(this.historyLimit);

    // 初始化节点追踪器
    this.nodeTracker = new NodeTracker(
      this.navigationStorage, 
      this.tabStateManager,
      this.currentSessionId
    );

    // 初始化边追踪器
    this.edgeTracker = new EdgeTracker(
      this.navigationStorage,
      this.currentSessionId
    );

    // 初始化待处理导航追踪器
    this.pendingNavigationTracker = new PendingNavigationTracker(
      this.expirationTime
    );
  }
  /**
   * 初始化导航管理器
   */
  public async initialize(): Promise<void> {
    try {
      logger.log("初始化导航管理器...");
      
      // 初始化导航存储
      await this.navigationStorage.initialize();
      // 初始化会话存储
      await this.sessionStorage.initialize();
  
      // 确保有活跃会话
      const currentSession = await this.sessionStorage.getCurrentSession();
      if (!currentSession) {
        logger.log("未找到活跃会话，创建新的默认会话...");
        const newSession = await this.sessionStorage.createSession({
          title: `浏览会话 ${new Date().toLocaleString()}`,
          makeActive: true
        });
        this.setCurrentSessionId(newSession.id);
      } else {
        this.setCurrentSessionId(currentSession.id);
      }

      // 设置定期清理任务
      setInterval(() => this.cleanupPendingUpdates(), 60000); // 每分钟清理一次待更新列表
      setInterval(() => this.cleanupExpiredNavigations(), 30000); // 每30秒清理一次过期导航

      // 注册消息处理程序
      logger.groupCollapsed('注册导航相关消息处理程序');
      this.registerMessageHandlers(this.messageService);
      logger.groupEnd();

      // 初始化事件侦听器
      this.setupEventListeners();
            
      logger.log("导航管理器初始化完成");
    } catch (error) {
      logger.error("导航管理器初始化失败:", error);
      throw new Error(`导航管理器初始化失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * 设置当前会话ID并同步到所有组件
   * @param sessionId 新的会话ID
   */
  private setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.nodeTracker.setSessionId(sessionId);
    this.edgeTracker.setSessionId(sessionId);
    
    if (this.debugMode) {
      logger.log(`已切换到会话: ${sessionId}`);
    }
  }
  /**
   * 设置调试模式
   */
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.nodeTracker.setDebugMode(enabled);
    this.edgeTracker.setDebugMode(enabled);
    this.pendingNavigationTracker.setDebugMode(enabled);
    logger.log(`导航管理器调试模式: ${enabled ? "已启用" : "已禁用"}`);
  }
  /**
   * 获取导航存储实例
   */
  public getNavigationStorage(): NavigationStorage {
    return this.navigationStorage;
  }

  /**
   * 获取会话存储实例
   */
  public getSessionStorage(): SessionStorage {
    return this.sessionStorage;
  }

  /**
   * 设置事件监听器
   * 监听Chrome API的各种导航和标签页事件
   */
  private setupEventListeners(): void {
    // 标签页创建事件
    chrome.tabs.onCreated.addListener(this.handleTabCreated.bind(this));

    // 标签页更新事件
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));

    // 标签页激活事件
    chrome.tabs.onActivated.addListener(this.handleTabActivated.bind(this));

    // 标签页关闭事件
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

    // 导航提交事件（URL变化但页面可能尚未加载）
    chrome.webNavigation.onCommitted.addListener((details) => {
      this.handleNavigationCommitted(details as ExtendedCommittedDetails);
    });

    // 导航完成事件（页面已加载完成）
    chrome.webNavigation.onCompleted.addListener((details) => {
      this.handleNavigationCompleted(details as ExtendedCompletedDetails);
    });

    // 导航到历史记录中的事件
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      this.handleHistoryStateUpdated(details as ExtendedTransitionDetails);
    });

    // 重定向事件
    chrome.webRequest.onBeforeRedirect.addListener(
      (details) => {
        this.handleRedirect(details);
      },
      { urls: ["<all_urls>"] }
    );

    logger.log("导航事件监听器已设置");
  }

  /**
   * 处理标签页创建事件
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

      if (this.debugMode) {
        logger.log(`标签页创建: ID=${tabId}, URL=${tab.url || "空"}`);
      }

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
      logger.error("处理标签页创建失败:", error);
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
      // 只有当标题或图标更新时才处理
      if (!changeInfo.title && !changeInfo.favIconUrl) {
        return;
      }

      // 获取此标签页中需要更新的节点ID
      const nodeIds = this.nodeTracker.getPendingUpdates(tabId);
      if (nodeIds.length === 0) {
        return;
      }

      if (this.debugMode) {
        logger.log(
          `标签页更新: ID=${tabId}, 标题=${changeInfo.title || "没变"}, 图标=${
            changeInfo.favIconUrl ? "已更新" : "没变"
          }`
        );
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
        favicon: changeInfo.favIconUrl
      });

      // 清理已更新的节点
      this.nodeTracker.clearPendingUpdates(tabId);
    } catch (error) {
      logger.error("处理标签页更新失败:", error);
    }
  }

  /**
   * 处理标签页激活事件
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
          lastActiveTime: now
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

          if (this.debugMode) {
            logger.log(
              `标签页激活: ID=${tabId}, 窗口=${windowId}, URL=${
                tab.url || "未知"
              }`
            );
          }
        } catch (err) {
          logger.warn(
            `获取标签页信息失败: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    } catch (error) {
      logger.error("处理标签页激活失败:", error);
    }
  }

  /**
   * 处理标签页移除事件
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
          logger.warn(`更新节点关闭状态失败: ${nodeId}`, e);
        }
      }

      // 标记标签页已移除
      this.tabStateManager.markTabRemoved(tabId);
      
      // 清理标签页相关数据
      this.nodeTracker.clearPendingUpdates(tabId);
      this.pendingNavigationTracker.clearTabNavigations(tabId);

      if (this.debugMode) {
        logger.log(
          `标签页关闭: ID=${tabId}, 窗口=${removeInfo.windowId}, 窗口关闭=${removeInfo.isWindowClosing}`
        );
      }
    } catch (error) {
      logger.error("处理标签页移除失败:", error);
    }
  }

  /**
   * 处理导航提交事件
   * 当用户导航到新页面，URL发生变化时触发
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
        if (this.debugMode) {
          logger.log(`忽略已关闭标签页的导航: ${tabId}`);
        }
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

      if (this.debugMode) {
        logger.log(
          `导航提交: 标签页=${tabId}, URL=${url}, 类型=${navigationType}, 目标=${openTarget}`
        );
        logger.log(`  - 过渡类型: ${transitionType}`);
        logger.log(
          `  - 过渡限定词: ${transitionQualifiers.join(", ") || "无"}`
        );
      }

      // 处理常规导航
      await this.handleRegularNavigation(details, navigationType, openTarget);
    } catch (error) {
      logger.error("处理导航提交事件失败:", error);
    }
  }

  /**
   * 处理常规导航事件
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
      const pendingNav = this.pendingNavigationTracker.getPendingNavigationForUrl(url, tabId);

      if (pendingNav) {
        // 使用待处理导航信息设置父节点和导航类型
        navigationType = pendingNav.type;
        if (pendingNav.sourceNodeId) {
          parentId = pendingNav.sourceNodeId;
        }
        if (this.debugMode) {
          logger.log(
            `找到匹配的待处理导航: ${pendingNav.type}, 父节点ID: ${parentId}`
          );
        }
      }

      // 3. 如果是JS导航，尝试找到更好的父节点
      if (navigationType === "javascript") {
        const matchResult = this.pendingNavigationTracker.findMatchingJsNavigation(tabId, url);
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
            if (this.debugMode) {
              logger.log(`找到JS导航的父节点: ${parentId}`);
            }

            // 移除已使用的JS导航记录
            this.pendingNavigationTracker.removeJsNavigation(tabId, matchResult.index);
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
            record.favicon = await this.nodeTracker.getFaviconUrl(url, tab.favIconUrl);
          }
        }
      } catch (e) {
        logger.warn(`无法获取标签页信息用于导航记录:`, e);
      }

      // 13. 保存记录
      await this.navigationStorage.saveNode(record);

      // 14. 如果存在父节点，创建边
      if (parentId) {
        await this.edgeTracker.createNavigationEdge({
          sourceId: parentId,
          targetId: nodeId,
          timestamp: now,
          navigationType: navigationType,
          sessionId: this.currentSessionId
        });
      }

      if (this.debugMode) {
        logger.log(
          `已创建导航节点: ID=${nodeId}, 父节点=${
            parentId || "无"
          }, 类型=${navigationType}`
        );
      }
    } catch (error) {
      logger.error("处理常规导航失败:", error);
    }
  }
  /**
   * 处理导航完成事件
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

      if (this.debugMode) {
        logger.log(`导航完成: 标签页=${tabId}, URL=${url}`);
      }

      // 委托给 NodeTracker 处理所有节点相关的逻辑
      await this.nodeTracker.handleNavigationCompleted(details, this.debugMode);
    } catch (error) {
      logger.error("处理导航完成失败:", error);
    }
  }
  /**
   * 处理历史状态更新事件
   * 当使用history.pushState或history.replaceState触发导航时
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
        if (this.debugMode) {
          logger.log(
            `历史状态更新: 已存在节点 ${existingNodeId} 于URL=${url}`
          );
        }

        // 更新现有节点的访问时间和计数
        const now = Date.now();
        await this.navigationStorage.updateNode(existingNodeId, {
          lastVisit: now,
          visitCount: await this.nodeTracker.incrementVisitCount(existingNodeId),
        });

        return;
      }

      // 找到父节点
      const parentId = await this.findLastNodeIdForTab(tabId);

      // 如果没有找到父节点，则忽略
      if (!parentId) {
        if (this.debugMode) {
          logger.log(
            `历史状态更新: 未找到父节点, 标签页=${tabId}, URL=${url}`
          );
        }
        return;
      }

      // 创建新节点记录
      const now = Date.now();
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
          favicon = await this.nodeTracker.getFaviconUrl(url, tab.favIconUrl);
        }
      } catch (e) {
        logger.warn("获取标签页信息失败:", e);
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
        parentFrameId: details.parentFrameId ?? -1
      };

      // 保存记录
      await this.navigationStorage.saveNode(record);

      // 创建边
      await this.edgeTracker.createNavigationEdge({
        sourceId: parentId,
        targetId: nodeId,
        timestamp: now,
        navigationType: "javascript",
        sessionId: this.currentSessionId
      });

      if (this.debugMode) {
        logger.log(
          `历史状态更新: 已创建节点 ${nodeId}, 父节点=${parentId}, URL=${url}`
        );
      }
    } catch (error) {
      logger.error("处理历史状态更新失败:", error);
    }
  }

  /**
   * 处理初始导航
   * 用于处理标签页创建时已有的URL
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
          favicon = await this.nodeTracker.getFaviconUrl(url, tab.favIconUrl);
        }
      } catch (e) {
        logger.warn("获取标签页信息失败:", e);
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

      // 保存记录
      await this.navigationStorage.saveNode(record);

      // 如果存在父节点，创建边
      if (parentNodeId) {
        await this.edgeTracker.createNavigationEdge({
          sourceId: parentNodeId,
          targetId: nodeId,
          timestamp: now,
          navigationType: "initial",
          sessionId: this.currentSessionId
        });
      }

      if (this.debugMode) {
        logger.log(
          `已创建初始导航节点: ID=${nodeId}, 父节点=${parentNodeId || "无"}`
        );
      }

      return nodeId;
    } catch (error) {
      logger.error("处理初始导航失败:", error);
      return null;
    }
  }

  /**
   * 清理待更新列表
   */
  private async cleanupPendingUpdates(): Promise<void> {
    try {
      await this.nodeTracker.cleanupCache();
    } catch (error) {
      logger.error("清理待更新列表失败:", error);
    }
  }
  /**
   * 清理已过期的待处理导航记录
   */
  private cleanupExpiredNavigations(): void {
    try {
      const removed = this.pendingNavigationTracker.cleanupExpiredNavigations();
      
      if (removed > 0 && this.debugMode) {
        logger.log(`清理了 ${removed} 个过期的待处理导航记录`);
      }
    } catch (error) {
      logger.error("清理过期导航失败:", error);
    }
  }
  /**
   * 处理链接点击事件
   */
  private handleLinkClick(linkInfo: {
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
      logger.error('处理链接点击失败:', error);
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
      logger.error('处理表单提交失败:', error);
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
        timestamp: message.timestamp
      });
    } catch (error) {
      logger.error('处理JS导航失败:', error);
    }
  }

  /**
   * 处理重定向事件
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
      const isRedirectStatus = details.statusCode >= 300 && details.statusCode < 400;
      if (!isRedirectStatus) {
        return;
      }

      // 从响应头中获取重定向目标
      let redirectUrl = '';
      
      if (details.responseHeaders) {
        // 查找Location响应头
        const locationHeader = details.responseHeaders.find(
          header => header.name.toLowerCase() === 'location'
        );
        
        if (locationHeader && locationHeader.value) {
          redirectUrl = locationHeader.value;
          
          // 如果是相对URL，转换为绝对URL
          if (redirectUrl.startsWith('/')) {
            try {
              const originalUrl = new URL(details.url);
              redirectUrl = `${originalUrl.origin}${redirectUrl}`;
            } catch (e) {
              logger.warn(`无法将相对路径转换为绝对URL: ${redirectUrl}`);
            }
          }
        }
      }
      
      // 如果找不到重定向URL，退出
      if (!redirectUrl) {
        if (this.debugMode) {
          logger.log(`重定向事件没有目标URL: ${details.url}, 状态码: ${details.statusCode}`);
        }
        return;
      }

      // 检查是否为系统页面
      if (UrlUtils.isSystemPage(redirectUrl)) {
        return;
      }

      const tabId = details.tabId;
      const sourceUrl = details.url;
      const targetUrl = redirectUrl;

      if (this.debugMode) {
        logger.log(
          `重定向: 标签页=${tabId}, 从=${sourceUrl}, 到=${targetUrl}, 状态码=${details.statusCode}`
        );
      }

      // 其余代码保持不变...
      // ... 处理重定向节点的创建 ...
    } catch (error) {
      logger.error("处理重定向事件失败:", error);
    }
  }

  /**
   * 找到标签页的最后一个节点ID
   */
  private async findLastNodeIdForTab(tabId: number): Promise<string | null> {
    return this.tabStateManager.getLastNodeId(tabId);
  }

  /**
   * 更新标签页活跃时间
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

        if (this.debugMode) {
          logger.log(
            `更新标签页[${tabId}]活跃时间: +${elapsedTime}ms, 节点=${lastNodeId}`
          );
        }
      }
    } catch (error) {
      logger.warn("更新标签页活跃时间失败:", error);
    }
  }

  /**
   * 判断是否为新弹出窗口
   */
  private isNewPopupWindow(tabId: number): boolean {
    // 此方法可以通过检查标签页所在窗口的属性来确定
    // 目前使用简单实现，未来可以扩展
    return false;
  }

  /**
   * 判断当前导航是否应该作为根节点
   * 根节点是指没有父节点的导航
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
   * 获取当前会话信息
   */
  public async getCurrentSession(): Promise<BrowsingSession | null> {
    const currentSession = await this.sessionStorage.getCurrentSession();
    return currentSession ? currentSession : null;
  }

  /**
   * 获取记录总数
   */
  public async getNodeCount(): Promise<number> {
    try {      
      // 查询节点总数
      const nodes = await this.navigationStorage.queryNodes({
        sessionId: this.currentSessionId
      });
      
      return nodes.length;
    } catch (error) {
      logger.error('获取记录数量失败:', error);
      return 0;
    }
  }

  /**
   * 获取当前会话的边数
   */
  public async getEdgeCount(): Promise<number> {
    return this.edgeTracker.getEdgeCount(this.currentSessionId);
  }

  /**
   * 获取当前活跃的节点
   * 返回每个标签页最后访问的节点
   */
  public async getActiveNodes(): Promise<NavNode[]> {
    return this.nodeTracker.getActiveNodes();
  }

  /**
   * 获取标签页的导航历史
   */
  public async getTabHistory(tabId: number): Promise<NavNode[]> {
    try {
      const history = this.tabStateManager.getTabHistory(tabId);
      const records: NavNode[] = [];

      for (const nodeId of history) {
        const record = await this.navigationStorage.getNode(nodeId);
        if (record) {
          records.push(record);
        }
      }

      return records;
    } catch (error) {
      logger.error(`获取标签页[${tabId}]历史失败:`, error);
      return [];
    }
  }

  /**
   * 注册消息处理程序
   * 修改所有方法调用使用正确的存储实例
   */
  private registerMessageHandlers(service: BackgroundMessageService): void {
    // 获取节点ID请求
    service.registerHandler('getNodeId', (
      message: BackgroundMessages.GetNodeIdRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.GetNodeIdResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      const handleRequest = async () => {
        try {
          const { tabId, url, referrer, timestamp } = message;
          
          // 获取或创建节点
          const node = await this.nodeTracker.getOrCreateNodeForUrl(url, {
            tabId,
            referrer: referrer || '',  // 如果客户端没遵循新类型，提供默认值作为后备
            timestamp: timestamp || Date.now()  // 如果客户端没遵循新类型，提供默认值作为后备
          });
          
          if (node && node.id) {
            logger.log(`为URL分配节点ID: ${url} -> ${node.id}`);
            ctx.success({ nodeId: node.id });
          } else {
            ctx.error('无法创建节点');
          }
        } catch (error) {
          logger.error('处理getNodeId失败:', error);
          ctx.error(`获取节点ID失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      
      // 执行异步处理
      handleRequest();
      
      return true; // 异步响应
    });

    // 页面加载请求
    service.registerHandler('pageLoaded', (
      message: BackgroundMessages.PageLoadedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.PageLoadedResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      const tabId = sender.tab?.id;
      const pageInfo = message.pageInfo || {};
      const url = pageInfo.url || sender.tab?.url || '';
      
      if (!tabId || !url) {
        return ctx.error('缺少必要的页面信息');
      }
      
      if (this.debugMode) {
        logger.log(`处理页面加载事件: 标签页=${tabId}, URL=${url}`);
      }
      
      this.nodeTracker.updatePageMetadata(tabId, {
        ...pageInfo,
        url: url
      })
        .then(nodeId => {
          if (nodeId) {
            return ctx.success({ nodeId });
          } else {
            return ctx.error('未找到此页面的节点ID');
          }
        })
        .catch(error => ctx.error(`处理页面加载失败: ${error instanceof Error ? error.message : String(error)}`));
        
      return true; // 异步响应
    });
    
    // 页面标题更新请求
    service.registerHandler('pageTitleUpdated', (
      message: BackgroundMessages.PageTitleUpdatedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.PageTitleUpdatedResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      // 获取节点ID，优先使用消息中的，或者尝试查找
      const handleUpdate = async () => {
        try {
          let nodeId = message.nodeId;
          
          // 如果没有提供节点ID，尝试查找
          if (!nodeId) {
            const tabId = sender.tab?.id;
            const url = sender.tab?.url;
            
            if (!tabId || !url) {
              return ctx.error('无法确定标签页信息');
            }
            
            const result = await this.nodeTracker.getNodeIdForTab(tabId, url);
            if (!result) {
              return ctx.error('未找到节点ID');
            }
            nodeId = result;
          }
          
          // 更新标题
          await this.nodeTracker.updateNodeMetadata(
            nodeId,
            { title: message.title },
            'content_script'
          );
          return ctx.success();
        } catch (error) {
          return ctx.error(`更新页面标题失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      
      handleUpdate();
      return true; // 异步响应
    });
    
    // favicon 更新请求
    service.registerHandler('faviconUpdated', (
      message: BackgroundMessages.FaviconUpdatedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.FaviconUpdatedResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      const handleUpdate = async () => {
        try {
          let nodeId = message.nodeId;
          
          // 如果没有提供节点ID，尝试查找
          if (!nodeId) {
            const tabId = sender.tab?.id;
            const url = sender.tab?.url;
            
            if (!tabId || !url) {
              return ctx.error('无法确定标签页信息');
            }
            
            const result = await this.nodeTracker.getNodeIdForTab(tabId, url);
            if (!result) {
              return ctx.error('未找到节点ID');
            }
            nodeId = result;
          }
          
          // 更新favicon
          await this.nodeTracker.updateNodeMetadata(
            nodeId,
            { favicon: message.faviconUrl },
            'content_script'
          );
          return ctx.success();
        } catch (error) {
          return ctx.error(`更新页面图标失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      
      handleUpdate();
      return true; // 异步响应
    });
    
    // 页面活动消息
    service.registerHandler('pageActivity', (
      message: BackgroundMessages.PageActivityRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.PageActivityResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      if (this.debugMode) {
        logger.log(
          "收到页面活动消息:",
          message.source || "unknown source",
          message.timestamp
            ? new Date(message.timestamp).toLocaleTimeString()
            : "unknown time"
        );
      }
      
      // 这里可以添加更多处理逻辑，例如更新节点的最后访问时间
      
      return ctx.success({ acknowledged: true });
    });
    
    // 链接点击请求
    service.registerHandler('linkClicked', (
      message: BackgroundMessages.LinkClickedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.LinkClickedResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      if (message.linkInfo) {
        try {
          const { sourcePageId, sourceUrl, targetUrl, anchorText, isNewTab, timestamp } = message.linkInfo;
          
          // 处理链接点击，始终使用值，不需要检查是否存在
          this.handleLinkClick({
            sourcePageId,
            sourceUrl, 
            targetUrl,
            anchorText: anchorText || '',  // 如果客户端没遵循新类型，提供默认值作为后备
            isNewTab: isNewTab ?? false,   // 使用空值合并运算符处理布尔型属性
            timestamp: timestamp || Date.now()  // 如果客户端没遵循新类型，提供默认值作为后备
          });
          
          ctx.success();
        } catch (error) {
          logger.error('处理链接点击失败:', error);
          ctx.error(`处理链接点击失败: ${error instanceof Error ? error.message : String(error)}`);
        }
        return false;
      } else {
        ctx.error('缺少链接信息');
        return false;
      }
    });
    
    // 表单提交请求
    service.registerHandler('formSubmitted', (
      message: BackgroundMessages.FormSubmittedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.FormSubmittedResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      const tabId = sender.tab?.id;
      if (!tabId) {
        ctx.error('无法确定标签页ID');
        return false; // 同步响应
      }
      
      if (!message.formInfo) {
        ctx.error('缺少表单信息');
        return false; // 同步响应
      }
      
      try {
        this.handleFormSubmitted(tabId, message.formInfo);
        ctx.success();
      } catch (error) {
        logger.error('处理表单提交失败:', error);
        ctx.error(`处理表单提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false; // 同步响应
    });
    
    // JS导航请求
    service.registerHandler('jsNavigation', (
      message: BackgroundMessages.JsNavigationRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.JsNavigationResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      const tabId = sender.tab?.id;
      if (!tabId) {
        return ctx.error('无法确定标签页ID');
      }
      
      try {
        this.handleJsNavigation(tabId, message);
        return ctx.success();
      } catch (error) {
        logger.error('处理JS导航失败:', error);
        return ctx.error(`处理JS导航失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  
  /**
   * 为导航树中的节点标记更新状态
   */
  private markUpdatedNodes(treeData: { nodes: any[]; edges: any[] }, lastUpdateTime: number): void {
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
   * 重置导航状态
   */
  private resetNavigationState(): void {
    // 重置标签页状态管理器
    this.tabStateManager.reset();
    
    // 重置节点追踪器
    this.nodeTracker.reset();
    
    // 重置边追踪器
    this.edgeTracker.reset();
    
    // 重置待处理导航追踪器
    this.pendingNavigationTracker.reset();
    
    logger.log('已重置导航管理器内部状态');
  }
}