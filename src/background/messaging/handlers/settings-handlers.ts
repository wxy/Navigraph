import { Logger } from '../../../lib/utils/logger.js';
import { BackgroundMessageService } from '../bg-message-service.js';
import { BackgroundMessages, BackgroundResponses } from '../../../types/messages/background.js';
import { getSettingsService } from '../../../lib/settings/service.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';

const logger = new Logger('SettingsHandlers');
/**
 * 注册设置相关的消息处理程序
 */
export function registerSettingsHandlers(messageService: BackgroundMessageService): void {
  // 获取设置
  messageService.registerHandler('getSettings', (
    message: BackgroundMessages.GetSettingsRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponses.GetSettingsResponse) => void
  ) => {
    const ctx = messageService.createMessageContext(message, sender, sendResponse);
    if (!ctx) {
      logger.error(i18n('settings_context_failed', '创建消息上下文失败'));
      return false;
    }
    const settingsService = getSettingsService();
    try {
      // 使用现有的设置服务获取设置
      settingsService.getSettings()
        .then((settings: Record<string, any>) => {
          // 确保始终返回一个对象，即使设置为空
          ctx.success({ settings: settings || {} });
        })
        .catch((error: Error) => {
          logger.error(i18n('settings_get_error', '获取设置时出错'), error);
          ctx.error(i18n('settings_get_failed', '获取设置失败: {0}'), error.message);
        });
    } catch (error) {
      logger.error(i18n('settings_handler_error', '处理{0}请求时出错'), 'getSettings');
      ctx.error(i18n('settings_request_failed', '处理请求失败: {0}'), error instanceof Error ? error.message : String(error));
    }
    
    return true; // 需要异步响应
  });
  
  // 保存设置
  messageService.registerHandler('saveSettings', (
    message: BackgroundMessages.SaveSettingsRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponses.SaveSettingsResponse) => void
  ) => {
    const ctx = messageService.createMessageContext(message, sender, sendResponse);
    if (!ctx) {
      logger.error(i18n('settings_context_failed', '创建消息上下文失败'));
      return false;
    }
    const settingsService = getSettingsService();
    const { settings } = message;
    
    if (!settings) {
      ctx.error(i18n('settings_missing_data', '缺少设置数据'));
      return false;
    }
    
    try {
      // 使用现有的设置服务保存设置
      settingsService.updateSettings(settings)
        .then(() => {
          ctx.success();
        })
        .catch((error: Error) => {
          logger.error(i18n('settings_save_error', '保存设置时出错'), error);
          ctx.error(i18n('settings_save_failed', '保存设置失败: {0}'), error.message);
        });
    } catch (error) {
      logger.error(i18n('settings_handler_error', '处理{0}请求时出错'), 'saveSettings');
      ctx.error(i18n('settings_request_failed', '处理请求失败: {0}'), error instanceof Error ? error.message : String(error));
    }
    
    return true; // 需要异步响应
  });
  
  // 重置设置
  messageService.registerHandler('resetSettings', (
    message: BackgroundMessages.ResetSettingsRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponses.ResetSettingsResponse) => void
  ) => {
    const ctx = messageService.createMessageContext(message, sender, sendResponse);
    if (!ctx) {
      logger.error(i18n('settings_context_failed', '创建消息上下文失败'));
      return false;
    }
    const settingsService = getSettingsService();
    
    if (!message) {
      ctx.error(i18n('settings_invalid_request', '无效的请求'));
      return false;
    }

    // 移除外层try-catch，仅保留Promise错误处理
    settingsService.resetSettings()
      .then(() => ctx.success())
      .catch(error => {
        logger.error(i18n('settings_reset_error', '重置设置时出错'), error);
        ctx.error(i18n('settings_reset_failed', '重置设置失败: {0}'), error instanceof Error ? error.message : String(error));
      });
    
    return true; // 需要异步响应
  });
  
  logger.log(i18n('settings_handlers_registered', '设置相关消息处理程序已注册'));
}