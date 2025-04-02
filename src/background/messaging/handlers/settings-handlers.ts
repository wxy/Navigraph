import { Logger } from '../../../lib/utils/logger.js';
import { BackgroundMessageService } from '../bg-message-service.js';
import { BackgroundMessages, BackgroundResponses } from '../../../types/messages/background.js';

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
    
    try {
      const settingsService = require('../../lib/settings/service.js').getSettingsService();
      
      // 使用现有的设置服务获取设置
      settingsService.getAll()
        .then((settings: Record<string, any>) => {
          // 确保始终返回一个对象，即使设置为空
          ctx.success({ settings: settings || {} });
        })
        .catch((error: Error) => {
          logger.error('获取设置时出错:', error);
          ctx.error(`获取设置失败: ${error.message}`);
        });
    } catch (error) {
      logger.error('处理getSettings请求时出错:', error);
      ctx.error(`处理请求失败: ${error instanceof Error ? error.message : String(error)}`);
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
    const { settings } = message;
    
    if (!settings) {
      ctx.error('缺少设置数据');
      return false;
    }
    
    try {
      const settingsService = require('../../lib/settings/service.js').getSettingsService();
      
      // 使用现有的设置服务保存设置
      settingsService.saveAll(settings)
        .then(() => {
          ctx.success();
        })
        .catch((error: Error) => {
          logger.error('保存设置时出错:', error);
          ctx.error(`保存设置失败: ${error.message}`);
        });
    } catch (error) {
      logger.error('处理saveSettings请求时出错:', error);
      ctx.error(`处理请求失败: ${error instanceof Error ? error.message : String(error)}`);
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
    
    try {
      const settingsService = require('../../lib/settings/service.js').getSettingsService();
      
      // 使用现有的设置服务重置设置
      settingsService.resetToDefaults()
        .then(() => {
          ctx.success();
        })
        .catch((error: Error) => {
          logger.error('重置设置时出错:', error);
          ctx.error(`重置设置失败: ${error.message}`);
        });
    } catch (error) {
      logger.error('处理resetSettings请求时出错:', error);
      ctx.error(`处理请求失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return true; // 需要异步响应
  });
  
  logger.log('设置相关消息处理程序已注册');
}