/**
 * 后台会话管理器
 * 负责创建、管理和维护浏览会话
 */

import { IdGenerator } from "./id-generator.js";
import { SessionStorage } from "../store/session-storage.js";
import { NavigationStorage } from "../store/navigation-storage.js";
import { sessionEvents } from "./session-event-emitter.js";
import { BackgroundMessageService } from "../messaging/bg-message-service.js";
import {
  NavNode, 
  NavLink,
  BrowsingSession,
  SessionCreationOptions,
  SessionQueryOptions,
  SessionUpdateOptions,
  SessionStatistics
} from "../../types/session-types.js";
import {
  BackgroundMessages,
  BackgroundResponses,
} from "../../types/messages/background.js";
import { getSettingsService } from '../../lib/settings/service.js';
import { NavigraphSettings } from '../../lib/settings/types.js';

/**
 * 后台会话管理器类
 * 负责会话的创建、更新、删除和查询等操作
 */
export class BackgroundSessionManager {
  // 存储引用
  private storage: SessionStorage;

  // 当前激活的会话ID
  private currentSessionId: string | null = null;

  // 会话缓存 - 提高性能
  private sessionCache: Map<string, BrowsingSession> = new Map();

  // 初始化状态
  private initialized = false;

  // 空闲计时器
  private idleTimerId: number | null = null;
  
  // 空闲超时设置（分钟）
  private idleTimeoutMinutes: number = 30;
  
  // 最后活动时间
  private lastActivityTime: number = 0;
  
  // 会话模式
  private sessionMode: 'auto' | 'manual' | 'smart' | 'daily' | 'activity' = 'daily';

  /**
   * 创建后台会话管理器实例
   */
  constructor() {
    this.storage = new SessionStorage();

    console.log("后台会话管理器已创建");
  }

  /**
   * 初始化会话管理器
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      console.log("会话管理器已经初始化，跳过");
      return;
    }

    try {
      console.log("初始化会话管理器...");
      // 先设置初始化标志，以防止循环调用
      this.initialized = true;

      // 初始化存储
      await this.storage.initialize();
      
      // 加载设置
      await this.loadSettings();

      // 注册监听器
      await this.setupListeners();

      // 检查日期转换（是否需要新建今日会话）
      if (this.sessionMode === 'daily') {
        await this.checkDayTransition();
      }
      
      // 加载会话并检查活跃会话
      if (!this.currentSessionId) {
        await this.loadActiveSessions();
      }

      // 记录当前时间为最后活动时间
      this.lastActivityTime = Date.now();
      
      // 设置会话活动监听器
      this.setupActivityListeners();

      console.log("会话管理器初始化完成");
    } catch (error) {
      console.error("会话管理器初始化失败:", error);
      throw new Error(
        `会话管理器初始化失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 设置会话活动监听器
   */
  private setupActivityListeners(): void {
    console.log('设置会话活动监听器');
    
    // 浏览器启动时
    chrome.runtime.onStartup.addListener(() => {
      console.log('浏览器启动');
      this.checkDayTransition();
    });
    
    // 标签页激活时
    chrome.tabs.onActivated.addListener(() => {
      this.markSessionActivity();
    });
    
    // 导航完成时
    chrome.webNavigation.onCompleted.addListener(() => {
      this.markSessionActivity();
    });
    
    // 标签页更新时
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete') {
        this.markSessionActivity();
      }
    });
  }

  /**
   * 确保已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * 检查是否应该开始新的会话
   */
  public async checkDayTransition(): Promise<void> {
    // 如果不是每日模式，跳过
    if (this.sessionMode !== 'daily') {
      return;
    }

    // 获取当前日期（本地时区）
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    console.log("检查会话日期转换...");

    try {
      // 先检查当前会话是否存在
      const currentSession = await this.getCurrentSession();
      
      if (!currentSession) {
        // 没有当前会话，创建新的每日会话
        await this.createDailySession();
        return;
      }
      
      // 检查会话开始时间是否是今天
      const sessionDate = new Date(currentSession.startTime);
      const sessionDayStart = new Date(
        sessionDate.getFullYear(),
        sessionDate.getMonth(),
        sessionDate.getDate()
      ).getTime();
      
      if (sessionDayStart < today) {
        // 会话是较早日期的，结束旧会话并创建新会话
        console.log("检测到新的一天，创建新会话");
        await this.endSession(currentSession.id);
        await this.createDailySession();
      }
    } catch (error) {
      console.error("日期转换检查失败:", error);
    }
  }

  /**
   * 创建每日会话
   */
  private async createDailySession(): Promise<BrowsingSession> {
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    
    return this.createSession({
      title: `${dateStr} 浏览会话`,
      description: `自动创建的 ${dateStr} 工作日会话`,
      metadata: {
        type: "daily",
        date: now.getTime()
      }
    }, true);
  }

  /**
   * 标记会话活动
   */
  public async markSessionActivity(): Promise<void> {
    // 更新最后活动时间
    this.lastActivityTime = Date.now();
    
    // 重置空闲计时器
    this.resetIdleTimer();
    
    // 如果没有当前会话，检查是否需要创建新会话
    if (!this.currentSessionId && this.sessionMode === 'daily') {
      await this.checkDayTransition();
    }
  }
  
  /**
   * 重置空闲计时器
   */
  private resetIdleTimer(): void {
    // 清除现有计时器
    if (this.idleTimerId) {
      clearTimeout(this.idleTimerId);
      this.idleTimerId = null;
    }
    
    // 如果不是每日模式或空闲超时为0，不设置计时器
    if (this.sessionMode !== 'daily' || this.idleTimeoutMinutes <= 0) {
      return;
    }
    
    // 设置新的计时器
    const timeoutMs = this.idleTimeoutMinutes * 60 * 1000;
    this.idleTimerId = setTimeout(() => {
      this.handleUserIdle();
    }, timeoutMs) as unknown as number; // 类型转换以符合属性类型
  }
  
  /**
   * 处理用户空闲
   */
  private async handleUserIdle(): Promise<void> {
    // 如果没有当前会话，不需要处理
    if (!this.currentSessionId) return;
    
    console.log(`检测到用户空闲超过${this.idleTimeoutMinutes}分钟，自动结束当前会话`);
    
    try {
      // 结束当前会话
      await this.endSession(this.currentSessionId);
    } catch (error) {
      console.error("自动结束会话失败:", error);
    }
  }

  /**
   * 加载活跃会话
   */
  private async loadActiveSessions(): Promise<void> {
    try {
      // 获取活跃会话
      const sessions = await this.storage.getSessions({
        includeInactive: false,
      });

      if (sessions.length > 0) {
        // 使用最近的活跃会话作为当前会话
        const mostRecent = sessions.sort(
          (a, b) => b.startTime - a.startTime
        )[0];
        this.currentSessionId = mostRecent.id;
        this.sessionCache.set(mostRecent.id, mostRecent);

        console.log(`加载了活跃会话: ${mostRecent.id} - ${mostRecent.title}`);
      } else {
        console.log("未找到活跃会话，将创建新会话");
        // 创建新的默认会话
        await this.createSession({
          title: `会话 ${new Date().toLocaleString()}`,
          description: "自动创建的默认会话",
        }, true);
      }

      // 加载其他会话到缓存
      sessions.forEach((session) => {
        if (session.id !== this.currentSessionId) {
          this.sessionCache.set(session.id, session);
        }
      });

      console.log(
        `已加载 ${sessions.length} 个活跃会话，当前会话ID: ${this.currentSessionId}`
      );
    } catch (error) {
      console.error("加载活跃会话失败:", error);
      throw new Error(
        `加载活跃会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 加载设置并设置监听器
   */
  private async loadSettings(): Promise<void> {
    const settingsService = getSettingsService();
    
    // 确保设置服务已初始化
    if (!settingsService.isInitialized()) {
      await settingsService.initialize();
    }
    
    // 获取当前设置
    const settings = settingsService.getSettings();
    
    // 应用设置
    this.applySettings(settings);

    console.log(`已加载会话设置: 模式=${this.sessionMode}, 空闲超时=${this.idleTimeoutMinutes}分钟`);
  }

  /**
   * 加载设置并设置监听器
   */
  private async setupListeners(): Promise<void> {
    const settingsService = getSettingsService();

    // 添加设置变更监听器
    settingsService.addChangeListener(this.handleSettingsChange.bind(this));
  }
  /**
   * 应用设置到会话管理器
   */
  private applySettings(settings: NavigraphSettings): void {
    const oldMode = this.sessionMode;
    const oldTimeout = this.idleTimeoutMinutes;
    
    // 更新设置值
    this.sessionMode = settings.sessionMode;
    this.idleTimeoutMinutes = settings.idleTimeout;
    
    // 处理模式更改
    if (this.initialized && oldMode !== this.sessionMode) {
      this.handleSessionModeChange(oldMode).catch(err => {
        console.error('处理会话模式变更失败:', err);
      });
    }
    
    // 处理超时更改
    if (this.initialized && oldTimeout !== this.idleTimeoutMinutes) {
      this.resetIdleTimer();  // 用新的超时值重设计时器
    }
  }
  
  /**
   * 处理设置变更
   */
  private handleSettingsChange(settings: NavigraphSettings): void {
    console.log('检测到设置变更，更新会话管理器配置');
    this.applySettings(settings);
  }
  
  /**
   * 处理会话模式变更
   */
  private async handleSessionModeChange(oldMode: string): Promise<void> {
    console.log(`会话模式从 ${oldMode} 变更为 ${this.sessionMode}`);
    
    // 如果切换到每日模式，检查是否需要创建新会话
    if (this.sessionMode === 'daily' && oldMode !== 'daily') {
      await this.checkDayTransition();
    }
    
    // 其他模式切换逻辑...
  }

  /**
   * 创建新会话
   * @param options 会话创建选项
   * @returns 新创建的会话对象
   */
  public async createSession(
    options?: SessionCreationOptions,
    skipInitCheck: boolean = false
  ): Promise<BrowsingSession> {
    // 只在非跳过模式下检查初始化
    if (!skipInitCheck) {
      await this.ensureInitialized();
    }

    try {
      // 生成会话ID
      const sessionId = IdGenerator.generateSessionId();

      // 构建新会话对象
      const newSession: BrowsingSession = {
        id: sessionId,
        title: options?.title || `会话 ${new Date().toLocaleString()}`,
        description: options?.description || "",
        startTime: Date.now(),
        isActive: true,
        nodeCount: 0,
        tabCount: 0,
        metadata: options?.metadata || {},
        records: {},
        edges: {},
        rootIds: [],
      };

      // 如果设置为活跃会话或未指定（默认为true）
      const makeActive = options?.makeActive !== false;

      if (makeActive) {
        // 将当前活跃会话设为非活跃
        await this.deactivateCurrentSession();

        // 更新当前会话ID
        this.currentSessionId = sessionId;
      }

      // 保存到存储和缓存
      await this.storage.saveSession(newSession);
      this.sessionCache.set(sessionId, newSession);

      console.log(`已创建新会话: ${sessionId} - ${newSession.title}`);

      // 发出事件
      sessionEvents.emitSessionCreated(sessionId, {
        title: newSession.title,
        makeActive,
      });

      if (makeActive) {
        sessionEvents.emitSessionActivated(sessionId);
      }

      return newSession;
    } catch (error) {
      console.error("创建会话失败:", error);
      throw new Error(
        `创建会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 设置当前活跃会话
   * @param sessionId 要设置为当前会话的ID
   * @returns 设置的会话对象
   */
  public async setCurrentSession(
    sessionId: string | null
  ): Promise<BrowsingSession | null> {
    await this.ensureInitialized();

    try {
      // 如果ID为null，清除当前会话
      if (sessionId === null) {
        const oldSessionId = this.currentSessionId;
        this.currentSessionId = null;

        if (oldSessionId) {
          sessionEvents.emitSessionDeactivated(oldSessionId);
        }

        return null;
      }

      // 如果会话ID与当前会话相同，无需操作
      if (sessionId === this.currentSessionId) {
        console.log(`会话 ${sessionId} 已经是当前活跃会话`);
        return this.getSessionById(sessionId);
      }

      // 检查会话是否存在
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }

      // 将当前会话设为非活跃
      await this.deactivateCurrentSession();

      // 更新当前会话ID
      this.currentSessionId = sessionId;

      // 更新会话为活跃状态
      session.isActive = true;
      await this.storage.saveSession(session);
      this.sessionCache.set(sessionId, session);

      console.log(`已将会话 ${sessionId} 设置为当前活跃会话`);

      // 发出事件
      sessionEvents.emitSessionActivated(sessionId);

      return session;
    } catch (error) {
      console.error(`设置当前会话 ${sessionId} 失败:`, error);
      throw new Error(
        `设置当前会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 获取当前会话
   * @returns 当前会话对象，如果没有则返回null
   */
  public async getCurrentSession(): Promise<BrowsingSession | null> {
    await this.ensureInitialized();

    if (!this.currentSessionId) {
      return null;
    }

    try {
      return await this.getSessionById(this.currentSessionId);
    } catch (error) {
      console.error("获取当前会话失败:", error);
      throw new Error(
        `获取当前会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 获取当前会话ID
   * @returns 当前会话ID，如果没有则返回null
   */
  public getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 根据ID获取会话
   * @param sessionId 会话ID
   * @returns 会话对象，如果不存在则返回null
   */
  public async getSessionById(
    sessionId: string
  ): Promise<BrowsingSession | null> {
    await this.ensureInitialized();

    try {
      // 先尝试从缓存获取
      if (this.sessionCache.has(sessionId)) {
        const cachedSession = this.sessionCache.get(sessionId);
        // 如果缓存中已有完整数据（包含records和edges），直接返回
        if (cachedSession && cachedSession.records) {
          return cachedSession;
        }
      }

      // 从存储获取基本会话信息
      const session = await this.storage.getSession(sessionId);

      // 如果会话不存在，返回null
      if (!session) {
        return null;
      }

      // 获取会话的导航数据
      const navData = await this.getSessionNavigationData(sessionId);

      // 组装完整会话对象
      const fullSession: BrowsingSession = {
        ...session,
        records: navData.records,
        edges: navData.edges,
        rootIds: navData.rootIds,
      };

      // 更新缓存
      this.sessionCache.set(sessionId, fullSession);

      return fullSession;
    } catch (error) {
      console.error(`获取会话 ${sessionId} 失败:`, error);
      throw new Error(
        `获取会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 获取会话的导航数据
   * @param sessionId 会话ID
   * @returns 导航节点和边的记录
   */
  private async getSessionNavigationData(sessionId: string): Promise<{
    records: Record<string, NavNode>;
    edges: Record<string, NavLink>;
    rootIds: string[];
  }> {
    // 创建导航存储实例
    const navStorage = new NavigationStorage();
    await navStorage.initialize();
    
    try {
      // 获取会话的所有节点和边
      const { nodes, edges } = await navStorage.getSessionGraph(sessionId);

      // 转换为前端期望的格式
      const records: Record<string, NavNode> = {};
      const edgesMap: Record<string, NavLink> = {};

      // 填充节点记录
      nodes.forEach((node) => {
        records[node.id] = {
          ...node,
          parentId: node.parentId || "", // 确保parentId始终为字符串，避免类型不兼容
        };
      });

      // 填充边记录
      edges.forEach((edge) => {
        edgesMap[edge.id] = edge;
      });

      // 查找根节点ID（没有父节点的节点）
      const rootIds = nodes
        .filter((node) => !node.parentId)
        .map((node) => node.id);

      return {
        records,
        edges: edgesMap,
        rootIds,
      };
    } catch (error) {
      console.error(`获取会话 ${sessionId} 的导航数据失败:`, error);
      // 出错时返回空数据，而不是终止整个流程
      return {
        records: {},
        edges: {},
        rootIds: [],
      };
    }
  }

  /**
   * 获取会话列表
   * @param options 会话查询选项
   * @returns 会话对象数组
   */
  public async getSessions(
    options?: SessionQueryOptions
  ): Promise<BrowsingSession[]> {
    await this.ensureInitialized();

    try {
      return await this.storage.getSessions(options);
    } catch (error) {
      console.error("获取会话列表失败:", error);
      throw new Error(
        `获取会话列表失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 更新会话
   * @param sessionId 要更新的会话ID
   * @param updates 更新内容
   * @returns 更新后的会话对象
   */
  public async updateSession(
    sessionId: string,
    updates: SessionUpdateOptions
  ): Promise<BrowsingSession> {
    await this.ensureInitialized();

    try {
      // 获取原会话
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }

      // 应用更新
      if (updates.title !== undefined) {
        session.title = updates.title;
      }

      if (updates.description !== undefined) {
        session.description = updates.description;
      }

      // 处理活跃状态变更
      if (
        updates.isActive !== undefined &&
        updates.isActive !== session.isActive
      ) {
        if (updates.isActive) {
          // 激活会话
          await this.setCurrentSession(sessionId);
        } else {
          // 停用会话
          if (sessionId === this.currentSessionId) {
            // 如果是当前会话，设置为null
            await this.setCurrentSession(null);
          } else {
            // 否则直接更新状态
            session.isActive = false;
          }
        }
      }

      // 更新元数据
      if (updates.metadata) {
        session.metadata = {
          ...(session.metadata || {}),
          ...updates.metadata,
        };
      }

      // 保存更新
      await this.storage.saveSession(session);
      this.sessionCache.set(sessionId, session);

      console.log(`已更新会话 ${sessionId}`);

      // 发出事件
      sessionEvents.emitSessionUpdated(sessionId, { updates });

      return session;
    } catch (error) {
      console.error(`更新会话 ${sessionId} 失败:`, error);
      throw new Error(
        `更新会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 结束会话
   * @param sessionId 要结束的会话ID
   * @returns 结束后的会话对象
   */
  public async endSession(sessionId: string): Promise<BrowsingSession> {
    await this.ensureInitialized();

    try {
      // 获取会话
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }

      // 标记为已结束
      session.isActive = false;
      session.endTime = Date.now();

      // 如果是当前会话，清除当前会话ID
      if (sessionId === this.currentSessionId) {
        this.currentSessionId = null;
      }

      // 保存更新
      await this.storage.saveSession(session);
      this.sessionCache.set(sessionId, session);

      console.log(`已结束会话 ${sessionId}`);

      // 发出事件
      sessionEvents.emitSessionEnded(sessionId, {
        endTime: session.endTime,
      });

      return session;
    } catch (error) {
      console.error(`结束会话 ${sessionId} 失败:`, error);
      throw new Error(
        `结束会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 删除会话
   * @param sessionId 要删除的会话ID
   * @returns 是否成功删除
   */
  public async deleteSession(sessionId: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      // 如果是当前会话，清除当前会话ID
      if (sessionId === this.currentSessionId) {
        this.currentSessionId = null;
      }

      // 从缓存移除
      this.sessionCache.delete(sessionId);

      // 从存储删除
      const result = await this.storage.deleteSession(sessionId);

      console.log(`已删除会话 ${sessionId}`);

      // 发出事件
      sessionEvents.emitSessionDeleted(sessionId);

      return result;
    } catch (error) {
      console.error(`删除会话 ${sessionId} 失败:`, error);
      throw new Error(
        `删除会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 获取会话统计信息
   * @param sessionId 会话ID
   * @returns 会话统计信息
   */
  public async getSessionStatistics(
    sessionId: string
  ): Promise<SessionStatistics> {
    await this.ensureInitialized();

    try {
      // 获取会话
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }

      // TODO: 从存储中获取会话相关的导航节点数据
      // 这需要将来与导航管理器集成
      // 现在临时返回基本统计信息

      const stats: SessionStatistics = {
        totalNodes: session.nodeCount || 0,
        uniqueDomains: 0,
        duration: session.endTime
          ? session.endTime - session.startTime
          : Date.now() - session.startTime,
        topDomains: [],
        mostVisitedPages: [],
        activityByHour: [],
      };

      return stats;
    } catch (error) {
      console.error(`获取会话 ${sessionId} 统计信息失败:`, error);
      throw new Error(
        `获取会话统计信息失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 更新会话节点计数
   * @param sessionId 会话ID
   * @param count 新的节点计数，未提供则增加1
   */
  public async updateNodeCount(
    sessionId: string,
    count?: number
  ): Promise<void> {
    await this.ensureInitialized();

    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        console.warn(`更新节点计数失败: 会话 ${sessionId} 不存在`);
        return;
      }

      if (count !== undefined) {
        session.nodeCount = count;
      } else {
        session.nodeCount = (session.nodeCount || 0) + 1;
      }

      // 更新缓存和存储
      this.sessionCache.set(sessionId, session);
      await this.storage.saveSession(session);
    } catch (error) {
      console.error(`更新会话 ${sessionId} 节点计数失败:`, error);
    }
  }

  /**
   * 更新会话标签页计数
   * @param sessionId 会话ID
   * @param count 新的标签页计数，未提供则增加1
   */
  public async updateTabCount(
    sessionId: string,
    count?: number
  ): Promise<void> {
    await this.ensureInitialized();

    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        console.warn(`更新标签页计数失败: 会话 ${sessionId} 不存在`);
        return;
      }

      if (count !== undefined) {
        session.tabCount = count;
      } else {
        session.tabCount = (session.tabCount || 0) + 1;
      }

      // 更新缓存和存储
      this.sessionCache.set(sessionId, session);
      await this.storage.saveSession(session);
    } catch (error) {
      console.error(`更新会话 ${sessionId} 标签页计数失败:`, error);
    }
  }

  /**
   * 将当前活跃会话设为非活跃
   */
  private async deactivateCurrentSession(): Promise<void> {
    if (!this.currentSessionId) {
      return;
    }

    try {
      // 获取当前会话
      const session = await this.getSessionById(this.currentSessionId);
      if (!session) {
        // 当前会话不存在，直接清空当前会话ID
        this.currentSessionId = null;
        return;
      }

      // 标记为非活跃
      session.isActive = false;

      // 保存更新
      await this.storage.saveSession(session);
      this.sessionCache.set(session.id, session);

      console.log(`将会话 ${session.id} 设置为非活跃状态`);

      // 发出事件
      sessionEvents.emitSessionDeactivated(session.id);
    } catch (error) {
      console.error("设置当前会话为非活跃状态失败:", error);
    }
  }

  /**
   * 注册消息处理程序
   * @param messageService 消息服务实例
   */
  public registerMessageHandlers(
    messageService: BackgroundMessageService
  ): void {
    console.log("注册会话相关消息处理程序");

    // 获取会话列表
    messageService.registerHandler(
      "getSessions",
      (
        message: BackgroundMessages.GetSessionsRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetSessionsResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);

        this.getSessions(message.options)
          .then((sessions) => {
            // 格式化为前端期望的格式
            const formattedSessions = sessions.map((s) => ({
              id: s.id,
              title: s.title,
              startTime: s.startTime,
              endTime: s.endTime,
              isActive: s.isActive,
              nodeCount: s.nodeCount,
              recordCount: s.nodeCount, // 兼容旧代码
            }));

            ctx.success({
              sessions: formattedSessions,
            });
          })
          .catch((error) => {
            ctx.error(`获取会话列表失败: ${error.message}`);
          });

        return true;
      }
    );

    // 获取会话详情
    messageService.registerHandler(
      "getSessionDetails",
      (
        message: BackgroundMessages.GetSessionDetailsRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetSessionDetailsResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
        const { sessionId } = message;

        this.getSessionById(sessionId)
          .then((session) => {
            if (!session) {
              ctx.error(`会话 ${sessionId} 不存在`);
              return;
            }

            // 确保session具有前端期望的所有字段
            ctx.success({
              session: {
                ...session,
                // 如果records或edges为空，确保它们是空对象而不是undefined
                records: session.records || {},
                edges: session.edges || {},
                rootIds: session.rootIds || [],
              },
            });
          })
          .catch((error) => {
            ctx.error(`获取会话详情失败: ${error.message}`);
          });

        return true;
      }
    );

     // 创建会话
    messageService.registerHandler(
      "createSession",
      (
        message: BackgroundMessages.CreateSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.CreateSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
    
        this.createSession(message.options)
          .then((session) => {
            ctx.success({
              session,
            });
          })
          .catch((error) => {
            ctx.error(`创建会话失败: ${error.message}`);
          });
    
        return true;
      }
    );

    // 更新会话
    messageService.registerHandler(
      "updateSession",
      (
        message: BackgroundMessages.UpdateSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.UpdateSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
        const { sessionId, updates } = message;
    
        this.updateSession(sessionId, updates)
          .then((session) => {
            ctx.success({
              session,
            });
          })
          .catch((error) => {
            ctx.error(`更新会话失败: ${error.message}`);
          });
    
        return true;
      }
    );

    // 结束会话
    messageService.registerHandler(
      "endSession",
      (
        message: BackgroundMessages.EndSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.EndSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
        const { sessionId } = message;
    
        this.endSession(sessionId)
          .then((session) => {
            ctx.success({
              sessionId,
              session,
            });
          })
          .catch((error) => {
            ctx.error(`结束会话失败: ${error.message}`);
          });
    
        return true;
      }
    );

    // 设置当前会话
    messageService.registerHandler(
      "setCurrentSession",
      (
        message: BackgroundMessages.SetCurrentSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.SetCurrentSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
        const { sessionId } = message;
    
        this.setCurrentSession(sessionId)
          .then((session) => {
            ctx.success({
              sessionId,
              session,
            });
          })
          .catch((error) => {
            ctx.error(`设置当前会话失败: ${error.message}`);
          });
    
        return true;
      }
    );

    // 获取当前会话
    messageService.registerHandler(
      "getCurrentSession",
      (
        message: BackgroundMessages.GetCurrentSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetCurrentSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
    
        this.getCurrentSession()
          .then((session) => {
            ctx.success({
              session,
              sessionId: session ? session.id : null,
            });
          })
          .catch((error) => {
            ctx.error(`获取当前会话失败: ${error.message}`);
          });
    
        return true;
      }
    );

    // 删除会话
    messageService.registerHandler(
      "deleteSession",
      (
        message: BackgroundMessages.DeleteSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.DeleteSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
        const { sessionId, confirm } = message;
    
        // 安全检查：必须明确确认删除
        if (!confirm) {
          ctx.error("删除会话操作需要明确确认");
          return false;
        }
    
        this.deleteSession(sessionId)
          .then((success) => {
            if (success) {
              ctx.success({
                sessionId,
              });
            } else {
              ctx.error(`删除会话 ${sessionId} 失败`);
            }
          })
          .catch((error) => {
            ctx.error(`删除会话失败: ${error.message}`);
          });
    
        return true;
      }
    );

    // 获取会话统计信息
    messageService.registerHandler(
      "getSessionStats",
      (
        message: BackgroundMessages.GetSessionStatsRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetSessionStatsResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
        const { sessionId } = message;
    
        this.getSessionStatistics(sessionId)
          .then((statistics) => {
            ctx.success({
              sessionId,
              statistics,
            });
          })
          .catch((error) => {
            ctx.error(`获取会话统计信息失败: ${error.message}`);
          });
    
        return true;
      }
    );

    // 添加会话活动更新处理程序
    messageService.registerHandler(
      "markSessionActivity",
      (
        message: BackgroundMessages.MarkSessionActivityRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.MarkSessionActivityResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
        
        this.markSessionActivity()
          .then(() => {
            ctx.success({});
          })
          .catch((error) => {
            ctx.error(`标记会话活动失败: ${error.message}`);
          });
        
        return false; // 同步响应
      }
    );
  }
}

// 创建单例实例的工厂函数
let instance: BackgroundSessionManager | null = null;

/**
 * 获取后台会话管理器单例
 */
export function getBackgroundSessionManager(): BackgroundSessionManager {
  if (!instance) {
    instance = new BackgroundSessionManager();
  }
  return instance;
}
