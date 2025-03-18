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
      case 'debug-test-render':
        this.testRender();
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
   * 测试渲染基本图形
   */
  public testRender(): void {
    try {
      const container = document.getElementById('visualization-container');
      if (!container) {
        alert('未找到可视化容器！');
        return;
      }
      
      // 清除容器内容
      container.innerHTML = '';
      
      // 隐藏无数据提示
      const noDataEl = document.getElementById('no-data');
      if (noDataEl) noDataEl.style.display = 'none';
      
      console.log('开始测试渲染，容器尺寸:', container.clientWidth, 'x', container.clientHeight);
      
      // 创建测试SVG
      const svg = window.d3.select(container)
        .append('svg')
        .attr('width', container.clientWidth || 800)
        .attr('height', container.clientHeight || 600)
        .attr('viewBox', [0, 0, container.clientWidth || 800, container.clientHeight || 600])
        .style('background-color', '#212730')
        .style('border', '1px dashed #ff0');
      
      // 添加一些测试图形
      // 1. 矩形
      svg.append('rect')
        .attr('x', 50)
        .attr('y', 50)
        .attr('width', 100)
        .attr('height', 100)
        .attr('fill', 'red');
      
      // 2. 圆形
      svg.append('circle')
        .attr('cx', 250)
        .attr('cy', 100)
        .attr('r', 50)
        .attr('fill', 'blue');
      
      // 3. 文本
      svg.append('text')
        .attr('x', 400)
        .attr('y', 100)
        .attr('fill', 'white')
        .text('测试渲染');
      
      // 4. 线
      svg.append('line')
        .attr('x1', 50)
        .attr('y1', 200)
        .attr('x2', 450)
        .attr('y2', 200)
        .attr('stroke', 'green')
        .attr('stroke-width', 3);
      
      // 5. 添加可视化调试按钮
      this.addDebugToolbarToSvg(svg, container.clientWidth, container.clientHeight);
      
      console.log('测试渲染完成');
      alert('测试渲染完成！请检查图形是否显示（红色矩形、蓝色圆形、绿线和文字）。');
    } catch (error) {
      console.error('测试渲染失败:', error);
      alert('测试渲染失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  
  /**
   * 向SVG添加调试工具栏
   */
  private addDebugToolbarToSvg(svg: any, width: number, height: number): void {
    // 添加调试工具栏（右上角）
    const buttonData = [
      { id: 'reset-view', label: '重置视图', icon: '⟲', title: '重置视图到默认状态' },
      { id: 'focus-current', label: '聚焦当前', icon: '◎', title: '聚焦到当前节点' },
      { id: 'optimize-layout', label: '优化布局', icon: '⚙', title: '重新优化节点布局' },
      { id: 'toggle-grid', label: '显示网格', icon: '⊞', title: '切换网格线显示' }
    ];

    const buttonWidth = 25;
    const buttonSpacing = 30;
    const debugToolbar = svg.append('g')
      .attr('class', 'debug-toolbar')
      .attr('transform', `translate(${width - 125}, 60)`);

    buttonData.forEach((button, i) => {
      const buttonGroup = debugToolbar.append('g')
        .attr('class', `debug-button ${button.id}`)
        .attr('transform', `translate(${i * buttonSpacing}, 0)`)
        .attr('cursor', 'pointer')
        .on('click', () => {
          // 在测试模式下只显示事件发生提示
          console.log(`测试模式下点击了按钮: ${button.label}`);
          alert(`测试模式下点击了按钮: ${button.label}`);
        });

      // 按钮背景
      buttonGroup.append('rect')
        .attr('width', buttonWidth)
        .attr('height', buttonWidth)
        .attr('rx', 4)
        .attr('fill', 'rgba(33, 39, 48, 0.7)')
        .attr('stroke', '#aaa')
        .attr('stroke-width', 1);

      // 按钮图标
      buttonGroup.append('text')
        .attr('x', buttonWidth / 2)
        .attr('y', buttonWidth / 2 + 1)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#fff')
        .attr('font-size', '14px')
        .text(button.icon);

      // 按钮提示
      buttonGroup.append('title')
        .text(button.title);
    });
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
  
  /**
   * 添加SVG可视化调试功能
   */
  public setupSvgDebugControls(): void {
    // 将视图中的调试按钮功能添加到NavigationVisualizer对象上
    this.visualizer.resetView = this.resetView.bind(this);
    this.visualizer.focusCurrentNode = this.focusCurrentNode.bind(this);
    this.visualizer.optimizeLayout = this.optimizeLayout.bind(this);
    this.visualizer.toggleGrid = this.toggleGrid.bind(this);
    
    console.log('SVG调试控制功能已设置');
  }
  
  /**
   * 重置视图到默认状态
   */
  public resetView(): void {
    if (!this.visualizer.svg || !this.visualizer.zoom) {
      console.warn('无法重置视图：SVG或缩放对象不存在');
      return;
    }
    
    try {
      const resetTransform = window.d3.zoomIdentity.translate(0, 0).scale(0.8);
      this.visualizer.svg.call(this.visualizer.zoom.transform, resetTransform);
      
      console.log('视图已重置到默认状态');
      
      // 如果存在保存状态的功能，保存新的状态
      if (typeof this.visualizer.saveViewState === 'function' && this.visualizer.tabId) {
        this.visualizer.saveViewState(this.visualizer.tabId, { 
          transform: { x: 0, y: 0, k: 0.8 } 
        });
      }
    } catch (error) {
      console.error('重置视图失败:', error);
    }
  }
  
  /**
   * 聚焦到当前/最新节点
   */
  public focusCurrentNode(): void {
    const nodes = this.visualizer.nodes || [];
    if (nodes.length === 0 || !this.visualizer.zoom) {
      console.warn('无法聚焦：没有节点或缩放对象不存在');
      return;
    }
    
    try {
      // 找到最新的未关闭节点
      const activeNodes = nodes.filter(node => !node.isClosed);
      const targetNode = activeNodes.length > 0 
        ? activeNodes.reduce((latest, node) => 
            (node.timestamp || 0) > (latest.timestamp || 0) ? node : latest, activeNodes[0])
        : nodes[nodes.length - 1]; // 如果没有未关闭节点，选择最后一个
      
      if (!targetNode) return;
      
      if (typeof targetNode.renderX === 'number' && typeof targetNode.renderY === 'number') {
        // 计算居中的变换
        const width = this.visualizer.width || 800;
        const height = this.visualizer.height || 600;
        const scale = 1.5; // 放大一些
        const tx = width/2 - targetNode.renderX * scale;
        const ty = height/2 - targetNode.renderY * scale;
        
        const focusTransform = window.d3.zoomIdentity.translate(tx, ty).scale(scale);
        
        // 应用变换
        this.visualizer.svg.call(this.visualizer.zoom.transform, focusTransform);
        
        // 高亮显示目标节点
        this.visualizer.svg.selectAll('.node').classed('highlighted', false);
        this.visualizer.svg.selectAll('.node').filter((d: any) => {
          return d.id === targetNode.id;
        }).classed('highlighted', true);
        
        // 显示节点详情
        if (typeof this.visualizer.showNodeDetails === 'function') {
          this.visualizer.showNodeDetails(targetNode);
        }
        
        console.log('已聚焦到节点:', targetNode.id);
      }
    } catch (error) {
      console.error('聚焦节点失败:', error);
    }
  }
  
  /**
   * 优化节点布局
   */
  public optimizeLayout(): void {
    const nodes = this.visualizer.nodes || [];
    if (nodes.length === 0) {
      console.warn('无法优化布局：没有节点');
      return;
    }
    
    try {
      // 通知用户
      alert('布局优化功能需要结合具体的布局算法实现，目前为示例通知');
      
      console.log('布局优化功能调用');
      
      // 这里应该调用实际的布局优化算法
      // ...
      
    } catch (error) {
      console.error('优化布局失败:', error);
    }
  }
  
  /**
   * 切换网格显示
   */
  public toggleGrid(): void {
    if (!this.visualizer.svg) {
      console.warn('无法切换网格：SVG不存在');
      return;
    }
    
    try {
      const mainGroup = this.visualizer.svg.select('.main-group');
      if (mainGroup.empty()) return;
      
      // 检查网格是否已存在
      let gridGroup = mainGroup.select('.grid');
      const gridVisible = !gridGroup.empty() && gridGroup.style('display') !== 'none';
      
      if (gridVisible) {
        // 隐藏网格
        gridGroup.style('display', 'none');
        console.log('网格已隐藏');
      } else {
        // 如果网格组不存在，创建一个
        if (gridGroup.empty()) {
          gridGroup = mainGroup.append('g').attr('class', 'grid');
        }
        
        // 显示网格
        gridGroup.style('display', null);
        
        // 绘制网格线
        this.drawGridLines(gridGroup);
        
        console.log('网格已显示');
      }
    } catch (error) {
      console.error('切换网格失败:', error);
    }
  }
  
  /**
   * 绘制网格线
   */
  private drawGridLines(gridGroup: any): void {
    // 清除现有的网格线
    gridGroup.selectAll('*').remove();
    
    const width = this.visualizer.width || 800;
    const height = this.visualizer.height || 600;
    
    // 网格参数
    const gridSize = 50;
    const majorGridSize = 200;
    
    // 水平线
    for (let y = 0; y < height; y += gridSize) {
      const isMajor = y % majorGridSize === 0;
      gridGroup.append('line')
        .attr('x1', 0)
        .attr('y1', y)
        .attr('x2', width)
        .attr('y2', y)
        .attr('stroke', isMajor ? '#555' : '#333')
        .attr('stroke-width', isMajor ? 1 : 0.5);
    }
    
    // 垂直线
    for (let x = 0; x < width; x += gridSize) {
      const isMajor = x % majorGridSize === 0;
      gridGroup.append('line')
        .attr('x1', x)
        .attr('y1', 0)
        .attr('x2', x)
        .attr('y2', height)
        .attr('stroke', isMajor ? '#555' : '#333')
        .attr('stroke-width', isMajor ? 1 : 0.5);
    }
  }
}