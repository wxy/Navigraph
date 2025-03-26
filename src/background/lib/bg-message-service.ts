import { MessageHandler, BaseMessage } from '../../types/message-types';

/**
 * 后台消息服务
 * 处理接收到的消息并路由到相应的处理程序
 */
export class BackgroundMessageService {
  private static instance: BackgroundMessageService | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: NodeJS.Timeout;
  }> = new Map();
  private readonly REQUEST_TIMEOUT = 30000; // 30秒请求超时
  private initialized: boolean = false;
  
  /**
   * 私有构造函数，防止直接实例化
   */
  private constructor() {
    // 设置消息监听器
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    this.initialized = true;
    console.log('后台消息服务已初始化');
  }
  
  /**
   * 获取单例实例
   */
  public static getInstance(): BackgroundMessageService {
    if (!BackgroundMessageService.instance) {
      BackgroundMessageService.instance = new BackgroundMessageService();
    }
    return BackgroundMessageService.instance;
  }
  
  /**
   * 处理接收到的消息
   */
  private handleMessage(
    message: any, 
    sender: chrome.runtime.MessageSender, 
    sendResponse: (response?: any) => void
  ): boolean {
    // 检查是否为响应消息
    if (message.isResponse && message.requestId) {
      return this.handleResponseMessage(message);
    }
    
    // 确保消息有一个请求ID
    if (!message.requestId) {
      message.requestId = this.generateRequestId();
    }
    
    console.log('收到消息:', message.action, `[ID:${message.requestId}]`);
    
    if (!message || !message.action) {
      if (sendResponse) {
        sendResponse({ 
          success: false, 
          error: '缺少action字段',
          requestId: message.requestId,
          action: message.action
        });
      }
      return false;
    }
    
    // 获取对应的处理程序
    const handlers = this.handlers.get(message.action) || [];
    
    if (handlers.length === 0) {
      console.warn(`没有处理程序注册用于消息类型: ${message.action}`);
      if (sendResponse) {
        sendResponse({ 
          success: false, 
          error: `未处理的消息类型: ${message.action}`,
          requestId: message.requestId,
          action: message.action
        });
      }
      return false;
    }
    
    // 执行处理程序
    // 如果任何处理程序返回true，则保持消息通道开放以进行异步响应
    let keepChannelOpen = false;
    let responseHandled = false;
    
    for (const handler of handlers) {
      try {
        const result = handler(message, sender, (response) => {
          if (!responseHandled && sendResponse) {
            // 确保响应包含请求ID
            const finalResponse = {
              ...response,
              requestId: message.requestId,
              action: message.action // 回显原始action
            };
            sendResponse(finalResponse);
            responseHandled = true;
          }
        });
        
        if (result === true) {
          keepChannelOpen = true;
        }
      } catch (error) {
        console.error(`处理消息${message.action}时出错:`, error);
        if (!responseHandled && sendResponse) {
          sendResponse({ 
            success: false, 
            error: `处理消息时出错: ${error instanceof Error ? error.message : String(error)}`,
            requestId: message.requestId,
            action: message.action
          });
          responseHandled = true;
        }
      }
    }
    
    return keepChannelOpen;
  }
  
  /**
   * 处理响应消息
   * 匹配之前发送的请求，并解析相应的Promise
   */
  private handleResponseMessage(message: any): boolean {
    const { requestId } = message;
    
    if (this.pendingRequests.has(requestId)) {
      const { resolve, reject, timer } = this.pendingRequests.get(requestId)!;
      
      // 清除超时计时器
      clearTimeout(timer);
      
      // 移除等待请求
      this.pendingRequests.delete(requestId);
      
      if (message.success === false) {
        reject(new Error(message.error || '未知错误'));
      } else {
        resolve(message);
      }
      
      return false; // 不保持消息通道开放
    }
    
    console.warn(`收到未匹配的响应消息: ${requestId}`);
    return false;
  }
  
  /**
   * 生成唯一请求ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }
  
  /**
   * 注册消息处理程序
   * @param action 消息动作类型
   * @param handler 处理函数
   */
  public registerHandler(action: string, handler: MessageHandler): void {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, []);
    }
    
    this.handlers.get(action)!.push(handler);
    console.log(`已注册消息处理程序: ${action}`);
  }
  
  /**
   * 注册多个消息处理程序
   * @param handlers 消息处理程序映射
   */
  public registerHandlers(handlers: Record<string, MessageHandler>): void {
    for (const [action, handler] of Object.entries(handlers)) {
      this.registerHandler(action, handler);
    }
  }
  
  /**
   * 取消注册消息处理程序
   * @param action 消息动作类型
   * @param handler 处理函数(可选)，不提供则移除所有该类型的处理程序
   */
  public unregisterHandler(action: string, handler?: MessageHandler): void {
    if (!this.handlers.has(action)) {
      return;
    }
    
    if (handler) {
      const handlers = this.handlers.get(action)!;
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
        console.log(`已移除消息处理程序: ${action}`);
      }
      
      // 如果没有处理程序了，删除整个条目
      if (handlers.length === 0) {
        this.handlers.delete(action);
      }
    } else {
      this.handlers.delete(action);
      console.log(`已移除所有 ${action} 消息处理程序`);
    }
  }
  
  /**
   * 发送消息到内容脚本
   * @param tabId 目标标签页ID
   * @param message 消息内容
   */
  public async sendMessageToTab(tabId: number, message: any): Promise<any> {
    // 确保消息有一个请求ID
    if (!message.requestId) {
      message.requestId = this.generateRequestId();
    }
    
    return new Promise((resolve, reject) => {
      try {
        console.log(`发送消息到标签页 ${tabId}:`, message.action, `[ID:${message.requestId}]`);
        
        // 设置超时处理
        const timer = setTimeout(() => {
          if (this.pendingRequests.has(message.requestId)) {
            this.pendingRequests.delete(message.requestId);
            reject(new Error(`发送到标签页 ${tabId} 的请求超时: ${message.action}`));
          }
        }, this.REQUEST_TIMEOUT);
        
        // 存储待处理请求
        this.pendingRequests.set(message.requestId, { resolve, reject, timer });
        
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.error(`发送消息到标签页${tabId}失败:`, error);
            // 移除待处理请求
            if (this.pendingRequests.has(message.requestId)) {
              clearTimeout(this.pendingRequests.get(message.requestId)!.timer);
              this.pendingRequests.delete(message.requestId);
            }
            reject(new Error(error.message));
            return;
          }
          
          // 如果收到直接响应，解析Promise
          if (response) {
            // 移除待处理请求，因为我们已经收到了响应
            if (this.pendingRequests.has(message.requestId)) {
              clearTimeout(this.pendingRequests.get(message.requestId)!.timer);
              this.pendingRequests.delete(message.requestId);
            }
            
            if (response.success === false) {
              reject(new Error(response.error || '未知错误'));
            } else {
              resolve(response);
            }
          }
          // 如果没有直接响应，Promise将在handleResponseMessage中解析
        });
      } catch (error) {
        console.error(`发送消息到标签页${tabId}失败:`, error);
        reject(error);
      }
    });
  }
  
  /**
   * 发送消息并等待响应
   * @param message 要发送的消息
   */
  public async sendMessage(message: BaseMessage): Promise<any> {
    // 确保消息有一个请求ID
    if (!message.requestId) {
      message.requestId = this.generateRequestId();
    }
    
    return new Promise((resolve, reject) => {
      try {
        console.log(`发送消息:`, message.action, `[ID:${message.requestId}]`);
        
        // 设置超时处理
        const timer = setTimeout(() => {
          if (this.pendingRequests.has(message.requestId!)) {
            this.pendingRequests.delete(message.requestId!);
            reject(new Error(`请求超时: ${message.action}`));
          }
        }, this.REQUEST_TIMEOUT);
        
        // 存储待处理请求
        this.pendingRequests.set(message.requestId!, { resolve, reject, timer });
        
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.error(`发送消息失败:`, error);
            // 移除待处理请求
            if (this.pendingRequests.has(message.requestId!)) {
              clearTimeout(this.pendingRequests.get(message.requestId!)!.timer);
              this.pendingRequests.delete(message.requestId!);
            }
            reject(new Error(error.message));
            return;
          }
          
          // 如果收到直接响应，解析Promise
          if (response) {
            // 移除待处理请求，因为我们已经收到了响应
            if (this.pendingRequests.has(message.requestId!)) {
              clearTimeout(this.pendingRequests.get(message.requestId!)!.timer);
              this.pendingRequests.delete(message.requestId!);
            }
            
            if (response.success === false) {
              reject(new Error(response.error || '未知错误'));
            } else {
              resolve(response);
            }
          }
          // 如果没有直接响应，Promise将在handleResponseMessage中解析
        });
      } catch (error) {
        console.error(`发送消息失败:`, error);
        reject(error);
      }
    });
  }
  
  /**
   * 广播消息到所有内容脚本
   * @param message 要广播的消息
   * @param excludeTabs 要排除的标签页ID数组
   */
  public async broadcastMessage(message: any, excludeTabs: number[] = []): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({});
      
      // 确保消息有一个请求ID
      if (!message.requestId) {
        message.requestId = this.generateRequestId();
      }
      
      console.log(`广播消息:`, message.action, `[ID:${message.requestId}]`);
      
      const sendPromises = tabs
        .filter(tab => tab.id !== undefined && !excludeTabs.includes(tab.id))
        .map(tab => {
          return this.sendMessageToTab(tab.id!, message)
            .catch(error => {
              // 忽略单个标签页的错误，继续发送到其他标签页
              console.warn(`向标签页 ${tab.id} 发送消息失败:`, error);
              return null;
            });
        });
      
      await Promise.all(sendPromises);
    } catch (error) {
      console.error('广播消息失败:', error);
      throw error;
    }
  }
  
  /**
   * 创建消息上下文对象
   * 用于在处理程序中更方便地管理消息状态和响应
   */
  public createMessageContext(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): BackgroundMessageContext {
    return new BackgroundMessageContext(message, sender, sendResponse);
  }
}

/**
 * 消息上下文类
 * 封装消息处理过程中的上下文信息和辅助方法
 */
export class BackgroundMessageContext {
  private message: any;
  private sender: chrome.runtime.MessageSender;
  private sendResponse: (response?: any) => void;
  private asyncResponseMarked: boolean = false;
  
  constructor(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) {
    this.message = message;
    this.sender = sender;
    this.sendResponse = sendResponse;
  }
  
  /**
   * 发送成功响应
   */
  public success(data: any = {}): boolean {
    const response = {
      success: true,
      ...data,
      // 回显请求ID (如果有)
      requestId: this.message.requestId,
      // 回显动作类型
      action: this.message.action
    };
    
    this.sendResponse(response);
    return false; // 表示已处理完成，不保持消息通道开放
  }
  
  /**
   * 发送错误响应
   */
  public error(errorMessage: string): boolean {
    const response = {
      success: false,
      error: errorMessage,
      // 回显请求ID (如果有)
      requestId: this.message.requestId,
      // 回显动作类型
      action: this.message.action
    };
    
    this.sendResponse(response);
    return false; // 表示已处理完成，不保持消息通道开放
  }
  
  /**
   * 通用响应方法
   */
  public respond(response: any): boolean {
    this.sendResponse({
      ...response,
      // 回显请求ID (如果有)
      requestId: this.message.requestId,
      // 回显动作类型
      action: this.message.action
    });
    return false; // 表示已处理完成，不保持消息通道开放
  }
  
  /**
   * 标记为异步响应
   * 在异步处理中使用，表示需要保持消息通道开放
   */
  public markAsAsync(): true {
    this.asyncResponseMarked = true;
    return true; // 表示需要保持消息通道开放
  }
  
  /**
   * 获取发送者的标签页ID
   */
  public getTabId(): number | undefined {
    return this.sender.tab?.id;
  }
  
  /**
   * 获取发送者的URL
   */
  public getUrl(): string | undefined {
    return this.sender.tab?.url || this.message.url;
  }
  
  /**
   * 获取发送者的域名
   */
  public getOrigin(): string | undefined {
    try {
      const url = this.getUrl();
      if (url) {
        return new URL(url).origin;
      }
    } catch (e) {
      console.error('获取源失败:', e);
    }
    return undefined;
  }
  
  /**
   * 检查消息中是否包含特定字段
   */
  public hasField(field: string): boolean {
    return field in this.message && this.message[field] !== undefined && this.message[field] !== null;
  }
  
  /**
   * 获取消息中的字段值
   */
  public getField<T>(field: string, defaultValue?: T): T | undefined {
    return this.hasField(field) ? this.message[field] : defaultValue;
  }
}

// 导出工具函数获取单例
export const getBackgroundMessageService = (): BackgroundMessageService => {
  return BackgroundMessageService.getInstance();
};