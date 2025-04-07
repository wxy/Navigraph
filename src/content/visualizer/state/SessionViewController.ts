/**
 * 会话处理器
 * 管理会话相关操作，如加载、保存、切换会话等
 */
import { Logger } from '../../../lib/utils/logger.js';
import { sessionServiceClient } from '../../core/session-service-client.js';
import type { UIManager } from '../ui/UIManager.js';
import type { NavigationVisualizer } from '../../core/navigation-visualizer.js';
import type { SessionDetails } from '../../types/session.js';
import { nodeManager } from '../../core/node-manager.js';

const logger = new Logger('SessionViewController');

export class SessionViewController {
  private visualizer: NavigationVisualizer;
  private uiManager: UIManager;
  
  /**
   * 构造函数
   */
  constructor(visualizer: NavigationVisualizer, uiManager: UIManager) {
    this.visualizer = visualizer;
    this.uiManager = uiManager;
    logger.log('会话视图控制器初始化');
  }
  
  /**
   * 初始化会话管理
   */
  async initialize(): Promise<void> {
    logger.log("初始化会话管理...");
    
    try {
      // 直接在会话选择器上注册事件监听
      const sessionSelector = document.getElementById('session-selector');
      if (sessionSelector) {
        sessionSelector.addEventListener('change', (e) => {
          const target = e.target as HTMLSelectElement;
          this.handleSessionSelected(target.value);
        });
      }
      
      // 订阅会话加载事件
      sessionServiceClient.onSessionLoaded((session) => 
        this.handleSessionLoaded(session)
      );
      sessionServiceClient.onSessionsListLoaded((sessions) => 
        this.handleSessionListLoaded(sessions)
      );
      
      // 加载会话列表
      await this.loadSessionList();
      
      // 加载当前会话
      await this.loadCurrentSession();
      
      logger.log("会话管理初始化完成");
    } catch (error) {
      logger.error("会话管理初始化失败:", error);
      this.uiManager.showError("会话管理初始化失败");
      throw error;
    }
  }
  
  /**
   * 加载会话列表
   */
  async loadSessionList(): Promise<any[]> {
    try {
      logger.log("加载会话列表...");
      
      const sessions = await sessionServiceClient.loadSessions();
      this.handleSessionListLoaded(sessions);
      
      logger.log("会话列表加载完成，找到", sessions.length, "个会话");
      
      return sessions;
    } catch (error) {
      logger.error("加载会话列表失败:", error);
      this.uiManager.showError("加载会话列表失败");
      throw error;
    }
  }
  
  /**
   * 处理会话列表加载
   */
  handleSessionListLoaded(sessions: any[]): void {
    try {
      logger.log(`会话列表已加载，共${sessions.length}个会话`);
      
      // 更新会话选择器
      this.updateSessionSelector(sessions);
    } catch (error) {
      logger.error("处理会话列表失败:", error);
    }
  }
  
  /**
   * 更新会话选择器
   */
  updateSessionSelector(sessions?: any[]): void {
    logger.debug("更新会话选择器...");

    try {
      // 如果提供了会话列表，直接使用
      if (sessions) {
        // 获取当前会话ID
        const currentSession = sessionServiceClient.getCurrentSession();
        const currentSessionId = currentSession ? currentSession.id : undefined;

        // 不再传递回调函数
        this.uiManager.updateSessionSelector(sessions, currentSessionId);
        return;
      }

      // 否则从会话管理器同步获取
      const availableSessions = sessionServiceClient.getSessions();
      const currentSession = sessionServiceClient.getCurrentSession();
      const currentSessionId = currentSession ? currentSession.id : undefined;

      // 不再传递回调函数
      this.uiManager.updateSessionSelector(availableSessions, currentSessionId);
    } catch (error) {
      logger.error("更新会话选择器失败", error);
    }
  }
  
  /**
   * 处理会话选择
   */
  async handleSessionSelected(sessionId: string): Promise<void> {
    try {
      logger.log("选择会话:", sessionId);

      // 更新当前会话
      await sessionServiceClient.switchSession(sessionId);
      
      // 加载会话数据
      await this.loadCurrentSession();
      
      // 刷新可视化
      this.visualizer.refreshVisualization();
      
      logger.log("会话切换成功");
    } catch (error) {
      logger.error("选择会话失败:", error);
      this.uiManager.showError("选择会话失败");
    }
  }
  
  /**
   * 加载当前会话
   */
  async loadCurrentSession(): Promise<SessionDetails | null> {
    try {
      logger.log("加载当前会话...");

      const session = await sessionServiceClient.loadCurrentSession();
      this.handleSessionLoaded(session);
      
      logger.log("当前会话加载完成");
      
      return session;
    } catch (error) {
      logger.error("加载当前会话失败:", error);
      this.uiManager.showError("加载当前会话失败");
      throw error;
    }
  }
  
  /**
   * 处理会话加载
   */
  handleSessionLoaded(session: SessionDetails | null): void {
    try {
      logger.log("会话已加载，准备更新UI和数据");

      // 移除加载状态
      document.body.classList.remove("loading-session");

      if (!session) {
        this.uiManager.showError("会话加载失败或无可用会话");
        return;
      }

      // 保存当前会话到可视化器
      this.visualizer.currentSession = session;

      // 从节点管理器获取处理好的数据
      const nodes = [...nodeManager.getNodes()];
      const edges = [...nodeManager.getEdges()];
      const nodeMap = nodeManager.getNodeMap();
      
      // 设置可视化器数据
      this.visualizer.setRawData(nodes, edges, nodeMap);

      // 更新会话相关UI
      this.updateSessionUI();

      this.visualizer.refreshVisualization(undefined, { restoreTransform: true });
      
      logger.log("会话已加载:", { 
        id: session.id, 
        title: session.title,
        nodes: nodes.length,
        edges: edges.length
      });
    } catch (error) {
      logger.error("处理会话加载失败:", error);
      this.uiManager.showError("处理会话数据失败");
    }
  }
  
  /**
   * 更新会话相关UI
   */
  private updateSessionUI(): void {
    // 更新会话选择器
    this.updateSessionSelector();

    // 更新状态栏
    this.visualizer.updateStatusBar();

    // 使用 UIManager 隐藏控制面板
    this.uiManager.hideControlPanel();
  }
  
  /**
   * 清理会话数据
   */
  cleanup(): void {
    logger.log("清理会话数据...");
    // 清理任何特定的会话相关资源
  }
  
  /**
   * 刷新会话数据
   * 完全包装对sessionServiceClient的调用，统一数据刷新逻辑
   */
  async refreshData(): Promise<void> {
    try {
      logger.log("刷新会话数据...");
      await sessionServiceClient.loadSessions();
      await sessionServiceClient.loadCurrentSession();
      logger.log("会话数据刷新完成");
    } catch (error) {
      logger.error("刷新会话数据失败:", error);
      throw error;
    }
  }

  /**
   * 加载会话内容
   * 简化的方法，不触发UI更新
   */
  async loadSessionData(): Promise<void> {
    await sessionServiceClient.loadSessions();
    await sessionServiceClient.loadCurrentSession();
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): SessionDetails | null {
    return sessionServiceClient.getCurrentSession();
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): SessionDetails[] {
    return sessionServiceClient.getSessions();
  }
}