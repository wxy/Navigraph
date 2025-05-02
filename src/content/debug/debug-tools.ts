/**
 * 导航图谱调试工具
 * 为开发者提供便捷的调试功能
 */
import { Logger } from '../../lib/utils/logger.js';
import type { Visualizer } from '../types/navigation.js';
import { sendMessage, registerHandler, unregisterHandler } from '../messaging/content-message-service.js';
import { BaseMessage, BaseResponse } from '../../types/messages/common.js';
import { isDev } from '../../lib/environment.js';
import { i18n, I18nError } from '../../lib/utils/i18n-utils.js'; // 添加导入i18n和I18nError

const logger = new Logger('DebugTools');

/**
 * 调试工具类
 * 提供各种调试功能
 */
export class DebugTools {
  private visualizer: Visualizer;
  private lastDebugTimestamp: number = 0;
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
    
    // 在非开发环境中，只初始化最基本的功能
    if (!isDev()) {
      logger.debug('debug_tools_disabled_in_production');
      return; // 提前返回，不初始化调试功能
    }
    // 检查URL调试参数（保留用于直接通过URL启动调试）
    this.checkUrlDebugParams();
    
    // 设置存储监听器
    this.setupStorageListener();
    
    logger.log('debug_tools_initialized');
  }
  
  /**
   * 设置存储变化监听器
   * 用于接收调试命令而不刷新页面
   */
  private setupStorageListener(): void {
    // 监听存储变化
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      
      if (changes.navigraph_debug_command && changes.navigraph_debug_timestamp) {
        const command = changes.navigraph_debug_command.newValue;
        const timestamp = changes.navigraph_debug_timestamp.newValue;
        
        // 防止重复处理同一个命令
        if (timestamp > this.lastDebugTimestamp) {
          this.lastDebugTimestamp = timestamp;
          
          logger.log('debug_command_received_via_storage', command);
          this.handleDebugCommand(command);
        }
      }
    });
    
    // 初始检查是否有未处理的命令
    chrome.storage.local.get(['navigraph_debug_command', 'navigraph_debug_timestamp'], (result) => {
      if (result.navigraph_debug_command && result.navigraph_debug_timestamp) {
        // 如果命令时间戳比当前记录的更新，则执行
        if (result.navigraph_debug_timestamp > this.lastDebugTimestamp) {
          this.lastDebugTimestamp = result.navigraph_debug_timestamp;
          
          logger.log('debug_command_pending_detected', result.navigraph_debug_command);
          this.handleDebugCommand(result.navigraph_debug_command);
        }
      }
    });
  }
  
  /**
   * 设置消息监听，用于接收背景页发来的调试命令
   */
  private setupMessageListener(): void {
    // 使用新的处理程序注册方法
    registerHandler<BaseMessage, BaseResponse>('debug', (message: any, sender, sendResponse) => {
      logger.log('debug_command_received', message.command);
      
      // 处理调试命令
      if (message.command) {
        this.handleDebugCommand(message.command);
      }
      
      sendResponse({ 
        success: true, 
        requestId: message.requestId 
      } as BaseResponse);
      
      return false;
    });
  }
  
  /**
   * 处理调试命令
   */
  private handleDebugCommand(command: string): void {
    // 在非开发环境中，忽略所有调试命令
    if (!isDev()) {
      logger.debug('debug_command_ignored_non_dev', command);
      return;
    }
    switch (command) {
      case 'debug-check-data':
        this.checkData();
        break;
      case 'debug-check-dom':
        this.checkDOM();
        break;
      case 'debug-clear-data':
        this.clearData();
        break;
      default:
        logger.warn('debug_command_unknown', command);
    }
  }
  
  /**
   * 检查URL参数中的调试指令
   */
  public checkUrlDebugParams(): void {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const debugCommand = urlParams.get('debug');
      
      if (debugCommand) {
        logger.log('debug_param_detected_in_url', debugCommand);
        
        // 延迟执行，确保页面已完全加载
        setTimeout(() => {
          this.handleDebugCommand(debugCommand);
          
          // 执行完后，清除URL参数
          if (typeof window.history?.replaceState === 'function') {
            const newUrl = window.location.pathname;
            history.replaceState({}, document.title, newUrl);
          }
        }, 800);
      }
    } catch (error) {
      logger.error('debug_url_param_processing_failed', error);
    }
  }
  
  /**
   * 检查数据状态
   */
  public checkData(): void {
    logger.group('debug_data_status_check');
    
    // 检查会话数据
    logger.log('debug_current_session', this.visualizer.currentSession);
    if (this.visualizer.currentSession) {
      logger.log('debug_session_id', this.visualizer.currentSession.id);
      logger.log('debug_session_start_time', new Date(this.visualizer.currentSession.startTime).toLocaleString());
      logger.log('debug_session_end_time', this.visualizer.currentSession.endTime ? 
                 new Date(this.visualizer.currentSession.endTime).toLocaleString() : i18n('debug_session_active'));
    }
    
    // 检查节点和边
    const nodes = this.visualizer.nodes || [];
    const edges = this.visualizer.edges || [];
    logger.log('debug_node_count', nodes.length);
    logger.log('debug_edge_count', edges.length);
    
    // 样本数据
    if (nodes.length > 0) {
      logger.log('debug_node_samples', nodes.slice(0, 3));
    }
    
    if (edges.length > 0) {
      logger.log('debug_edge_samples', edges.slice(0, 3));
    }
    
    // 检查过滤器状态
    logger.log('debug_filter_status', this.visualizer.filters);
    
    logger.groupEnd();
    
    // 显示弹窗反馈
    const message = i18n('debug_data_check_complete', 
      this.visualizer.currentSession ? i18n('debug_exists') : i18n('debug_not_exists'),
      nodes.length.toString(),
      edges.length.toString(),
      this.visualizer.currentView || i18n('debug_unknown')
    );
    
    alert(message);
  }
  
  /**
   * 检查DOM状态
   */
  public checkDOM(): void {
    logger.group('debug_dom_status_check');
    
    // 检查关键元素
    const elements = [
      'visualization-container',
      'loading',
      'no-data',
      'status-text',
      'node-details',
      'session-selector'
    ];
    
    elements.forEach(id => {
      const el = document.getElementById(id);
      logger.log(`${id}: ${el ? i18n('debug_element_found') : i18n('debug_element_not_found')}`);
      
      if (el) {
        logger.log(i18n('debug_element_visibility', getComputedStyle(el).display));
        logger.log(i18n('debug_element_size', el.clientWidth.toString(), el.clientHeight.toString()));
      }
    });
    
    // 检查可视化容器尺寸
    const container = document.getElementById('visualization-container');
    if (container) {
      logger.log('debug_container_styles');
      logger.log('debug_style_width', getComputedStyle(container).width);
      logger.log('debug_style_height', getComputedStyle(container).height);
      logger.log('debug_style_position', getComputedStyle(container).position);
      logger.log('debug_style_display', getComputedStyle(container).display);
    }
    
    // 检查SVG是否存在
    const svg = container?.querySelector('svg');
    logger.log('debug_svg_element', svg ? i18n('debug_exists') : i18n('debug_not_exists'));
    if (svg) {
      logger.log('debug_svg_size', svg.clientWidth.toString(), svg.clientHeight.toString());
      logger.log('debug_svg_child_count', svg.childNodes.length.toString());
    }
    
    logger.groupEnd();
    
    // 显示弹窗反馈
    const container_status = container ? 
      i18n('debug_element_found_with_size', container.clientWidth.toString(), container.clientHeight.toString()) : 
      i18n('debug_element_not_found');
      
    const svg_status = svg ? 
      i18n('debug_svg_found_with_children', svg.childNodes.length.toString()) : 
      i18n('debug_element_not_found');
      
    const message = i18n('debug_dom_check_complete',
      container_status,
      svg_status,
      this.visualizer.currentView || i18n('debug_unknown')
    );
    
    alert(message);
  }
  
  /**
   * 清除所有数据
   */
  public async clearData(): Promise<void> {
    if (!confirm(i18n('debug_clear_data_confirm'))) {
      return;
    }
    
    try {
      // 显示加载状态
      const loadingElement = document.getElementById('loading');
      if (loadingElement) {
        loadingElement.style.display = 'flex';
      }
      
      // 使用新的消息系统发送消息
      try {
        const response = await sendMessage('clearAllData', {
          timestamp: Date.now()
        });
        
        if (!response.success) {
          throw new I18nError('debug_clear_data_unknown_error', response.error);
        }
      } catch (error) {
        logger.error('debug_clear_data_send_failed', error);
        throw error;
      }
      
      // 刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 500);
      
      alert(i18n('debug_clear_data_success'));
    } catch (error) {
      logger.error('debug_clear_data_failed', error);
      alert(i18n('debug_clear_data_failed_message', error instanceof Error ? error.message : String(error)));
    } finally {
      // 隐藏加载状态
      const loadingElement = document.getElementById('loading');
      if (loadingElement) {
        loadingElement.style.display = 'none';
      }
    }
  }
  
  /**
   * 清理资源
   */
  public cleanup(): void {
    // 使用新的取消注册方法
    unregisterHandler('debug');
  }
}