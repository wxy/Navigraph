/**
 * 导航图谱调试工具
 * 为开发者提供便捷的调试功能
 */

import type { Visualizer } from '../types/navigation.js';

/**
 * 调试工具类
 * 提供各种调试功能
 */
export class DebugTools {
  private visualizer: Visualizer;
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
    
    // 设置消息监听器
    this.setupMessageListener();
    
    // 检查URL调试参数
    this.checkUrlDebugParams();
    
    console.log('调试工具已初始化');
  }
  
  /**
   * 设置消息监听，用于接收背景页发来的调试命令
   */
  private setupMessageListener(): void {
    // 监听来自扩展背景页的消息
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'debug') {
          console.log('收到调试命令:', message.command);
          
          // 处理调试命令
          this.handleDebugCommand(message.command);
          
          // 发送响应
          sendResponse({ success: true });
          return true; // 保持消息通道开启
        }
        return false;
      });
    }
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
        console.warn('未知的调试命令:', command);
    }
  }
  
  /**
   * 检查URL参数中的调试指令
   */
  private checkUrlDebugParams(): void {
    try {
      // 获取URL中的调试参数
      const urlParams = new URLSearchParams(window.location.search);
      const debugCommand = urlParams.get('debug');
      
      if (debugCommand) {
        console.log('检测到URL中的调试参数:', debugCommand);
        
        // 延迟执行，确保页面已完全加载
        setTimeout(() => {
          this.handleDebugCommand(debugCommand);
          
          // 执行完后，删除URL中的参数，保持浏览器历史记录整洁
          if (window.history && window.history.replaceState) {
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
          }
        }, 800); // 稍微延长延迟，确保页面完全加载和可视化器初始化
      }
    } catch (error) {
      console.error('处理URL调试参数失败:', error);
    }
  }
  
  /**
   * 检查数据状态
   */
  public checkData(): void {
    console.group('📊 数据状态检查');
    
    // 检查会话数据
    console.log('当前会话:', this.visualizer.currentSession);
    if (this.visualizer.currentSession) {
      console.log('会话ID:', this.visualizer.currentSession.id);
      console.log('会话开始时间:', new Date(this.visualizer.currentSession.startTime).toLocaleString());
      console.log('会话结束时间:', this.visualizer.currentSession.endTime ? 
                 new Date(this.visualizer.currentSession.endTime).toLocaleString() : '活跃中');
    }
    
    // 检查节点和边
    const nodes = this.visualizer.nodes || [];
    const edges = this.visualizer.edges || [];
    console.log('节点数量:', nodes.length);
    console.log('边数量:', edges.length);
    
    // 样本数据
    if (nodes.length > 0) {
      console.log('节点样本:', nodes.slice(0, 3));
    }
    
    if (edges.length > 0) {
      console.log('边样本:', edges.slice(0, 3));
    }
    
    // 检查过滤器状态
    console.log('过滤器状态:', this.visualizer.filters);
    
    console.groupEnd();
    
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
    console.group('🔍 DOM状态检查');
    
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
      console.log(`${id}: ${el ? '✅ 找到' : '❌ 未找到'}`);
      
      if (el) {
        console.log(`- 可见性: ${getComputedStyle(el).display}`);
        console.log(`- 尺寸: ${el.clientWidth}x${el.clientHeight}`);
      }
    });
    
    // 检查可视化容器尺寸
    const container = document.getElementById('visualization-container');
    if (container) {
      console.log('可视化容器样式:');
      console.log('- width:', getComputedStyle(container).width);
      console.log('- height:', getComputedStyle(container).height);
      console.log('- position:', getComputedStyle(container).position);
      console.log('- display:', getComputedStyle(container).display);
    }
    
    // 检查SVG是否存在
    const svg = container?.querySelector('svg');
    console.log('SVG元素:', svg ? '✅ 存在' : '❌ 不存在');
    if (svg) {
      console.log('- SVG尺寸:', svg.clientWidth, 'x', svg.clientHeight);
      console.log('- SVG子元素数:', svg.childNodes.length);
    }
    
    console.groupEnd();
    
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
      
      // 调用后台API清除数据
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        await chrome.runtime.sendMessage({ 
          action: 'clearAllData',
          timestamp: Date.now() 
        });
      } else {
        console.warn('Chrome API不可用，无法发送消息');
        // 模拟延迟
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 500);
      
      alert('已成功清除所有数据，页面将重新加载...');
    } catch (error) {
      console.error('清除数据失败:', error);
      alert('清除数据失败: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      // 隐藏加载状态
      const loadingElement = document.getElementById('loading');
      if (loadingElement) {
        loadingElement.style.display = 'none';
      }
    }
  }
}