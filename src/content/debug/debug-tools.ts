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
      logger.debug(i18n('debug_tools_disabled_in_production', '生产环境，调试工具功能已禁用'));
      return; // 提前返回，不初始化调试功能
    }
    // 检查URL调试参数（保留用于直接通过URL启动调试）
    this.checkUrlDebugParams();
    
    // 设置存储监听器
    this.setupStorageListener();
    
    logger.log(i18n('debug_tools_initialized', '调试工具已初始化'));
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
          
          logger.log(i18n('debug_command_received_via_storage', '通过存储API收到调试命令: {0}'), command);
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
          
          logger.log(i18n('debug_command_pending_detected', '检测到未处理的调试命令: {0}'), result.navigraph_debug_command);
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
      logger.log(i18n('debug_command_received', '收到调试命令: {0}'), message.command);
      
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
      logger.debug(i18n('debug_command_ignored_non_dev', '非开发环境，忽略调试命令: {0}'), command);
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
        logger.warn(i18n('debug_command_unknown', '未知的调试命令: {0}'), command);
    }
    // 命令执行后清除存储中的调试命令
    chrome.storage.local.remove(['navigraph_debug_command', 'navigraph_debug_timestamp'], () => {
      logger.debug(i18n('debug_command_storage_cleared', '已从存储中清除调试命令'));
    });
  }
  
  /**
   * 检查URL参数中的调试指令
   */
  public checkUrlDebugParams(): void {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const debugCommand = urlParams.get('debug');
      
      if (debugCommand) {
        logger.log(i18n('debug_param_detected_in_url', '检测到URL中的调试参数: {0}'), debugCommand);
        
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
      logger.error(i18n('debug_url_param_processing_failed', '处理URL调试参数失败: {0}'), error);
    }
  }
  
  /**
   * 检查数据状态
   */
  public checkData(): void {
    logger.group(i18n('debug_data_status_check', '📊 数据状态检查'));
    
    // 检查会话数据
    logger.log(i18n('debug_current_session', '当前会话: {0}'), this.visualizer.currentSession);
    if (this.visualizer.currentSession) {
      logger.log(i18n('debug_session_id', '会话ID: {0}'), this.visualizer.currentSession.id);
      logger.log(i18n('debug_session_start_time', '会话开始时间: {0}'), new Date(this.visualizer.currentSession.startTime).toLocaleString());
      logger.log(i18n('debug_session_end_time', '会话结束时间: {0}'), this.visualizer.currentSession.endTime ? 
                 new Date(this.visualizer.currentSession.endTime).toLocaleString() : i18n('debug_session_active', '活跃中'));
    }
    
    // 检查节点和边
    const nodes = this.visualizer.nodes || [];
    const edges = this.visualizer.edges || [];
    logger.log(i18n('debug_node_count', '节点数量: {0}'), nodes.length);
    logger.log(i18n('debug_edge_count', '边数量: {0}'), edges.length);
    
    // 样本数据
    if (nodes.length > 0) {
      logger.log(i18n('debug_node_samples', '节点样本: {0}'), nodes.slice(0, 3));
    }
    
    if (edges.length > 0) {
      logger.log(i18n('debug_edge_samples', '边样本: {0}'), edges.slice(0, 3));
    }
    
    // 检查过滤器状态
    logger.log(i18n('debug_filter_status', '过滤器状态: {0}'), this.visualizer.filters);
    
    logger.groupEnd();
    
    // 显示弹窗反馈
    const message = i18n('debug_data_check_complete', "数据检查完成！请查看控制台。\n\n▶ 当前会话: {0}\n▶ 总节点数: {1}\n▶ 总边数: {2}\n▶ 视图类型: {3}", 
      this.visualizer.currentSession ? i18n('debug_exists', '存在') : i18n('debug_not_exists', '不存在'),
      nodes.length.toString(),
      edges.length.toString(),
      this.visualizer.currentView || i18n('debug_unknown', '未知')
    );
    
    alert(message);
  }
  
  /**
   * 检查DOM状态
   */
  public checkDOM(): void {
    logger.group(i18n('debug_dom_status_check', '🔍 DOM状态检查'));
    
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
      logger.log(`${id}: ${el ? i18n('debug_element_found', '✅ 找到') : i18n('debug_element_not_found', '❌ 未找到')}`);
      
      if (el) {
        logger.log(i18n('debug_element_visibility', '- 可见性: {0}', getComputedStyle(el).display));
        logger.log(i18n('debug_element_size', '- 尺寸: {0}x{1}', el.clientWidth.toString(), el.clientHeight.toString()));
      }
    });
    
    // 检查可视化容器尺寸
    const container = document.getElementById('visualization-container');
    if (container) {
      logger.log(i18n('debug_container_styles', '可视化容器样式:'));
      logger.log(i18n('debug_style_width', '- width: {0}'), getComputedStyle(container).width);
      logger.log(i18n('debug_style_height', '- height: {0}'), getComputedStyle(container).height);
      logger.log(i18n('debug_style_position', '- position: {0}'), getComputedStyle(container).position);
      logger.log(i18n('debug_style_display', '- display: {0}'), getComputedStyle(container).display);
    }
    
    // 检查SVG是否存在
    const svg = container?.querySelector('svg');
    logger.log(i18n('debug_svg_element', 'SVG元素: {0}'), svg ? i18n('debug_exists', '存在') : i18n('debug_not_exists', '不存在'));
    if (svg) {
      logger.log(i18n('debug_svg_size', '- SVG尺寸: {0} x {1}'), svg.clientWidth.toString(), svg.clientHeight.toString());
      logger.log(i18n('debug_svg_child_count', '- SVG子元素数: {0}'), svg.childNodes.length.toString());
    }
    
    logger.groupEnd();
    
    // 显示弹窗反馈
    const container_status = container ? 
      i18n('debug_element_found_with_size', '找到 ({0}x{1})', container.clientWidth.toString(), container.clientHeight.toString()) : 
      i18n('debug_element_not_found', '❌ 未找到');
      
    const svg_status = svg ? 
      i18n('debug_svg_found_with_children', '找到 ({0} 个子元素)', svg.childNodes.length.toString()) : 
      i18n('debug_element_not_found', '❌ 未找到');
      
    const message = i18n('debug_dom_check_complete', "DOM检查完成！请查看控制台。\n\n▶ 可视化容器: {0}\n▶ SVG元素: {1}\n▶ 当前视图: {2}", 
      container_status,
      svg_status,
      this.visualizer.currentView || i18n('debug_unknown', '未知')
    );
    
    alert(message);
  }
  
  /**
   * 清除所有数据
   */
  public async clearData(): Promise<void> {
    if (!confirm(i18n('debug_clear_data_confirm', '警告: 这将删除所有导航数据！确定要继续吗？'))) {
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
          throw new Error(i18n('debug_clear_data_unknown_error', '清除数据时发生未知错误: {0}', response.error));
        }
      } catch (error) {
        logger.error(i18n('debug_clear_data_send_failed', '发送清除数据消息失败: {0}'), error);
        throw error;
      }
      
      // 刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 500);
      
      alert(i18n('debug_clear_data_success', '已成功清除所有数据，页面将重新加载...'));
    } catch (error) {
      logger.error(i18n('debug_clear_data_failed', '清除数据失败: {0}'), error);
      alert(i18n('debug_clear_data_failed_message', '清除数据失败: {0}', error instanceof Error ? error.message : String(error)));
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