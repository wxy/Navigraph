import { Logger } from '../../../lib/utils/logger.js';
import { BackgroundMessageService } from '../../messaging/bg-message-service.js';
import { BackgroundMessages, BackgroundResponses } from '../../../types/messages/background.js';
import { NodeTracker } from './node-tracker.js';
import { NavigationEventHandler } from './navigation-event-handler.js';

const logger = new Logger('NavigationMessageHandler');

/**
 * 导航消息处理器
 * 
 * 处理所有与导航相关的消息交互，包括：
 * - 获取节点ID
 * - 页面加载和更新
 * - 用户交互（链接点击、表单提交等）
 * - 页面活动记录
 */
export class NavigationMessageHandler {
  /**
   * 构造函数
   */
  constructor(
    private messageService: BackgroundMessageService,
    private nodeTracker: NodeTracker,
    private navigationEventHandler: NavigationEventHandler,
  ) {}

  /**
   * 注册所有消息处理程序
   */
  public registerMessageHandlers(): void {
    logger.groupCollapsed('注册导航相关消息处理程序');
    
    // 获取节点ID请求
    this.messageService.registerHandler('getNodeId', (
      message: BackgroundMessages.GetNodeIdRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.GetNodeIdResponse) => void
    ) => {
      const ctx = this.messageService.createMessageContext(message, sender, sendResponse);
      
      const handleRequest = async () => {
        try {
          const { tabId, url, referrer, timestamp } = message;
          
          // 获取或创建节点
          const node = await this.nodeTracker.getOrCreateNodeForUrl(url, {
            tabId,
            referrer: referrer || '',  // 如果客户端没遵循新类型，提供默认值作为后备
            timestamp: timestamp || Date.now()  // 如果客户端没遵循新类型，提供默认值作为后备
          });
          
          if (node && node.id) {
            logger.log(`为URL分配节点ID: ${url} -> ${node.id}`);
            ctx.success({ nodeId: node.id });
          } else {
            ctx.error('无法创建节点');
          }
        } catch (error) {
          logger.error('处理getNodeId失败:', error);
          ctx.error(`获取节点ID失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      
      // 执行异步处理
      handleRequest();
      
      return true; // 异步响应
    });

    // 页面加载请求
    this.messageService.registerHandler('pageLoaded', (
      message: BackgroundMessages.PageLoadedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.PageLoadedResponse) => void
    ) => {
      const ctx = this.messageService.createMessageContext(message, sender, sendResponse);
      
      const tabId = sender.tab?.id;
      const pageInfo = message.pageInfo || {};
      const url = pageInfo.url || sender.tab?.url || '';
      
      if (!tabId || !url) {
        return ctx.error('缺少必要的页面信息');
      }
      
      this.nodeTracker.updatePageMetadata(tabId, {
        ...pageInfo,
        url: url
      })
        .then(nodeId => {
          if (nodeId) {
            return ctx.success({ nodeId });
          } else {
            return ctx.error('未找到此页面的节点ID');
          }
        })
        .catch(error => ctx.error(`处理页面加载失败: ${error instanceof Error ? error.message : String(error)}`));
        
      return true; // 异步响应
    });
    
    // 页面标题更新请求
    this.messageService.registerHandler('pageTitleUpdated', (
      message: BackgroundMessages.PageTitleUpdatedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.PageTitleUpdatedResponse) => void
    ) => {
      const ctx = this.messageService.createMessageContext(message, sender, sendResponse);
      
      // 获取节点ID，优先使用消息中的，或者尝试查找
      const handleUpdate = async () => {
        try {
          let nodeId = message.nodeId;
          
          // 如果没有提供节点ID，尝试查找
          if (!nodeId) {
            const tabId = sender.tab?.id;
            const url = sender.tab?.url;
            
            if (!tabId || !url) {
              return ctx.error('无法确定标签页信息');
            }
            
            const result = await this.nodeTracker.getNodeIdForTab(tabId, url);
            if (!result) {
              return ctx.error('未找到节点ID');
            }
            nodeId = result;
          }
          
          // 更新标题
          await this.nodeTracker.updateNodeMetadata(
            nodeId,
            { title: message.title },
            'content_script'
          );
          return ctx.success();
        } catch (error) {
          return ctx.error(`更新页面标题失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      
      handleUpdate();
      return true; // 异步响应
    });
    
    // favicon 更新请求
    this.messageService.registerHandler('faviconUpdated', (
      message: BackgroundMessages.FaviconUpdatedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.FaviconUpdatedResponse) => void
    ) => {
      const ctx = this.messageService.createMessageContext(message, sender, sendResponse);
      
      const handleUpdate = async () => {
        try {
          let nodeId = message.nodeId;
          
          // 如果没有提供节点ID，尝试查找
          if (!nodeId) {
            const tabId = sender.tab?.id;
            const url = sender.tab?.url;
            
            if (!tabId || !url) {
              return ctx.error('无法确定标签页信息');
            }
            
            const result = await this.nodeTracker.getNodeIdForTab(tabId, url);
            if (!result) {
              return ctx.error('未找到节点ID');
            }
            nodeId = result;
          }
          
          // 更新favicon
          await this.nodeTracker.updateNodeMetadata(
            nodeId,
            { favicon: message.faviconUrl },
            'content_script'
          );
          return ctx.success();
        } catch (error) {
          return ctx.error(`更新页面图标失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      
      handleUpdate();
      return true; // 异步响应
    });
    
    // 页面活动消息
    this.messageService.registerHandler('pageActivity', (
      message: BackgroundMessages.PageActivityRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.PageActivityResponse) => void
    ) => {
      const ctx = this.messageService.createMessageContext(message, sender, sendResponse);
      
      // 这里可以添加更多处理逻辑，例如更新节点的最后访问时间
      
      return ctx.success({ acknowledged: true });
    });
    
    // 链接点击请求
    this.messageService.registerHandler('linkClicked', (
      message: BackgroundMessages.LinkClickedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.LinkClickedResponse) => void
    ) => {
      const ctx = this.messageService.createMessageContext(message, sender, sendResponse);
      
      if (message.linkInfo) {
        try {
          const { sourcePageId, sourceUrl, targetUrl, anchorText, isNewTab, timestamp } = message.linkInfo;
          
          // 处理链接点击，始终使用值，不需要检查是否存在
          this.navigationEventHandler.handleLinkClick({
            sourcePageId,
            sourceUrl, 
            targetUrl,
            anchorText: anchorText || '',  // 如果客户端没遵循新类型，提供默认值作为后备
            isNewTab: isNewTab ?? false,   // 使用空值合并运算符处理布尔型属性
            timestamp: timestamp || Date.now()  // 如果客户端没遵循新类型，提供默认值作为后备
          });
          
          ctx.success();
        } catch (error) {
          logger.error('处理链接点击失败:', error);
          ctx.error(`处理链接点击失败: ${error instanceof Error ? error.message : String(error)}`);
        }
        return false;
      } else {
        ctx.error('缺少链接信息');
        return false;
      }
    });
    
    // 表单提交请求
    this.messageService.registerHandler('formSubmitted', (
      message: BackgroundMessages.FormSubmittedRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.FormSubmittedResponse) => void
    ) => {
      const ctx = this.messageService.createMessageContext(message, sender, sendResponse);
      
      const tabId = sender.tab?.id;
      if (!tabId) {
        ctx.error('无法确定标签页ID');
        return false; // 同步响应
      }
      
      if (!message.formInfo) {
        ctx.error('缺少表单信息');
        return false; // 同步响应
      }
      
      try {
        this.navigationEventHandler.handleFormSubmitted(tabId, message.formInfo);
        ctx.success();
      } catch (error) {
        logger.error('处理表单提交失败:', error);
        ctx.error(`处理表单提交失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false; // 同步响应
    });
    
    // JS导航请求
    this.messageService.registerHandler('jsNavigation', (
      message: BackgroundMessages.JsNavigationRequest,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BackgroundResponses.JsNavigationResponse) => void
    ) => {
      const ctx = this.messageService.createMessageContext(message, sender, sendResponse);
      
      const tabId = sender.tab?.id;
      if (!tabId) {
        return ctx.error('无法确定标签页ID');
      }
      
      try {
        this.navigationEventHandler.handleJsNavigation(tabId, message);
        return ctx.success();
      } catch (error) {
        logger.error('处理JS导航失败:', error);
        return ctx.error(`处理JS导航失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    
    logger.groupEnd();
  }

  /**
   * 清理注册的消息处理程序
   */
  public unregisterMessageHandlers(): void {
    this.messageService.unregisterHandler('getNodeId');
    this.messageService.unregisterHandler('pageLoaded');
    this.messageService.unregisterHandler('pageTitleUpdated');
    this.messageService.unregisterHandler('faviconUpdated');
    this.messageService.unregisterHandler('pageActivity');
    this.messageService.unregisterHandler('linkClicked');
    this.messageService.unregisterHandler('formSubmitted');
    this.messageService.unregisterHandler('jsNavigation');
    
    logger.log('已清理所有导航消息处理程序');
  }
}