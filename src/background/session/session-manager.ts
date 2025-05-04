/**
 * 会话管理器
 * 负责创建、管理和维护浏览会话
 */
import { Logger } from '../../lib/utils/logger.js';
import { IdGenerator } from "../lib/id-generator.js";
import { SessionStorage, getSessionStorage } from "../store/session-storage.js";
import { getSettingsService } from '../../lib/settings/service.js';
import { NavigraphSettings } from '../../lib/settings/types.js';
import { getNavigationManager } from "../navigation/navigation-manager.js";
import { BackgroundMessageService } from '../messaging/bg-message-service.js';
import { i18n, I18nError } from '../../lib/utils/i18n-utils.js';

import { sessionEvents } from "./session-event-emitter.js";
import { SessionMessageHandler } from './handlers/session-handlers.js';
import { ActivityMonitor } from './monitors/activity-monitor.js';
import { ConsistencyChecker } from './monitors/consistency-checker.js';
import { SessionStrategyFactory } from './strategies/session-strategy-factory.js';

import {
  NavNode, 
  NavLink,
  BrowsingSession,
  SessionCreationOptions,
  SessionQueryOptions,
  SessionUpdateOptions,
  SessionStatistics
} from "../../types/session-types.js";

const logger = new Logger('SessionManager');

/**
 * 会话管理器类
 * 负责会话的创建、更新、删除和查询等核心操作
 */
export class SessionManager {
  // 存储引用
  private storage: SessionStorage;

  // 当前查看的会话ID (UI显示焦点)
  private currentSessionId: string | null = null;
  
  // 最新活动的会话ID (记录新活动)
  private latestSessionId: string | null = null;

  // 初始化状态
  private initialized = false;
  
  // 活动监视器
  private activityMonitor: ActivityMonitor;
  
  // 一致性检查器
  private consistencyChecker: ConsistencyChecker;
  
  // 会话策略工厂
  private strategyFactory: SessionStrategyFactory;

  /**
   * 创建会话管理器实例
   */
  constructor() {
    this.storage = getSessionStorage();
    this.activityMonitor = new ActivityMonitor(this);
    this.consistencyChecker = new ConsistencyChecker(this);
    this.strategyFactory = new SessionStrategyFactory(this);

    logger.log("session_manager_created");
  }

  /**
   * 初始化会话管理器
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.log("session_manager_already_initialized");
      return;
    }

    try {
      logger.log("session_manager_init_start");
      this.initialized = true;

      // 初始化存储
      await this.storage.initialize();
      
      // 加载设置并设置变更监听器
      await this.loadSettings();

      // 先加载活跃会话，确保会话ID已设置
      await this.loadActiveSessions();
      
      // 初始化子组件
      await this.activityMonitor.initialize();
      this.consistencyChecker.startChecking();
      
      logger.log("session_manager_init_complete");
    } catch (error) {
      logger.error('session_manager_init_failed', error);
      throw new I18nError(
        'session_manager_init_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
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
   * 加载设置并设置监听器
   */
  private async loadSettings(): Promise<void> {
    const settingsService = getSettingsService();
    
    if (!settingsService.isInitialized()) {
      await settingsService.initialize();
    }
    
    // 应用初始设置
    const settings = settingsService.getSettings();
    this.applySettings(settings);

    // 添加变更监听器
    settingsService.addChangeListener(settings => this.applySettings(settings));
  }
  
  /**
   * 应用设置到会话管理器
   */
  private applySettings(settings: NavigraphSettings): void {
    // 应用设置到活动监视器
    this.activityMonitor.applySettings(settings);
    
    // 应用会话策略
    this.strategyFactory.setActiveStrategy(settings.sessionMode);
  }

  /**
   * 注册会话管理器的消息处理程序
   * 这是与BackgroundMessageService集成的桥接方法
   * @param messageService 消息服务实例
   */
  public registerMessageHandlers(messageService: BackgroundMessageService): void {
    logger.log('session_manager_register_handlers_start');
    
    // 创建SessionMessageHandler实例
    const messageHandler = new SessionMessageHandler(this);
    
    // 委托给SessionMessageHandler处理注册
    messageHandler.registerHandlers(messageService);
  }

  /**
   * 加载活跃会话
   */
  private async loadActiveSessions(): Promise<void> {
    try {
      // 1. 首先查找活跃会话
      const activeSessions = await this.storage.getSessions({
        includeInactive: false,
      });
  
      if (activeSessions.length > 0) {
        // 使用最近的活跃会话作为当前会话和最新会话
        const mostRecent = activeSessions.sort(
          (a, b) => b.startTime - a.startTime
        )[0];
        this.currentSessionId = mostRecent.id;
        this.latestSessionId = mostRecent.id;
  
        logger.log('session_manager_loaded_active', mostRecent.id, mostRecent.title);
        return;  // 找到活跃会话，直接返回
      }
  
      // 2. 没有活跃会话，查找最近的已结束会话
      const recentSessions = await this.storage.getSessions({
        includeInactive: true,
        sortBy: 'endTime',
        sortOrder: 'desc',
        limit: 1
      });
  
      if (recentSessions.length > 0) {
        const mostRecent = recentSessions[0];
        const lastActivityTime = mostRecent.lastActivity || mostRecent.endTime || mostRecent.startTime;
        const now = Date.now();
        const timeSinceLastActivity = now - lastActivityTime;
        
        // 如果最后活动时间在合理范围内（默认12小时），重用该会话
        const maxReusePeriod = 12 * 60 * 60 * 1000;  // 12小时
        if (timeSinceLastActivity < maxReusePeriod) {
          logger.log('session_manager_reuse_recent', mostRecent.id, Math.round(timeSinceLastActivity / (1000 * 60 * 60)));
          
          // 重新激活该会话
          mostRecent.isActive = true;
          mostRecent.lastActivity = now;
          await this.storage.saveSession(mostRecent);
          
          this.currentSessionId = mostRecent.id;
          this.latestSessionId = mostRecent.id;
          
          sessionEvents.emitSessionActivated(mostRecent.id);
          return;
        }
      }
  
      // 3. 没有找到活跃会话或最近会话已过期，创建新会话
      logger.log("session_manager_create_new_session");
      const strategy = this.strategyFactory.getActiveStrategy();
      const newSession = await strategy.createSession();
      
      // 设置为当前和最新会话
      this.currentSessionId = newSession.id;
      this.latestSessionId = newSession.id;
    } catch (error) {
      logger.error('session_manager_load_active_failed', error);
      throw new I18nError(
        'session_manager_load_active_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 获取会话列表
   */
  public async getSessions(options?: SessionQueryOptions): Promise<BrowsingSession[]> {
    await this.ensureInitialized();
    
    try {
      const sessions = await this.storage.getSessions(options);
      return sessions;
    } catch (error) {
      logger.error('session_manager_get_list_failed', error);
      throw new I18nError('session_manager_get_list_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 获取会话详情
   */
  public async getSessionDetails(sessionId: string): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      // 使用存储服务获取会话数据
      const session = await this.storage.getSession(sessionId);
      
      // 如果会话不存在，返回null
      if (!session) {
        logger.warn('session_manager_session_not_found', sessionId);
        return null;
      }

      // 添加导航数据
      return this.enrichSessionWithNavigationData(session);
    } catch (error) {
      logger.error('session_manager_get_session_failed', sessionId, error);
      throw new I18nError('session_manager_get_session_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 增强会话对象，添加导航数据
   */
  private async enrichSessionWithNavigationData(session: BrowsingSession): Promise<BrowsingSession> {
    try {
      // 获取导航数据 
      const navData = await this.getSessionNavigationData(session.id);
      
      // 返回完整的会话对象
      const fullSession: BrowsingSession = {
        ...session,
        records: navData.records,
        edges: navData.edges,
        rootIds: navData.rootIds,
      };

      return fullSession;
    } catch (error) {
      logger.error('session_navigation_data_failed', session.id, error);
      // 失败时仍返回基本会话，但带有空导航数据
      return {
        ...session,
        records: {},
        edges: {},
        rootIds: []
      };
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
    try {
      // 通过导航管理器获取图数据
      const navManager = getNavigationManager();
      const { nodes, edges } = await navManager.getSessionGraph(sessionId);

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
      logger.error('session_manager_get_navigation_failed', sessionId, error);
      // 出错时返回空数据，而不是终止整个流程
      return {
        records: {},
        edges: {},
        rootIds: [],
      };
    }
  }
  
  /**
   * 创建新会话
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
        title: options?.title || i18n('session_manager_default_session_name', new Date().toLocaleString()),
        description: options?.description || "",
        startTime: Date.now(),
        isActive: true,
        nodeCount: 0,
        tabCount: 0,
        lastActivity: Date.now(), // 初始化为创建时间
        metadata: options?.metadata || {},
        records: {},
        edges: {},
        rootIds: [],
      };
  
      // 如果设置为活跃会话或未指定（默认为true）
      const makeActive = options?.makeActive !== false;
  
      if (makeActive) {
        // 将当前活跃会话设为非活跃
        if (this.latestSessionId) {
          await this.deactivateSession(this.latestSessionId);
        }
  
        // 更新最新会话ID和当前会话ID
        this.latestSessionId = sessionId;
        
        // 如果没有指定不更新查看会话，也更新当前会话ID
        if (options?.updateCurrent !== false) {
          this.currentSessionId = sessionId;
        }
      }
  
      // 保存到存储和缓存
      await this.storage.saveSession(newSession);
  
      logger.log('session_manager_created_session', sessionId, newSession.title);
  
      // 发出事件
      sessionEvents.emitSessionCreated(sessionId, {
        title: newSession.title,
        makeActive,
      });
  
      if (makeActive) {
        sessionEvents.emitSessionActivated(sessionId);
        
        // 如果同时也设置为当前查看会话
        if (this.currentSessionId === sessionId) {
          sessionEvents.emitSessionViewed(sessionId);
        }
      }
  
      return newSession;
    } catch (error) {
      logger.error('background_session_create_failed', error);
      throw new I18nError(
        'background_session_create_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 创建并激活新会话
   * 被NavigationManager调用，在没有活跃会话时创建新会话
   * @param title 会话标题
   */
  public async createAndActivateSession(
    title: string
  ): Promise<BrowsingSession> {
    try {
      // 创建新会话
      const newSession = await this.createSession({
        title: title,
        makeActive: true
      });
      
      // 设置为当前会话和最新会话
      await this.setCurrentSession(newSession.id);
      await this.setLatestSession(newSession.id);
      
      return newSession;
    } catch (error) {
      logger.error("session_manager_create_activate_failed", error);
      throw new I18nError('session_manager_create_activate_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 更新会话
   */
  public async updateSession(
    sessionId: string,
    updateData: SessionUpdateOptions
  ): Promise<BrowsingSession> {
    await this.ensureInitialized();
    
    try {
      // 验证会话是否存在
      const existingSession = await this.storage.getSession(sessionId);
      if (!existingSession) {
        throw new I18nError('session_does_not_exist', sessionId);
      }
      
      // 更新会话
      await this.storage.updateSession(sessionId, updateData);
      
      // 获取更新后的会话
      const updatedSession = await this.storage.getSession(sessionId);
      if (!updatedSession) {
        throw new I18nError('session_not_found_after_update');
      }
      
      // 发布会话更新事件
      sessionEvents.emitSessionUpdated(sessionId);
      
      logger.log('session_manager_updated', sessionId);
      
      return updatedSession;
    } catch (error) {
      logger.error('session_manager_update_failed', sessionId, error);
      throw new I18nError('session_manager_update_failed',
        error instanceof Error ? error.message : String(error)
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
      const session = await this.storage.getSession(sessionId);
      if (!session) {
        logger.warn('update_node_count_failed_session_not_found', sessionId);
        return;
      }
  
      if (count !== undefined) {
        session.nodeCount = count;
      } else {
        session.nodeCount = (session.nodeCount || 0) + 1;
      }
  
      // 更新存储，不触发事件
      await this.storage.saveSession(session);
    } catch (error) {
      logger.error('update_node_count_session_failed', sessionId, error);
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
      const session = await this.storage.getSession(sessionId);
      if (!session) {
        logger.warn('update_tab_count_failed_session_not_found', sessionId);
        return;
      }
  
      if (count !== undefined) {
        session.tabCount = count;
      } else {
        session.tabCount = (session.tabCount || 0) + 1;
      }
  
      // 更新存储，不触发事件
      await this.storage.saveSession(session);
    } catch (error) {
      logger.error('update_tab_count_session_failed', sessionId, error);
    }
  }
  
  /**
   * 将会话设置为非活跃状态
   */
  private async deactivateSession(sessionId: string): Promise<void> {
    try {
      const session = await this.storage.getSession(sessionId);
      if (!session) {
        logger.warn('session_manager_deactivate_not_found', sessionId);
        return;
      }
      
      if (!session.isActive) {
        logger.log('session_manager_already_inactive', sessionId);
        return;
      }
      
      await this.storage.updateSession(sessionId, {
        isActive: false,
        endTime: Date.now()
      });
      
      sessionEvents.emitSessionDeactivated(sessionId);
      
      logger.log('session_manager_deactivated', sessionId);
    } catch (error) {
      logger.error('session_manager_deactivate_failed', sessionId, error);
    }
  }
  
  /**
   * 结束会话
   */
  public async endSession(sessionId: string): Promise<BrowsingSession> {
    await this.ensureInitialized();
    
    try {
      // 验证会话是否存在
      const existingSession = await this.storage.getSession(sessionId);
      if (!existingSession) {
        throw new I18nError('session_does_not_exist', sessionId);
      }
      
      // 如果会话已经结束，直接返回
      if (!existingSession.isActive) {
        return existingSession;
      }
      
      // 更新会话状态
      await this.storage.updateSession(sessionId, {
        endTime: Date.now(),
        isActive: false
      });
      
      // 获取更新后的会话
      const updatedSession = await this.storage.getSession(sessionId);
      if (!updatedSession) {
        throw new I18nError('session_not_found_after_end');
      }
      
      // 如果这是最新会话，清除引用
      if (this.latestSessionId === sessionId) {
        this.latestSessionId = null;
      }
      
      // 发布会话结束事件
      sessionEvents.emitSessionEnded(sessionId);
      
      logger.log('session_manager_ended_session', sessionId);
      
      return updatedSession;
    } catch (error) {
      logger.error('session_manager_end_failed', sessionId, error);
      throw new I18nError('session_manager_end_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 删除会话
   * @returns 返回true表示删除成功
   */
  public async deleteSession(sessionId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      // 验证会话是否存在
      const existingSession = await this.storage.getSession(sessionId);
      if (!existingSession) {
        throw new I18nError('session_does_not_exist', sessionId);
      }
      
      // 删除会话
      await this.storage.deleteSession(sessionId);
      
      // 更新引用
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
      }
      if (this.latestSessionId === sessionId) {
        this.latestSessionId = null;
      }
      
      // 发布会话删除事件
      sessionEvents.emitSessionDeleted(sessionId);
      
      logger.log('session_manager_deleted', sessionId);
      
      return true;
    } catch (error) {
      logger.error('session_manager_delete_failed', sessionId, error);
      throw new I18nError('session_manager_delete_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 获取当前查看的会话
   */
  public async getCurrentSession(): Promise<BrowsingSession | null> {
    if (!this.currentSessionId) {
      return null;
    }
    
    return await this.getSessionDetails(this.currentSessionId);
  }
  
  /**
   * 设置当前查看的会话
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
        this.currentSessionId = null;
        return null;
      }
      
      // 如果与当前会话相同，直接返回会话
      if (this.currentSessionId === sessionId) {
        logger.log('session_manager_already_current', sessionId);
        return await this.getSessionDetails(sessionId);
      }
      
      // 检查会话是否存在
      const session = await this.getSessionDetails(sessionId);
      if (!session) {
        throw new I18nError('session_does_not_exist', sessionId);
      }
      
      // 更新当前会话ID
      this.currentSessionId = sessionId;
      
      logger.log('session_manager_set_current', sessionId);
      
      // 发出事件
      sessionEvents.emitSessionViewed(sessionId);
      
      return session;
    } catch (error) {
      logger.error('session_manager_set_current_failed', sessionId, error);
      throw new I18nError('session_manager_set_current_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 获取当前会话ID
   */
  public getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }
  
  /**
   * 获取最新活跃会话
   */
  public async getLatestSession(): Promise<BrowsingSession | null> {
    await this.ensureInitialized();

    if (!this.latestSessionId) {
      return null;
    }

    try {
      return await this.getSessionDetails(this.latestSessionId);
    } catch (error) {
      logger.error("latest_session_load_failed", error);
      throw new I18nError('latest_session_load_failed_message',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 设置最新活跃会话
   * @param sessionId 要设置为最新会话的ID
   * @returns 设置的会话对象
   */
  public async setLatestSession(
    sessionId: string | null
  ): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      // 如果ID为null，清除最新会话
      if (sessionId === null) {
        const oldSessionId = this.latestSessionId;
        this.latestSessionId = null;
        
        if (oldSessionId) {
          // 将原最新会话设为非活跃
          await this.deactivateSession(oldSessionId);
        }
        
        return null;
      }
      
      // 如果与最新会话相同，直接返回会话
      if (this.latestSessionId === sessionId) {
        logger.log('session_manager_already_latest', sessionId);
        return await this.getSessionDetails(sessionId);
      }
      
      // 检查会话是否存在
      const session = await this.getSessionDetails(sessionId);
      if (!session) {
        throw new I18nError('session_does_not_exist', sessionId);
      }
      
      // 将当前最新会话设为非活跃
      if (this.latestSessionId) {
        await this.deactivateSession(this.latestSessionId);
      }
      
      // 更新最新会话ID
      this.latestSessionId = sessionId;
      
      // 更新会话为活跃状态
      await this.storage.updateSession(sessionId, {
        isActive: true,
        lastActivity: Date.now()
      });
      
      logger.log('session_manager_set_latest', sessionId);
      
      // 发出事件
      sessionEvents.emitSessionActivated(sessionId);
      
      return session;
    } catch (error) {
      logger.error('session_manager_set_latest_failed', sessionId, error);
      throw new I18nError('session_manager_set_latest_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 获取最新会话ID
   */
  public getLatestSessionId(): string | null {
    return this.latestSessionId;
  }
  
  /**
   * 同步当前会话到最新会话
   */
  public async syncCurrentToLatest(): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      if (!this.currentSessionId) {
        logger.warn('session_no_current_to_sync_latest');
        return null;
      }
      
      return await this.setLatestSession(this.currentSessionId);
    } catch (error) {
      logger.error('sync_current_to_latest_failed', error);
      throw new I18nError('sync_current_to_latest_failed_message',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 同步最新会话到当前会话
   */
  public async syncLatestToCurrent(): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      if (!this.latestSessionId) {
        logger.warn('session_no_latest_to_sync_current');
        return null;
      }
      
      return await this.setCurrentSession(this.latestSessionId);
    } catch (error) {
      logger.error('sync_latest_to_current_failed', error);
      throw new I18nError('sync_latest_to_current_failed_message',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 检查是否需要处理日期转换
   */
  public async checkDayTransition(): Promise<void> {
    try {
      // 获取当前活跃的策略
      const strategy = this.strategyFactory.getActiveStrategy();
      
      // 如果没有最新会话，直接创建新会话
      if (!this.latestSessionId) {
        const newSession = await strategy.createSession();
        this.latestSessionId = newSession.id;
        
        // 如果当前没有查看的会话，设置同样的会话为当前会话
        if (!this.currentSessionId) {
          this.currentSessionId = newSession.id;
        }
        return;
      }
      
      // 获取当前会话和活动时间
      const latestSession = await this.getSessionDetails(this.latestSessionId);
      const lastActivityTime = this.activityMonitor.getLastActivityTime();
      
      // 检查是否需要创建新会话
      if (latestSession) {
        const needNewSession = await strategy.shouldCreateNewSession(
          lastActivityTime,
          Date.now(),
          latestSession
        );
        
        if (needNewSession) {
          // 结束当前会话
          await this.endSession(this.latestSessionId);
          
          // 创建新会话
          const newSession = await strategy.createSession();
          
          // 更新最新会话ID
          this.latestSessionId = newSession.id;
          
          // 如果当前会话是原最新会话，也更新当前会话ID
          if (this.currentSessionId === latestSession.id) {
            this.currentSessionId = newSession.id;
          }
        }
      }
    } catch (error) {
      logger.error("date_transition_check_failed", error);
    }
  }
  
  /**
   * 标记会话活动
   */
  public async markSessionActivity(
    currentTime: number = Date.now(), 
    previousActivityTime: number = 0
  ): Promise<void> {
    // 如果没有最新会话，创建一个新会话
    if (!this.latestSessionId) {
      const strategy = this.strategyFactory.getActiveStrategy();
      const newSession = await strategy.createSession();
      this.latestSessionId = newSession.id;
      
      // 如果当前没有查看的会话，设置同样的会话为当前会话
      if (!this.currentSessionId) {
        this.currentSessionId = newSession.id;
      }
      return;
    }
    
    try {
      // 检查是否需要创建新会话
      const latestSession = await this.getSessionDetails(this.latestSessionId);
      if (latestSession && previousActivityTime > 0) {
        const strategy = this.strategyFactory.getActiveStrategy();
        const needNewSession = await strategy.shouldCreateNewSession(
          previousActivityTime,
          currentTime,
          latestSession
        );
        
        if (needNewSession) {
          // 结束当前会话
          await this.endSession(this.latestSessionId);
          
          // 创建新会话
          const newSession = await strategy.createSession();
          
          // 更新最新会话ID
          this.latestSessionId = newSession.id;
          
          // 如果当前会话是原最新会话，也更新当前会话ID
          if (this.currentSessionId === latestSession.id) {
            this.currentSessionId = newSession.id;
          }
          
          return; // 创建了新会话后直接返回
        }
      }
      
      // 更新最新会话的最后活动时间
      if (this.latestSessionId) {
        await this.storage.updateSession(this.latestSessionId, { 
          lastActivity: currentTime 
        });
      }
    } catch (error) {
      logger.error("session_activity_mark_failed", error);
    }
  }

  /**
   * 处理用户空闲
   */
  public async handleUserIdle(): Promise<void> {
    if (!this.latestSessionId) return;
    
    logger.log('session_manager_idle_detected');
    
    try {
      // 结束当前会话
      await this.endSession(this.latestSessionId);
    } catch (error) {
      logger.error("session_manager_auto_end_failed", error);
    }
  }

  /**
   * 处理标签页关闭
   */
  public async handleTabClosed(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo): Promise<void> {
    if (!this.latestSessionId) return;
    
    logger.log('session_manager_tab_closed', tabId);
    
    try {
      const navManager = getNavigationManager();
      await navManager.closeNodesForTab(tabId, this.latestSessionId);
    } catch (error) {
      logger.error('session_manager_close_nodes_failed', error);
    }
  }

  /**
   * 获取空闲超时时间(毫秒)
   */
  public getIdleTimeoutMs(): number {
    return this.activityMonitor.getIdleTimeoutMs();
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
      // 获取指定会话
      const session = await this.getSessionDetails(sessionId);
      if (!session) {
        throw new I18nError('session_does_not_exist', sessionId);
      }
  
      // 计算基本统计信息
      let totalNodes = session.nodeCount || 0;
      const duration = session.endTime
        ? session.endTime - session.startTime
        : Date.now() - session.startTime;
  
      // 域名和URL访问统计
      const domainCounts: Map<string, number> = new Map();
      const pageCounts: Map<string, {url: string, title: string, visits: number}> = new Map();
      const hourlyActivity: Map<number, number> = new Map();
      
      try {
        // 获取会话的详细导航数据
        const navManager = getNavigationManager();
        const sessionNodes = await navManager.queryNodes({ sessionId });
        
        // 处理每个节点的统计信息
        sessionNodes.forEach(node => {
          // 提取域名
          try {
            const url = new URL(node.url);
            const domain = url.hostname;
            
            // 更新域名统计
            domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
            
            // 更新页面访问统计
            const pageKey = node.url;
            if (!pageCounts.has(pageKey)) {
              pageCounts.set(pageKey, {
                url: node.url,
                title: node.title || node.url,
                visits: 0
              });
            }
            pageCounts.get(pageKey)!.visits += 1;
            
            // 更新小时活动统计
            const hour = new Date(node.timestamp).getHours();
            hourlyActivity.set(hour, (hourlyActivity.get(hour) || 0) + 1);
          } catch (urlError) {
            // 忽略无效URL
          }
        });
      } catch (navError) {
        logger.error('session_statistics_failed', sessionId, navError);
        // 继续执行，返回基础统计信息
      }
      
      // 计算唯一域名数
      const uniqueDomains = domainCounts.size;
      
      // 获取访问最多的域名（最多10个）
      const topDomains = Array.from(domainCounts.entries())
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      
      // 获取访问最多的页面（最多10个）
      const mostVisitedPages = Array.from(pageCounts.values())
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 10);
      
      // 生成所有小时的活动统计
      const activityByHour = Array.from({ length: 24 }, (_, i) => i)
        .map(hour => ({
          hour,
          count: hourlyActivity.get(hour) || 0
        }));
      
      return {
        totalNodes,
        uniqueDomains,
        duration,
        topDomains,
        mostVisitedPages,
        activityByHour
      };
    } catch (error) {
      logger.error('session_statistics_failed', sessionId, error);
      throw new I18nError('session_statistics_failed_message',
        error instanceof Error ? error.message : String(error)
      );
    }
  } 
}
// 单例模式
let sessionManagerInstance: SessionManager | null = null;

/**
 * 获取会话管理器实例
 */
export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    throw new I18nError('session_manager_not_initialized');
  }
  return sessionManagerInstance;
}

/**
 * 设置会话管理器实例
 */
export function setSessionManager(instance: SessionManager): void {
  sessionManagerInstance = instance;
}