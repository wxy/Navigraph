import { BaseMessageService } from '../../lib/messaging/base-service.js';

/**
 * 内容脚本消息服务类
 */
export class ContentMessageService extends BaseMessageService<'content'> {
  private static instance: ContentMessageService | null = null;
  
  /**
   * 私有构造函数，确保单例
   */
  private constructor() {
    super('content');
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
    console.log('内容脚本消息服务已初始化');
  }
}

// 导出单例获取函数
export const getContentMessageService = (): ContentMessageService => {
  return ContentMessageService.getInstance();
};