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
          this.navigationEventHandler.handleLinkClick({
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
        this.navigationEventHandler.handleFormSubmitted(tabId, message.formInfo);
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
        this.navigationEventHandler.handleJsNavigation(tabId, message);
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
}