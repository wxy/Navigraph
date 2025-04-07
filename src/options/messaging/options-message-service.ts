import { Logger } from '../../lib/utils/logger.js';
import { BaseMessageService } from '../../lib/messaging/base-service.js';

const logger = new Logger('OptionsMessageService');
/**
 * 选项页消息服务类
 * 处理发送给选项页的消息
 */
export class OptionsMessageService extends BaseMessageService<'options'> {
  private static instance: OptionsMessageService | null = null;
  
  /**
   * 私有构造函数，确保单例
   */
  private constructor() {
    super('options');
  }
  
  /**
   * 获取单例实例
   */
  public static getInstance(): OptionsMessageService {
    if (!OptionsMessageService.instance) {
      OptionsMessageService.instance = new OptionsMessageService();
    }
    return OptionsMessageService.instance;
  }
  
  /**
   * 初始化消息服务
   */
  protected initialize(): void {
    // 设置消息监听器
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    logger.log('选项页消息服务已初始化');
  }
}

// 导出单例获取函数
export const getOptionsMessageService = (): OptionsMessageService => {
  return OptionsMessageService.getInstance();
};