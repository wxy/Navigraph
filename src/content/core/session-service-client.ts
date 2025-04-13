/**
 * 会话管理模块
 * 负责加载和处理会话数据
 */
import { Logger } from '../../lib/utils/logger.js';
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
      logger.debug('会话列表正在加载中，复用现有请求');
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
      logger.log('加载会话列表...');

      const response = await sendMessage('getSessions', {}, {
        retry: true,             // 启用重试
        maxRetries: 5,           // 多次重试
        initialDelay: 300,       // 起始延迟较短
        factor: 1.5,             // 较小的退避因子
        defaultValue: { sessions: [] }  // 重试失败后默认返回空数组        
      });
      logger.log('收到会话列表响应:', response);

      if (response && response.success === true && Array.isArray(response.sessions)) {
        const sessions = response.sessions;
        this.sessionList = sessions;

        // 通知监听器
        this.sessionsListLoadedListeners.forEach(callback => {
          try {
            callback(sessions);
          } catch (err) {
            logger.error('会话列表加载监听器执行错误:', err);
          }
        });

        logger.log(`成功加载${sessions.length}个会话`);
        return sessions;
      } else {
        logger.warn('会话响应格式不正确:', response);
        throw new Error(response?.error || '获取会话列表失败');
      }
    } catch (error) {
      logger.error('加载会话列表失败:', error);
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
      logger.debug(`会话 ${sessionId} 正在加载中，复用现有请求`);
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
      logger.log(`尝试加载会话: ${sessionId}`);

      const response = await sendMessage('getSessionDetails', { sessionId }, {
        retry: true,             // 启用重试
        maxRetries: 5,           // 多次重试
        initialDelay: 300,       // 起始延迟较短
        factor: 1.5,             // 较小的退避因子
        defaultValue: { SessionDetails: null }  // 重试失败后默认返回空对象        
      });

      logger.log('getSessionDetails响应:', response);

      if (response && response.success && response.session) {
        logger.log('会话数据获取成功, 节点数:', 
                  response.session.records ? Object.keys(response.session.records).length : 0);

        const session = response.session;
        this.currentSession = session;
        this.currentSessionId = sessionId;

        if (session) {
          try {
            nodeManager.processSessionData(session);
          } catch (processError) {
            logger.error('处理会话数据时出错:', processError);
          }
        }

        // 通知监听器
        this.sessionLoadListeners.forEach(callback => {
          try {
            callback(session);
          } catch (err) {
            logger.error('会话加载监听器执行错误:', err);
          }
        });

        return session;
      } else {
        logger.error('获取会话详情失败, 响应:', response);
        throw new Error(response && response.error ? response.error : '获取会话详情失败');
      }
    } catch (error) {
      logger.error('加载会话详情失败:', error);
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
      logger.error("加载最新会话失败:", error);
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
   */
  async loadCurrentSession(): Promise<any | null> {
    const sessionId = this.getCurrentSessionId();

    if (!sessionId) {
      try {
        if (this.sessionList.length === 0) {
          await this.loadSessionList();
        }

        if (this.sessionList.length > 0) {
          return this.loadSession(this.sessionList[0].id);
        }

        return null;
      } catch (error) {
        logger.error('加载当前会话失败:', error);
        throw error;
      }
    }

    return this.loadSession(sessionId);
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
      logger.warn('保存会话ID到本地存储失败:', e);
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
        logger.error("调用最新会话加载监听器失败:", error);
      }
    }
  }
}

// 导出全局实例
export const sessionServiceClient = SessionServiceClient.getInstance();