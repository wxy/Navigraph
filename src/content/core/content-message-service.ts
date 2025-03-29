import { BaseMessage, RequestResponseMap, MessageHandler } from '../../types/message-types.js';

/**
 * 内容脚本消息服务
 * 负责与后台脚本进行通信
 */
class ContentMessageService {
  private static instance: ContentMessageService | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private initialized: boolean = false;
  
  /**
   * 私有构造函数，防止直接实例化
   */
  private constructor() {
    this.setupMessageListener();
    this.initialized = true;
    console.log('内容消息服务已初始化');
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
   * 设置消息监听器
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object' || !message.action) {
        console.error('收到无效消息，缺少action字段');
        sendResponse({ success: false, error: '缺少action字段' });
        return false;
      }
      
      // 忽略目标为后台的消息，这些应该由后台处理
      if (message.target === 'background') {
        console.log(`跳过发往后台的消息: ${message.action}`);
        return false;
      }
      
      // 只处理目标为content的消息
      if (message.target !== 'content' && message.target !== undefined) {
        console.warn(`未知的消息目标: ${message.target}，跳过处理`);
        return false;
      }
      
      console.log(`处理内容脚本消息: ${message.action} [ID:${message.requestId || 'none'}]`);
      
      // 获取对应的处理程序
      const handlers = this.handlers.get(message.action) || [];
      
      if (handlers.length === 0) {
        console.warn(`没有处理程序注册用于消息类型: ${message.action}`);
        sendResponse({ success: false, error: `未处理的消息类型: ${message.action}` });
        return false;
      }
      
      // 执行处理程序
      let keepChannelOpen = false;
      let responseHandled = false;
      
      for (const handler of handlers) {
        try {
          const result = handler(message, sender, (response) => {
            if (!responseHandled) {
              sendResponse(response);
              responseHandled = true;
            }
          });
          
          if (result === true) {
            keepChannelOpen = true;
          }
        } catch (error) {
          console.error(`处理消息${message.action}时出错:`, error);
          if (!responseHandled) {
            sendResponse({
              success: false,
              error: `处理消息时出错: ${error instanceof Error ? error.message : String(error)}`
            });
            responseHandled = true;
          }
        }
      }
      
      return keepChannelOpen;
    });
  }
  
  /**
   * 注册消息处理程序
   * @param action 消息类型
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
   * 取消注册消息处理程序
   * @param action 消息类型
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
   * 发送消息到后台脚本
   * @param action 消息类型
   * @param data 消息数据
   * @returns Promise<any> 响应结果
   */
  public sendMessage<T extends keyof RequestResponseMap>(
    action: T, 
    data: Omit<RequestResponseMap[T]['request'], 'action' | 'requestId'> = {} as any
  ): Promise<RequestResponseMap[T]['response']> {
    return new Promise((resolve, reject) => {
      try {
        const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        
        // 构建消息对象，设置默认target为background
        const message = {
          action: action as string,
          requestId,
          ...data,
          target: 'background' // 默认target为background
        };
        
        console.log(`发送消息: ${action} [ID:${requestId}], target: ${message.target}`);
        
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            console.error('发送消息时出错:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }
          
          if (!response) {
            reject(new Error('没有收到响应'));
            return;
          }
          
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          
          resolve(response);
        });
      } catch (error) {
        console.error('发送消息异常:', error);
        reject(error);
      }
    });
  }
}

// 创建单例实例
const contentMessageService = ContentMessageService.getInstance();

/**
 * 设置消息服务
 * 初始化消息服务
 */
export function setupMessageService(): void {
  // 实例已在导入时创建
  console.log('消息服务已设置');
}

/**
 * 发送消息到后台脚本
 * @param action 消息类型
 * @param data 消息数据
 * @returns Promise<any> 响应结果
 */
export function sendMessage<T extends keyof RequestResponseMap>(
  action: T, 
  data: Omit<RequestResponseMap[T]['request'], 'action' | 'requestId'> = {} as any
): Promise<RequestResponseMap[T]['response']> {
  return contentMessageService.sendMessage(action, data);
}

/**
 * 注册消息处理程序
 * @param action 消息类型
 * @param handler 处理函数
 */
export function registerMessageHandler(action: string, handler: MessageHandler): void {
  contentMessageService.registerHandler(action, handler);
}

/**
 * 取消注册消息处理程序
 * @param action 消息类型
 * @param handler 处理函数(可选)，不提供则移除所有该类型的处理程序
 */
export function unregisterMessageHandler(action: string, handler?: MessageHandler): void {
  contentMessageService.unregisterHandler(action, handler);
}