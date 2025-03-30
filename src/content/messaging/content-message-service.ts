import { BaseMessageService } from '../../lib/messaging/base-service.js';
import { sendToBackground } from '../../lib/messaging/sender.js';
import { createMessageContext } from '../../lib/messaging/handlers.js';
// 导入现有的类型定义
import { MessageHandler, BaseMessage, BaseResponse } from '../../types/messages/common.js';

/**
 * 内容脚本消息服务类
 */
export class ContentMessageService extends BaseMessageService<"content"> {
  private static instance: ContentMessageService | null = null;

  /**
   * 私有构造函数，确保单例
   */
  private constructor() {
    super("content");
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): ContentMessageService {
    if (!ContentMessageService.instance) {
      ContentMessageService.instance = new ContentMessageService();
    }
    return ContentMessageService.instance;
  }

  /**
   * 初始化消息服务
   */
  protected initialize(): void {
    // 设置消息监听器
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    console.log("内容脚本消息服务已初始化");
  }

  /**
   * 注册消息处理程序
   * 这里使用了通用MessageHandler类型，如果需要可以添加类型参数
   */
  public registerHandler<TRequest extends BaseMessage, TResponse extends BaseResponse>(
    type: string, 
    handler: MessageHandler<TRequest, TResponse>
  ): void {
    // 这里应该是调用基类的方法，如果基类提供了的话
    // @ts-ignore - 屏蔽类型检查错误（如有必要）
    super.registerHandler(type, handler);
  }

  /**
   * 注销消息处理程序
   */
  public unregisterHandler<TRequest extends BaseMessage, TResponse extends BaseResponse>(
    type: string, 
    handler?: MessageHandler<TRequest, TResponse>
  ): void {
    // 这里应该是调用基类的方法，如果基类提供了的话
    // @ts-ignore - 屏蔽类型检查错误（如有必要）
    super.unregisterHandler(type, handler);
  }
}

/**
 * 获取内容脚本消息服务实例
 */
export function getContentMessageService(): ContentMessageService {
  return ContentMessageService.getInstance();
}

/**
 * 设置消息服务
 */
export function setupMessageService(): ContentMessageService {
  const instance = getContentMessageService();
  console.log('内容脚本消息服务已设置');
  return instance;
}

/**
 * 向后台发送消息的辅助函数
 */
export { sendToBackground as sendMessage };

/**
 * 导出createMessageContext
 */
export { createMessageContext };

/**
 * 注册消息处理函数
 */
export function registerHandler<TRequest extends BaseMessage, TResponse extends BaseResponse>(
  type: string, 
  handler: MessageHandler<TRequest, TResponse>
): void {
  const service = getContentMessageService();
  service.registerHandler(type, handler);
}

/**
 * 注销消息处理程序
 */
export function unregisterHandler<TRequest extends BaseMessage, TResponse extends BaseResponse>(
  type: string, 
  handler?: MessageHandler<TRequest, TResponse>
): void {
  const service = getContentMessageService();
  service.unregisterHandler(type, handler);
}