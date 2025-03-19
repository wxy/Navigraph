/**
 * 消息上下文处理器类
 * 提供基于当前消息上下文的响应创建方法
 */
export class MessageContext {
  /** 消息动作 */
  readonly action: string;
  
  /** 请求ID */
  readonly requestId: string | undefined;
  
  /** 发送者信息 */
  readonly sender: chrome.runtime.MessageSender;
  
  /** 原始消息 */
  readonly message: any;
  
  /** 响应回调函数 */
  private readonly sendResponse: (response?: any) => void;

  /**
   * 创建消息上下文处理器
   * @param message 接收到的消息
   * @param sender 发送者信息
   * @param sendResponse 响应回调函数
   */
  constructor(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) {
    this.message = message;
    this.action = message.action;
    this.requestId = message.requestId;
    this.sender = sender;
    this.sendResponse = sendResponse;
  }

  /**
   * 创建成功响应
   * @param additionalData 附加数据
   * @returns true (表示保持消息通道开启)
   */
  success(additionalData: Record<string, any> = {}): boolean {
    const response = this.createResponse(true);
    Object.assign(response, additionalData);
    this.sendResponse(response);
    return true; // 保持消息通道开启
  }

  /**
   * 创建错误响应
   * @param errorMessage 错误消息
   * @returns true (表示保持消息通道开启)
   */
  error(errorMessage: string): boolean {
    this.sendResponse(this.createErrorResponse(errorMessage));
    return true; // 保持消息通道开启
  }

  /**
   * 创建响应对象
   * @param isSuccess 是否成功
   * @param error 错误信息（如果失败）
   * @returns 响应对象
   */
  createResponse(isSuccess: boolean = true, error?: string): any {
    const response: any = {
      success: isSuccess,
      action: this.action,
      requestId: this.requestId,
      timestamp: Date.now()
    };
    
    if (!isSuccess && error) {
      response.error = error;
    }
    
    return response;
  }

  /**
   * 创建错误响应对象
   * @param errorMessage 错误信息
   * @returns 错误响应对象
   */
  createErrorResponse(errorMessage: string): any {
    return this.createResponse(false, errorMessage);
  }

  /**
   * 获取消息发送者标签页ID
   * @returns 标签页ID或undefined
   */
  getTabId(): number | undefined {
    return this.sender.tab?.id;
  }

  /**
   * 获取消息发送者URL
   * @returns URL或undefined
   */
  getUrl(): string | undefined {
    return this.sender.tab?.url;
  }
}