/**
 * 会话处理器
 * 管理会话相关操作，如加载、保存、切换会话等
 */
import { Logger } from '../../../lib/utils/logger.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';
import { sessionServiceClient } from '../../core/session-service-client.js';
import type { UIManager } from '../ui/UIManager.js';
import type { NavigationVisualizer } from '../../core/navigation-visualizer.js';
import type { SessionDetails } from '../../types/session.js';
import { nodeManager } from '../../core/node-manager.js';

const logger = new Logger('SessionViewController');

export class SessionViewController {
  private visualizer: NavigationVisualizer;
  private uiManager: UIManager;
  
  // 防止递归调用的标志
  private isHandlingSessionLoaded: boolean = false;
  private isRefreshingData: boolean = false;
  
  /**
   * 构造函数
   */
  constructor(visualizer: NavigationVisualizer, uiManager: UIManager) {
    this.visualizer = visualizer;
    this.uiManager = uiManager;
    logger.log('session_view_controller_init');
  }
  
  /**
   * 初始化会话管理
   */
  async initialize(): Promise<void> {
    logger.log("session_management_init_start");
    
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
      sessionServiceClient.onSessionsListLoaded((sessionList) => 
        this.handleSessionListLoaded(sessionList)
      );
      
      // 加载会话列表
      await this.loadSessionList();
      
      // 加载当前会话
      await this.loadCurrentSession();

      // 获取最新会话ID (不需要单独加载，仅获取ID用于视觉区分)
      await sessionServiceClient.loadLatestSession();
      
      logger.log("session_management_init_complete");
    } catch (error) {
      logger.error("session_management_init_failed", error);
      this.uiManager.showError("content_session_load_failed_or_unavailable");
      throw error;
    }
  }
  
  /**
   * 加载会话列表
   */
  async loadSessionList(): Promise<any[]> {
    try {
      logger.log("session_list_loading");
      
      const sessionList = await sessionServiceClient.loadSessionList();
      // handleSessionListLoaded 已通过事件触发，这里不需要显式调用
      
      logger.log("session_list_load_complete", sessionList.length);
      
      return sessionList;
    } catch (error) {
      logger.error("session_list_load_failed", error);
      this.uiManager.showError("content_session_list_load_failed");
      throw error;
    }
  }
  
  /**
   * 处理会话列表加载
   */
  handleSessionListLoaded(sessionList: any[]): void {
    try {
      logger.log('session_list_loaded', sessionList.length);
      
      // 更新会话选择器
      this.updateSessionSelector(sessionList);
    } catch (error) {
      logger.error("session_list_process_failed", error);
    }
  }
  
  /**
   * 更新会话选择器
   */
  updateSessionSelector(sessionList?: any[]): void {
    logger.debug("session_selector_updating");
  
    try {
      // 获取当前会话ID
      const currentSession = sessionServiceClient.getCurrentSession();
      const currentSessionId = currentSession ? currentSession.id : undefined;
      
      // 获取最新会话ID - 仅用于视觉区分
      const latestSessionId = sessionServiceClient.getLatestSessionId() || undefined;
  
      // 如果提供了会话列表，直接使用
      if (sessionList) {
        this.uiManager.updateSessionSelector(sessionList, currentSessionId, latestSessionId);
        return;
      }
  
      // 否则从会话管理器同步获取
      const availableSessionList = sessionServiceClient.getSessionList();
      this.uiManager.updateSessionSelector(availableSessionList, currentSessionId, latestSessionId);
    } catch (error) {
      logger.error("session_selector_update_failed", error);
    }
  }
  
  /**
   * 处理会话选择
   */
  async handleSessionSelected(sessionId: string): Promise<void> {
    try {
      logger.log("session_selected", sessionId);

      // 更新当前会话
      await sessionServiceClient.switchSession(sessionId);
      
      // 不需要再调用loadCurrentSession，switchSession内部已加载会话数据
      // 也不需要显式调用refreshVisualization，事件链会处理
      logger.log("session_switch_success");
    } catch (error) {
      logger.error("session_selection_failed", error);
      this.uiManager.showError("content_session_selection_failed");
    }
  }
  
  /**
   * 加载当前会话
   */
  async loadCurrentSession(): Promise<SessionDetails | null> {
    try {
      logger.log("current_session_loading");

      const session = await sessionServiceClient.loadCurrentSession();
      // handleSessionLoaded 已通过事件触发，这里不需要显式调用
      
      logger.log("current_session_load_complete");
      
      return session;
    } catch (error) {
      logger.error("current_session_load_failed", error);
      this.uiManager.showError("content_current_session_load_failed");
      throw error;
    }
  }
  
  /**
   * 处理会话加载
   */
  handleSessionLoaded(session: SessionDetails | null): void {
    // 防止递归调用
    if (this.isHandlingSessionLoaded) {
      logger.debug("session_load_handling_in_progress");
      return;
    }
    
    try {
      this.isHandlingSessionLoaded = true;
      logger.log("session_loaded_updating_ui");

      // 移除加载状态
      document.body.classList.remove("loading-session");

      if (!session) {
        this.uiManager.showError("content_session_load_failed_or_unavailable");
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

      // 刷新可视化，但不触发会话相关事件
      this.visualizer.refreshVisualization(undefined, { 
        restoreTransform: true,
        skipSessionEvents: true // 防止会话事件循环
      });
      
      logger.log("session_loaded_details", { 
        id: session.id, 
        title: session.title,
        nodes: nodes.length,
        edges: edges.length
      });
    } catch (error) {
      logger.error("session_load_processing_failed", error);
      this.uiManager.showError("content_session_data_processing_failed");
    } finally {
      // 确保标志被重置
      this.isHandlingSessionLoaded = false;
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
   * 刷新会话数据
   */
  async refreshSessionData(): Promise<void> {
    // 防止递归调用
    if (this.isRefreshingData) {
      logger.debug("session_data_refresh_in_progress");
      return;
    }
    
    try {
      this.isRefreshingData = true;
      logger.log("session_data_refreshing");
      
      await sessionServiceClient.loadSessionList();
      await sessionServiceClient.loadCurrentSession();
      
      // 同时更新最新会话ID
      await sessionServiceClient.loadLatestSession();

      logger.log("session_data_refresh_complete");
    } catch (error) {
      logger.error("session_data_refresh_failed", error);
      throw error;
    } finally {
      // 确保标志被重置
      this.isRefreshingData = false;
    }
  }

  /**
   * 加载会话数据（不触发UI更新的简化版本）
   */
  async loadSessionData(): Promise<void> {
    await sessionServiceClient.loadSessionList();
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
  getSessionList(): SessionDetails[] {
    return sessionServiceClient.getSessionList();
  }
  
  /**
   * 清理会话数据
   */
  cleanup(): void {
    logger.log("session_data_cleanup");
    // 清理任何特定的会话相关资源
  }
}