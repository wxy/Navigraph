import { NavigationStorage } from './lib/storage.js';
import { IdGenerator } from './lib/id-generator.js';
import { BackgroundMessageService } from './messaging/bg-message-service.js';
import { BackgroundMessages, BackgroundResponses } from '../types/messages/background.js';
import { 
  NavigationRecord,
  NavigationEdge,
  NavigationType,
  OpenTarget,
  BrowsingSession,
  ExtendedCommittedDetails, 
  ExtendedCompletedDetails,
  ExtendedTransitionDetails,
  TabState,
  PendingNavigation
} from './types/webext.js';

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
  // 存储引用
  private storage: NavigationStorage;

  // 标签页追踪状态
  private tabStates = new Map<number, TabState>();
  private tabNavigationHistory = new Map<number, string[]>(); // 标签页ID -> 节点ID数组
  private removedTabs = new Set<number>();
  private tabActiveTimes = new Map<number, number>(); // 标签页激活时间记录

  // 待处理的数据
  private pendingUpdates = new Map<number, string[]>(); // 标签页ID -> 待更新节点ID数组
  private pendingJsNavigations = new Map<
    number,
    { from: string; to: string }[]
  >(); // 标签页ID -> JS导航记录
  private pendingNavigations = new Map<string, PendingNavigation[]>(); // URL -> 待处理导航数组

  // 临时存储的信息
  private tabNodeIdCache = new Map<string, string>(); // "tabId-url" -> 节点ID
  private urlToNodeCache = new Map<
    string,
    { nodeId: string; timestamp: number }
  >(); // URL -> {节点ID, 时间戳}

  // 其他状态追踪
  private navigationSequence = 0;
  private expirationTime = 10000; // 待处理导航的过期时间（毫秒）
  private historyLimit = 50; // 每个标签页的历史记录限制

  // 调试标志
  private debugMode = false;


  /**
   * 构造函数 - 初始化导航管理器
   * @param messageService 消息服务实例（通过依赖注入）
   */
  constructor(messageService: BackgroundMessageService) {

    // 创建存储实例
    this.storage = new NavigationStorage();

    // 设置定期清理任务
    setInterval(() => this.cleanupPendingUpdates(), 60000); // 每分钟清理一次待更新列表
    setInterval(() => this.cleanupExpiredNavigations(), 30000); // 每30秒清理一次过期导航

    // 初始化事件侦听器
    this.setupEventListeners();

    // 注册消息处理程序
    this.registerMessageHandlers(messageService);

    console.log("导航管理器已初始化");
  }

  /**
   * 设置调试模式
   */
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    console.log(`导航管理器调试模式: ${enabled ? "已启用" : "已禁用"}`);
  }

  /**
   * 获取存储实例
   */
  public getStorage(): NavigationStorage {
    return this.storage;
  }

  /**
   * 初始化存储和会话
   */
  public async initialize(): Promise<void> {
    try {
      console.log("初始化导航管理器存储...");
      await this.storage.initialize();

      // 获取当前会话，如果不存在则创建一个
      const currentSession = await this.storage.getCurrentSession();
      if (!currentSession) {
        console.log("创建新的浏览会话...");
        await this.storage.createSession();
      }

      console.log("导航管理器初始化完成");
      return Promise.resolve();
    } catch (error) {
      console.error("导航管理器初始化失败:", error);
      return Promise.reject(error);
    }
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

    console.log("导航事件监听器已设置");
  }
  /**
   * 处理标签页创建事件
   */
  private async handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
    try {
      const tabId = tab.id;
      if (!tabId) return;

      // 记录标签页创建时间
      this.addTabState(tabId, {
        id: tabId,
        url: tab.url || "",
        title: tab.title,
        created: Date.now(),
      });

      if (this.debugMode) {
        console.log(`标签页创建: ID=${tabId}, URL=${tab.url || "空"}`);
      }

      // 如果创建时已有URL，且不是空白页或新标签页，尝试创建初始导航记录
      const url = tab.url || "";
      if (url && !this.isEmptyTabUrl(url) && !this.isSystemPage(url)) {
        // 获取可能的opener标签页作为父节点来源
        let parentNodeId = "";
        if (tab.openerTabId) {
          const openerState = this.tabStates.get(tab.openerTabId);
          if (openerState && openerState.lastNodeId) {
            parentNodeId = openerState.lastNodeId;
          }
        }

        // 创建一个初始导航节点
        await this.handleInitialNavigation(tabId, url, parentNodeId);
      }
    } catch (error) {
      console.error("处理标签页创建失败:", error);
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
      const nodeIds = this.pendingUpdates.get(tabId) || [];
      if (nodeIds.length === 0) {
        return;
      }

      if (this.debugMode) {
        console.log(
          `标签页更新: ID=${tabId}, 标题=${changeInfo.title || "没变"}, 图标=${
            changeInfo.favIconUrl ? "已更新" : "没变"
          }`
        );
      }

      // 使用统一方法更新元数据
      for (const nodeId of nodeIds) {
        await this.updateNodeMetadata(
          nodeId,
          {
            title: changeInfo.title,
            favicon: changeInfo.favIconUrl,
          },
          "chrome_api"
        );
      }

      // 更新标签页状态
      const tabState = this.tabStates.get(tabId);
      if (tabState) {
        if (changeInfo.title) {
          tabState.title = changeInfo.title;
        }
        if (changeInfo.favIconUrl) {
          tabState.favicon = changeInfo.favIconUrl;
        }
      }

      // 清理已更新的节点
      this.pendingUpdates.delete(tabId);
    } catch (error) {
      console.error("处理标签页更新失败:", error);
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
      // 更新之前活跃标签页的活跃时间
      const previousActiveTime = this.tabActiveTimes.get(tabId);
      if (previousActiveTime) {
        const activeTabId = Array.from(this.tabActiveTimes.entries()).find(
          ([id, time]) => time === previousActiveTime && id !== tabId
        )?.[0];

        if (activeTabId) {
          const elapsedTime = now - previousActiveTime;
          this.updateTabActiveTime(activeTabId, elapsedTime);
        }
      }

      // 记录当前标签页的激活时间
      this.tabActiveTimes.set(tabId, now);

      // 更新标签页状态
      const tabState = this.tabStates.get(tabId);
      if (tabState) {
        tabState.activated = now;
        tabState.lastActiveTime = now;
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

          this.addTabState(tabId, {
            id: tabId,
            url: tab.url || "",
            title: tab.title,
            activated: now,
            lastActiveTime: now,
          });

          if (this.debugMode) {
            console.log(
              `标签页激活: ID=${tabId}, 窗口=${windowId}, URL=${
                tab.url || "未知"
              }`
            );
          }
        } catch (err) {
          console.warn(
            `获取标签页信息失败: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    } catch (error) {
      console.error("处理标签页激活失败:", error);
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
      // 记录最后一次活跃时间
      const activeTime = this.tabActiveTimes.get(tabId);
      if (activeTime) {
        const elapsedTime = Date.now() - activeTime;
        this.updateTabActiveTime(tabId, elapsedTime);
        this.tabActiveTimes.delete(tabId);
      }

      // 标记所有此标签页的节点为关闭状态
      const history = this.tabNavigationHistory.get(tabId) || [];
      for (const nodeId of history) {
        try {
          const record = await this.storage.getRecord(nodeId);
          if (record && !record.isClosed) {
            await this.storage.updateRecord(nodeId, { isClosed: true });
          }
        } catch (e) {
          console.warn(`更新节点关闭状态失败: ${nodeId}`, e);
        }
      }

      // 清理标签页相关数据
      this.tabStates.delete(tabId);
      this.tabNavigationHistory.delete(tabId);
      this.pendingUpdates.delete(tabId);
      this.pendingJsNavigations.delete(tabId);
      this.removedTabs.add(tabId);

      if (this.debugMode) {
        console.log(
          `标签页关闭: ID=${tabId}, 窗口=${removeInfo.windowId}, 窗口关闭=${removeInfo.isWindowClosing}`
        );
      }
    } catch (error) {
      console.error("处理标签页移除失败:", error);
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
        this.isErrorPage(details.url) ||
        this.isSystemPage(details.url)
      ) {
        return;
      }

      const tabId = details.tabId;
      if (this.removedTabs.has(tabId)) {
        if (this.debugMode) {
          console.log(`忽略已关闭标签页的导航: ${tabId}`);
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
        console.log(
          `导航提交: 标签页=${tabId}, URL=${url}, 类型=${navigationType}, 目标=${openTarget}`
        );
        console.log(`  - 过渡类型: ${transitionType}`);
        console.log(
          `  - 过渡限定词: ${transitionQualifiers.join(", ") || "无"}`
        );
      }

      // 处理常规导航
      await this.handleRegularNavigation(details, navigationType, openTarget);
    } catch (error) {
      console.error("处理导航提交事件失败:", error);
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
      if (this.isEmptyTabUrl(url)) {
        return;
      }

      // 1. 尝试查找上一个节点作为父节点
      let parentId = await this.findLastNodeIdForTab(tabId);

      // 2. 查找待处理导航
      const pendingNav = this.getPendingNavigationForUrl(url, tabId);

      if (pendingNav) {
        // 使用待处理导航信息设置父节点和导航类型
        navigationType = pendingNav.type;
        if (pendingNav.sourceNodeId) {
          parentId = pendingNav.sourceNodeId;
        }
        if (this.debugMode) {
          console.log(
            `找到匹配的待处理导航: ${pendingNav.type}, 父节点ID: ${parentId}`
          );
        }
      }

      // 3. 如果是JS导航，尝试找到更好的父节点
      if (navigationType === "javascript") {
        const pendingJsNavs = this.pendingJsNavigations.get(tabId) || [];
        if (pendingJsNavs.length > 0) {
          // 标准化URL以便比较
          const normalizedUrl = this.normalizeUrl(url);

          // 查找匹配的JS导航
          for (let i = pendingJsNavs.length - 1; i >= 0; i--) {
            const jsNav = pendingJsNavs[i];
            const normalizedToUrl = this.normalizeUrl(jsNav.to);

            if (normalizedToUrl === normalizedUrl) {
              // 找到匹配的JS导航，从当前标签页的节点历史中查找源节点
              const history = this.tabNavigationHistory.get(tabId) || [];
              let sourceNodeId = null;
              for (const id of history) {
                if (await this.isSameNodeUrl(id, jsNav.from)) {
                  sourceNodeId = id;
                  break;
                }
              }

              if (sourceNodeId) {
                parentId = sourceNodeId;
                if (this.debugMode) {
                  console.log(`找到JS导航的父节点: ${parentId}`);
                }

                // 移除已使用的JS导航记录
                pendingJsNavs.splice(i, 1);
                break;
              }
            }
          }

          // 更新JS导航列表
          this.pendingJsNavigations.set(tabId, pendingJsNavs);
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
      this.addToTabNavigationHistory(tabId, nodeId);

      // 7. 更新标签页状态
      this.updateTabState(tabId, {
        url: url,
        lastNodeId: nodeId,
        lastNavigation: now,
      });

      // 8. 添加到待更新列表
      this.addToPendingUpdates(tabId, nodeId);

      // 9. 更新缓存
      this.tabNodeIdCache.set(`${tabId}-${url}`, nodeId);

      // 10. 创建导航记录
      const record: NavigationRecord = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: now,
        sessionId: (await this.storage.getCurrentSession()).id,
        parentId: parentId || "",
        navigationType: navigationType,
        openTarget: openTarget,
        source: "chrome_api",
        firstVisit: now,
        lastVisit: now,
        visitCount: 1,
        reloadCount: 0,
        frameId: details.frameId,
        parentFrameId: details.parentFrameId,
      };

      // 11. 根据导航类型设置其他字段
      if (navigationType === "reload") {
        // 对于刷新，查找之前的记录并更新计数
        if (parentId) {
          const parentRecord = await this.storage.getRecord(parentId);
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
            record.favicon = await this.getFavicon(url, tab.favIconUrl);
          }
        }
      } catch (e) {
        console.warn(`无法获取标签页信息用于导航记录:`, e);
      }

      // 13. 保存记录
      await this.storage.saveRecord(record);

      // 14. 如果存在父节点，创建边
      if (parentId) {
        await this.createNavigationEdge(parentId, nodeId, now, navigationType);
      }

      if (this.debugMode) {
        console.log(
          `已创建导航节点: ID=${nodeId}, 父节点=${
            parentId || "无"
          }, 类型=${navigationType}`
        );
      }
    } catch (error) {
      console.error("处理常规导航失败:", error);
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
        this.isErrorPage(details.url) ||
        this.isSystemPage(details.url)
      ) {
        return;
      }

      // 获取标签页信息，包括标题
      const tabId = details.tabId;
      const url = details.url;

      if (this.removedTabs.has(tabId)) {
        return;
      }

      if (this.debugMode) {
        console.log(`导航完成: 标签页=${tabId}, URL=${url}`);
      }

      // 获取节点ID
      const nodeId = await this.getNodeIdForTab(tabId, url);
      if (!nodeId) {
        if (this.debugMode) {
          console.log(`未找到导航完成的节点ID: 标签页=${tabId}, URL=${url}`);
        }
        return;
      }

      // 获取增强版favicon
      const tab = await chrome.tabs.get(tabId);
      const favicon = await this.getFavicon(url, tab.favIconUrl);

      // 获取记录
      const record = await this.storage.getRecord(nodeId);

      // 计算加载时间
      let loadTime: number | undefined = undefined;
      if (record && record.timestamp) {
        loadTime = Date.now() - record.timestamp;
        if (this.debugMode) {
          console.log(`计算加载时间: ${loadTime}ms (当前时间 - 节点创建时间)`);
        }
      }

      // 使用统一方法更新元数据
      await this.updateNodeMetadata(
        nodeId,
        {
          title: tab.title,
          favicon: favicon,
          loadTime: loadTime,
        },
        "navigation_event"
      );
    } catch (error) {
      console.error("处理导航完成失败:", error);
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
        this.isErrorPage(details.url) ||
        this.isSystemPage(details.url)
      ) {
        return;
      }

      const tabId = details.tabId;
      const url = details.url;

      if (this.removedTabs.has(tabId)) {
        return;
      }

      // 检查是否已有相同URL的节点
      const existingNodeId = await this.getNodeIdForTab(tabId, url);
      if (existingNodeId) {
        if (this.debugMode) {
          console.log(
            `历史状态更新: 已存在节点 ${existingNodeId} 于URL=${url}`
          );
        }

        // 更新现有节点的访问时间和计数
        const now = Date.now();
        await this.storage.updateRecord(existingNodeId, {
          lastVisit: now,
          visitCount: await this.incrementVisitCount(existingNodeId),
        });

        return;
      }

      // 找到父节点
      const parentId = await this.findLastNodeIdForTab(tabId);

      // 如果没有找到父节点，则忽略
      if (!parentId) {
        if (this.debugMode) {
          console.log(
            `历史状态更新: 未找到父节点, 标签页=${tabId}, URL=${url}`
          );
        }
        return;
      }

      // 创建新节点记录
      const now = Date.now();
      const nodeId = IdGenerator.generateNodeId(tabId, url);

      // 记录节点ID到标签页历史
      this.addToTabNavigationHistory(tabId, nodeId);

      // 更新标签页状态
      this.updateTabState(tabId, {
        url: url,
        lastNodeId: nodeId,
        lastNavigation: now,
      });

      // 添加到待更新列表
      this.addToPendingUpdates(tabId, nodeId);

      // 更新缓存
      this.tabNodeIdCache.set(`${tabId}-${url}`, nodeId);

      // 获取标签页信息
      let title: string | undefined;
      let favicon: string | undefined;

      try {
        const tab = await chrome.tabs.get(tabId);
        title = tab.title;
        favicon = tab.favIconUrl;

        if (!favicon) {
          favicon = await this.getFavicon(url, tab.favIconUrl);
        }
      } catch (e) {
        console.warn("获取标签页信息失败:", e);
      }

      // 创建导航记录
      const record: NavigationRecord = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: now,
        sessionId: (await this.storage.getCurrentSession()).id,
        parentId: parentId,
        title: title,
        favicon: favicon,
        navigationType: "javascript",
        openTarget: "same_tab",
        source: "chrome_api",
        firstVisit: now,
        lastVisit: now,
        visitCount: 1,
        reloadCount: 0,
        frameId: details.frameId,
        parentFrameId: details.parentFrameId,
      };

      // 保存记录
      await this.storage.saveRecord(record);

      // 创建边
      await this.createNavigationEdge(parentId, nodeId, now, "javascript");

      if (this.debugMode) {
        console.log(
          `历史状态更新: 已创建节点 ${nodeId}, 父节点=${parentId}, URL=${url}`
        );
      }
    } catch (error) {
      console.error("处理历史状态更新失败:", error);
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
      if (this.isEmptyTabUrl(url) || this.isSystemPage(url)) {
        return null;
      }

      const now = Date.now();

      // 生成新的节点ID
      const nodeId = IdGenerator.generateNodeId(tabId, url);

      // 记录节点ID到标签页历史
      this.addToTabNavigationHistory(tabId, nodeId);

      // 更新标签页状态
      this.updateTabState(tabId, {
        url: url,
        lastNodeId: nodeId,
        lastNavigation: now,
      });

      // 添加到待更新列表
      this.addToPendingUpdates(tabId, nodeId);

      // 更新缓存
      this.tabNodeIdCache.set(`${tabId}-${url}`, nodeId);

      // 获取标签页信息
      let title: string | undefined;
      let favicon: string | undefined;

      try {
        const tab = await chrome.tabs.get(tabId);
        title = tab.title;
        favicon = tab.favIconUrl;

        if (!favicon) {
          favicon = await this.getFavicon(url, tab.favIconUrl);
        }
      } catch (e) {
        console.warn("获取标签页信息失败:", e);
      }

      // 创建导航记录
      const record: NavigationRecord = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: now,
        sessionId: (await this.storage.getCurrentSession()).id,
        parentId: parentNodeId,
        title: title,
        favicon: favicon,
        navigationType: "initial",
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
      await this.storage.saveRecord(record);

      // 如果存在父节点，创建边
      if (parentNodeId) {
        await this.createNavigationEdge(parentNodeId, nodeId, now, "initial");
      }

      if (this.debugMode) {
        console.log(
          `已创建初始导航节点: ID=${nodeId}, 父节点=${parentNodeId || "无"}`
        );
      }

      return nodeId;
    } catch (error) {
      console.error("处理初始导航失败:", error);
      return null;
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
      id: IdGenerator.generateEdgeId(sourceId, targetId, timestamp),
      sourceId,
      targetId,
      timestamp,
      action: navigationType,
      sequence: this.navigationSequence,
      sessionId: session.id,
    };

    // 保存边
    await this.storage.saveEdge(edge);

    return edge;
  }
  private cleanupExpiredNavigations(): void {
    const now = Date.now();
    let removedCount = 0;

    // 创建待删除URL的列表，避免在迭代过程中修改集合
    const urlsToDelete: string[] = [];

    for (const [url, navigations] of this.pendingNavigations.entries()) {
      const validNavigations = navigations.filter((nav) => nav.expiresAt > now);
      removedCount += navigations.length - validNavigations.length;

      if (validNavigations.length === 0) {
        urlsToDelete.push(url);
      } else {
        this.pendingNavigations.set(url, validNavigations);
      }
    }

    // 删除空的导航列表
    for (const url of urlsToDelete) {
      this.pendingNavigations.delete(url);
    }

    if (removedCount > 0 && this.debugMode) {
      console.log(`已清理 ${removedCount} 个过期的待处理导航`);
    }
  }

  /**
   * 清理待更新列表
   */
  private async cleanupPendingUpdates(): Promise<void> {
    try {
      // 获取当前会话
      const session = await this.storage.getCurrentSession();

      // 查询所有记录
      const records = await this.storage.queryRecords({
        sessionId: session.id,
      });

      // 创建一个节点ID集合，用于快速查找
      const validNodeIds = new Set(records.map((record) => record.id));

      let totalRemoved = 0;

      // 遍历所有标签页的待更新列表
      for (const [tabId, nodeIds] of this.pendingUpdates.entries()) {
        // 保留在当前会话中存在的节点
        const validIds = nodeIds.filter((id) => validNodeIds.has(id));

        if (validIds.length !== nodeIds.length) {
          totalRemoved += nodeIds.length - validIds.length;
          this.pendingUpdates.set(tabId, validIds);
        }
      }

      if (totalRemoved > 0 && this.debugMode) {
        console.log(
          `自动清理完成，从待更新列表中移除了 ${totalRemoved} 个无效节点`
        );
      }
    } catch (error) {
      console.error("清理待更新列表失败:", error);
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
      const { sourcePageId, sourceUrl, targetUrl, anchorText, isNewTab, timestamp } = linkInfo;
      
      // 创建一个待处理的导航记录，稍后当用户访问目标URL时会自动关联
      const expiresAt = timestamp + this.expirationTime;
      
      // 创建一个待处理导航记录
      const pendingNav: PendingNavigation = {
        type: "link_click",
        sourceNodeId: sourcePageId,
        sourceUrl: sourceUrl,
        targetUrl: targetUrl,
        data: {
          anchorText: anchorText,
          isNewTab: isNewTab
        },
        timestamp: timestamp,
        expiresAt: expiresAt,
        // 如果知道源标签页ID，可以从linkInfo中获取并添加
        sourceTabId: 0 // 此处可能需要从上下文中获取tabId
      };
      
      // 添加到待处理导航列表
      const normalizedUrl = this.normalizeUrl(targetUrl);
      if (!this.pendingNavigations.has(normalizedUrl)) {
        this.pendingNavigations.set(normalizedUrl, []);
      }
      this.pendingNavigations.get(normalizedUrl)?.push(pendingNav);
      
      // 如果目标是在新标签页打开，记录这个信息
      if (isNewTab) {
        pendingNav.isNewTab = true;
      }
      
      // 记录到控制台
      if (this.debugMode) {
        console.log(
          `记录链接点击: 从[${sourceUrl}](${sourcePageId}) -> 到[${targetUrl}], ` +
          `文本="${anchorText}", 新标签页=${isNewTab}`
        );
      } else {
        console.log(`记录链接点击: ${sourceUrl} -> ${targetUrl}`);
      }
    } catch (error) {
      console.error('处理链接点击失败:', error);
    }
  }

  /**
   * 处理表单提交事件
   * 内容脚本发送的事件
   */
  public handleFormSubmitted(tabId: number, formInfo: any): void {
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
      expiresAt,
    };

    // 添加到待处理列表 - 使用标签页ID作为键
    const key = `tab:${tabId}`;
    if (!this.pendingNavigations.has(key)) {
      this.pendingNavigations.set(key, []);
    }
    this.pendingNavigations.get(key)?.push(pendingNav);

    if (this.debugMode) {
      console.log(
        `表单提交: ${formInfo.sourceUrl} -> ${formInfo.formAction} (源节点: ${formInfo.sourcePageId})`
      );
    }
  }

  /**
   * 处理JS导航事件
   * 内容脚本发送的事件
   */
  public handleJsNavigation(tabId: number, message: any): void {
    if (!message || !tabId) return;

    // 记录JavaScript导航以用于确定父子关系
    const jsNavRecord = {
      from: message.sourceUrl,
      to: message.targetUrl,
    };

    if (!this.pendingJsNavigations.has(tabId)) {
      this.pendingJsNavigations.set(tabId, []);
    }

    // 添加到JS导航记录列表，限制大小
    const jsNavs = this.pendingJsNavigations.get(tabId) || [];
    jsNavs.push(jsNavRecord);

    // 保持列表不超过10项
    if (jsNavs.length > 10) {
      jsNavs.shift();
    }

    this.pendingJsNavigations.set(tabId, jsNavs);

    // 同时也加入待处理导航
    const expiresAt = Date.now() + this.expirationTime;

    // 生成待处理导航记录
    const pendingNav: PendingNavigation = {
      type: "javascript",
      sourceNodeId: message.sourcePageId,
      sourceTabId: tabId,
      sourceUrl: message.sourceUrl,
      targetUrl: message.targetUrl,
      data: message,
      timestamp: message.timestamp || Date.now(),
      expiresAt,
    };

    // 添加到待处理列表
    const targetUrl = this.normalizeUrl(message.targetUrl);
    if (!this.pendingNavigations.has(targetUrl)) {
      this.pendingNavigations.set(targetUrl, []);
    }
    this.pendingNavigations.get(targetUrl)?.push(pendingNav);

    if (this.debugMode) {
      console.log(
        `JS导航: ${message.sourceUrl} -> ${targetUrl} (源节点: ${message.sourcePageId})`
      );
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
              console.warn(`无法将相对路径转换为绝对URL: ${redirectUrl}`);
            }
          }
        }
      }
      
      // 如果找不到重定向URL，退出
      if (!redirectUrl) {
        if (this.debugMode) {
          console.log(`重定向事件没有目标URL: ${details.url}, 状态码: ${details.statusCode}`);
        }
        return;
      }

      // 检查是否为系统页面
      if (this.isSystemPage(redirectUrl)) {
        return;
      }

      const tabId = details.tabId;
      const sourceUrl = details.url;
      const targetUrl = redirectUrl;

      if (this.debugMode) {
        console.log(
          `重定向: 标签页=${tabId}, 从=${sourceUrl}, 到=${targetUrl}, 状态码=${details.statusCode}`
        );
      }

      // 其余代码保持不变...
      // ... 处理重定向节点的创建 ...
    } catch (error) {
      console.error("处理重定向事件失败:", error);
    }
  }

  /**
   * 更新节点元数据
   */
  public async updateNodeMetadata(
    nodeId: string,
    metadata: {
      title?: string;
      favicon?: string;
      referrer?: string;
      loadTime?: number;
      description?: string;
      keywords?: string;
    },
    source: "chrome_api" | "content_script" | "navigation_event" = "chrome_api"
  ): Promise<void> {
    if (!nodeId) {
      console.warn("更新元数据失败: 无效的节点ID");
      return;
    }

    try {
      // 获取现有记录
      const record = await this.storage.getRecord(nodeId);
      if (!record) {
        console.warn(`未找到节点 ${nodeId}，无法更新元数据`);
        return;
      }

      // 准备更新对象
      const updates: Partial<NavigationRecord> = {};

      // 标题处理 - 应用优先级策略
      if (metadata.title) {
        if (!record.title) {
          // 如果没有现有标题，直接使用新标题
          updates.title = metadata.title;
        } else if (
          source === "content_script" &&
          (record.title.length < metadata.title.length ||
            record.title.includes("New Tab") ||
            record.title.includes("Untitled"))
        ) {
          // 内容脚本提供的更长/更有意义的标题优先
          updates.title = metadata.title;
        } else if (
          source === "chrome_api" &&
          record.source === "navigation_event"
        ) {
          // Chrome API 提供的标题覆盖导航事件的标题
          updates.title = metadata.title;
        }

        if (updates.title && this.debugMode) {
          console.log(`更新标题: ${record.title || "无"} -> ${updates.title}`);
        }
      }

      // Favicon处理 - 应用优先级策略
      if (metadata.favicon) {
        const useFavicon =
          !record.favicon ||
          (source === "content_script" &&
            record.favicon.includes("google.com/s2/favicons")) ||
          (source === "chrome_api" && record.source === "navigation_event");

        if (useFavicon) {
          updates.favicon = metadata.favicon;
          if (this.debugMode) {
            console.log(
              `更新Favicon: ${record.favicon ? "已有图标" : "无图标"} -> 新图标`
            );
          }
        }
      }

      // 引用信息处理 - 只在没有父节点时使用
      if (metadata.referrer && (!record.parentId || record.parentId === "")) {
        // 存储引用信息
        updates.referrer = metadata.referrer;

        // 尝试基于引用信息查找父节点
        if (this.shouldUseReferrerForParent(record)) {
          const potentialParentId = await this.findNodeByUrl(metadata.referrer);
          if (potentialParentId && potentialParentId !== nodeId) {
            if (!(await this.wouldCreateCycle(potentialParentId, nodeId))) {
              updates.parentId = potentialParentId;
              if (this.debugMode) {
                console.log(`基于引用信息更新父节点: ${potentialParentId}`);
              }

              // 创建导航边
              await this.createNavigationEdge(
                potentialParentId,
                nodeId,
                Date.now(),
                "link_click"
              );
            } else {
              if (this.debugMode) {
                console.warn(
                  `基于引用信息的父节点 ${potentialParentId} -> ${nodeId} 会导致循环，已阻止`
                );
              }
            }
          }
        }
      }

      // 其他元数据处理
      if (metadata.description) updates.description = metadata.description;
      if (metadata.keywords) updates.keywords = metadata.keywords;
      if (metadata.loadTime && !record.loadTime)
        updates.loadTime = metadata.loadTime;

      // 记录更新来源 - 只在特定情况下更新
      if (
        !record.source ||
        (source === "content_script" && record.source === "chrome_api")
      ) {
        updates.source = source;
      }

      // 应用更新
      if (Object.keys(updates).length > 0) {
        await this.storage.updateRecord(nodeId, updates);
        if (this.debugMode) {
          console.log(`已更新节点[${nodeId}]元数据，来源:${source}`);
        }
      }
    } catch (error) {
      console.error("更新节点元数据失败:", error);
    }
  }

  /**
   * 从内容脚本请求获取元数据
   */
  public async updatePageMetadata(
    tabId: number,
    metadata: any
  ): Promise<string | null> {
    if (!metadata || !tabId) {
      return null;
    }

    const url = metadata.url;
    if (!url) {
      return null;
    }

    // 获取节点ID
    const nodeId = await this.getNodeIdForTab(tabId, url);

    if (!nodeId) {
      if (this.debugMode) {
        console.log(`未找到标签页${tabId}的节点ID: ${url}，不更新元数据`);
      }
      return null;
    }

    // 使用统一方法更新元数据
    await this.updateNodeMetadata(
      nodeId,
      {
        title: metadata.title,
        favicon: metadata.favicon,
        referrer: metadata.referrer,
        loadTime: metadata.loadTime,
        description: metadata.description,
        keywords: metadata.keywords,
      },
      "content_script"
    );

    return nodeId;
  }
  /**
   * 获取标签页的节点ID
   */
  public async getNodeIdForTab(
    tabId: number,
    url: string
  ): Promise<string | null> {
    // 1. 首先尝试从缓存获取
    const cacheKey = `${tabId}-${url}`;
    const cachedId = this.tabNodeIdCache.get(cacheKey);
    if (cachedId) {
      return cachedId;
    }

    // 2. 再尝试从导航历史中找到最匹配的节点
    const history = this.tabNavigationHistory.get(tabId) || [];

    // 倒序查找，优先使用最近的节点
    for (let i = history.length - 1; i >= 0; i--) {
      const nodeId = history[i];
      if (await this.isSameNodeUrl(nodeId, url)) {
        return nodeId;
      }
    }

    // 3. 最后尝试找标签页状态的最后节点
    const tabState = this.tabStates.get(tabId);
    if (
      tabState &&
      tabState.lastNodeId &&
      tabState.url &&
      this.isSameUrl(tabState.url, url)
    ) {
      return tabState.lastNodeId;
    }

    return null;
  }

  /**
   * 查找标签页的最后一个节点ID
   */
  private async findLastNodeIdForTab(tabId: number): Promise<string | null> {
    const history = this.tabNavigationHistory.get(tabId) || [];
    if (history.length > 0) {
      return history[history.length - 1];
    }

    const tabState = this.tabStates.get(tabId);
    if (tabState && tabState.lastNodeId) {
      return tabState.lastNodeId;
    }

    return null;
  }

  /**
   * 通过URL查找节点
   */
  private async findNodeByUrl(url: string): Promise<string | null> {
    if (!url) return null;

    try {
      // 检查缓存
      const normalized = this.normalizeUrl(url);
      const cached = this.urlToNodeCache.get(normalized);
      if (cached && Date.now() - cached.timestamp < 60000) {
        // 1分钟内的缓存有效
        return cached.nodeId;
      }

      // 标准化URL
      const normalizedUrl = this.normalizeUrl(url);

      // 获取当前会话
      const session = await this.storage.getCurrentSession();

      // 查询记录
      const records = await this.storage.queryRecords({
        sessionId: session.id,
      });

      // 首先尝试精确匹配
      let matchingRecord = records.find((r) => r.url === url);

      // 如果没找到，尝试标准化URL匹配
      if (!matchingRecord) {
        matchingRecord = records.find(
          (r) => this.normalizeUrl(r.url) === normalizedUrl
        );
      }

      // 更新缓存
      if (matchingRecord?.id) {
        this.urlToNodeCache.set(normalized, {
          nodeId: matchingRecord.id,
          timestamp: Date.now(),
        });
      }

      return matchingRecord?.id || null;
    } catch (error) {
      console.error("通过URL查找节点失败:", error);
      return null;
    }
  }

  /**
   * 判断两个URL是否匹配
   */
  private isSameUrl(url1: string, url2: string): boolean {
    try {
      return this.normalizeUrl(url1) === this.normalizeUrl(url2);
    } catch (e) {
      return url1 === url2;
    }
  }

  /**
   * 检查节点的URL是否与给定URL匹配
   */
  private async isSameNodeUrl(nodeId: string, url: string): Promise<boolean> {
    try {
      const record = await this.storage.getRecord(nodeId);
      if (!record) return false;

      return this.isSameUrl(record.url, url);
    } catch (e) {
      console.warn(`检查节点URL匹配失败: ${nodeId}`, e);
      return false;
    }
  }

  /**
   * 添加标签页状态
   */
  private addTabState(tabId: number, state: Partial<TabState>): void {
    const existingState = this.tabStates.get(tabId) || { id: tabId, url: "" };
    this.tabStates.set(tabId, { ...existingState, ...state });
  }

  /**
   * 更新标签页状态
   */
  private updateTabState(tabId: number, updates: Partial<TabState>): void {
    const state = this.tabStates.get(tabId);
    if (state) {
      Object.assign(state, updates);
    } else {
      this.addTabState(tabId, { id: tabId, url: "", ...updates });
    }
  }

  /**
   * 添加到标签页导航历史
   */
  private addToTabNavigationHistory(tabId: number, nodeId: string): void {
    if (!this.tabNavigationHistory.has(tabId)) {
      this.tabNavigationHistory.set(tabId, []);
    }

    const history = this.tabNavigationHistory.get(tabId)!;
    history.push(nodeId);

    // 限制历史记录长度
    if (history.length > this.historyLimit) {
      history.shift();
    }
  }

  /**
   * 添加到待更新列表
   */
  private addToPendingUpdates(tabId: number, nodeId: string): void {
    if (!this.pendingUpdates.has(tabId)) {
      this.pendingUpdates.set(tabId, []);
    }

    const updates = this.pendingUpdates.get(tabId)!;
    if (!updates.includes(nodeId)) {
      updates.push(nodeId);
    }
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
      const history = this.tabNavigationHistory.get(tabId) || [];
      if (history.length === 0) return;

      // 更新最后一个节点的活跃时间
      const lastNodeId = history[history.length - 1];
      const record = await this.storage.getRecord(lastNodeId);

      if (record) {
        await this.storage.updateRecord(lastNodeId, {
          activeTime: (record.activeTime || 0) + elapsedTime,
        });

        if (this.debugMode) {
          console.log(
            `更新标签页[${tabId}]活跃时间: +${elapsedTime}ms, 节点=${lastNodeId}`
          );
        }
      }
    } catch (error) {
      console.warn("更新标签页活跃时间失败:", error);
    }
  }

  /**
   * 获取favicon URL
   */
  private async getFavicon(url: string, fallbackUrl?: string): Promise<string> {
    // 如果有回退URL且不是空字符串，直接使用
    if (fallbackUrl && fallbackUrl.trim().length > 0) {
      return fallbackUrl;
    }

    // 使用Google的favicon服务
    try {
      const urlObj = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=128`;
    } catch (e) {
      // 如果URL解析失败，返回一个默认图标
      return "chrome://favicon/";
    }
  }

  /**
   * 查找与URL匹配的待处理导航
   */
  private getPendingNavigationForUrl(
    url: string,
    tabId?: number
  ): PendingNavigation | null {
    // 标准化URL
    const normalizedUrl = this.normalizeUrl(url);

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
          return foundNavigation;
        }
      }
    }

    return null;
  }

  /**
   * 增加节点访问计数
   */
  private async incrementVisitCount(nodeId: string): Promise<number> {
    const record = await this.storage.getRecord(nodeId);
    if (!record) return 1;

    const newCount = (record.visitCount || 0) + 1;
    return newCount;
  }

  /**
   * 标准化URL（移除片段标识符、末尾斜杠等）
   */
  private normalizeUrl(url: string): string {
    try {
      // 移除URL末尾的斜杠和片段标识符
      return url.replace(/\/$/, "").split("#")[0];
    } catch (e) {
      return url;
    }
  }

  /**
   * 判断是否为系统页面
   */
  private isSystemPage(url: string): boolean {
    if (!url) return false;

    // 检查常见的系统页面 URL 模式
    return (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("devtools://") ||
      url.startsWith("about:") ||
      url.startsWith("edge://") ||
      url.startsWith("brave://") ||
      url.startsWith("opera://") ||
      url.startsWith("vivaldi://") ||
      url.startsWith("view-source:") ||
      url.startsWith("file://") ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    );
  }

  /**
   * 判断是否为空白页或新标签页
   */
  private isEmptyTabUrl(url: string): boolean {
    return (
      !url ||
      url === "about:blank" ||
      url === "chrome://newtab/" ||
      url.startsWith("chrome://newtab") ||
      url === "edge://newtab/" ||
      url === "brave://newtab/"
    );
  }

  /**
   * 判断是否为错误页面
   */
  private isErrorPage(url: string): boolean {
    return (
      url.startsWith("chrome-error://") ||
      url.startsWith("chrome://crash") ||
      url.startsWith("chrome://kill")
    );
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
   * 判断是否应该使用引用信息查找父节点
   */
  private shouldUseReferrerForParent(record: NavigationRecord): boolean {
    // 如果是JavaScript导航，或者没有父节点，或者是根节点类型，可以使用引用信息
    return (
      record.navigationType === "javascript" ||
      !record.parentId ||
      record.parentId === "" ||
      !this.shouldBeRootNavigation(record.navigationType, record.url)
    );
  }

  /**
   * 判断添加父子关系是否会导致循环
   */
  private async wouldCreateCycle(
    parentId: string,
    childId: string
  ): Promise<boolean> {
    if (parentId === childId) return true;

    // 检查从childId向上查找是否能找到parentId
    let currentId = parentId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) {
        // 检测到循环
        return true;
      }

      visited.add(currentId);

      const record = await this.storage.getRecord(currentId);
      if (!record || !record.parentId) {
        break;
      }

      if (record.parentId === childId) {
        return true;
      }

      currentId = record.parentId;
    }

    return false;
  }

  /**
   * 获取当前会话信息
   */
  public async getCurrentSession(): Promise<BrowsingSession> {
    return this.storage.getCurrentSession();
  }

  /**
   * 获取记录总数
   */
  public async getNodeCount(): Promise<number> {
    try {
      const session = await this.getStorage().getCurrentSession();
      if (!session || !session.records) {
        return 0;
      }
      return Object.keys(session.records).length;
    } catch (error) {
      console.error('获取记录数量失败:', error);
      return 0;
    }
  }

  /**
   * 获取当前会话的边数
   */
  public async getEdgeCount(): Promise<number> {
    const edges = await this.storage.queryEdges({
      sessionId: (await this.storage.getCurrentSession()).id,
    });

    return edges.length;
  }

  /**
   * 获取当前活跃的节点
   * 返回每个标签页最后访问的节点
   */
  public async getActiveNodes(): Promise<NavigationRecord[]> {
    try {
      const activeNodes: NavigationRecord[] = [];

      for (const [tabId, history] of this.tabNavigationHistory.entries()) {
        if (history.length > 0) {
          const lastNodeId = history[history.length - 1];
          const record = await this.storage.getRecord(lastNodeId);
          if (record) {
            activeNodes.push(record);
          }
        }
      }

      return activeNodes;
    } catch (error) {
      console.error("获取活跃节点失败:", error);
      return [];
    }
  }

  /**
   * 获取标签页的导航历史
   */
  public async getTabHistory(tabId: number): Promise<NavigationRecord[]> {
    try {
      const history = this.tabNavigationHistory.get(tabId) || [];
      const records: NavigationRecord[] = [];

      for (const nodeId of history) {
        const record = await this.storage.getRecord(nodeId);
        if (record) {
          records.push(record);
        }
      }

      return records;
    } catch (error) {
      console.error(`获取标签页[${tabId}]历史失败:`, error);
      return [];
    }
  }

  /**
   * 注册消息处理程序
   * 修改后与内容脚本、扩展页和选项页的交互更加清晰
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
          const node = await this.getOrCreateNodeForUrl(url, {
            tabId,
            referrer: referrer || '',  // 如果客户端没遵循新类型，提供默认值作为后备
            timestamp: timestamp || Date.now()  // 如果客户端没遵循新类型，提供默认值作为后备
          });
          
          if (node && node.id) {
            console.log(`为URL分配节点ID: ${url} -> ${node.id}`);
            ctx.success({ nodeId: node.id });
          } else {
            ctx.error('无法创建节点');
          }
        } catch (error) {
          console.error('处理getNodeId失败:', error);
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
        console.log(`处理页面加载事件: 标签页=${tabId}, URL=${url}`);
      }
      
      this.updatePageMetadata(tabId, {
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
            
            const result = await this.getNodeIdForTab(tabId, url);
            if (!result) {
              return ctx.error('未找到节点ID');
            }
            nodeId = result;
          }
          
          // 更新标题
          await this.updateNodeMetadata(
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
            
            const result = await this.getNodeIdForTab(tabId, url);
            if (!result) {
              return ctx.error('未找到节点ID');
            }
            nodeId = result;
          }
          
          // 更新favicon
          await this.updateNodeMetadata(
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
        console.log(
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
          console.error('处理链接点击失败:', error);
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
        console.error('处理表单提交失败:', error);
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
        console.error('处理JS导航失败:', error);
        return ctx.error(`处理JS导航失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    
    // 获取会话列表请求
    service.registerHandler('getSessions', (
      message: BackgroundMessages.GetSessionsRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.GetSessionsResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      this.getStorage().getSessions()
        .then(sessions => {
          // 创建简化的会话摘要
          const sessionSummaries = Array.isArray(sessions) ? sessions.map(session => ({
            id: session.id,
            title: session.title || session.id,
            startTime: session.startTime,
            endTime: session.endTime || 0,
            recordCount: session.records ? Object.keys(session.records).length : 0
          })) : [];
          
          return ctx.success({ sessions: sessionSummaries });
        })
        .catch(error => {
          console.error('获取会话列表失败:', error);
          return ctx.error(String(error));
        });
      
      return true; // 异步响应
    });
    
    // 获取会话详情请求
    service.registerHandler('getSessionDetails', (
      message: BackgroundMessages.GetSessionDetailsRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.GetSessionDetailsResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      if (!message.sessionId) {
        return ctx.error('缺少会话ID参数');
      }
      
      this.getStorage().getSession(message.sessionId)
        .then(session => {
          if (session) {
            return ctx.success({ session });
          } else {
            return ctx.error(`未找到会话: ${message.sessionId}`);
          }
        })
        .catch(error => {
          console.error('获取会话详情失败:', error);
          return ctx.error(String(error));
        });
      
      return true; // 异步响应
    });
    
    // 获取导航树请求
    service.registerHandler('getNavigationTree', (
      message: BackgroundMessages.GetNavigationTreeRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.GetNavigationTreeResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      const options = message.options || {};
      if (this.debugMode) {
        console.log('获取导航树数据...', options);
      }
      
      // 首先获取当前会话ID
      this.getStorage().getCurrentSessionId()
        .then(currentSessionId => {
          // 然后获取导航树
          return this.getStorage().getNavigationTree()
            .then(treeData => {
              // 检查是否需要提供上次更新时间（用于增量更新）
              if (options && options.lastUpdate) {
                // 如果客户端提供了上次更新时间，标记在此时间后更新的节点
                const lastUpdateTime = parseInt(options.lastUpdate);
                if (!isNaN(lastUpdateTime)) {
                  this.markUpdatedNodes(treeData, lastUpdateTime);
                }
              }
              
              return ctx.success({
                data: {
                  nodes: treeData.nodes,
                  edges: treeData.edges
                },
                sessionId: currentSessionId,
                timestamp: Date.now() // 添加当前时间戳，客户端用于增量更新
              });
            });
        })
        .catch(error => {
          console.error('获取导航树失败:', error);
          return ctx.error(String(error));
        });
      
      return true; // 异步响应
    });
    
    // 清除所有记录请求
    service.registerHandler('clearAllRecords', (
      message: BackgroundMessages.ClearAllRecordsRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.ClearAllRecordsResponse) => void
    ) => {
      const ctx = service.createMessageContext(message, sender, sendResponse);
      
      this.getStorage().clearAllRecords()
        .then(() => {
          return ctx.success();
        })
        .catch(error => {
          console.error('清空记录失败:', error);
          return ctx.error(String(error));
        });
      
      return true; // 异步响应
    });
    
    console.log('导航管理器消息处理程序已注册');
  }
    /**
   * 获取或创建URL对应的节点
   * 如果节点已存在则返回现有节点，否则创建新节点
   */
  private async getOrCreateNodeForUrl(url: string, options: {
    tabId: number;
    referrer?: string;
    timestamp?: number;
  }): Promise<{ id: string; isNew?: boolean } | null> {
    try {
      const { tabId, referrer, timestamp = Date.now() } = options;
      
      // 1. 首先尝试从标签页中查找节点
      let nodeId = await this.getNodeIdForTab(tabId, url);
      
      if (nodeId) {
        // 找到现有节点，更新访问信息
        await this.storage.updateRecord(nodeId, {
          lastVisit: timestamp,
          visitCount: await this.incrementVisitCount(nodeId)
        });
        
        return { id: nodeId };
      }
      
      // 2. 如果没找到，创建新节点
      nodeId = IdGenerator.generateNodeId(tabId, url);
      
      // 3. 记录节点ID到标签页历史
      this.addToTabNavigationHistory(tabId, nodeId);
      
      // 4. 更新标签页状态
      this.updateTabState(tabId, {
        url: url,
        lastNodeId: nodeId,
        lastNavigation: timestamp
      });
      
      // 5. 添加到待更新列表
      this.addToPendingUpdates(tabId, nodeId);
      
      // 6. 更新缓存
      this.tabNodeIdCache.set(`${tabId}-${url}`, nodeId);
      
      // 7. 查找可能的父节点
      let parentId = "";
      
      // 首先检查是否有待处理导航
      const pendingNav = this.getPendingNavigationForUrl(url, tabId);
      
      if (pendingNav && pendingNav.sourceNodeId) {
        // 使用待处理导航的源节点作为父节点
        parentId = pendingNav.sourceNodeId;
      } else if (referrer) {
        // 使用引用页面作为父节点
        const referrerNodeId = await this.findNodeByUrl(referrer);
        if (referrerNodeId) {
          parentId = referrerNodeId;
        }
      }
      
      // 如果还没找到父节点，尝试使用当前标签页的最后一个节点
      if (!parentId) {
        parentId = await this.findLastNodeIdForTab(tabId) || "";
      }
      
      // 8. 创建导航记录
      const record: NavigationRecord = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: timestamp,
        sessionId: (await this.storage.getCurrentSession()).id,
        parentId: parentId,
        navigationType: pendingNav ? pendingNav.type : "initial",
        openTarget: "same_tab",
        source: "chrome_api",
        firstVisit: timestamp,
        lastVisit: timestamp,
        visitCount: 1,
        reloadCount: 0,
        frameId: 0,
        parentFrameId: -1
      };
      
      // 9. 保存记录
      await this.storage.saveRecord(record);
      
      // 10. 如果存在父节点，创建边
      if (parentId) {
        await this.createNavigationEdge(parentId, nodeId, timestamp, record.navigationType);
      }
      
      if (this.debugMode) {
        console.log(`创建新节点: ID=${nodeId}, URL=${url}, 父节点=${parentId || "无"}`);
      }
      
      return { id: nodeId, isNew: true };
    } catch (error) {
      console.error("获取或创建节点失败:", error);
      return null;
    }
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
}