import { getSessionManager } from '../session/session-manager.js';
import { enqueue } from '../lib/task-queue.js';
import { getNavigationStorage } from '../store/navigation-storage.js';
import { Logger } from '../../lib/utils/logger.js';
import { BaseMessageService } from '../../lib/messaging/base-service.js';
import { registerTabHandlers, registerSettingsHandlers } from './handlers/index.js';
import { _, _Error } from '../../lib/utils/i18n.js';

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
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.target !== 'background') return false;
      void enqueue(async () => {
        try {
          await this.authorize(message, sender);
          await new Promise<void>(resolve => {
            const respond = (response?: any) => { sendResponse(response); resolve(); };
            const asynchronous = this.handleMessage(message, sender, respond);
            if (!asynchronous) resolve();
          });
        } catch (error) {
          sendResponse({ success: false, error: error instanceof Error ? error.message : String(error), requestId: message?.requestId });
        }
      }).catch(error => {
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error), requestId: message?.requestId });
      });
      return true;
    });
    logger.log(_('bg_message_service_initialized', '后台消息服务已初始化'));
  }
  private async authorize(message: any, sender: chrome.runtime.MessageSender): Promise<void> {
    if (sender.id !== chrome.runtime.id || !message || typeof message.action !== 'string') throw new Error('Untrusted sender');
    if (JSON.stringify(message).length > 32768) throw new Error('Message too large');
    const extensionPages = ['content/index.html', 'options/index.html'].map(path => chrome.runtime.getURL(path));
    const senderUrl = sender.url || '';
    const privileged = extensionPages.includes(senderUrl.split(/[?#]/)[0]);
    const str = (value: unknown, max = 8192): value is string => typeof value === 'string' && value.length <= max;
    const http = (value: unknown): value is string => { try { return str(value) && ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
    if (privileged) {
      for (const key of ['sessionId', 'nodeId', 'title']) if (message[key] !== undefined && !str(message[key], 2048)) throw new Error('Invalid field');
      if (message.timestamp !== undefined && (!Number.isFinite(message.timestamp) || message.timestamp < 0)) throw new Error('Invalid timestamp');
      return;
    }
    const allowed = ['getTabId', 'getNodeId', 'pageLoaded', 'pageTitleUpdated', 'faviconUpdated', 'pageActivity', 'linkClicked', 'formSubmitted', 'jsNavigation'];
    if (!allowed.includes(message.action) || !sender.tab || sender.tab.incognito || sender.frameId !== 0 || !http(senderUrl)) throw new Error('Action not permitted');
    const tabId = sender.tab.id!;
    if (message.tabId !== undefined && message.tabId !== tabId) throw new Error('Tab mismatch');
    const activeFrame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!activeFrame || (sender.documentId && activeFrame.documentId !== sender.documentId)) throw new Error('Inactive document');
    await getSessionManager().ensureRecordingSession();
    message.tabId = tabId;
    const required: Record<string, string[]> = {
      getNodeId: ['url'], pageTitleUpdated: ['title'], faviconUpdated: ['faviconUrl'],
      pageLoaded: ['url'], linkClicked: ['sourcePageId', 'sourceUrl', 'targetUrl'],
      jsNavigation: ['sourcePageId', 'sourceUrl', 'targetUrl'], formSubmitted: ['sourcePageId', 'sourceUrl', 'formAction', 'formMethod']
    };
    if (['pageLoaded', 'linkClicked', 'formSubmitted'].includes(message.action)) {
      const key = { pageLoaded: 'pageInfo', linkClicked: 'linkInfo', formSubmitted: 'formInfo' }[message.action as 'pageLoaded'];
      if (!message[key] || typeof message[key] !== 'object' || Array.isArray(message[key])) throw new Error('Missing payload');
    }
    const payload = message.pageInfo || message.linkInfo || message.formInfo || message;
    for (const key of required[message.action] || []) {
      if (!str(payload[key]) || !payload[key]) throw new Error('Missing or invalid ' + key);
    }
    for (const key of ['title', 'favicon', 'faviconUrl', 'description', 'keywords', 'anchorText', 'sourcePageId', 'nodeId', 'referrer']) {
      if (payload[key] !== undefined && !str(payload[key])) throw new Error('Invalid ' + key);
    }
    if (payload.isNewTab !== undefined && typeof payload.isNewTab !== 'boolean') throw new Error('Invalid isNewTab');
    if (message.formInfo) {
      if (!http(payload.formAction) || !['get', 'post'].includes(payload.formMethod.toLowerCase())) throw new Error('Invalid form');
      if (payload.formData && (typeof payload.formData !== 'object' || Array.isArray(payload.formData) || Object.values(payload.formData).some(value => !str(value)))) throw new Error('Invalid form fields');
      payload.formData = {}; // Navigation intent never needs submitted field values.
    }
    if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid payload');
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string' && !str(value, key === 'title' || key === 'description' ? 4096 : 8192)) throw new Error('Invalid string');
      if (['timestamp', 'loadTime', 'duration'].includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Invalid number');
      if (['url', 'sourceUrl'].includes(key) && value !== undefined) {
        if (!http(value) || value !== senderUrl) throw new Error('Document URL mismatch');
      }
      if (['targetUrl', 'referrer'].includes(key) && value && !http(value)) throw new Error('Invalid URL');
    }
    for (const nodeId of [message.nodeId, payload.sourcePageId].filter(Boolean)) {
      if (!str(nodeId, 2048)) throw new Error('Invalid node');
      const node = await getNavigationStorage().getNode(nodeId);
      if (!node || node.tabId !== tabId || node.url !== senderUrl || node.sessionId !== getSessionManager().getLatestSessionId()) throw new Error('Node ownership mismatch');
    }
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
  
  logger.groupCollapsed(_('bg_message_service_registering_handlers', '正在注册后台消息处理程序...'));
  
  // 仅注册实际需要的处理程序
  registerTabHandlers(messageService);
  registerSettingsHandlers(messageService);
  
  logger.groupEnd();
}