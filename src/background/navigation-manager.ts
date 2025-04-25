import { Logger } from '../lib/utils/logger.js';
import { NavigationStorage, getNavigationStorage } from './store/navigation-storage.js';
import { BackgroundMessageService } from './messaging/bg-message-service.js';
import { 
  BrowsingSession,
  NavNode,
  NavLink
} from '../types/session-types.js';

import { getBackgroundSessionManager } from './session/bg-session-manager.js';

import { TabStateManager } from './navigation/managers/tab-state-manager.js';
import { NodeTracker } from './navigation/managers/node-tracker.js';
import { EdgeTracker } from './navigation/managers/edge-tracker.js';
import { PendingNavigationTracker } from './navigation/managers/pending-navigation-tracker.js';
import { NavigationEventHandler } from './navigation/managers/navigation-event-handler.js';
import { NavigationMessageHandler } from './navigation/managers/navigation-message-handler.js';

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
      logger.log("初始化导航管理器...");
      
      // 初始化存储
      await this.initializeStorage();
      
      // 初始化会话
      await this.initializeSession();
      
      // 设置定期任务
      this.setupPeriodicTasks();
      
      // 注册事件和消息处理程序
      this.registerHandlers();
      
      logger.log("导航管理器初始化完成");
    } catch (error) {
      logger.error("导航管理器初始化失败:", error);
      throw new Error(`导航管理器初始化失败: ${error instanceof Error ? error.message : String(error)}`);
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
      const sessionManager = getBackgroundSessionManager();
      const currentSessionId = sessionManager.getCurrentSessionId();
      
      if (currentSessionId) {
        this.setCurrentSessionId(currentSessionId);
        logger.log(`已从会话管理器获取当前会话ID: ${currentSessionId}`);
      } else {
        // 如果没有当前会话，则请求会话管理器创建一个新会话
        logger.log("未找到活跃会话，请求会话管理器创建新会话...");
        const newSession = await sessionManager.createAndActivateSession(
          `浏览会话 ${new Date().toLocaleString()}`
        );
        if (newSession) {
          this.setCurrentSessionId(newSession.id);
        } else {
          logger.error("无法创建新会话");
          this.setCurrentSessionId('');
        }
      }
    } catch (error) {
      logger.error("获取或创建会话失败:", error);
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
    logger.log('注册导航相关消息处理程序...');
    this.navigationMessageHandler.registerMessageHandlers();

    // 设置事件监听器
    logger.log('设置导航相关事件监听器...');
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
    
    logger.log(`已切换到会话: ${sessionId}`);
  }

  /**
   * 获取当前会话信息
   * 修改为从会话管理器获取
   */
  public async getCurrentSession(): Promise<BrowsingSession | null> {
    try {
      const sessionManager = getBackgroundSessionManager();
      return await sessionManager.getCurrentSession();
    } catch (error) {
      logger.error("从会话管理器获取当前会话失败:", error);
      return null;
    }
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
      logger.error(`获取会话 ${sessionId} 图数据失败:`, error);
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
    
    logger.log('导航管理器资源已清理');
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
    
    logger.log('已重置导航管理器内部状态');
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
      logger.error("清理待更新列表失败:", error);
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
}
// 单例模式
let navigationManagerInstance: NavigationManager | null = null;

export function getNavigationManager(): NavigationManager {
  if (!navigationManagerInstance) {
    throw new Error('NavigationManager实例未初始化');
  }
  return navigationManagerInstance;
}

export function setNavigationManager(instance: NavigationManager): void {
  navigationManagerInstance = instance;
}