import { Logger } from '../../lib/utils/logger.js';
import { BaseMessageService } from '../../lib/messaging/base-service.js';
import { registerTabHandlers, registerSettingsHandlers } from './handlers/index.js';
import { i18n } from '../../lib/utils/i18n-utils.js';

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
    logger.log(i18n('bg_message_service_initialized', '后台消息服务已初始化'));
  }
}

// 导出单例获取函数
export const getBackgroundMessageService = (): BackgroundMessageService => {
  return BackgroundMessageService.getInstance();
};

/**
 * 注册所有后台消息处理程序
 */
export const registerAllBackgroundHandlers = (): void => {
  const messageService = getBackgroundMessageService();
  
  logger.groupCollapsed(i18n('bg_message_service_registering_handlers', '正在注册后台消息处理程序...'));
  
  // 仅注册实际需要的处理程序
  registerTabHandlers(messageService);
  registerSettingsHandlers(messageService);
  
  logger.groupEnd();
}