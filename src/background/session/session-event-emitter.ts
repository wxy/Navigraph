/**
 * 会话事件发射器
 * 提供会话相关事件的发布-订阅功能
 */
import { Logger } from '../../lib/utils/logger.js';
import { SessionEvent, SessionEventType } from '../../types/session-types.js';
import { _, _Error } from '../../lib/utils/i18n.js';

const logger = new Logger('SessionEventEmitter');
/**
 * 会话事件监听器类型
 */
type SessionEventListener = (event: SessionEvent) => void;

/**
 * 会话事件发射器
 * 实现发布-订阅模式，允许组件订阅和发布会话相关事件
 */
export class SessionEventEmitter {
  // 事件监听器映射
  private listeners: Map<SessionEventType, Set<SessionEventListener>> = new Map();
  
  /**
   * 添加事件监听器
   * @param eventType 事件类型
   * @param listener 监听器函数
   */
  public addEventListener(eventType: SessionEventType, listener: SessionEventListener): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    
    this.listeners.get(eventType)!.add(listener);
    
    logger.log(_('session_event_listener_added', '添加了 {0} 事件的监听器，当前共 {1} 个'), eventType, this.listeners.get(eventType)!.size.toString());
  }
  
  /**
   * 移除事件监听器
   * @param eventType 事件类型
   * @param listener 要移除的监听器函数
   */
  public removeEventListener(eventType: SessionEventType, listener: SessionEventListener): void {
    if (!this.listeners.has(eventType)) {
      return;
    }
    
    const listeners = this.listeners.get(eventType)!;
    listeners.delete(listener);
    
    logger.log(_('session_event_listener_removed', '移除了 {0} 事件的监听器，剩余 {1} 个'), eventType, listeners.size.toString());
    
    // 如果没有监听器了，删除这个事件类型的集合
    if (listeners.size === 0) {
      this.listeners.delete(eventType);
    }
  }
  
  /**
   * 触发事件
   * @param eventType 事件类型
   * @param sessionId 相关会话ID
   * @param data 事件数据
   */
  public emit(eventType: SessionEventType, sessionId: string, data?: any): void {
    if (!this.listeners.has(eventType)) {
      return;
    }
    
    const event: SessionEvent = {
      type: eventType,
      sessionId: sessionId,
      timestamp: Date.now(),
      data: data
    };
    
    // 同步调用所有监听器
    const listeners = this.listeners.get(eventType)!;
    logger.log(_('session_event_emitted', '触发 {0} 事件，通知 {1} 个监听器'), eventType, listeners.size.toString());
    
    listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        logger.error(_('session_event_listener_error', '会话事件监听器执行出错: {0}'), 
          error instanceof Error ? error.message : String(error));
      }
    });
  }
  
  /**
   * 清除所有事件监听器
   */
  public clearAllListeners(): void {
    this.listeners.clear();
    logger.log(_('session_event_all_listeners_cleared', '已清除所有会话事件监听器'));
  }
  
  /**
   * 获取特定事件类型的监听器数量
   * @param eventType 事件类型
   */
  public getListenerCount(eventType: SessionEventType): number {
    if (!this.listeners.has(eventType)) {
      return 0;
    }
    return this.listeners.get(eventType)!.size;
  }
  
  /**
   * 发出会话创建事件
   * @param sessionId 会话ID
   * @param data 事件数据
   */
  public emitSessionCreated(sessionId: string, data?: any): void {
    this.emit(SessionEventType.Created, sessionId, data);
  }
  
  /**
   * 发出会话更新事件
   * @param sessionId 会话ID
   * @param data 事件数据
   */
  public emitSessionUpdated(sessionId: string, data?: any): void {
    this.emit(SessionEventType.Updated, sessionId, data);
  }
  
  /**
   * 发出会话结束事件
   * @param sessionId 会话ID
   * @param data 事件数据
   */
  public emitSessionEnded(sessionId: string, data?: any): void {
    this.emit(SessionEventType.Ended, sessionId, data);
  }
  
  /**
   * 发出会话激活事件
   * @param sessionId 会话ID
   * @param data 事件数据
   */
  public emitSessionActivated(sessionId: string, data?: any): void {
    this.emit(SessionEventType.Activated, sessionId, data);
  }
  
  /**
   * 发出会话停用事件
   * @param sessionId 会话ID
   * @param data 事件数据
   */
  public emitSessionDeactivated(sessionId: string, data?: any): void {
    this.emit(SessionEventType.Deactivated, sessionId, data);
  }
  
  /**
   * 发出会话删除事件
   * @param sessionId 会话ID
   * @param data 事件数据
   */
  public emitSessionDeleted(sessionId: string, data?: any): void {
    this.emit(SessionEventType.Deleted, sessionId, data);
  }
  
  /**
   * 发出会话查看事件
   * 当用户在UI中查看某个会话时触发
   * @param sessionId 会话ID
   * @param data 事件数据
   */
  public emitSessionViewed(sessionId: string, data?: any): void {
    this.emit(SessionEventType.Viewed, sessionId, data);
  }
}

// 创建单例实例
export const sessionEvents = new SessionEventEmitter();