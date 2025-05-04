import { Logger } from '../../../lib/utils/logger.js';
import { ContentMessageService } from '../content-message-service.js';
import { ContentMessages, ContentResponses } from '../../../types/messages/content.js';
import { i18n, I18nError } from '../../../lib/utils/i18n-utils.js';

const logger = new Logger('UIHandlers');
/**
 * 注册UI相关的消息处理程序
 */
export function registerUIHandlers(messageService: ContentMessageService): void {
  // 刷新可视化器 - 这是唯一保留的UI更新处理程序
  messageService.registerHandler('refreshVisualizer', (
    message: ContentMessages.RefreshVisualizerRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ContentResponses.RefreshVisualizerResponse) => void
  ) => {
    const ctx = messageService.createMessageContext(message, sender, sendResponse);
    
    try {
      logger.log('ui_handlers_refresh_request');
      
      // 获取可视化器实例并刷新
      const visualizer = window.visualizer;
      if (visualizer && typeof visualizer.triggerRefresh === 'function') {
        // 如果提供了数据，使用数据刷新
        if (message.data && typeof visualizer.refreshVisualization === 'function') {
          visualizer.refreshVisualization(message.data, { restoreTransform: true });
        } else {
          visualizer.triggerRefresh();
        }
        
        ctx.success();
      } else {
        logger.warn('ui_handlers_visualizer_unavailable');
        ctx.error('ui_handlers_visualizer_error');
      }
      return false; // 同步响应
    } catch (error) {
      logger.error('ui_handlers_refresh_error', 
        error instanceof Error ? error.message : String(error));
      ctx.error('ui_handlers_refresh_error', 
        error instanceof Error ? error.message : String(error));
      return false; // 同步响应
    }
  });
  
  logger.log('ui_handlers_registered');
}