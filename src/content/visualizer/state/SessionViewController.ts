/**
 * 会话处理器
 * 管理会话相关操作，如加载、保存、切换会话等
 */
import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
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
    logger.log(_('session_view_controller_init', '会话视图控制器初始化'));
  }
  
  /**
   * 初始化会话管理
   */
  async initialize(): Promise<void> {
    logger.log(_('session_management_init_start', '初始化会话管理...'));
    
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
      
      logger.log(_('session_management_init_complete', '会话管理初始化完成'));
    } catch (error) {
      logger.error(_('session_management_init_failed', '会话管理初始化失败: {0}'), error);
      this.uiManager.showError(_('content_session_load_failed_or_unavailable', '会话加载失败或无可用会话'));
      throw error;
    }
  }
  
  /**
   * 加载会话列表
   */
  async loadSessionList(): Promise<any[]> {
    try {
      logger.log(_('session_list_loading', '加载会话列表...'));
      
      const sessionList = await sessionServiceClient.loadSessionList();
      // handleSessionListLoaded 已通过事件触发，这里不需要显式调用
      
      logger.log(_('session_list_load_complete', '会话列表加载完成，找到 {0} 个会话'), sessionList.length);
      
      return sessionList;
    } catch (error) {
      logger.error(_('session_list_load_failed', '加载会话列表失败: {0}'), error);
      this.uiManager.showError(_('content_session_list_load_failed', '加载会话列表失败: {0}'));
      throw error;
    }
  }
  
  /**
   * 处理会话列表加载
   */
  handleSessionListLoaded(sessionList: any[]): void {
    try {
      logger.log(_('session_list_loaded', '成功加载{0}个会话'), sessionList.length);
      
      // 更新会话选择器
      this.updateSessionSelector(sessionList);
    } catch (error) {
      logger.error(_('session_list_process_failed', '处理会话列表失败: {0}'), error);
    }
  }
  
  /**
   * 更新会话选择器
   */
  updateSessionSelector(sessionList?: any[]): void {
    logger.debug(_('session_selector_updating', '更新会话选择器...'));
  
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
      logger.error(_('session_selector_update_failed', '更新会话选择器失败: {0}'), error);
    }
  }
  
  /**
   * 处理会话选择
   */
  async handleSessionSelected(sessionId: string): Promise<void> {
    try {
      logger.log(_('session_selected', '选择会话: {0}'), sessionId);

      // 更新当前会话
      await sessionServiceClient.switchSession(sessionId);
      
      // 不需要再调用loadCurrentSession，switchSession内部已加载会话数据
      // 也不需要显式调用refreshVisualization，事件链会处理
      logger.log(_('session_switch_success', '会话切换成功'));
    } catch (error) {
      logger.error(_('session_selection_failed', '选择会话失败: {0}'), error);
      this.uiManager.showError(_('content_session_selection_failed', '选择会话失败'));
    }
  }
  
  /**
   * 加载当前会话
   */
  async loadCurrentSession(): Promise<SessionDetails | null> {
    try {
      logger.log(_('current_session_loading', '加载当前会话...'));

      const session = await sessionServiceClient.loadCurrentSession();
      // handleSessionLoaded 已通过事件触发，这里不需要显式调用
      
      logger.log(_('current_session_load_complete', '当前会话加载完成'));
      
      return session;
    } catch (error) {
      logger.error(_('current_session_load_failed', '加载当前会话失败: {0}'), error);
      this.uiManager.showError(_('content_current_session_load_failed', '加载当前会话失败'));
      throw error;
    }
  }
  
  /**
   * 处理会话加载
   */
  handleSessionLoaded(session: SessionDetails | null): void {
    // 防止递归调用
    if (this.isHandlingSessionLoaded) {
      logger.debug(_('session_load_handling_in_progress', '会话加载处理已在进行中，跳过重复处理'));
      return;
    }
    
    try {
      this.isHandlingSessionLoaded = true;
      logger.log(_('session_loaded_updating_ui', '会话已加载，准备更新UI和数据'));

      // 移除加载状态
      document.body.classList.remove("loading-session");

      if (!session) {
        this.uiManager.showError(_('content_session_load_failed_or_unavailable', '会话加载失败或无可用会话'));
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
      
      logger.log(_('session_loaded_details', '会话已加载: {0}'), { 
        id: session.id, 
        title: session.title,
        nodes: nodes.length,
        edges: edges.length
      });
    } catch (error) {
      logger.error(_('session_load_processing_failed', '处理会话加载失败: {0}'), error);
      this.uiManager.showError(_('content_session_data_processing_failed', '处理会话数据失败'));
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
      logger.debug(_('session_data_refresh_in_progress', '会话数据刷新已在进行中，跳过重复刷新'));
      return;
    }
    
    try {
      this.isRefreshingData = true;
      logger.log(_('session_data_refreshing', '刷新会话数据...'));
      
      await sessionServiceClient.loadSessionList();
      await sessionServiceClient.loadCurrentSession();
      
      // 同时更新最新会话ID
      await sessionServiceClient.loadLatestSession();

      logger.log(_('session_data_refresh_complete', '会话数据刷新完成'));
    } catch (error) {
      logger.error(_('session_data_refresh_failed', '刷新会话数据失败: {0}'), error);
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
   * 切换到当天的会话
   */
  async switchToToday(): Promise<void> {
    try {
      logger.log(_('switching_to_today', '切换到当天的会话...'));
      
      // 获取所有会话
      const sessionList = this.getSessionList();
      
      if (!sessionList || sessionList.length === 0) {
        logger.warn(_('no_sessions_available', '没有可用的会话'));
        this.uiManager.showError(_('content_no_sessions_available', '没有可用的会话'));
        return;
      }
      
      // 获取今天的日期（本地时区）
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTime = today.getTime();
      
      // 查找今天的会话（会话的 startTime 在今天）
      const todaySession = sessionList.find(session => {
        const sessionDate = new Date(session.startTime);
        sessionDate.setHours(0, 0, 0, 0);
        return sessionDate.getTime() === todayTime;
      });
      
      if (todaySession) {
        logger.log(_('today_session_found', '找到今天的会话: {0}'), todaySession.id);
        await this.handleSessionSelected(todaySession.id);
      } else {
        logger.warn(_('no_session_for_today', '没有找到今天的会话'));
        this.uiManager.showError(_('content_no_session_for_today', '没有找到今天的会话'));
      }
    } catch (error) {
      logger.error(_('switch_to_today_failed', '切换到当天失败: {0}'), error);
      this.uiManager.showError(_('content_switch_to_today_failed', '切换到当天失败'));
    }
  }
  
  /**
   * 清理会话数据
   */
  cleanup(): void {
    logger.log(_('session_data_cleanup', '清理会话数据...'));
    // 清理任何特定的会话相关资源
  }
}