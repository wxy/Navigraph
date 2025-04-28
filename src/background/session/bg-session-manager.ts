/**
 * 后台会话管理器
 * 负责创建、管理和维护浏览会话
 */
import { Logger } from '../../lib/utils/logger.js';
import { IdGenerator } from "../lib/id-generator.js";
import { SessionStorage, getSessionStorage } from "../store/session-storage.js";
import { sessionEvents } from "./session-event-emitter.js";
import { BackgroundMessageService } from "../messaging/bg-message-service.js";
import { getNavigationManager } from "../navigation/navigation-manager.js";
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
import { UrlUtils } from '../navigation/utils/url-utils.js';

const logger = new Logger('BackgroundSessionManager');

/**
 * 后台会话管理器类
 * 负责会话的创建、更新、删除和查询等操作
 */
export class BackgroundSessionManager {
  // 存储引用
  private storage: SessionStorage;

  // 当前查看的会话ID (UI显示焦点)
  private currentSessionId: string | null = null;
  
  // 最新活动的会话ID (记录新活动)
  private latestSessionId: string | null = null;

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
    this.storage = getSessionStorage();

    logger.log("后台会话管理器已创建");
  }

  /**
   * 初始化会话管理器
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.log("会话管理器已经初始化，跳过");
      return;
    }

    try {
      logger.log("初始化会话管理器...");
      // 先设置初始化标志，以防止循环调用
      this.initialized = true;

      // 初始化存储
      await this.storage.initialize();
      
      // 加载设置
      await this.loadSettings();

      // 注册监听器
      await this.setupListeners();

      // 先加载活跃会话，确保currentSessionId已设置
      await this.loadActiveSessions();

      // 恢复lastActivityTime
      await this.restoreActivityTime();
      
      // 修改：仅在加载会话后再检查日期转换
      if (this.sessionMode === 'daily') {
        await this.checkDayTransition();
      }
      
      // 设置会话活动监听器
      this.setupActivityListeners();

      // 启动状态一致性检查
      this.startStateConsistencyChecker();

      logger.log("会话管理器初始化完成");
    } catch (error) {
      logger.error("会话管理器初始化失败:", error);
      throw new Error(
        `会话管理器初始化失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  
  /**
   * 启动状态一致性检查器
   */
  private startStateConsistencyChecker(): void {
    // 每5分钟执行一次检查
    setInterval(() => {
      this.checkNodeStateConsistency()
        .catch(err => logger.error('节点状态一致性检查失败:', err));
    }, 5 * 60 * 1000);
  }
  
  /**
   * 检查节点状态一致性
   * 确保节点的关闭状态与实际标签页状态一致
   */
  private async checkNodeStateConsistency(): Promise<void> {
    if (!this.latestSessionId) return;
    
    try {
      logger.groupCollapsed('执行节点状态一致性检查...');
      
      // 1. 获取所有活跃标签页，过滤系统页面
      const tabs = await this.getAllActiveTabs();
      const activeTabIds = new Set(
        tabs
          .filter(tab => tab.id !== undefined && tab.url && !UrlUtils.isSystemPage(tab.url))
          .map(tab => tab.id)
      );
      logger.log(`当前有 ${activeTabIds.size} 个活跃标签页（不含系统页面）`);
      
      try {
        // 2. 获取导航管理器实例
        const navManager = getNavigationManager();
        
        // 3. 查询当前会话的节点
        const sessionNodes = await navManager.queryNodes({
          sessionId: this.latestSessionId
        });
        
        // 过滤出活跃(未关闭)节点
        const activeNodes = sessionNodes.filter(node => node.isClosed !== true);
        logger.log(`当前会话有 ${activeNodes.length} 个活跃节点`);

        // 4. 找出标签页已关闭但节点未标记为关闭的节点
        const orphanedNodes = activeNodes.filter(node => 
          node.tabId !== undefined && !activeTabIds.has(node.tabId)
        );
        
        if (orphanedNodes.length > 0) {
          logger.log(`发现 ${orphanedNodes.length} 个孤立节点，标记为已关闭`);
          
          const now = Date.now();
          
          // 更新这些节点状态
          for (const node of orphanedNodes) {
            logger.log(`标记节点 ${node.id} (tabId=${node.tabId}) 为已关闭`);
            await navManager.updateNode(node.id, {
              isClosed: true,
              closeTime: now
            });
          }
        } else {
          logger.log('未发现需要更新状态的孤立节点');
        }
        
        // 其余代码...
        
      } catch (navError) {
        logger.error('获取导航管理器失败:', navError);
      }
      
      logger.log('节点状态一致性检查完成');
      logger.groupEnd();
    } catch (error) {
      logger.error('节点状态一致性检查出错:', error);
    }
  }

  /**
   * 获取所有活跃标签页
   */
  private async getAllActiveTabs(): Promise<chrome.tabs.Tab[]> {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        resolve(tabs);
      });
    });
  }
  /**
   * 恢复最后活动时间
   */
  private async restoreActivityTime(): Promise<void> {
    try {
      // 如果已有当前会话
      if (this.currentSessionId) {
        const currentSession = await this.getSessionDetails(this.currentSessionId);
        if (currentSession) {
          // 使用会话的lastActivity或startTime作为最后活动时间
          this.lastActivityTime = currentSession.lastActivity || currentSession.startTime;
          logger.log(`恢复会话活动时间: ${new Date(this.lastActivityTime).toLocaleString()}`);
          return;
        }
      }
      
      // 默认设置为当前时间
      this.lastActivityTime = Date.now();
    } catch (error) {
      logger.error("恢复活动时间失败:", error);
      this.lastActivityTime = Date.now();
    }
  }
  /**
   * 设置会话活动监听器
   */
  private setupActivityListeners(): void {
    logger.log('设置会话活动监听器');
    
    // 浏览器启动时
    chrome.runtime.onStartup.addListener(() => {
      logger.log('浏览器启动');
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

    // 添加: 标签页关闭监听
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      this.handleTabClosed(tabId, removeInfo);
    });
  }

  /**
   * 处理标签页关闭
   */
  private async handleTabClosed(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo): Promise<void> {
    try {
      if (!this.latestSessionId) return;
      
      logger.log(`标签页 ${tabId} 已关闭，更新节点状态`);
      
      try {
        // 通过导航管理器关闭节点
        const navManager = getNavigationManager();
        await navManager.closeNodesForTab(tabId, this.latestSessionId);
      } catch (error) {
        logger.error('获取导航管理器或关闭节点失败:', error);
      }
    } catch (error) {
      logger.error('处理标签页关闭失败:', error);
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
   * 获取工作日标识符
   * 以标准年月日格式作为工作日标识
   */
  private getWorkDayIdentifier(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 检查是否跨越了工作日边界并需要创建新会话
   */
  public async checkDayTransition(): Promise<void> {
    try {
      await this.ensureInitialized();
      
      // 获取当前活跃会话
      const currentSession = await this.getCurrentSession();
      if (!currentSession) {
        logger.log("没有活跃会话，创建新会话");
        await this.createDailySession();
        return;
      }
      
      // 获取会话的日期和当前日期
      const sessionDate = new Date(currentSession.startTime);
      const nowDate = new Date();
      
      // 计算会话日期和当前日期的工作日
      const sessionWorkDay = this.getWorkDayIdentifier(sessionDate);
      const currentWorkDay = this.getWorkDayIdentifier(nowDate);
      
      // 获取最后活动时间
      const lastActivityTime = this.lastActivityTime || (currentSession.lastActivity ?? currentSession.startTime);
      const now = Date.now();
      const idleTime = now - lastActivityTime;
      
      // 使用配置的空闲超时值 (转换为毫秒)
      const minIdleForNewDay = this.idleTimeoutMinutes * 60 * 1000;
      
      // 如果工作日不同且空闲时间足够，创建新会话
      if (sessionWorkDay !== currentWorkDay && idleTime > minIdleForNewDay) {
        logger.log(`检测到新工作日且空闲时间足够(${Math.round(idleTime / (60 * 60 * 1000))}小时)，创建新会话`);
        await this.endSession(currentSession.id);
        await this.createDailySession();
      } else if (sessionWorkDay !== currentWorkDay) {
        logger.log(`检测到新工作日，但空闲时间不足(${Math.round(idleTime / (60 * 1000))}分钟，需要${Math.round(minIdleForNewDay / (60 * 1000))}分钟)，不创建新会话`);
      }
    } catch (error) {
      logger.error("日期转换检查失败:", error);
    }
  }

  /**
   * 创建每日会话
   * @returns 创建的每日会话
   */
  private async createDailySession(): Promise<BrowsingSession> {
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();
    
    logger.log(`创建新的每日会话: ${dateStr}`);
    
    return await this.createSession({
      title: `${dateStr} 浏览会话`,
      description: `自动创建的 ${dateStr} ${timeStr} 会话`,
      metadata: {
        type: "daily",
        date: now.getTime()
      }
    }, true);
  }

  /**
   * 标记会话活动，并检查是否需要创建新会话
   */
  public async markSessionActivity(): Promise<void> {
    const now = Date.now();
    const previousActivityTime = this.lastActivityTime;
    
    // 更新最后活动时间
    this.lastActivityTime = now;
    
    // 重置空闲计时器
    this.resetIdleTimer();
    
    // 如果没有最新会话，创建一个新会话
    if (!this.latestSessionId) {
      const newSession = await this.createDailySession();
      this.latestSessionId = newSession.id;
      
      // 如果当前没有查看的会话，设置同样的会话为当前会话
      if (!this.currentSessionId) {
        this.currentSessionId = newSession.id;
      }
      return;
    }
    
    try {
      // 检查是否需要创建新会话 - 两个条件：1. 空闲时间足够长 2. 跨越工作日
      const latestSession = await this.getSessionDetails(this.latestSessionId);
      if (latestSession && previousActivityTime > 0) {
        // 计算空闲时间
        const idleTime = now - previousActivityTime;
        
        // 使用配置的空闲超时值
        const idleThreshold = this.idleTimeoutMinutes * 60 * 1000;
        
        // 只有当空闲时间超过阈值时才检查日期
        if (idleTime > idleThreshold) {
          logger.log(`检测到足够长的空闲时间: ${Math.round(idleTime / (60 * 1000))}分钟`);
          
          // 检查是否跨越工作日
          const sessionDate = new Date(latestSession.startTime);
          const nowDate = new Date();
          
          const sessionWorkDay = this.getWorkDayIdentifier(sessionDate);
          const currentWorkDay = this.getWorkDayIdentifier(nowDate);
          
          if (sessionWorkDay !== currentWorkDay) {
            logger.log(`检测到新工作日 ${currentWorkDay}（当前会话工作日为 ${sessionWorkDay}），创建新会话`);
            
            // 结束当前会话
            await this.endSession(this.latestSessionId);
            
            // 创建新的每日会话
            const newSession = await this.createDailySession();
            
            // 更新最新会话ID
            this.latestSessionId = newSession.id;
            
            // 如果当前会话是原最新会话，也更新当前会话ID
            if (this.currentSessionId === latestSession.id) {
              this.currentSessionId = newSession.id;
            }
            
            return; // 创建了新会话后直接返回
          } else {
            logger.log(`虽然有足够空闲时间，但仍在同一工作日 ${currentWorkDay}，不创建新会话`);
          }
        }
      }
      
      // 更新最新会话的最后活动时间
      await this.storage.updateSession(this.latestSessionId, { 
        lastActivity: this.lastActivityTime 
      });
    } catch (error) {
      logger.error("会话活动标记失败:", error);
      // 即使失败也不要中断流程，确保最基本的功能正常
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
    if (!this.latestSessionId) return;
    
    logger.log(`检测到用户空闲超过${this.idleTimeoutMinutes / 60}小时，自动结束当前会话`);
    
    try {
      // 结束当前会话
      await this.endSession(this.latestSessionId);
    } catch (error) {
      logger.error("自动结束会话失败:", error);
    }
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
  
        logger.log(`加载了活跃会话: ${mostRecent.id} - ${mostRecent.title}`);
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
          logger.log(`找到最近会话(${mostRecent.id})，距现在${Math.round(timeSinceLastActivity / (1000 * 60 * 60))}小时，重新激活`);
          
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
      logger.log("未找到活跃会话或最近会话已过期，创建新会话");
      const newSession = await this.createSession({
        title: `会话 ${new Date().toLocaleString()}`,
        description: "自动创建的默认会话",
      }, true);
      
      // 设置为当前和最新会话
      this.currentSessionId = newSession.id;
      this.latestSessionId = newSession.id;
    } catch (error) {
      logger.error("加载活跃会话失败:", error);
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

    logger.log(`已加载会话设置: 模式=${this.sessionMode}, 空闲超时=${this.idleTimeoutMinutes / 60}小时`);
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
    // 将小时转换为分钟
    this.idleTimeoutMinutes = settings.idleTimeout * 60;  
    
    // 处理模式更改
    if (this.initialized && oldMode !== this.sessionMode) {
      this.handleSessionModeChange(oldMode).catch(err => {
        logger.error('处理会话模式变更失败:', err);
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
    logger.log('检测到设置变更，更新会话管理器配置');
    this.applySettings(settings);
  }
  
  /**
   * 处理会话模式变更
   */
  private async handleSessionModeChange(oldMode: string): Promise<void> {
    logger.log(`会话模式从 ${oldMode} 变更为 ${this.sessionMode}`);
    
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
  
      logger.log(`已创建新会话: ${sessionId} - ${newSession.title}`);
  
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
      logger.error("创建会话失败:", error);
      throw new Error(
        `创建会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 设置当前查看的会话
   * @param sessionId 要设置为当前查看会话的ID
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
  
      // 如果会话ID与当前会话相同，无需操作
      if (sessionId === this.currentSessionId) {
        logger.log(`会话 ${sessionId} 已经是当前查看会话`);
        return this.getSessionDetails(sessionId);
      }
  
      // 检查会话是否存在
      const session = await this.getSessionDetails(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }
  
      // 更新当前会话ID
      this.currentSessionId = sessionId;
  
      logger.log(`已将会话 ${sessionId} 设置为当前查看会话`);
  
      // 发出会话查看事件
      sessionEvents.emitSessionViewed(sessionId);
  
      return session;
    } catch (error) {
      logger.error(`设置当前查看会话 ${sessionId} 失败:`, error);
      throw new Error(
        `设置当前查看会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 获取当前会话
   * 被NavigationManager调用，获取当前活跃会话
   */
  public async getCurrentSession(): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
  
    if (!this.currentSessionId) {
      return null;
    }
    
    try {
      return await this.getSessionDetails(this.currentSessionId);
    } catch (error) {
      logger.error("获取当前会话失败:", error);
      return null;  // 返回null而不是抛出异常，适合作为API被其他管理器调用
    }
  }

  /**
   * 创建并激活新会话
   * 被NavigationManager调用，在没有活跃会话时创建新会话
   * @param title 会话标题
   */
  public async createAndActivateSession(title: string): Promise<BrowsingSession | null> {
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
      logger.error("创建并激活新会话失败:", error);
      return null;
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
   * 获取最新活跃会话ID
   * @returns 最新会话ID，如果没有则返回null
   */
  public getLatestSessionId(): string | null {
    return this.latestSessionId;
  }

  /**
   * 获取最新活跃会话
   * @returns 最新会话对象，如果没有则返回null
   */
  public async getLatestSession(): Promise<BrowsingSession | null> {
    await this.ensureInitialized();

    if (!this.latestSessionId) {
      return null;
    }

    try {
      return await this.getSessionDetails(this.latestSessionId);
    } catch (error) {
      logger.error("获取最新会话失败:", error);
      throw new Error(
        `获取最新会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
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
          sessionEvents.emitSessionDeactivated(oldSessionId);
        }

        return null;
      }

      // 如果会话ID与最新会话相同，无需操作
      if (sessionId === this.latestSessionId) {
        logger.log(`会话 ${sessionId} 已经是最新活跃会话`);
        return this.getSessionDetails(sessionId);
      }

      // 检查会话是否存在
      const session = await this.getSessionDetails(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }

      // 将当前最新会话设为非活跃
      if (this.latestSessionId) {
        await this.deactivateSession(this.latestSessionId);
      }

      // 更新最新会话ID
      this.latestSessionId = sessionId;

      // 更新会话为活跃状态
      session.isActive = true;
      await this.storage.saveSession(session);

      logger.log(`已将会话 ${sessionId} 设置为最新活跃会话`);

      // 发出事件
      sessionEvents.emitSessionActivated(sessionId);

      return session;
    } catch (error) {
      logger.error(`设置最新会话 ${sessionId} 失败:`, error);
      throw new Error(
        `设置最新会话失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 将特定会话标记为非活跃
   * @private
   */
  private async deactivateSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      // 获取会话
      const session = await this.getSessionDetails(sessionId);
      if (!session) {
        return;
      }

      // 标记为非活跃
      session.isActive = false;

      // 保存更新
      await this.storage.saveSession(session);

      logger.log(`将会话 ${session.id} 设置为非活跃状态`);

      // 发出事件
      sessionEvents.emitSessionDeactivated(session.id);
    } catch (error) {
      logger.error(`设置会话 ${sessionId} 为非活跃状态失败:`, error);
    }
  }

  /**
   * 同步当前查看会话和最新活跃会话
   * 将当前查看会话设为最新活跃会话
   */
  public async syncCurrentToLatest(): Promise<BrowsingSession | null> {
    if (this.currentSessionId) {
      return this.setLatestSession(this.currentSessionId);
    }
    return null;
  }

  /**
   * 同步最新活跃会话到当前查看会话
   * 将最新活跃会话设为当前查看会话
   */
  public async syncLatestToCurrent(): Promise<BrowsingSession | null> {
    if (this.latestSessionId) {
      return this.setCurrentSession(this.latestSessionId);
    }
    return null;
  }

  /**
   * 根据ID获取会话
   * @param sessionId 会话ID
   * @returns 会话对象，如果不存在则返回null
   */
  public async getSessionDetails(
    sessionId: string
  ): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    try {
      // 从存储获取基本会话信息
      const session = await this.storage.getSession(sessionId);
      
      // 如果会话不存在，返回null
      if (!session) {
        logger.error(`会话 ${sessionId} 不存在`);
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

      return fullSession;
    } catch (error) {
      logger.error(`获取会话 ${sessionId} 失败:`, error);
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
      logger.error(`获取会话 ${sessionId} 的导航数据失败:`, error);
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
      logger.error("获取会话列表失败:", error);
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
      const session = await this.getSessionDetails(sessionId);
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

      logger.log(`已更新会话 ${sessionId}`);

      // 发出事件
      sessionEvents.emitSessionUpdated(sessionId, { updates });

      return session;
    } catch (error) {
      logger.error(`更新会话 ${sessionId} 失败:`, error);
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
      const session = await this.getSessionDetails(sessionId);
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

      logger.log(`已结束会话 ${sessionId}`);

      // 发出事件
      sessionEvents.emitSessionEnded(sessionId, {
        endTime: session.endTime,
      });

      return session;
    } catch (error) {
      logger.error(`结束会话 ${sessionId} 失败:`, error);
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

      // 从存储删除
      const result = await this.storage.deleteSession(sessionId);

      logger.log(`已删除会话 ${sessionId}`);

      // 发出事件
      sessionEvents.emitSessionDeleted(sessionId);

      return result;
    } catch (error) {
      logger.error(`删除会话 ${sessionId} 失败:`, error);
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
      const session = await this.getSessionDetails(sessionId);
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
      logger.error(`获取会话 ${sessionId} 统计信息失败:`, error);
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
      const session = await this.getSessionDetails(sessionId);
      if (!session) {
        logger.warn(`更新节点计数失败: 会话 ${sessionId} 不存在`);
        return;
      }

      if (count !== undefined) {
        session.nodeCount = count;
      } else {
        session.nodeCount = (session.nodeCount || 0) + 1;
      }

      // 更新存储
      await this.storage.saveSession(session);
    } catch (error) {
      logger.error(`更新会话 ${sessionId} 节点计数失败:`, error);
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
      const session = await this.getSessionDetails(sessionId);
      if (!session) {
        logger.warn(`更新标签页计数失败: 会话 ${sessionId} 不存在`);
        return;
      }

      if (count !== undefined) {
        session.tabCount = count;
      } else {
        session.tabCount = (session.tabCount || 0) + 1;
      }

      // 更新存储
      await this.storage.saveSession(session);
    } catch (error) {
      logger.error(`更新会话 ${sessionId} 标签页计数失败:`, error);
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
      const session = await this.getSessionDetails(this.currentSessionId);
      if (!session) {
        // 当前会话不存在，直接清空当前会话ID
        this.currentSessionId = null;
        return;
      }

      // 标记为非活跃
      session.isActive = false;

      // 保存更新
      await this.storage.saveSession(session);

      logger.log(`将会话 ${session.id} 设置为非活跃状态`);

      // 发出事件
      sessionEvents.emitSessionDeactivated(session.id);
    } catch (error) {
      logger.error("设置当前会话为非活跃状态失败:", error);
    }
  }
 
  /**
   * 注册消息处理程序
   * @param messageService 消息服务实例
   */
  public registerMessageHandlers(
    messageService: BackgroundMessageService
  ): void {
    logger.groupCollapsed("注册会话相关消息处理程序");

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

        this.getSessionDetails(sessionId)
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
    // 获取最新会话
    messageService.registerHandler(
      "getLatestSession",
      (
        message: BackgroundMessages.GetLatestSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetLatestSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);

        this.getLatestSession()
          .then((session) => {
            ctx.success({
              session,
              sessionId: session ? session.id : null,
            });
          })
          .catch((error) => {
            ctx.error(`获取最新会话失败: ${error.message}`);
          });

        return true;
      }
    );

    // 设置最新会话
    messageService.registerHandler(
      "setLatestSession",
      (
        message: BackgroundMessages.SetLatestSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.SetLatestSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);
        const { sessionId } = message;

        this.setLatestSession(sessionId)
          .then((session) => {
            ctx.success({
              sessionId,
              session,
            });
          })
          .catch((error) => {
            ctx.error(`设置最新会话失败: ${error.message}`);
          });

        return true;
      }
    );

    // 同步当前查看会话到最新会话
    messageService.registerHandler(
      "syncCurrentToLatest",
      (
        message: BackgroundMessages.SyncCurrentToLatestRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.SyncCurrentToLatestResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);

        this.syncCurrentToLatest()
          .then((session) => {
            ctx.success({
              success: true,
              session,
            });
          })
          .catch((error) => {
            ctx.error(`同步当前查看会话到最新会话失败: ${error.message}`);
          });

        return true;
      }
    );

    // 同步最新会话到当前查看会话
    messageService.registerHandler(
      "syncLatestToCurrent",
      (
        message: BackgroundMessages.SyncLatestToCurrentRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.SyncLatestToCurrentResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(message, sender, sendResponse);

        this.syncLatestToCurrent()
          .then((session) => {
            ctx.success({
              success: true,
              session,
            });
          })
          .catch((error) => {
            ctx.error(`同步最新会话到当前查看会话失败: ${error.message}`);
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
    logger.groupEnd();
  }
}

// 创建单例实例的工厂函数
let sessionManagerInstance: BackgroundSessionManager | null = null;

export function getBackgroundSessionManager(): BackgroundSessionManager {
  if (!sessionManagerInstance) {
    throw new Error('BackgroundSessionManager实例未初始化');
  }
  return sessionManagerInstance;
}

export function setBackgroundSessionManager(instance: BackgroundSessionManager): void {
  sessionManagerInstance = instance;
}