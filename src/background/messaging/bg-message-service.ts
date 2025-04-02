import { Logger } from '../../lib/utils/logger.js';
import { BaseMessageService } from '../../lib/messaging/base-service.js';

const logger = new Logger('BackgroundMessageService');
/**
 * 后台消息服务类
 * 处理发送给后台的消息
 */
export class BackgroundMessageService extends BaseMessageService<'background'> {
  private static instance: BackgroundMessageService | null = null;
  
  /**
   * 私有构造函数，确保单例
   */
  private constructor() {
    super('background');
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
   * 初始化消息服务
   */
  protected initialize(): void {
    // 设置消息监听器
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    logger.log('后台消息服务已初始化');
  }
}

// 导出单例获取函数
export const getBackgroundMessageService = (): BackgroundMessageService => {
  return BackgroundMessageService.getInstance();
};