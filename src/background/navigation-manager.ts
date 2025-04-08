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
import { NavigationEventHandler } from './navigation/managers/navigation-event-handler.js';
import { NavigationMessageHandler } from './navigation/managers/navigation-message-handler.js';

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

  // 导航事件处理器
  private navigationEventHandler: NavigationEventHandler;

  // 导航消息处理器
  private navigationMessageHandler: NavigationMessageHandler;

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

    // 初始化导航事件处理器
    this.navigationEventHandler = new NavigationEventHandler(
      this.tabStateManager,
      this.nodeTracker,
      this.edgeTracker,
      this.pendingNavigationTracker,
      this.navigationStorage,
      this.currentSessionId,
      this.debugMode
    );

    // 初始化导航消息处理器
    this.navigationMessageHandler = new NavigationMessageHandler(
      messageService,
      this.nodeTracker,
      this.navigationEventHandler,
      this.debugMode
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
      this.navigationMessageHandler.registerMessageHandlers();
      logger.groupEnd();

      // 使用NavigationEventHandler设置事件监听器替代原来的方法
      this.navigationEventHandler.setupEventListeners();
            
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
    this.navigationEventHandler.setCurrentSessionId(sessionId);
    
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
    this.navigationEventHandler.setDebugMode(enabled);
    this.navigationMessageHandler.setDebugMode(enabled);

    logger.log(`导航管理器调试模式: ${enabled ? "已启用" : "已禁用"}`);
  }
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
    
    // 重置当前会话ID
    // 注意：不重置currentSessionId，因为这可能会在后续的操作中需要
    
    logger.log('已重置导航管理器内部状态');
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