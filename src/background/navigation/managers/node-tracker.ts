import { Logger } from '../../../lib/utils/logger.js';
import { IdGenerator } from '../../lib/id-generator.js';
import { NavigationStorage } from '../../store/navigation-storage.js';
import { TabStateManager } from './tab-state-manager.js';
import { UrlUtils } from '../utils/url-utils.js';
import { NavNode, ExtendedCompletedDetails } from '../../../types/session-types.js';
import { NodeCreationOptions, NodeMetadataOptions, MetadataSource, UpdateNodeResult } from '../types/node.js';

const logger = new Logger('NodeTracker');

/**
 * 节点追踪器
 * 负责创建、更新和查询导航节点
 */
export class NodeTracker {
  // 依赖组件
  private navigationStorage: NavigationStorage;
  private tabStateManager: TabStateManager;
  private sessionId: string;

  // 待更新节点列表
  private pendingUpdates = new Map<number, string[]>(); // 标签页ID -> 待更新节点ID数组

  // 缓存
  private tabNodeIdCache = new Map<string, string>(); // "tabId-url" -> 节点ID
  private urlToNodeCache = new Map<
    string,
    { nodeId: string; timestamp: number }
  >(); // URL -> {节点ID, 时间戳}

  /**
   * 构造函数
   * @param navigationStorage 导航存储实例
   * @param tabStateManager 标签页状态管理器实例
   * @param sessionId 当前会话ID
   */
  constructor(
    navigationStorage: NavigationStorage,
    tabStateManager: TabStateManager,
    sessionId: string
  ) {
    this.navigationStorage = navigationStorage;
    this.tabStateManager = tabStateManager;
    this.sessionId = sessionId;

    logger.log("节点追踪器初始化完成");
  }

  /**
   * 设置当前会话ID
   * @param sessionId 会话ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * 创建新节点
   * @param options 节点创建选项
   * @returns 创建的节点ID或null
   */
  async createNode(options: NodeCreationOptions): Promise<string | null> {
    try {
      const {
        tabId,
        url,
        parentId = "",
        navigationType = "initial",
        openTarget = "same_tab",
        source = "chrome_api",
        timestamp = Date.now(),
        frameId = 0,
        parentFrameId = -1,
      } = options;

      // 生成节点ID
      const nodeId = IdGenerator.generateNodeId(tabId, url);

      // 记录节点ID到标签页历史
      this.tabStateManager.addToNavigationHistory(tabId, nodeId);

      // 更新标签页状态
      this.tabStateManager.updateTabState(tabId, {
        url: url,
        lastNodeId: nodeId,
        lastNavigation: timestamp,
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
        logger.warn("获取标签页信息失败:", e);
      }

      // 创建导航记录
      const record: NavNode = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: timestamp,
        sessionId: this.sessionId,
        parentId: parentId,
        title: title,
        favicon: favicon,
        type: navigationType,
        openTarget: openTarget,
        source: source,
        firstVisit: timestamp,
        lastVisit: timestamp,
        visitCount: 1,
        reloadCount: 0,
        frameId: frameId,
        parentFrameId: parentFrameId,
      };

      // 保存记录
      await this.navigationStorage.saveNode(record);

      return nodeId;
    } catch (error) {
      logger.error("创建节点失败:", error);
      return null;
    }
  }
  /**
   * 添加标签页节点缓存
   * @param tabId 标签页ID
   * @param url URL
   * @param nodeId 节点ID
   */
  public addTabNodeCache(tabId: number, url: string, nodeId: string): void {
    this.tabNodeIdCache.set(`${tabId}-${url}`, nodeId);
  }

  /**
   * 获取标签页节点缓存
   * @param tabId 标签页ID
   * @param url URL
   * @returns 节点ID或undefined
   */
  public getTabNodeCache(tabId: number, url: string): string | undefined {
    return this.tabNodeIdCache.get(`${tabId}-${url}`);
  }
  /**
   * 获取或创建URL对应的节点
   * @param url 页面URL
   * @param options 创建选项
   * @returns 节点信息对象或null
   */
  async getOrCreateNodeForUrl(
    url: string,
    options: {
      tabId: number;
      referrer?: string;
      timestamp?: number;
    }
  ): Promise<{ id: string; isNew?: boolean } | null> {
    try {
      const { tabId, referrer, timestamp = Date.now() } = options;

      // 1. 首先尝试从标签页中查找节点
      let nodeId = await this.getNodeIdForTab(tabId, url);

      if (nodeId) {
        // 找到现有节点，更新访问信息
        await this.navigationStorage.updateNode(nodeId, {
          lastVisit: timestamp,
          visitCount: await this.incrementVisitCount(nodeId),
        });

        return { id: nodeId };
      }

      // 2. 如果没找到，创建新节点
      nodeId = IdGenerator.generateNodeId(tabId, url);

      // 3. 记录节点ID到标签页历史
      this.tabStateManager.addToNavigationHistory(tabId, nodeId);

      // 4. 更新标签页状态
      this.tabStateManager.updateTabState(tabId, {
        url: url,
        lastNodeId: nodeId,
        lastNavigation: timestamp,
      });

      // 5. 添加到待更新列表
      this.addToPendingUpdates(tabId, nodeId);

      // 6. 更新缓存
      this.tabNodeIdCache.set(`${tabId}-${url}`, nodeId);

      // 7. 查找可能的父节点
      let parentId = "";

      // 如果提供了引用页面，尝试查找对应节点作为父节点
      if (referrer) {
        const referrerNodeId = await this.findNodeByUrl(referrer);
        if (referrerNodeId) {
          parentId = referrerNodeId;
        }
      }

      // 如果还没找到父节点，尝试使用当前标签页的最后一个节点
      if (!parentId) {
        parentId = this.tabStateManager.getLastNodeId(tabId) || "";
      }

      // 8. 创建导航记录
      const record: NavNode = {
        id: nodeId,
        tabId: tabId,
        url: url,
        timestamp: timestamp,
        sessionId: this.sessionId,
        parentId: parentId,
        type: "initial",
        openTarget: "same_tab",
        source: "chrome_api",
        firstVisit: timestamp,
        lastVisit: timestamp,
        visitCount: 1,
        reloadCount: 0,
        frameId: 0,
        parentFrameId: -1,
      };

      // 9. 保存记录
      await this.navigationStorage.saveNode(record);

      return { id: nodeId, isNew: true };
    } catch (error) {
      logger.error("获取或创建节点失败:", error);
      return null;
    }
  }

  /**
   * 更新节点元数据
   * @param nodeId 节点ID
   * @param metadata 元数据对象
   * @param source 更新来源
   * @returns 更新结果
   */
  async updateNodeMetadata(
    nodeId: string,
    metadata: NodeMetadataOptions,
    source: MetadataSource = "chrome_api"
  ): Promise<UpdateNodeResult> {
    if (!nodeId) {
      logger.warn("更新元数据失败: 无效的节点ID");
      return { success: false, error: "无效的节点ID" };
    }

    try {
      // 获取现有记录
      const record = await this.navigationStorage.getNode(nodeId);
      if (!record) {
        logger.warn(`未找到节点 ${nodeId}，无法更新元数据`);
        return { success: false, error: `未找到节点 ${nodeId}` };
      }

      // 准备更新对象
      const updates: Partial<NavNode> = {};
      const updatedFields: string[] = [];

      // 标题处理 - 应用优先级策略
      if (metadata.title) {
        if (!record.title) {
          // 如果没有现有标题，直接使用新标题
          updates.title = metadata.title;
          updatedFields.push("title");
        } else if (
          source === "content_script" &&
          (record.title.length < metadata.title.length ||
            record.title.includes("New Tab") ||
            record.title.includes("Untitled"))
        ) {
          // 内容脚本提供的更长/更有意义的标题优先
          updates.title = metadata.title;
          updatedFields.push("title");
        } else if (
          source === "chrome_api" &&
          record.source === "navigation_event"
        ) {
          // Chrome API 提供的标题覆盖导航事件的标题
          updates.title = metadata.title;
          updatedFields.push("title");
        }

        if (updates.title) {
          logger.log(`更新标题: ${record.title || "无"} -> ${updates.title}`);
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
          updatedFields.push("favicon");
        }
      }

      // 引用信息处理 - 只在没有父节点时使用
      if (metadata.referrer && (!record.parentId || record.parentId === "")) {
        updates.referrer = metadata.referrer;
        updatedFields.push("referrer");
      }

      // 其他元数据处理
      if (metadata.description) {
        updates.description = metadata.description;
        updatedFields.push("description");
      }

      if (metadata.keywords) {
        updates.keywords = metadata.keywords;
        updatedFields.push("keywords");
      }

      if (metadata.loadTime && !record.loadTime) {
        updates.loadTime = metadata.loadTime;
        updatedFields.push("loadTime");
      }

      // 记录更新来源 - 只在特定情况下更新
      if (
        !record.source ||
        (source === "content_script" && record.source === "chrome_api")
      ) {
        updates.source = source;
        updatedFields.push("source");
      }

      // 应用更新
      if (Object.keys(updates).length > 0) {
        await this.navigationStorage.updateNode(nodeId, updates);

        return {
          success: true,
          updatedFields: updatedFields,
        };
      }

      return { success: true, updatedFields: [] };
    } catch (error) {
      logger.error("更新节点元数据失败:", error);
      return {
        success: false,
        error: `更新失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /**
   * 更新页面元数据（通常从内容脚本接收）
   * @param tabId 标签页ID
   * @param metadata 元数据对象
   * @returns 节点ID或null
   */
  async updatePageMetadata(
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
      logger.log(`未找到标签页${tabId}的节点ID: ${url}，不更新元数据`);
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
   * @param tabId 标签页ID
   * @param url 页面URL
   * @returns 节点ID或null
   */
  async getNodeIdForTab(tabId: number, url: string): Promise<string | null> {
    // 1. 首先尝试从缓存获取
    const cacheKey = `${tabId}-${url}`;
    const cachedId = this.tabNodeIdCache.get(cacheKey);
    if (cachedId) {
      return cachedId;
    }

    // 2. 再尝试从导航历史中找到最匹配的节点
    const history = this.tabStateManager.getTabHistory(tabId);

    // 倒序查找，优先使用最近的节点
    for (let i = history.length - 1; i >= 0; i--) {
      const nodeId = history[i];
      if (await this.isSameNodeUrl(nodeId, url)) {
        return nodeId;
      }
    }

    // 3. 最后尝试找标签页状态的最后节点
    const tabState = this.tabStateManager.getTabState(tabId);
    if (
      tabState &&
      tabState.lastNodeId &&
      tabState.url &&
      UrlUtils.isSameUrl(tabState.url, url)
    ) {
      return tabState.lastNodeId;
    }

    return null;
  }

  /**
   * 根据URL查找节点
   * @param url URL地址
   * @returns 节点ID或null
   */
  async findNodeByUrl(url: string): Promise<string | null> {
    if (!url) return null;

    try {
      // 检查缓存
      const normalized = UrlUtils.normalizeUrl(url);
      const cached = this.urlToNodeCache.get(normalized);
      if (cached && Date.now() - cached.timestamp < 60000) {
        // 1分钟内的缓存有效
        return cached.nodeId;
      }

      // 标准化URL
      const normalizedUrl = UrlUtils.normalizeUrl(url);

      // 查询记录
      const records = await this.navigationStorage.queryNodes({
        sessionId: this.sessionId,
      });

      // 首先尝试精确匹配
      let matchingRecord = records.find((r) => r.url === url);

      // 如果没找到，尝试标准化URL匹配
      if (!matchingRecord) {
        matchingRecord = records.find(
          (r) => UrlUtils.normalizeUrl(r.url) === normalizedUrl
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
      logger.error("通过URL查找节点失败:", error);
      return null;
    }
  }

  /**
   * 检查节点URL是否与给定URL匹配
   * @param nodeId 节点ID
   * @param url 要比较的URL
   * @returns 是否匹配
   */
  async isSameNodeUrl(nodeId: string, url: string): Promise<boolean> {
    try {
      const record = await this.navigationStorage.getNode(nodeId);
      if (!record) return false;

      return UrlUtils.isSameUrl(record.url, url);
    } catch (e) {
      logger.warn(`检查节点URL匹配失败: ${nodeId}`, e);
      return false;
    }
  }

  /**
   * 增加节点访问计数
   * @param nodeId 节点ID
   * @returns 新的访问计数
   */
  async incrementVisitCount(nodeId: string): Promise<number> {
    const record = await this.navigationStorage.getNode(nodeId);
    if (!record) return 1;

    const newCount = (record.visitCount || 0) + 1;
    return newCount;
  }

  /**
   * 添加到待更新列表
   * @param tabId 标签页ID
   * @param nodeId 节点ID
   */
  addToPendingUpdates(tabId: number, nodeId: string): void {
    if (!this.pendingUpdates.has(tabId)) {
      this.pendingUpdates.set(tabId, []);
    }

    const updates = this.pendingUpdates.get(tabId)!;
    if (!updates.includes(nodeId)) {
      updates.push(nodeId);
    }
  }

  /**
   * 获取标签页的待更新节点列表
   * @param tabId 标签页ID
   * @returns 节点ID数组
   */
  getPendingUpdates(tabId: number): string[] {
    return this.pendingUpdates.get(tabId) || [];
  }

  /**
   * 清除标签页的待更新节点
   * @param tabId 标签页ID
   */
  clearPendingUpdates(tabId: number): void {
    this.pendingUpdates.delete(tabId);
  }

  /**
   * 获取favicon URL
   * @param url 页面URL
   * @param fallbackUrl 备选URL
   * @returns favicon URL
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
   * 获取页面的 favicon URL
   * @param url 页面 URL
   * @param fallbackUrl 备选 URL
   * @returns favicon URL
   */
  public async getFaviconUrl(
    url: string,
    fallbackUrl?: string
  ): Promise<string> {
    return this.getFavicon(url, fallbackUrl);
  }

  /**
   * 处理导航完成事件
   * @param details 导航完成详情
   */
  public async handleNavigationCompleted(
    details: ExtendedCompletedDetails
  ): Promise<void> {
    try {
      const tabId = details.tabId;
      const url = details.url;
      
      // 获取节点ID
      const nodeId = await this.getNodeIdForTab(tabId, url);
      if (!nodeId) {
        return;
      }

      // 获取增强版favicon
      const tab = await chrome.tabs.get(tabId);
      const favicon = await this.getFaviconUrl(url, tab.favIconUrl);

      // 获取记录
      const record = await this.navigationStorage.getNode(nodeId);

      // 计算加载时间
      let loadTime: number | undefined = undefined;
      if (record && record.timestamp) {
        loadTime = Date.now() - record.timestamp;
      }

      // 更新元数据
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
      logger.error("处理导航完成失败:", error);
    }
  }

  /**
   * 获取当前活跃的节点
   * @returns 节点数组
   */
  async getActiveNodes(): Promise<NavNode[]> {
    try {
      const activeNodes: NavNode[] = [];

      // 获取所有标签页状态
      const allTabStates = this.tabStateManager.getAllTabStates();

      // 遍历所有标签页状态
      for (const tabState of allTabStates) {
        // 获取标签页的导航历史
        const history = this.tabStateManager.getTabHistory(tabState.id);

        if (history.length > 0) {
          // 获取最后一个节点
          const lastNodeId = history[history.length - 1];
          const record = await this.navigationStorage.getNode(lastNodeId);
          if (record) {
            activeNodes.push(record);
          }
        } else if (tabState.lastNodeId) {
          // 如果没有历史记录但有最后节点ID，也添加
          const record = await this.navigationStorage.getNode(
            tabState.lastNodeId
          );
          if (record) {
            activeNodes.push(record);
          }
        }
      }

      return activeNodes;
    } catch (error) {
      logger.error("获取活跃节点失败:", error);
      return [];
    }
  }

  /**
   * 清理过期缓存和待更新列表
   */
  async cleanupCache(): Promise<void> {
    try {
      const now = Date.now();

      // 清理 URL 缓存 - 移除超过5分钟的条目
      for (const [url, entry] of this.urlToNodeCache.entries()) {
        if (now - entry.timestamp > 300000) {
          // 5分钟
          this.urlToNodeCache.delete(url);
        }
      }

      // 清理待更新列表 - 移除无效节点ID
      const records = await this.navigationStorage.queryNodes({
        sessionId: this.sessionId,
      });

      // 创建有效节点ID集合
      const validNodeIds = new Set(records.map((record) => record.id));

      let totalRemoved = 0;

      // 遍历所有标签页的待更新列表
      for (const [tabId, nodeIds] of this.pendingUpdates.entries()) {
        const validIds = nodeIds.filter((id) => validNodeIds.has(id));

        if (validIds.length !== nodeIds.length) {
          totalRemoved += nodeIds.length - validIds.length;
          this.pendingUpdates.set(tabId, validIds);
        }
      }

      if (totalRemoved > 0) {
        logger.log(`清理缓存：移除了 ${totalRemoved} 个无效待更新节点`);
      }
    } catch (error) {
      logger.error("清理缓存失败:", error);
    }
  }

  /**
   * 重置状态
   * 清除所有缓存和待更新列表
   */
  reset(): void {
    this.tabNodeIdCache.clear();
    this.urlToNodeCache.clear();
    this.pendingUpdates.clear();

    logger.log("节点追踪器状态已重置");
  }
}