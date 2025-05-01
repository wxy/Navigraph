import { Logger } from '../../lib/utils/logger.js';
import { i18n } from '../../lib/utils/i18n-utils.js';
import { BaseMessage, BaseResponse, MessageHandler, MessageTarget } from '../../types/messages/common.js';
const logger = new Logger('BaseMessageService');

/**
 * 基础消息服务类
 * 为不同上下文的消息服务提供通用功能
 */
export abstract class BaseMessageService<T extends MessageTarget> {
  protected handlers: Map<string, MessageHandler<any, any>[]> = new Map();
  protected serviceId: string = `msg_service_${Date.now()}`;
  protected initialized: boolean = false;
  protected serviceTarget: T;
  
  /**
   * 构造函数
   * @param target 服务目标类型 (background/content/popup/options)
   */
  constructor(target: T) {
    this.serviceTarget = target;
    this.initialize();
  }
  
  /**
   * 初始化消息服务
   * 子类必须实现此方法来设置消息监听器
   */
  protected abstract initialize(): void;
  
  /**
   * 处理接收到的消息
   */
  protected handleMessage(
    message: any, 
    sender: chrome.runtime.MessageSender, 
    sendResponse: (response?: any) => void
  ): boolean {
    // 1. 格式校验
    if (!message || !message.action) {
      logger.error('message_missing_action_field'); // 日志使用消息ID
      sendResponse({ 
        success: false, 
        error: i18n('message_missing_action_field'),
        requestId: message?.requestId || i18n('unknown')
      });
      return false;
    }
    
    // 2. 接收日志
    logger.log(
      'message_received',
      this.serviceTarget,
      message.action,
      message.requestId || i18n('unknown')
    );
    
    // 3. 目标过滤
    if (message.target !== this.serviceTarget) {
      logger.log(
        'message_skip_wrong_target',
        this.serviceTarget,
        message.action,
        message.target || i18n('unknown')
      );
      return false;
    }
    
    // 4. 查找处理程序
    const handlers = this.handlers.get(message.action) || [];
    if (handlers.length === 0) {
      logger.warn('handler_not_found', message.action);
      sendResponse({ 
        success: false, 
        error: i18n('handler_not_found', message.action),
        requestId: message.requestId || i18n('unknown')
      });
      return false;
    }
    
    // 5. 执行处理程序
    try {
      return handlers[0](message, sender, sendResponse);
    } catch (error) {
      logger.error('message_handle_error', error instanceof Error ? error.message : String(error));
      sendResponse({ 
        success: false, 
        error: i18n('message_handle_error', error instanceof Error ? error.message : String(error)),
        requestId: message.requestId || i18n('unknown')
      });
      return false;
    }
  }
  
  /**
   * 注册消息处理程序
   */
  public registerHandler<TRequest extends BaseMessage, TResponse extends BaseResponse>(
    action: string, 
    handler: MessageHandler<TRequest, TResponse>
  ): void {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, []);
    }
    
    this.handlers.get(action)!.push(handler);
    logger.log(`[${this.serviceTarget}] 已注册消息处理程序: ${action}`);
  }
  
  /**
   * 批量注册消息处理程序
   */
  public registerHandlers<TRequest extends BaseMessage, TResponse extends BaseResponse>(
    handlers: Record<string, MessageHandler<TRequest, TResponse>>
  ): void {
    for (const [action, handler] of Object.entries(handlers)) {
      this.registerHandler(action, handler);
    }
  }
  
  /**
   * 取消注册消息处理程序
   */
  public unregisterHandler(action: string, handler?: MessageHandler<any, any>): void {
    if (!this.handlers.has(action)) {
      return;
    }
    
    if (handler) {
      // 移除特定处理程序
      const handlers = this.handlers.get(action)!;
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
        logger.log(`[${this.serviceTarget}] 已移除消息处理程序: ${action}`);
      }
      
      // 如果没有处理程序了，删除整个条目
      if (handlers.length === 0) {
        this.handlers.delete(action);
      }
    } else {
      // 移除所有该类型的处理程序
      this.handlers.delete(action);
      logger.log(`[${this.serviceTarget}] 已移除所有 ${action} 处理程序`);
    }
  }
  
  /**
   * 获取当前已注册的消息类型列表
   */
  public getRegisteredActions(): string[] {
    return Array.from(this.handlers.keys());
  }
  
  /**
   * 创建消息上下文对象
   * 简化处理程序中的响应创建
   */
  public createMessageContext(
    message: any, 
    sender: chrome.runtime.MessageSender, 
    sendResponse: (response?: any) => void
  ) {
    return {
      message,
      sender,
      success: (data: any = {}) => {
        sendResponse({
          success: true,
          requestId: message.requestId,
          ...data
        });
        return false; // 表示同步响应已完成
      },
      error: (msgOrId: string, ...params: any[]) => {
        const localized = i18n(msgOrId, ...params);
        sendResponse({
          success: false,
          error: localized,
          requestId: message.requestId
        });
        return false; // 表示同步响应已完成
      }
    };
  }
  
  /**
   * 生成唯一请求ID
   */
  protected generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}