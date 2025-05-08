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
      logger.error(i18n('message_missing_action_field', '缺少 action 字段')); // 日志使用消息ID
      sendResponse({ 
        success: false, 
        error: i18n('message_missing_action_field', '缺少 action 字段'),
        requestId: message?.requestId || i18n('unknown', '未指定')
      });
      return false;
    }
    
    // 2. 接收日志
    logger.log(i18n('message_received', '收到消息 [{0}] 操作: {1} 请求ID: {2}'),
      this.serviceTarget,
      message.action,
      message.requestId || i18n('unknown', '未指定')
    );
    
    // 3. 目标过滤
    if (message.target !== this.serviceTarget) {
      logger.log(i18n('message_skip_wrong_target', '跳过非目标服务消息: 服务={0} 操作={1} 目标={2}'),
        this.serviceTarget,
        message.action,
        message.target || i18n('unknown', '未指定')
      );
      return false;
    }
    
    // 4. 查找处理程序
    const handlers = this.handlers.get(message.action) || [];
    if (handlers.length === 0) {
      logger.warn(i18n('handler_not_found', '未注册的消息类型: {0}'), message.action);
      sendResponse({ 
        success: false, 
        error: i18n('handler_not_found', '未注册的消息类型: {0}', message.action),
        requestId: message.requestId || i18n('unknown', '未指定')
      });
      return false;
    }
    
    // 5. 执行处理程序
    try {
      return handlers[0](message, sender, sendResponse);
    } catch (error) {
      logger.error(i18n('message_handle_error', '处理消息时出错: {0}'), error instanceof Error ? error.message : String(error));
      sendResponse({ 
        success: false, 
        error: i18n('message_handle_error', '处理消息时出错: {0}', error instanceof Error ? error.message : String(error)),
        requestId: message.requestId || i18n('unknown', '未指定')
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
    logger.log(i18n('messaging_handler_registered', '[{0}] 已注册消息处理程序: {1}'), this.serviceTarget, action);
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
        logger.log(i18n('messaging_handler_unregistered', '[{0}] 已移除消息处理程序: {1}'), this.serviceTarget, action);
      }
      
      // 如果没有处理程序了，删除整个条目
      if (handlers.length === 0) {
        this.handlers.delete(action);
      }
    } else {
      // 移除所有该类型的处理程序
      this.handlers.delete(action);
      logger.log(i18n('messaging_all_handlers_unregistered', '[{0}] 已移除所有 {1} 处理程序'), this.serviceTarget, action);
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
      error: (msg: string, ...params: any[]) => {
        // 处理占位符替换
        let formattedMessage = msg;
        if (params && params.length > 0) {
          // 确保所有参数转换为字符串
          const stringParams = params.map(p => String(p));
          
          // 替换所有 {0}, {1}等占位符
          for (let i = 0; i < stringParams.length; i++) {
            const placeholder = new RegExp(`\\{${i}\\}`, 'g');
            formattedMessage = formattedMessage.replace(placeholder, stringParams[i]);
          }
        }
        
        sendResponse({
          success: false,
          error: formattedMessage,
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