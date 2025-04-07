/**
 * 导航图谱调试工具
 * 为开发者提供便捷的调试功能
 */
import { Logger } from '../../lib/utils/logger.js';
import type { Visualizer } from '../types/navigation.js';
import { sendMessage, registerHandler, unregisterHandler } from '../messaging/content-message-service.js';
import { BaseMessage, BaseResponse } from '../../types/messages/common.js';

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
    
    // 检查URL调试参数（保留用于直接通过URL启动调试）
    this.checkUrlDebugParams();
    
    // 设置存储监听器
    this.setupStorageListener();
    
    logger.log('调试工具已初始化');
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
          
          logger.log('通过存储API收到调试命令:', command);
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
          
          logger.log('检测到未处理的调试命令:', result.navigraph_debug_command);
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
      logger.log('收到调试命令:', message.command);
      
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
        logger.warn('未知的调试命令:', command);
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
        logger.log('检测到URL中的调试参数:', debugCommand);
        
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
      logger.error('处理URL调试参数失败:', error);
    }
  }
  
  /**
   * 检查数据状态
   */
  public checkData(): void {
    logger.group('📊 数据状态检查');
    
    // 检查会话数据
    logger.log('当前会话:', this.visualizer.currentSession);
    if (this.visualizer.currentSession) {
      logger.log('会话ID:', this.visualizer.currentSession.id);
      logger.log('会话开始时间:', new Date(this.visualizer.currentSession.startTime).toLocaleString());
      logger.log('会话结束时间:', this.visualizer.currentSession.endTime ? 
                 new Date(this.visualizer.currentSession.endTime).toLocaleString() : '活跃中');
    }
    
    // 检查节点和边
    const nodes = this.visualizer.nodes || [];
    const edges = this.visualizer.edges || [];
    logger.log('节点数量:', nodes.length);
    logger.log('边数量:', edges.length);
    
    // 样本数据
    if (nodes.length > 0) {
      logger.log('节点样本:', nodes.slice(0, 3));
    }
    
    if (edges.length > 0) {
      logger.log('边样本:', edges.slice(0, 3));
    }
    
    // 检查过滤器状态
    logger.log('过滤器状态:', this.visualizer.filters);
    
    logger.groupEnd();
    
    // 显示弹窗反馈
    const message = `
      数据检查完成！请查看控制台。
      
      ▶ 当前会话: ${this.visualizer.currentSession ? '存在' : '不存在'}
      ▶ 总节点数: ${nodes.length}
      ▶ 总边数: ${edges.length}
      ▶ 视图类型: ${this.visualizer.currentView}
    `;
    
    alert(message);
  }
  
  /**
   * 检查DOM状态
   */
  public checkDOM(): void {
    logger.group('🔍 DOM状态检查');
    
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
      logger.log(`${id}: ${el ? '✅ 找到' : '❌ 未找到'}`);
      
      if (el) {
        logger.log(`- 可见性: ${getComputedStyle(el).display}`);
        logger.log(`- 尺寸: ${el.clientWidth}x${el.clientHeight}`);
      }
    });
    
    // 检查可视化容器尺寸
    const container = document.getElementById('visualization-container');
    if (container) {
      logger.log('可视化容器样式:');
      logger.log('- width:', getComputedStyle(container).width);
      logger.log('- height:', getComputedStyle(container).height);
      logger.log('- position:', getComputedStyle(container).position);
      logger.log('- display:', getComputedStyle(container).display);
    }
    
    // 检查SVG是否存在
    const svg = container?.querySelector('svg');
    logger.log('SVG元素:', svg ? '✅ 存在' : '❌ 不存在');
    if (svg) {
      logger.log('- SVG尺寸:', svg.clientWidth, 'x', svg.clientHeight);
      logger.log('- SVG子元素数:', svg.childNodes.length);
    }
    
    logger.groupEnd();
    
    // 显示弹窗反馈
    const container_status = container ? 
      `找到 (${container.clientWidth}x${container.clientHeight})` : 
      '未找到';
      
    const svg_status = svg ? 
      `找到 (${svg.childNodes.length} 个子元素)` : 
      '未找到';
      
    const message = `
      DOM检查完成！请查看控制台。
      
      ▶ 可视化容器: ${container_status}
      ▶ SVG元素: ${svg_status}
      ▶ 当前视图: ${this.visualizer.currentView}
    `;
    
    alert(message);
  }
  
  /**
   * 清除所有数据
   */
  public async clearData(): Promise<void> {
    if (!confirm('警告: 这将删除所有导航数据！确定要继续吗？')) {
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
          throw new Error(response.error || '清除数据时发生未知错误');
        }
      } catch (error) {
        logger.error('发送清除数据消息失败:', error);
        throw error;
      }
      
      // 刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 500);
      
      alert('已成功清除所有数据，页面将重新加载...');
    } catch (error) {
      logger.error('清除数据失败:', error);
      alert('清除数据失败: ' + (error instanceof Error ? error.message : String(error)));
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