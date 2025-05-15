import { Logger } from '../../../lib/utils/logger.js';
import { ContentMessageService } from '../content-message-service.js';
import { ContentMessages, ContentResponses } from '../../../types/messages/content.js';
import { sendToBackground, isExtensionContextValid } from '../../../lib/messaging/sender.js';
import { _, _Error } from '../../../lib/utils/i18n.js';

const logger = new Logger('TrackingHandlers');
// 存储从后台获取的标准节点ID
// @ts-ignore - 全局变量可能未在类型中声明
window.standardNodeId = null;
let lastRequestTime = 0;

/**
 * 检查是否是系统页面
 */
function isSystemPage(url: string): boolean {
  // 检查是否是扩展页面、浏览器内置页面等
  return url.startsWith('chrome://') || 
         url.startsWith('chrome-extension://') || 
         url.startsWith('about:') ||
         url.startsWith('edge://') ||
         url.startsWith('brave://') ||
         url.startsWith('opera://');
}

/**
 * 注册跟踪相关的消息处理程序
 */
export function registerTrackingHandlers(messageService: ContentMessageService): void {
  // 请求节点ID处理程序 - 内部使用，保留
  messageService.registerHandler('requestNodeId', (
    message: ContentMessages.RequestNodeIdRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ContentResponses.RequestNodeIdResponse) => void
  ) => {
    const ctx = messageService.createMessageContext(message, sender, sendResponse);
    
    // 执行节点ID请求
    requestNodeId()
      .then((nodeId) => {
        ctx.success({ nodeId: nodeId || null });
      })
      .catch(error => {
        ctx.error(_('tracking_handlers_request_node_id_failed', '请求节点ID失败: {0}'), 
          error instanceof Error ? error.message : String(error));
      });
    
    return true; // 异步响应
  });
  
  logger.log(_('tracking_handlers_registered', '跟踪相关消息处理程序已注册'));
  
  // 初始请求节点ID
  setTimeout(() => {
    requestNodeId().catch(err => 
      logger.error(_('tracking_handlers_init_node_id_failed', '初始化节点ID失败: {0}'), 
        err instanceof Error ? err.message : String(err)));
  }, 1000);
}

/**
 * 请求当前页面的节点ID
 * 内部函数，用于获取并缓存节点ID
 */
async function requestNodeId(): Promise<string | null> {
  if (!isExtensionContextValid()) {
    logger.warn(_('tracking_handlers_invalid_context', '扩展上下文无效，无法请求节点ID'));
    return null;
  }
  
  const now = Date.now();
  
  // 限制频率
  if (now - lastRequestTime < 5000) {
    logger.debug(_('tracking_handlers_request_too_frequent', '请求节点ID间隔过短，跳过'));
    // @ts-ignore - 全局变量可能未在类型中声明
    return window.standardNodeId;
  }
  
  lastRequestTime = now;
  const url = window.location.href;
  
  // 系统页面不请求
  if (isSystemPage(url)) {
    return null;
  }
  
  try {
    logger.log(_('tracking_handlers_request_tab_id', '请求标签页ID...'));
    
    // 获取标签页ID
    const tabIdResponse = await sendToBackground('getTabId', {});
    
    if (tabIdResponse.tabId !== undefined) {
      // 请求节点ID
      const nodeIdResponse = await sendToBackground('getNodeId', {
        tabId: tabIdResponse.tabId,
        url: url,
        referrer: document.referrer,
        timestamp: Date.now()
      });
      
      if (nodeIdResponse.nodeId) {
        // @ts-ignore - 全局变量可能未在类型中声明
        window.standardNodeId = nodeIdResponse.nodeId;
        // @ts-ignore - 全局变量可能未在类型中声明
        return window.standardNodeId;
      }
    }
  } catch (error) {
    logger.error(_('tracking_handlers_get_node_id_failed', '获取节点ID失败: {0}'), 
      error instanceof Error ? error.message : String(error));
  }
  
  return null;
}

/**
 * 直接向后台发送链接点击信息的公共函数
 * 这取代了之前的消息处理程序
 */
export async function sendLinkClickToBackground(linkInfo: {
  targetUrl: string;
  isNewTab?: boolean;
  anchorText?: string;
  [key: string]: any;
}): Promise<void> {
  if (!linkInfo) {
    throw new _Error('tracking_handlers_missing_link_info', '缺少链接信息');
  }
  
  // 使用存储的节点ID
  // @ts-ignore - 全局变量可能未在类型中声明
  const nodeId = window.standardNodeId || '';
  
  // 使用完整的参数结构传递给后台
  await sendToBackground('linkClicked', { 
    linkInfo: {
      // 提供背景脚本需要的上下文信息
      sourcePageId: nodeId,
      sourceUrl: window.location.href,
      timestamp: Date.now(),
      
      // 链接特定信息
      ...linkInfo // 保留其他可能有用的字段
    }
  });
  
  logger.log(_('tracking_handlers_link_sent', '链接点击已发送到后台: {0}'), linkInfo.targetUrl);
}

/**
 * 直接向后台发送表单提交信息的公共函数
 * 这取代了之前的消息处理程序
 */
export async function sendFormSubmitToBackground(formInfo: {
  formAction: string;
  formMethod: string;
  formData?: Record<string, string>;
}): Promise<void> {
  if (!formInfo) {
    throw new _Error('tracking_handlers_missing_form_info', '缺少表单信息');
  }
  
  // 使用存储的节点ID
  // @ts-ignore - 全局变量可能未在类型中声明
  const nodeId = window.standardNodeId || '';
  
  // 使用完整的参数结构传递给后台
  await sendToBackground('formSubmitted', { 
    formInfo: {
      // 提供背景脚本需要的上下文信息
      sourcePageId: nodeId,
      sourceUrl: window.location.href,
      timestamp: Date.now(),
      
      // 表单特定信息
      formAction: formInfo.formAction || '',
      formMethod: formInfo.formMethod || 'GET',
      formData: formInfo.formData || {}
    }
  });
  
  logger.log(_('tracking_handlers_form_sent', '表单提交已发送到后台: {0}'), formInfo.formAction);
}
