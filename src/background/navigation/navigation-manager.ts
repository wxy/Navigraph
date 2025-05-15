import { Logger } from '../../lib/utils/logger.js';
import { NavigationStorage, getNavigationStorage } from '../store/navigation-storage.js';
import { BackgroundMessageService } from '../messaging/bg-message-service.js';
import { 
  BrowsingSession,
  NavNode,
  NavLink
} from '../../types/session-types.js';
import { _, _Error } from '../../lib/utils/i18n.js';
import { getSettingsService } from '../../lib/settings/service.js';
import { getSessionManager } from '../session/session-manager.js';

import { TabStateManager } from './managers/tab-state-manager.js';
import { NodeTracker } from './managers/node-tracker.js';
import { EdgeTracker } from './managers/edge-tracker.js';
import { PendingNavigationTracker } from './managers/pending-navigation-tracker.js';
import { NavigationEventHandler } from './managers/navigation-event-handler.js';
import { NavigationMessageHandler } from './managers/navigation-message-handler.js';

const logger = new Logger('NavigationManager');

/**
 * 导航管理器 - 协调各组件管理导航节点、事件和关系
 * 
 * 该类作为中央协调器，管理和协调下列子组件：
 * 1. NavigationEventHandler - 处理Chrome API导航事件
 * 2. NavigationMessageHandler - 处理内容脚本消息
 * 3. NodeTracker - 管理节点创建和更新
 * 4. EdgeTracker - 管理节点间的关系
 * 5. TabStateManager - 管理标签页状态
 * 6. PendingNavigationTracker - 管理待处理导航
 */
export class NavigationManager {
  // 存储引用
  private navigationStorage: NavigationStorage;

  // 会话ID
  private currentSessionId: string = '';

  // 组件实例
  private tabStateManager: TabStateManager;
  private nodeTracker: NodeTracker;
  private edgeTracker: EdgeTracker;
  private pendingNavigationTracker: PendingNavigationTracker;
  private navigationEventHandler: NavigationEventHandler;
  private navigationMessageHandler: NavigationMessageHandler;

  // 配置参数
  private expirationTime = 10000; // 待处理导航的过期时间（毫秒）
  private historyLimit = 50;      // 每个标签页的历史记录限制

  /**
   * 构造函数 - 初始化导航管理器
   * @param messageService 消息服务实例
   * @param navigationStorage 导航存储实例（可选，用于依赖注入）
   */
  constructor(
    private readonly messageService: BackgroundMessageService,
    navigationStorage?: NavigationStorage
  ) {
    // 优先使用传入的实例，否则使用单例
    this.navigationStorage = navigationStorage || getNavigationStorage();
  
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
  
    // 初始化导航事件处理器
    this.navigationEventHandler = new NavigationEventHandler(
      this.tabStateManager,
      this.nodeTracker,
      this.edgeTracker,
      this.pendingNavigationTracker,
      this.navigationStorage,
      this.currentSessionId
    );
  
    // 初始化导航消息处理器
    this.navigationMessageHandler = new NavigationMessageHandler(
      messageService,
      this.nodeTracker,
      this.navigationEventHandler
    );
  }
  
  // 删除 initializeComponents 方法，因为它的逻辑现在在构造函数中

  //-------------------------------------------------------------------------
  // 初始化相关方法
  //-------------------------------------------------------------------------

  /**
   * 初始化导航管理器
   */
  public async initialize(): Promise<void> {
    try {
      logger.log(_('navigation_manager_init_start', '初始化导航管理器...'));
      
      // 初始化存储
      await this.initializeStorage();
      
      // 初始化会话
      await this.initializeSession();
      
      // 设置定期任务
      this.setupPeriodicTasks();
      
      // 注册事件和消息处理程序
      this.registerHandlers();
      
      logger.log(_('navigation_manager_init_complete', '导航管理器初始化完成'));
    } catch (error) {
      logger.error(_('navigation_manager_init_failed', '导航管理器初始化失败: {0}'), error);
      throw new _Error('navigation_manager_init_failed', '导航管理器初始化失败: {0}', error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 初始化存储系统
   */
  private async initializeStorage(): Promise<void> {
    await this.navigationStorage.initialize();
  }

  /**
   * 初始化会话管理
   * 修改为从会话管理器获取当前会话
   */
  private async initializeSession(): Promise<void> {
    try {
      // 从会话管理器获取当前会话ID
      const sessionManager = getSessionManager();
      const currentSessionId = sessionManager.getCurrentSessionId();
      
      if (currentSessionId) {
        this.setCurrentSessionId(currentSessionId);
        logger.log(_('navigation_manager_session_id_retrieved', '已从会话管理器获取当前会话ID: {0}'), currentSessionId);
      } else {
        // 如果没有当前会话，则请求会话管理器创建一个新会话
        logger.log(_('navigation_manager_create_session_start', '未找到活跃会话，请求会话管理器创建新会话...'));
        const newSession = await sessionManager.createAndActivateSession(
          _('background_default_session_name', '会话 {0}', new Date().toLocaleString())
        );
        if (newSession) {
          this.setCurrentSessionId(newSession.id);
        } else {
          logger.error(_('background_create_session_failed', '无法创建新会话'));
          this.setCurrentSessionId('');
        }
      }
    } catch (error) {
      logger.error(_('background_get_create_session_failed', '获取或创建会话失败'), error);
      this.setCurrentSessionId('');
    }
  }

  /**
   * 设置定期任务
   */
  private setupPeriodicTasks(): void {
    setInterval(() => this.cleanupPendingUpdates(), 60000); // 每分钟清理一次待更新列表
    setInterval(() => this.cleanupExpiredNavigations(), 30000); // 每30秒清理一次过期导航
  }

  /**
   * 注册所有处理程序
   */
  private registerHandlers(): void {
    // 注册消息处理程序
    logger.log(_('navigation_manager_register_message_handlers_start', '注册导航相关消息处理程序...'));
    this.navigationMessageHandler.registerMessageHandlers();

    // 设置事件监听器
    logger.log(_('navigation_manager_setup_event_listeners_start', '设置导航相关事件监听器...'));
    this.navigationEventHandler.setupEventListeners();
  }

  //-------------------------------------------------------------------------
  // 会话管理方法
  //-------------------------------------------------------------------------

  /**
   * 设置当前会话ID并同步到所有组件
   * @param sessionId 新的会话ID
   */
  private setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.nodeTracker.setSessionId(sessionId);
    this.edgeTracker.setSessionId(sessionId);
    this.navigationEventHandler.setCurrentSessionId(sessionId);
    
    logger.log(_('navigation_manager_session_changed', '已切换到会话: {0}'), sessionId);
  }

  /**
   * 获取当前会话信息
   * 修改为从会话管理器获取
   */
  public async getCurrentSession(): Promise<BrowsingSession | null> {
    try {
      const sessionManager = getSessionManager();
      return await sessionManager.getCurrentSession();
    } catch (error) {
      logger.error(_('background_get_current_session_failed', '从会话管理器获取当前会话失败'), error);
      return null;
    }
  }
  /**
   * 更新当前使用的会话ID
   * 供SessionManager在latestSessionId变更时调用
   * @param sessionId 最新会话ID
   */
  public updateSessionId(sessionId: string): void {
    logger.log(_('navigation_manager_update_session', '正在更新导航管理器会话ID: {0}'), sessionId);
    
    // 调用内部方法更新会话ID并通知所有子组件
    this.setCurrentSessionId(sessionId);
  }
  /**
   * 获取会话图数据
   * 返回当前会话的节点和边数据
   * @param sessionId 会话ID
   * @returns 包含节点和边的对象
   * @throws 错误信息
   */
  public async getSessionGraph(sessionId: string): Promise<{
    nodes: NavNode[];
    edges: NavLink[];
  }> {
    try {
      // 获取节点和边
      const nodes = await this.nodeTracker.queryNodes({ sessionId });
      const edges = await this.edgeTracker.getEdgesForSession(sessionId);
      
      return { nodes, edges };
    } catch (error) {
      logger.error(_('background_storage_fetch_session_graph_failed', '获取会话 {0} 的导航图谱失败', sessionId), error);
      return { nodes: [], edges: [] };
    }
  }

  //-------------------------------------------------------------------------
  // 资源和状态管理方法
  //-------------------------------------------------------------------------

  /**
   * 清理资源
   */
  public cleanup(): void {
    // 移除事件监听器
    this.navigationEventHandler.removeEventListeners();
    
    // 清理消息处理程序
    this.navigationMessageHandler.unregisterMessageHandlers();
    
    // 重置内部状态
    this.resetNavigationState();
    
    logger.log(_('navigation_manager_resources_cleaned', '导航管理器资源已清理'));
  }

  /**
   * 重置导航状态
   * 重置所有组件的内部状态，但不清除存储的数据
   */
  private resetNavigationState(): void {
    // 重置各个组件的状态
    this.tabStateManager.reset();
    this.nodeTracker.reset();
    this.edgeTracker.reset();
    this.pendingNavigationTracker.reset();

    // 注意：不重置currentSessionId，因为这可能会在后续的操作中需要
    
    logger.log(_('navigation_manager_state_reset', '已重置导航管理器内部状态'));
  }

  //-------------------------------------------------------------------------
  // 定期维护任务
  //-------------------------------------------------------------------------

  /**
   * 清理待更新列表
   */
  private async cleanupPendingUpdates(): Promise<void> {
    try {
      await this.nodeTracker.cleanupCache();
    } catch (error) {
      logger.error(_('background_cleanup_pending_updates_failed', '清理待更新列表失败'), error);
    }
  }

  /**
   * 清理已过期的待处理导航记录
   */
  private cleanupExpiredNavigations(): void {
    this.navigationEventHandler.cleanupExpiredNavigations();
  }

  //-------------------------------------------------------------------------
  // 数据访问方法
  //-------------------------------------------------------------------------

  /**
   * 获取导航存储实例
   */
  public getNavigationStorage(): NavigationStorage {
    return this.navigationStorage;
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
      logger.error(_('background_get_node_count_failed', '获取记录数量失败'), error);
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
      logger.error(_('background_get_tab_history_failed', '获取标签页 {0} 的历史记录失败', tabId.toString()), error);
      return [];
    }
  }

  /**
   * 查询节点
   * @param queryParams 查询参数
   */
  public async queryNodes(queryParams: any): Promise<NavNode[]> {
    return this.nodeTracker.queryNodes(queryParams);
  }

  /**
   * 更新节点状态
   * @param nodeId 节点ID
   * @param updates 更新内容
   */
  public async updateNode(nodeId: string, updates: Partial<NavNode>): Promise<boolean> {
    return this.nodeTracker.updateNode(nodeId, updates);
  }

  /**
   * 关闭与标签页关联的所有节点
   * @param tabId 标签页ID
   * @param sessionId 会话ID
   */
  public async closeNodesForTab(tabId: number, sessionId: string): Promise<void> {
    return this.nodeTracker.closeNodesForTab(tabId, sessionId);
  }

  /**
   * 关闭会话中的所有活跃节点
   * 由会话管理器在会话切换或关闭时调用
   * @param sessionId 会话ID
   */
  public async closeAllNodesInSession(sessionId: string): Promise<void> {
    return this.nodeTracker.closeAllNodesInSession(sessionId);
  }

  /**
   * 将当前打开的标签页关联到指定会话
   * 由会话管理器在会话切换或创建新会话时调用
   * @param sessionId 目标会话ID
   */
  public async associateOpenTabsWithSession(sessionId: string): Promise<void> {
    return this.nodeTracker.associateOpenTabsWithSession(sessionId);
  }

  /**
   * 清除指定时间之前的导航数据
   * @param timestamp 时间戳
   * @returns 清除的节点和边数量
   */
  public async clearDataBeforeTime(timestamp: number): Promise<{nodes: number, edges: number}> {
    try {
      logger.log(_('navigation_manager_clearing_before', '清除{0}之前的导航数据...'), new Date(timestamp).toLocaleString());
      
      // 清除节点和边
      const nodeCount = await this.navigationStorage.clearNodesBeforeTime(timestamp);
      const edgeCount = await this.navigationStorage.clearEdgesBeforeTime(timestamp);
      
      // 重置可能失效的内存缓存
      this.tabStateManager.reset();
      
      logger.log(_('navigation_manager_cleared_before', '已清除{0}之前的导航数据: {1}个节点, {2}条边'), 
                new Date(timestamp).toLocaleString(), nodeCount.toString(), edgeCount.toString());
      
      return { nodes: nodeCount, edges: edgeCount };
    } catch (error) {
      logger.error(_('navigation_manager_clear_before_failed', '清除导航数据失败: {0}'), error);
      throw new _Error('navigation_manager_clear_before_failed', '清除导航数据失败: {0}', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 清除所有导航数据
   * 只清除导航相关数据，不涉及会话数据
   */
  public async clearAllData(): Promise<void> {
    try {
      logger.log(_('navigation_manager_clear_all_start', '开始清除所有导航数据...'));
      
      // 清除导航数据
      await this.navigationStorage.clearAllData();
      
      // 重置内存状态
      this.resetNavigationState();
      
      // 重新初始化导航状态
      await this.initializeSession();
      
      logger.log(_('navigation_manager_clear_all_complete', '所有导航数据已清除'));
    } catch (error) {
      logger.error(_('navigation_manager_clear_all_failed', '清除导航数据失败: {0}'), error);
      throw new _Error('navigation_manager_clear_all_failed', '清除导航数据失败: {0}', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 执行数据保留政策
   * 基于设置中的dataRetention值清除过期数据
   */
  public async executeDataRetentionPolicy(): Promise<void> {
    try {
      const settingsService = getSettingsService();
      const settings = settingsService.getSettings();
      
      // 如果数据保留设置为0，表示无限期保留数据
      if (settings.dataRetention === 0) {
        logger.log(_('data_retention_unlimited', '数据保留策略设置为无限期保留'));
        return;
      }
      
      // 计算保留期限的时间戳
      const retentionDays = settings.dataRetention;
      const cutoffTimestamp = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      logger.log(_('data_retention_executing', '执行数据保留政策: 删除{0}天前的数据 ({1}之前)'), 
                retentionDays.toString(), new Date(cutoffTimestamp).toLocaleString());
      
      // 清除导航数据
      const navResults = await this.clearDataBeforeTime(cutoffTimestamp);
      
      // 清除会话数据 - 使用会话管理器的方法而非直接访问存储
      const sessionManager = getSessionManager();
      const sessionsCleared = await sessionManager.clearSessionsBeforeTime(cutoffTimestamp);
      
      logger.log(_('data_retention_completed', 
                    '数据保留政策执行完成: 已删除{0}个节点, {1}条边, {2}个会话'), 
                navResults.nodes.toString(), 
                navResults.edges.toString(),
                sessionsCleared.toString());
    } catch (error) {
      logger.error(_('data_retention_failed', '执行数据保留政策失败: {0}'), error);
    }
  }
}
// 单例模式
let navigationManagerInstance: NavigationManager | null = null;

export function getNavigationManager(): NavigationManager {
  if (!navigationManagerInstance) {
    throw new _Error('background_instance_not_initialized', 'NavigationManager实例未初始化');
  }
  return navigationManagerInstance;
}

export function setNavigationManager(instance: NavigationManager): void {
  navigationManagerInstance = instance;
}