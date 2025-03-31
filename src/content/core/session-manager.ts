/**
 * 会话管理模块
 * 负责加载和处理会话数据
 */
import type { Session, SessionDetails } from '../types/session.js';
import { nodeManager } from './node-manager.js';
import { sendMessage } from '../messaging/content-message-service.js';

type SessionEventCallback = (session: SessionDetails | null) => void;

/**
 * 会话管理器类
 */
export class SessionManager {
  private sessions: Session[] = [];
  private currentSession: SessionDetails | null = null;
  private currentSessionId: string | null = null;
  private sessionLoadListeners: SessionEventCallback[] = [];
  private sessionsListLoadedListeners: ((sessions: Session[]) => void)[] = [];

  // 添加监听器方法
  onSessionLoaded(callback: SessionEventCallback): void {
    this.sessionLoadListeners.push(callback);
  }
  
  onSessionsListLoaded(callback: (sessions: Session[]) => void): void {
    this.sessionsListLoadedListeners.push(callback);
  }

  /**
   * 加载所有可用会话
   * @returns 会话列表
   */
  async loadSessions(): Promise<Session[]> {
    try {
      console.log('加载会话列表...');
      
      const response = await sendMessage('getSessions');
      console.log('收到会话列表响应:', response);
      
      // 强化错误处理和类型检查
      if (response && response.success === true && Array.isArray(response.sessions)) {
        this.sessions = response.sessions;
        // 通知监听器
        this.sessionsListLoadedListeners.forEach(callback => {
          try {
            callback(this.sessions);
          } catch (err) {
            console.error('会话列表加载监听器执行错误:', err);
          }
        });
        console.log(`成功加载${this.sessions.length}个会话`);
        return this.sessions;
      } else {
        console.warn('会话响应格式不正确:', response);
        throw new Error(response?.error || '获取会话列表失败');
      }
    } catch (error) {
      console.error('加载会话列表失败:', error);
      throw error;
    }
  }

  /**
   * 加载当前会话或最近的会话
   * @returns 当前会话详情
   */
  async loadCurrentSession(): Promise<SessionDetails | null> {
    try {
      console.log('加载当前会话或最近会话...');
      
      // 如果没有可用会话，先加载会话列表
      if (this.sessions.length === 0) {
        try {
          await this.loadSessions();
        } catch (err) {
          console.warn('自动加载会话列表失败:', err);
        }
        
        if (this.sessions.length === 0) {
          console.warn('没有可用的会话');
          return null;
        }
      }
      
      // 尝试从本地存储获取上次选择的会话ID
      let savedSessionId: string | null = null;
      try {
        savedSessionId = localStorage.getItem('navigraph_current_session');
      } catch (e) {
        console.warn('从本地存储读取会话ID失败:', e);
      }
      
      // 如果有已保存的会话ID，且该会话在可用会话列表中，优先使用它
      if (savedSessionId) {
        console.log(`检查本地存储中的会话ID: ${savedSessionId}`);
        
        // 检查此会话是否在会话列表中
        const sessionExists = this.sessions.some(s => s.id === savedSessionId);
        if (sessionExists) {
          console.log(`在会话列表中找到已保存的会话: ${savedSessionId}`);
          return await this.loadSession(savedSessionId);
        } else {
          console.warn(`已保存的会话ID ${savedSessionId} 不在可用列表中`);
        }
      }
      
      // 如果没有已保存会话或找不到已保存会话，加载最新的会话
      console.log('使用列表中的第一个会话');
      return await this.loadSession(this.sessions[0].id);
    } catch (error) {
      console.error('加载当前会话失败:', error);
      throw error;
    }
  }

  /**
   * 加载指定ID的会话
   * @param sessionId 会话ID
   * @returns 会话详情
   */
  async loadSession(sessionId: string): Promise<SessionDetails | null> {
    try {
      console.log(`尝试加载会话: ${sessionId}`);
      
      // 使用sendMessage函数
      const response = await sendMessage('getSessionDetails', { sessionId });
      
      console.log('getSessionDetails响应:', response);
      
      if (response && response.success && response.session) {
        console.log('会话数据获取成功, 节点数:', 
                  response.session.records ? Object.keys(response.session.records).length : 0);
        
        this.currentSession = response.session;
        this.currentSessionId = sessionId;
        
        // 添加类型和空值检查
        if (this.currentSession) {
          try {
            // 处理会话数据
            nodeManager.processSessionData(this.currentSession);
          } catch (processError) {
            // 捕获处理错误，但不中断流程
            console.error('处理会话数据时出错:', processError);
          }
        }
        
        // 通知监听器
        this.sessionLoadListeners.forEach(callback => {
          try {
            callback(this.currentSession);
          } catch (err) {
            console.error('会话加载监听器执行错误:', err);
          }
        });
        
        return this.currentSession;
      } else {
        console.error('获取会话详情失败, 响应:', response);
        throw new Error(response && response.error ? response.error : '获取会话详情失败');
      }
    } catch (error) {
      console.error('加载会话详情失败:', error);
      throw error;
    }
  }
  
  /**
   * 切换到指定会话
   * @param sessionId 要切换到的会话ID
   * @returns 切换后的会话详情
   */
  async switchSession(sessionId: string): Promise<SessionDetails | null> {
    console.log(`切换到会话: ${sessionId}`);
    
    // 如果已经是当前会话，无需重复加载
    if (this.currentSessionId === sessionId && this.currentSession) {
      console.log('已经是当前会话，无需切换');
      return this.currentSession;
    }
    
    try {
      // 通知后台服务切换当前会话
      await sendMessage('setCurrentSession', { sessionId });
      
      // 保存会话ID到本地存储，以便刷新后保持选择
      try {
        localStorage.setItem('navigraph_current_session', sessionId);
        console.log(`已保存会话ID ${sessionId} 到本地存储`);
      } catch (e) {
        console.warn('保存会话ID到本地存储失败:', e);
      }
      
      // 加载会话详情
      return await this.loadSession(sessionId);
    } catch (error) {
      console.error('切换会话失败:', error);
      throw error;
    }
  }

  /**
   * 清除所有会话数据
   * 用于调试或重置应用
   */
  async clearAllData(): Promise<boolean> {
    try {
      const response = await sendMessage('clearAllData', {
        timestamp: Date.now() // 添加时间戳或其他所需参数
      });
      
      if (response && response.success) {
        // 重置本地状态
        this.sessions = [];
        this.currentSession = null;
        this.currentSessionId = null;
        return true;
      } else {
        throw new Error(response?.error || '清除数据失败');
      }
    } catch (error) {
      console.error('清除数据失败:', error);
      throw error;
    }
  }

  /**
   * 获取会话列表
   */
  getSessions(): Session[] {
    return this.sessions;
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): SessionDetails | null {
    return this.currentSession;
  }

  /**
   * 获取当前会话ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }
}

// 导出默认实例
export const sessionManager = new SessionManager();