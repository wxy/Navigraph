/**
 * 会话管理模块
 * 负责加载和处理会话数据
 */
import { Logger } from '../../lib/utils/logger.js';
import { _, _Error } from '../../lib/utils/i18n.js'; // 保留i18n导入用于UI文本
import type { Session, SessionDetails } from '../types/session.js';
import { nodeManager } from './node-manager.js';
import { sendMessage } from '../messaging/content-message-service.js';

type SessionEventCallback = (session: SessionDetails | null) => void;

const logger = new Logger('SessionServiceClient');
/**
 * 会话管理器类
 */
export class SessionServiceClient {
  private static instance: SessionServiceClient | null = null;
  private sessionList: any[] = [];
  private currentSession: any | null = null;
  private currentSessionId: string | null = null;

  // 添加请求跟踪映射，用于防止重复请求
  private pendingSessionRequests: Map<string, Promise<any>> = new Map();
  private pendingListRequest: Promise<any[]> | null = null;

  private sessionLoadListeners: SessionEventCallback[] = [];
  private sessionsListLoadedListeners: ((sessions: Session[]) => void)[] = [];

  // 添加最新会话相关属性和方法
  private latestSession: any = null;
  private latestSessionId: string | null = null;

  private latestSessionLoadListeners: ((session: any | null) => void)[] = [];

  // 私有构造函数
  private constructor() {
    // 初始化代码
  }

  /**
   * 获取SessionServiceClient实例
   */
  public static getInstance(): SessionServiceClient {
    if (!SessionServiceClient.instance) {
      SessionServiceClient.instance = new SessionServiceClient();
    }
    return SessionServiceClient.instance;
  }

  // 添加监听器方法
  onSessionLoaded(callback: SessionEventCallback): void {
    this.sessionLoadListeners.push(callback);
  }

  onSessionsListLoaded(callback: (sessions: Session[]) => void): void {
    this.sessionsListLoadedListeners.push(callback);
  }

  onLatestSessionLoaded(callback: (session: any | null) => void): void {
    this.latestSessionLoadListeners.push(callback);
  }

  /**
   * 加载会话列表
   * 实现请求去重，避免重复加载
   */
  async loadSessionList(): Promise<any[]> {
    // 如果已有请求进行中，直接返回该请求
    if (this.pendingListRequest) {
      logger.debug(_('session_list_loading_reuse_request', '会话列表正在加载中，复用现有请求'));
      return this.pendingListRequest;
    }

    try {
      // 创建新请求并存储
      this.pendingListRequest = this.executeLoadSessionList();

      // 等待请求完成并返回结果
      const sessions = await this.pendingListRequest;
      return sessions;
    } finally {
      // 无论成功或失败，都清除请求记录
      this.pendingListRequest = null;
    }
  }

  /**
   * 执行实际的会话列表加载
   * @private
   */
  private async executeLoadSessionList(): Promise<any[]> {
    try {
      logger.log(_('session_list_loading', '加载会话列表...'));

      const response = await sendMessage('getSessions', {}, {
        retry: true,             // 启用重试
        maxRetries: 5,           // 多次重试
        initialDelay: 300,       // 起始延迟较短
        factor: 1.5,             // 较小的退避因子
        defaultValue: { sessions: [] }  // 重试失败后默认返回空数组        
      });
      logger.log(_('session_list_response_received', '收到会话列表响应: {0}'), response);

      if (response && response.success === true && Array.isArray(response.sessions)) {
        const sessions = response.sessions;
        this.sessionList = sessions;

        // 通知监听器
        this.sessionsListLoadedListeners.forEach(callback => {
          try {
            callback(sessions);
          } catch (err) {
            logger.error(_('session_list_listener_error', '会话列表加载监听器执行错误: {0}'), err);
          }
        });

        logger.log(_('session_list_loaded', '成功加载{0}个会话'), sessions.length);
        return sessions;
      } else {
        logger.warn(_('session_response_invalid_format', '会话响应格式不正确: {0}'), response);
        throw new _Error(response?.error || 'session_list_load_failed');
      }
    } catch (error) {
      logger.error(_('session_list_load_failed', '加载会话列表失败: {0}'), error);
      throw error;
    }
  }

  /**
   * 加载会话
   * 实现请求去重，避免重复加载
   */
  async loadSession(sessionId: string): Promise<any | null> {
    // 如果已有同ID请求进行中，直接返回该请求
    if (this.pendingSessionRequests.has(sessionId)) {
      logger.debug(_('session_loading_reuse_request', '会话 {0} 正在加载中，复用现有请求'), sessionId);
      return this.pendingSessionRequests.get(sessionId);
    }

    try {
      // 创建新请求并存储
      const request = this.executeLoadSession(sessionId);
      this.pendingSessionRequests.set(sessionId, request);

      // 等待请求完成并返回结果
      const session = await request;
      return session;
    } finally {
      // 无论成功或失败，都清除请求记录
      this.pendingSessionRequests.delete(sessionId);
    }
  }

  /**
   * 执行实际的会话加载
   * @private
   */
  private async executeLoadSession(sessionId: string): Promise<any | null> {
    try {
      logger.log(_('session_loading_attempt', '尝试加载会话: {0}'), sessionId);

      const response = await sendMessage('getSessionDetails', { sessionId }, {
        retry: true,             // 启用重试
        maxRetries: 5,           // 多次重试
        initialDelay: 300,       // 起始延迟较短
        factor: 1.5,             // 较小的退避因子
        defaultValue: { SessionDetails: null }  // 重试失败后默认返回空对象        
      });

      logger.log(_('session_details_response', 'getSessionDetails响应: {0}'), response);

      if (response && response.success && response.session) {
        logger.log(_('session_data_fetch_success', '会话数据获取成功, 节点数: {0}'), 
                  response.session.records ? Object.keys(response.session.records).length : 0);

        const session = response.session;
        this.currentSession = session;
        this.currentSessionId = sessionId;

        if (session) {
          try {
            nodeManager.processSessionData(session);
          } catch (processError) {
            logger.error(_('session_data_process_error', '处理会话数据时出错: {0}'), processError);
          }
        }

        // 通知监听器
        this.sessionLoadListeners.forEach(callback => {
          try {
            callback(session);
          } catch (err) {
            logger.error(_('session_load_listener_error', '会话加载监听器执行错误: {0}'), err);
          }
        });

        return session;
      } else {
        logger.error(_('session_details_fetch_failed', '获取会话详情失败, 响应: {0}'), response);
        throw new _Error(response && response.error ? response.error : 'session_details_fetch_failed');
      }
    } catch (error) {
      logger.error(_('session_details_load_failed', '加载会话详情失败: {0}'), error);
      throw error;
    }
  }

  /**
   * 加载最新活跃会话
   */
  async loadLatestSession(): Promise<any | null> {
    try {
      const response = await sendMessage('getLatestSession', {});
      
      if (response?.session) {
        this.latestSession = response.session;
        this.latestSessionId = response.session.id;
        this.triggerLatestSessionLoaded(response.session);
      } else {
        this.latestSession = null;
        this.latestSessionId = null;
        this.triggerLatestSessionLoaded(null);
      }
      
      return this.latestSession;
    } catch (error) {
      logger.error(_('latest_session_load_failed', '加载最新会话失败: {0}'), error);
      return null;
    }
  }

  /**
   * 获取最新活跃会话ID
   */
  getLatestSessionId(): string | null {
    return this.latestSessionId;
  }

  /**
   * 获取最新活跃会话
   */
  getLatestSession(): any | null {
    return this.latestSession;
  }

  /**
   * 加载当前会话
   * 优先级：本地存储的ID > 最新活跃会话 > 会话列表中最后一个 > 会话列表中第一个
   */
  async loadCurrentSession(): Promise<any | null> {
    // 1. 尝试使用存储的会话ID
    const sessionId = this.getCurrentSessionId();
    if (sessionId) {
      return this.loadSession(sessionId);
    }
    
    try {
      // 2. 尝试加载最新活跃会话
      logger.log(_('trying_to_load_latest_active_session', '尝试加载最新活跃会话'));
      const latestSession = await this.loadLatestSession();
      if (latestSession) {
        logger.log(_('latest_active_session_found', '找到最新活跃会话: {0}，使用该会话'), latestSession.id);
        this.setCurrentSessionId(latestSession.id);
        return this.loadSession(latestSession.id);
      }
      
      // 3. 如果没有最新会话，尝试加载会话列表
      if (this.sessionList.length === 0) {
        await this.loadSessionList();
      }
      
      // 4. 从会话列表中选择
      if (this.sessionList.length > 0) {
        // 选择最后一个会话（通常是最新的）
        const lastSession = this.sessionList[this.sessionList.length - 1];
        logger.log(_('using_last_session_from_list', '使用会话列表中最后一个会话: {0}'), lastSession.id);
        return this.loadSession(lastSession.id);
      }
      
      // 5. 如果以上都失败，返回null
      logger.log(_('no_available_sessions_found', '没有找到可用的会话'));
      return null;
    } catch (error) {
      logger.error(_('current_session_load_failed', '加载当前会话失败: {0}'), error);
      throw error;
    }
  }

  /**
   * 切换会话
   * 区分设置ID和加载数据，避免重复加载
   */
  async switchSession(sessionId: string): Promise<any | null> {
    this.setCurrentSessionId(sessionId);
    return this.loadSession(sessionId);
  }

  /**
   * 设置当前会话ID（不加载数据）
   */
  setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
    try {
      localStorage.setItem('navigraph_current_session', sessionId);
    } catch (e) {
      logger.warn(_('save_session_id_local_storage_failed', '保存会话ID到本地存储失败: {0}'), e);
    }
  }

  /**
   * 获取会话列表
   */
  getSessionList(): any[] {
    return this.sessionList;
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): any | null {
    return this.currentSession;
  }

  /**
   * 获取当前会话ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  // 事件触发相关方法
  private triggerLatestSessionLoaded(session: any | null): void {
    for (const listener of this.latestSessionLoadListeners) {
      try {
        listener(session);
      } catch (error) {
        logger.error(_('latest_session_listener_call_failed', '调用最新会话加载监听器失败: {0}'), error);
      }
    }
  }
}

// 导出全局实例
export const sessionServiceClient = SessionServiceClient.getInstance();