/**
 * 导航消息处理器
 * 处理与导航可视化相关的所有消息通信
 */
import { Logger } from '../../../lib/utils/logger.js';
import { 
  BaseMessage, 
  BaseResponse 
} from '../../../types/messages/common.js';
import { 
  registerHandler, 
  unregisterHandler, 
  sendMessage 
} from '../content-message-service.js';
import type { NavigationVisualizer } from '../../core/navigation-visualizer.js';
import type { NavNode } from '../../types/navigation.js';
import { _, _Error } from '../../../lib/utils/i18n.js';

const logger = new Logger('NavigationMessageHandler');

/**
 * 导航消息处理器 
 * 负责管理与后台/内容脚本的通信
 */
export class NavigationMessageHandler {
  private visualizer: NavigationVisualizer;
  
  /**
   * 构造函数
   * @param visualizer 可视化器实例的引用
   */
  constructor(visualizer: NavigationVisualizer) {
    this.visualizer = visualizer;
    logger.log(_('nav_message_handler_initialized', '导航消息处理器初始化'));
  }
  
  /**
   * 初始化所有消息监听器
   */
  initialize(): void {
    logger.groupCollapsed(_('nav_message_handler_init_listeners', '初始化导航消息监听...'));
    
    // 注册各类消息处理函数
    this.registerRefreshHandler();
    this.registerNodeIdHandler();
    this.registerPageLoadedHandler();
    this.registerPageTitleHandler();
    this.registerFaviconHandler();
    this.registerPageActivityHandler();
    this.registerLinkClickedHandler();
    this.registerFormSubmittedHandler();
    this.registerJsNavigationHandler();
    
    logger.groupEnd();
  }
  
  /**
   * 清理所有消息监听器
   */
  cleanup(): void {
    logger.log(_('nav_message_handler_cleanup', '清理消息处理器...'));
    
    // 取消注册所有处理器
    unregisterHandler("getNodeId");
    unregisterHandler("pageLoaded");
    unregisterHandler("pageTitleUpdated");
    unregisterHandler("faviconUpdated");
    unregisterHandler("pageActivity");
    unregisterHandler("linkClicked");
    unregisterHandler("formSubmitted");
    unregisterHandler("jsNavigation");
    unregisterHandler("refreshVisualization");
    
    logger.log(_('nav_message_handler_all_cleaned', '所有消息处理器已清理'));
  }
  
  /**
   * 注册可视化刷新处理器
   */
  private registerRefreshHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "refreshVisualization",
      (message: any, sender, sendResponse) => {
        logger.log(_('nav_message_handler_refresh_request', '收到刷新请求'));
        
        // 确认收到请求并发送响应
        if (message.requestId) {
          sendResponse({
            success: true,
            requestId: message.requestId,
          } as BaseResponse);
        }
        
        // 延迟执行刷新操作
        setTimeout(async () => {
          try {
            logger.log(_('nav_message_handler_refresh_start', '🔄 开始执行刷新操作...'));
            await this.visualizer.refreshData();
            logger.log(_('nav_message_handler_refresh_complete', '✅ 刷新操作完成'));
          } catch (error) {
            logger.error(_('nav_message_handler_refresh_failed', '❌ 自动刷新可视化失败: {0}'), 
              error instanceof Error ? error.message : String(error));
          }
        }, 50);
        
        return false; // 同步处理响应
      }
    );
  }
  
  /**
   * 注册节点ID处理器
   */
  private registerNodeIdHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "getNodeId",
      (message: any, sender, sendResponse) => {
        try {
          const pageUrl = message.url;
          logger.debug(_('nav_message_handler_get_node_request', '收到获取节点ID请求: {0}'), JSON.stringify({url: pageUrl}));
          
          if (!pageUrl) {
            throw new _Error('nav_message_handler_empty_url', 'URL为空');
          }
          
          // 获取或创建节点ID
          const nodeId = this.visualizer.getOrCreateNodeId(pageUrl);
          
          // 返回找到的节点ID，包含requestId
          sendResponse({
            success: true,
            nodeId,
            requestId: message.requestId,
          } as BaseResponse);
          
        } catch (error) {
          logger.error(_('nav_message_handler_get_node_failed', '获取节点ID失败: {0}'), 
            error instanceof Error ? error.message : String(error));
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : String(error),
            requestId: message.requestId
          });
        }
        
        return false; // 同步处理
      }
    );
  }
  
  /**
   * 注册页面加载处理器
   */
  private registerPageLoadedHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "pageLoaded",
      (message: any, sender, sendResponse) => {
        try {
          logger.debug(_('nav_message_handler_page_loaded', '收到页面加载消息: {0}'), message.pageInfo?.url ?? '');
          
          // 确认收到消息并回复
          if (message.requestId) {
            sendResponse({
              success: true,
              requestId: message.requestId,
            } as BaseResponse);
          }
          
          // 延迟刷新视图
          setTimeout(async () => {
            try {
              await this.visualizer.handlePageLoaded(message);
              logger.log(_('nav_message_handler_page_refresh_complete', '页面加载后刷新可视化完成'));
            } catch (error) {
              logger.error(_('nav_message_handler_page_refresh_failed', '页面加载后刷新可视化失败: {0}'), 
                error instanceof Error ? error.message : String(error));
            }
          }, 200);
          
        } catch (error) {
          logger.error(_('nav_message_handler_handle_page_failed', '处理页面加载失败: {0}'), 
            error instanceof Error ? error.message : String(error));
          if (message.requestId) {
            sendResponse({ 
              success: false, 
              error: error instanceof Error ? error.message : String(error),
              requestId: message.requestId
            });
          }
        }
        
        return false; // 同步处理
      }
    );
  }
  
  /**
   * 注册页面标题更新处理器
   */
  private registerPageTitleHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "pageTitleUpdated",
      (message: any, sender, sendResponse) => {
        try {
          const { nodeId, title } = message;
          logger.debug(_('nav_message_handler_title_updated', '收到页面标题更新: {0}'), JSON.stringify({ nodeId, title }));
          
          if (!nodeId || !title) {
            throw new _Error('nav_message_handler_empty_node_title', '节点ID或标题为空');
          }
          
          // 委托给可视化器更新标题
          this.visualizer.updateNodeMetadata(nodeId, { title });
          
          // 回复成功消息
          if (message.requestId) {
            sendResponse({
              success: true,
              requestId: message.requestId,
            } as BaseResponse);
          }
        } catch (error) {
          logger.error(_('nav_message_handler_update_title_failed', '更新页面标题失败: {0}'), 
            error instanceof Error ? error.message : String(error));
          if (message.requestId) {
            sendResponse({ 
              success: false, 
              error: error instanceof Error ? error.message : String(error),
              requestId: message.requestId
            });
          }
        }
        
        return false; // 同步处理
      }
    );
  }
  
  /**
   * 注册favicon更新处理器
   */
  private registerFaviconHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "faviconUpdated",
      (message: any, sender, sendResponse) => {
        try {
          const { nodeId, favicon } = message;
          logger.debug(_('nav_message_handler_favicon_updated', '收到favicon更新: {0}'), 
            JSON.stringify({ nodeId, faviconUrl: favicon }));
          
          if (!nodeId || !favicon) {
            throw new _Error('nav_message_handler_empty_node_favicon', '节点ID或favicon为空');
          }
          
          // 委托给可视化器更新favicon
          this.visualizer.updateNodeMetadata(nodeId, { favicon });
          
          // 回复成功消息
          if (message.requestId) {
            sendResponse({
              success: true,
              requestId: message.requestId,
            } as BaseResponse);
          }
        } catch (error) {
          logger.error(_('nav_message_handler_update_favicon_failed', '更新favicon失败: {0}'), 
            error instanceof Error ? error.message : String(error));
          if (message.requestId) {
            sendResponse({ 
              success: false, 
              error: error instanceof Error ? error.message : String(error),
              requestId: message.requestId
            });
          }
        }
        
        return false; // 同步处理
      }
    );
  }
  
  /**
   * 注册页面活动处理器
   */
  private registerPageActivityHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "pageActivity",
      (message: any) => {
        try {
          logger.log(_('nav_message_handler_activity', '收到页面活动事件，触发刷新: {0}'), message.source || '');
          
          // 触发刷新操作
          this.visualizer.triggerRefresh();
        } catch (error) {
          logger.error(_('nav_message_handler_activity_failed', '处理页面活动失败: {0}'), 
            error instanceof Error ? error.message : String(error));
        }
        
        return false; // 无需回复
      }
    );
  }
  
  /**
   * 注册链接点击处理器
   */
  private registerLinkClickedHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "linkClicked",
      (message: any, sender, sendResponse) => {
        try {
          logger.debug(_('nav_message_handler_link_clicked', '收到链接点击: {0}'), JSON.stringify(message.linkInfo));
          
          // 确认收到
          if (message.requestId) {
            sendResponse({
              success: true,
              requestId: message.requestId,
            } as BaseResponse);
          }
          
          // 延迟刷新可视化图表
          setTimeout(async () => {
            try {
              await this.visualizer.handleLinkClicked(message);
              logger.log(_('nav_message_handler_link_refresh_complete', '基于链接点击刷新可视化完成'));
            } catch (error) {
              logger.error(_('nav_message_handler_link_refresh_failed', '链接点击后刷新可视化失败: {0}'), 
                error instanceof Error ? error.message : String(error));
            }
          }, 100);
        } catch (error) {
          logger.error(_('nav_message_handler_link_handle_failed', '处理链接点击失败: {0}'), 
            error instanceof Error ? error.message : String(error));
          if (message.requestId) {
            sendResponse({ 
              success: false, 
              error: error instanceof Error ? error.message : String(error),
              requestId: message.requestId
            });
          }
        }
        
        return false; // 同步处理
      }
    );
  }
  
  /**
   * 注册表单提交处理器
   */
  private registerFormSubmittedHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "formSubmitted",
      (message: any, sender, sendResponse) => {
        try {
          logger.debug(_('nav_message_handler_form_submitted', '收到表单提交: {0}'), JSON.stringify(message.formInfo));
          
          // 确认收到
          if (message.requestId) {
            sendResponse({
              success: true,
              requestId: message.requestId,
            } as BaseResponse);
          }
          
          // 延迟刷新可视化图表
          setTimeout(async () => {
            try {
              await this.visualizer.handleFormSubmitted(message);
              logger.log(_('nav_message_handler_form_refresh_complete', '基于表单提交刷新可视化完成'));
            } catch (error) {
              logger.error(_('nav_message_handler_form_refresh_failed', '表单提交后刷新可视化失败: {0}'), 
                error instanceof Error ? error.message : String(error));
            }
          }, 150);
        } catch (error) {
          logger.error(_('nav_message_handler_form_handle_failed', '处理表单提交失败: {0}'), 
            error instanceof Error ? error.message : String(error));
          if (message.requestId) {
            sendResponse({ 
              success: false, 
              error: error instanceof Error ? error.message : String(error),
              requestId: message.requestId
            });
          }
        }
        
        return false; // 同步处理
      }
    );
  }
  
  /**
   * 注册JS导航处理器
   */
  private registerJsNavigationHandler(): void {
    registerHandler<BaseMessage, BaseResponse>(
      "jsNavigation",
      (message: any, sender, sendResponse) => {
        try {
          logger.debug(_('nav_message_handler_js_navigation', '收到JS导航: {0}'), JSON.stringify(message));
          
          // 确认收到
          if (message.requestId) {
            sendResponse({
              success: true,
              requestId: message.requestId,
            } as BaseResponse);
          }
          
          // 处理JS导航
          setTimeout(async () => {
            try {
              await this.visualizer.handleJsNavigation(message);
              logger.log(_('nav_message_handler_js_complete', '处理JS导航完成'));
            } catch (error) {
              logger.error(_('nav_message_handler_js_failed', '处理JS导航失败: {0}'), 
                error instanceof Error ? error.message : String(error));
            }
          }, 100);
        } catch (error) {
          logger.error(_('nav_message_handler_js_failed', '处理JS导航失败: {0}'), 
            error instanceof Error ? error.message : String(error));
          if (message.requestId) {
            sendResponse({ 
              success: false, 
              error: error instanceof Error ? error.message : String(error),
              requestId: message.requestId
            });
          }
        }
        
        return false; // 同步处理
      }
    );
  }
}