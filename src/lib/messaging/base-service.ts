import { Logger } from '../../lib/utils/logger.js';
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
    // 验证消息格式
    if (!message || !message.action) {
      logger.error(`[${this.serviceTarget}] 收到无效消息，缺少action字段：`, message);
      sendResponse({ 
        success: false, 
        error: '缺少action字段',
        requestId: message?.requestId || 'unknown'
      });
      return false;
    }
    
    logger.log(`[${this.serviceTarget}] 收到消息: ${message.action} [ID:${message.requestId || 'unknown'}]`, 
                'target:', message.target);
    
    // 仅处理目标匹配的消息
    if (message.target !== this.serviceTarget) {
      logger.log(`[${this.serviceTarget}] 跳过非当前目标消息: ${message.action}, target: ${message.target || '未指定'}`);
      return false;
    }
    
    // 查找对应处理程序
    const handlers = this.handlers.get(message.action) || [];
    
    if (handlers.length === 0) {
      logger.warn(`[${this.serviceTarget}] 未找到处理程序: ${message.action}`);
      sendResponse({ 
        success: false, 
        error: `未注册的消息类型: ${message.action}`,
        requestId: message.requestId || 'unknown'
      });
      return false;
    }
    
    // 调用处理程序(仅使用第一个注册的处理程序)
    try {
      return handlers[0](message, sender, sendResponse);
    } catch (error) {
      logger.error(`[${this.serviceTarget}] 处理消息 ${message.action} 时出错:`, error);
      sendResponse({ 
        success: false, 
        error: `处理消息时出错: ${error instanceof Error ? error.message : String(error)}`,
        requestId: message.requestId || 'unknown'
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
public createMessageContext(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
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
    error: (errorMsg: string, data: any = {}) => {
      sendResponse({
        success: false,
        error: errorMsg,
        requestId: message.requestId,
        ...data
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