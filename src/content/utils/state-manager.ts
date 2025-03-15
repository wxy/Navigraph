/**
 * 视图状态管理模块
 * 处理缩放状态、视图类型记忆和状态栏更新
 */

const d3 = window.d3;

// 扩展 Visualizer 类型，增加模块中使用的属性
import { Visualizer as BaseVisualizer } from '../types/navigation.js';

// 扩展 Visualizer 类型以包含我们使用的属性
interface ExtendedVisualizer extends BaseVisualizer {
  zoom?: any;
  svg?: any;
  container?: HTMLElement | any; // 允许 D3 选择器对象
  tabId?: string;
  currentView?: string;
  _isRestoringTransform?: boolean;
  _savedTransform?: {x: number, y: number, k: number};
  _saveStateTimeout?: number;
  statusBar?: HTMLElement;
  width?: number;
  height?: number;
  timelineSvg?: any;
  currentSession?: {startTime: number};
  renderVisualization?: () => void;
  showNodeDetails?: (data: any) => void;
}

// 使用扩展的类型
type Visualizer = ExtendedVisualizer;

// 状态类型定义
export interface ViewState {
  viewType?: string;
  transform?: {
    x: number;
    y: number;
    k: number;
  };
  lastUpdated?: number;
}

// 存储缩放与视图类型状态
export function saveViewState(tabId: string, state: ViewState): void {
  try {
    const key = `nav_view_state_${tabId}`;
    const currentState = getViewState(tabId) || {};
    
    // 合并新状态
    const newState = {
      ...currentState,
      ...state,
      lastUpdated: Date.now()
    };
    
    // 保存到本地存储
    localStorage.setItem(key, JSON.stringify(newState));
    console.log('保存当前变换状态:', newState);
  } catch (err) {
    console.warn('保存视图状态失败:', err);
  }
}

// 获取保存的视图状态
export function getViewState(tabId: string): ViewState | null {
  try {
    const key = `nav_view_state_${tabId}`;
    const savedState = localStorage.getItem(key);
    
    if (savedState) {
      return JSON.parse(savedState);
    }
  } catch (err) {
    console.warn('获取视图状态失败:', err);
  }
  
  return null;
}

// 清除保存的视图状态
export function clearViewState(tabId: string): void {
  try {
    const key = `nav_view_state_${tabId}`;
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('清除视图状态失败:', err);
  }
}

/**
 * 设置缩放处理并添加状态保存
 * 可同时用于树形图和时间线渲染器
 */
export function setupZoomHandling(
  visualizer: Visualizer, 
  svg: any, 
  container: any, 
  width: number, 
  height: number
): any {
  if (!visualizer || !svg || !container) {
    console.warn('设置缩放处理失败：缺少必要参数');
    return null;
  }
  
  try {
    // 创建缩放行为
    const zoom = d3.zoom()
      .scaleExtent([0.1, 3]) // 缩放范围
      .on('zoom', handleZoom);
    
    // 应用到SVG元素
    svg.call(zoom);
    
    // 保存缩放对象供外部使用
    visualizer.zoom = zoom;
    
    // 尝试恢复保存的缩放状态
    const tabId = visualizer.tabId || '';
    const savedState = getViewState(tabId);
    
    if (savedState && savedState.transform && !visualizer._isRestoringTransform) {
      console.log('检测到保存的变换状态:', savedState.transform);
      visualizer._isRestoringTransform = true;
      
      // 将状态保存到可视化器，延迟应用
      visualizer._savedTransform = savedState.transform;
      
      // 延迟应用保存的变换，确保DOM已完全渲染
      setTimeout(() => {
        if (savedState.transform) {
          applyTransform(visualizer, savedState.transform);
        }
      }, 150);
    }
    
    return zoom;
    
    // 处理缩放事件
    function handleZoom(event: any) {
      try {
        // 应用变换到主内容组
        if (container && typeof container.select === 'function') {
          const mainGroup = container.select('g');
          if (mainGroup && mainGroup.attr) {
            mainGroup.attr('transform', event.transform);
          }
        }
        
        // 同步时间线视图（如果是时间线模式）
        if (visualizer.currentView === 'timeline' && visualizer.timelineSvg) {
          try {
            // 只应用水平缩放和平移，保持垂直位置不变
            const timeAxisGroup = visualizer.timelineSvg.select('g.time-axis-group');
            if (timeAxisGroup && timeAxisGroup.attr) {
              timeAxisGroup.attr('transform', `translate(${event.transform.x}, 0) scale(${event.transform.k}, 1)`);
            }
          } catch (timelineError) {
            console.warn('同步时间线视图出错:', timelineError);
          }
        }
        
        // 处理动态节点过滤
        handleDynamicFiltering(event.transform, visualizer);
        
        // 防抖保存状态
        debounceSaveState(event.transform, visualizer);
      } catch (zoomError) {
        console.error('处理缩放事件出错:', zoomError);
      }
    }
  } catch (err) {
    console.error('设置缩放处理失败:', err);
    return null;
  }
}

/**
 * 应用保存的变换状态
 */
export function applyTransform(visualizer: Visualizer, transform: {x: number, y: number, k: number}): void {
  try {
    if (!visualizer || !visualizer.svg || !visualizer.zoom || !transform) return;
    
    const { x, y, k } = transform;
    const d3Transform = d3.zoomIdentity.translate(x, y).scale(k);
    
    console.log('应用保存的变换状态:', transform);
    visualizer.svg.call(visualizer.zoom.transform, d3Transform);
    
    // 清除标记和临时状态
    delete visualizer._isRestoringTransform;
    delete visualizer._savedTransform;
    
    // 更新状态栏
    updateStatusBar(visualizer);
    
  } catch (err) {
    console.error('应用变换状态失败:', err);
    // 清除错误状态
    if (visualizer) {
      delete visualizer._isRestoringTransform;
      delete visualizer._savedTransform;
    }
  }
}

// 防抖函数：避免频繁保存状态
let saveStateTimeout: ReturnType<typeof setTimeout> | null = null;
function debounceSaveState(transform: any, visualizer: Visualizer): void {
  if (visualizer._isRestoringTransform) return; // 恢复过程中不保存
  
  if (saveStateTimeout) {
    clearTimeout(saveStateTimeout);
    saveStateTimeout = null;
  }
  
  saveStateTimeout = setTimeout(() => {
    const tabId = visualizer.tabId || '';
    
    // 保存当前变换状态
    saveViewState(tabId, {
      viewType: visualizer.currentView,
      transform: {
        x: transform.x,
        y: transform.y,
        k: transform.k
      }
    });
    
    // 更新状态栏
    updateStatusBar(visualizer);
  }, 300); // 300ms防抖
}

/**
 * 处理动态节点过滤
 */
function handleDynamicFiltering(transform: any, visualizer: Visualizer): void {
  if (!visualizer || !visualizer.container) return;
  
  try {
    const container = visualizer.container;
    const zoomLevel = transform.k;
    
    // 测试容器是否为DOM元素
    const isDOMContainer = 
      container instanceof Element || 
      container instanceof HTMLElement || 
      (container.nodeType === 1);
      
    // 处理不同类型的容器
    if (!isDOMContainer && typeof container.node === 'function') {
      // 如果是D3选择器对象，获取底层DOM节点
      const containerNode = container.node();
      if (containerNode) {
        handleDOMFiltering(containerNode, zoomLevel, transform, visualizer);
      }
    } else if (isDOMContainer) {
      // 容器是DOM节点
      handleDOMFiltering(container, zoomLevel, transform, visualizer);
    } else {
      console.warn('容器类型不支持动态过滤');
    }
  } catch (err) {
    console.warn('处理动态过滤时出错:', err);
  }
}

// 处理DOM元素的过滤
function handleDOMFiltering(
  containerElement: Element | HTMLElement,
  zoomLevel: number,
  transform: any,
  visualizer: Visualizer
): void {
  try {
    // 只在缩放级别较低时应用过滤
    if (zoomLevel < 0.5) {
      // 获取当前视图区域
      const clientWidth = containerElement.clientWidth || 800;
      const clientHeight = containerElement.clientHeight || 600;
      
      const viewBox = {
        x: -transform.x / transform.k,
        y: -transform.y / transform.k,
        width: clientWidth / transform.k,
        height: clientHeight / transform.k
      };
      
      // 高级过滤逻辑：可见性和重要性评分
      const nodes = containerElement.querySelectorAll('.node');
      let visibleCount = 0;
      let hiddenCount = 0;
      
      nodes.forEach((node: Element) => {
        // 这里可以实现更复杂的可见性和重要性评分
        const nodeImportance = getNodeImportance(node);
        const nodeBox = node.getBoundingClientRect();
        
        // 检查节点是否在视图中，并根据缩放级别和重要性决定显示
        const isVisible = isInViewport(nodeBox, viewBox) && 
                          (nodeImportance > 30 || zoomLevel > 0.3);
        
        // 应用显示/隐藏
        (node as HTMLElement).style.display = isVisible ? '' : 'none';
        
        // 计数
        isVisible ? visibleCount++ : hiddenCount++;
      });
      
      // 更新过滤指示器
      if (hiddenCount > 0) {
        // 显示过滤指示器
        showFilteringIndicator(visualizer, hiddenCount);
      } else {
        // 隐藏过滤指示器
        hideFilteringIndicator(visualizer);
      }
      
      // 同步处理边缘的显示/隐藏
      const edges = containerElement.querySelectorAll('.edge, .link');
      edges.forEach((edge: Element) => {
        const connectedNodes = getConnectedNodes(edge, containerElement);
        const isVisible = connectedNodes.every(
          node => node && (node as HTMLElement).style.display !== 'none'
        );
        
        (edge as HTMLElement).style.display = isVisible ? '' : 'none';
      });
    } else {
      // 缩放级别较高时，显示所有节点
      containerElement.querySelectorAll('.node, .edge, .link')
        .forEach((el: Element) => {
          (el as HTMLElement).style.display = '';
        });
      
      // 隐藏过滤指示器
      hideFilteringIndicator(visualizer);
    }
  } catch (err) {
    console.warn('DOM过滤操作失败:', err);
  }
}

/**
 * 创建或更新视图状态栏
 */
export function updateStatusBar(visualizer: Visualizer): void {
  if (!visualizer) return;
  
  try {
    let container: Element | null = null;
    
    // 检查container是否为D3选择器对象
    if (visualizer.container) {
      if (typeof visualizer.container.node === 'function') {
        // D3 选择器
        container = visualizer.container.node();
      } else if (visualizer.container instanceof Element || visualizer.container instanceof HTMLElement) {
        // DOM 元素
        container = visualizer.container;
      }
    }
    
    if (!container) {
      // 尝试查找HTML中定义的容器
      container = document.getElementById('visualization-container');
      
      if (!container) {
        console.warn('无法更新状态栏: 找不到可视化容器');
        
        // 尝试在document级别查找状态栏
        const globalStatusBar = document.querySelector('.windows-status-bar');
        if (globalStatusBar) {
          // 如果找到全局状态栏，直接使用
          updateStatusBarContent(visualizer, globalStatusBar as HTMLElement);
          return;
        }
        
        return;
      }
    }
    
    // 查找状态栏，首先在容器内部查找
    let statusBar = container.querySelector('.windows-status-bar') as HTMLElement | null;
    
    // 如果容器内没有状态栏，尝试在页面级别查找
    if (!statusBar) {
      statusBar = document.querySelector('.windows-status-bar') as HTMLElement | null;
    }
    
    // 如果仍未找到，创建新的状态栏
    if (!statusBar) {
      console.log('创建新的状态栏元素');
      statusBar = document.createElement('div');
      statusBar.className = 'windows-status-bar';
      
      // 添加HTML结构，与index.html中的一致
      statusBar.innerHTML = `
        <div class="status-cell" id="status-nodes">节点: 0</div>
        <div class="status-cell" id="status-edges">连接: 0</div>
        <div class="status-cell" id="status-pages">页面: 0</div>
        <div class="status-cell" id="status-navigations">导航: 0</div>
        <div class="status-cell" id="status-time">时间: 0分钟</div>
        <div class="status-cell" id="status-filtered">已过滤: 0</div>
        <div class="status-cell status-cell-stretch" id="status-message">就绪</div>
      `;
      
      // 添加基本样式
      statusBar.style.display = 'flex';
      statusBar.style.backgroundColor = '#f0f0f0';
      statusBar.style.borderTop = '1px solid #ccc';
      statusBar.style.padding = '2px 0';
      statusBar.style.fontSize = '12px';
      statusBar.style.color = '#333';
      statusBar.style.width = '100%';
      
      // 附加到页面
      const appContainer = document.querySelector('.app-container') || document.body;
      appContainer.appendChild(statusBar);
      
      visualizer.statusBar = statusBar;
    }
    
    // 更新状态栏内容
    updateStatusBarContent(visualizer, statusBar);
    
  } catch (err) {
    console.warn('更新状态栏失败:', err);
  }
}

// 提取更新状态栏内容的逻辑到单独的函数
function updateStatusBarContent(visualizer: Visualizer, statusBar: HTMLElement): void {
  try {
    // 获取当前变换和节点计数
    let transform = null;
    if (visualizer.svg) {
      if (typeof visualizer.svg.node === 'function') {
        const svgNode = visualizer.svg.node();
        if (svgNode) {
          transform = d3.zoomTransform(svgNode);
        }
      } else if (visualizer.svg instanceof SVGElement) {
        transform = d3.zoomTransform(visualizer.svg);
      }
    }
    
    const zoom = transform ? Math.round(transform.k * 100) : 100;
    
    // 查找节点并计数
    let nodeCount = 0;
    let visibleNodeCount = 0;
    
    // 首选从visualizer.container中查找节点
    let nodeElements: NodeListOf<Element> | null = null;
    
    if (visualizer.container) {
      const containerEl = typeof visualizer.container.node === 'function' 
        ? visualizer.container.node() 
        : visualizer.container;
        
      if (containerEl) {
        nodeElements = containerEl.querySelectorAll('.node');
      }
    }
    
    // 如果没有找到节点，尝试在文档中查找
    if (!nodeElements || nodeElements.length === 0) {
      nodeElements = document.querySelectorAll('.node');
    }
    
    // 计算节点数量
    nodeCount = nodeElements.length;
    visibleNodeCount = Array.from(nodeElements).filter(
      node => (node as HTMLElement).style.display !== 'none'
    ).length;
    
    // 更新状态栏文本
    const viewTypeName = visualizer.currentView === 'tree' ? '树形图' : '时间线';
    
    // 如果是HTML中预定义的状态栏，更新其子元素
    const nodesCell = statusBar.querySelector('#status-nodes');
    if (nodesCell) {
      // 使用HTML结构中的各个单元格
      nodesCell.textContent = `节点: ${nodeCount}`;
      
      const filteredCell = statusBar.querySelector('#status-filtered');
      if (filteredCell && visibleNodeCount < nodeCount) {
        filteredCell.textContent = `已过滤: ${nodeCount - visibleNodeCount}`;
      }
      
      const messageCell = statusBar.querySelector('#status-message');
      if (messageCell) {
        messageCell.textContent = `${viewTypeName}视图 | 缩放: ${zoom}%`;
      }
    } else {
      // 简化的状态栏，直接设置文本
      if (visibleNodeCount < nodeCount) {
        statusBar.textContent = 
          `${viewTypeName}视图 | ${visibleNodeCount}/${nodeCount} 个节点可见 | 缩放: ${zoom}%`;
      } else {
        statusBar.textContent = 
          `${viewTypeName}视图 | ${nodeCount} 个节点 | 缩放: ${zoom}%`;
      }
    }
  } catch (err) {
    console.warn('更新状态栏内容失败:', err);
  }
}

/**
 * 显示过滤指示器
 */
export function showFilteringIndicator(visualizer: Visualizer, hiddenCount: number): void {
  if (!visualizer || !visualizer.container) return;
  
  try {
    const container = visualizer.container;
    
    // 查找或创建过滤指示器
    let indicator = container.querySelector('.filtering-indicator') as HTMLElement | null;
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'filtering-indicator';
      container.appendChild(indicator);
    }
    
    // 更新提示文本
    indicator.textContent = `${hiddenCount} 个节点已过滤（放大查看更多）`;
    
    // 显示指示器
    indicator.style.display = 'block';
  } catch (err) {
    console.warn('显示过滤指示器失败:', err);
  }
}

/**
 * 隐藏过滤指示器
 */
export function hideFilteringIndicator(visualizer: Visualizer): void {
  if (!visualizer || !visualizer.container) return;
  
  try {
    const container = visualizer.container;
    const indicator = container.querySelector('.filtering-indicator') as HTMLElement | null;
    
    if (indicator) {
      indicator.style.display = 'none';
    }
  } catch (err) {
    console.warn('隐藏过滤指示器失败:', err);
  }
}

/**
 * 切换视图类型
 */
export function switchViewType(visualizer: Visualizer, viewType: string): void {
  if (!visualizer || !visualizer.container) return;
  
  try {
    // 保存当前视图的缩放状态
    if (visualizer.svg && visualizer.zoom) {
      const currentTransform = d3.zoomTransform(visualizer.svg.node());
      
      saveViewState(visualizer.tabId || '', {
        viewType,
        transform: {
          x: currentTransform.x,
          y: currentTransform.y,
          k: currentTransform.k
        }
      });
    }
    
    // 更改视图类型
    visualizer.currentView = viewType;
    
    // 根据新的视图类型更新UI
    const container = visualizer.container;
    container.setAttribute('data-view-type', viewType);
    
    // 更新工具栏按钮激活状态
    const toolbarButtons = container.querySelectorAll('.view-toolbar button');
    toolbarButtons.forEach((btn: HTMLButtonElement) => {
      const btnViewType = btn.getAttribute('data-view');
      btn.classList.toggle('active', btnViewType === viewType);
    });
    
    // 重新渲染当前视图
    if (typeof visualizer.renderVisualization === 'function') {
      visualizer.renderVisualization();
    }
    
    // 更新状态栏
    updateStatusBar(visualizer);
  } catch (err) {
    console.error('切换视图类型失败:', err);
  }
}

/**
 * 初始化视图工具栏
 */
export function initializeViewToolbar(visualizer: Visualizer): void {
  if (!visualizer) return;
  
  try {
    // 优先使用visualizer.container
    let container = null;
    
    if (visualizer.container) {
      if (typeof visualizer.container.node === 'function') {
        container = visualizer.container.node();
      } else if (visualizer.container instanceof Element) {
        container = visualizer.container;
      }
    }
    
    // 如果visualizer中没有合适的container，尝试查找
    if (!container) {
      // 尝试查找HTML中定义的容器
      container = document.getElementById('visualization-container');
      
      if (container) {
        // 更新visualizer的container引用
        visualizer.container = container;
        console.log('已找到并设置可视化容器:', container.id);
      } else {
        console.error('找不到可视化容器元素');
        return;
      }
    }
    
    // 其余实现保持不变
    // 创建工具栏（如果不存在）
    let toolbar = container.querySelector('.view-toolbar') as HTMLElement | null;
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'view-toolbar';
      container.appendChild(toolbar);
      
      // 添加视图切换按钮
      const treeBtn = document.createElement('button');
      treeBtn.textContent = '树形图';
      treeBtn.setAttribute('data-view', 'tree');
      treeBtn.onclick = () => switchViewType(visualizer, 'tree');
      toolbar.appendChild(treeBtn);
      
      const timelineBtn = document.createElement('button');
      timelineBtn.textContent = '时间线';
      timelineBtn.setAttribute('data-view', 'timeline');
      timelineBtn.onclick = () => switchViewType(visualizer, 'timeline');
      toolbar.appendChild(timelineBtn);
      
      // 添加其他工具按钮...
      const resetBtn = document.createElement('button');
      resetBtn.textContent = '重置视图';
      resetBtn.classList.add('reset-btn');
      resetBtn.onclick = () => resetView(visualizer);
      toolbar.appendChild(resetBtn);
      
      // 添加显示全部按钮
      const showAllBtn = document.createElement('button');
      showAllBtn.textContent = '显示全部';
      showAllBtn.classList.add('show-all-btn');
      showAllBtn.onclick = () => showAllNodes(visualizer);
      toolbar.appendChild(showAllBtn);
    }
    
    // 创建状态栏（如果尚未创建）
    updateStatusBar(visualizer);
    
    // 恢复上次使用的视图类型
    const savedState = getViewState(visualizer.tabId || '');
    if (savedState && savedState.viewType) {
      switchViewType(visualizer, savedState.viewType);
    } else {
      // 默认使用树形图视图
      switchViewType(visualizer, 'tree');
    }
  } catch (err) {
    console.error('初始化视图工具栏失败:', err);
  }
}

/**
 * 重置视图到默认状态
 */
function resetView(visualizer: Visualizer): void {
  if (!visualizer || !visualizer.svg || !visualizer.zoom) return;
  
  try {
    // 默认变换：居中并设置适中缩放
    const defaultTransform = d3.zoomIdentity
      .translate(visualizer.width ? visualizer.width / 2 : 400, 
                 visualizer.height ? visualizer.height / 3 : 200)
      .scale(0.8);
      
    // 应用变换
    visualizer.svg.call(visualizer.zoom.transform, defaultTransform);
    
    // 清除保存的状态
    clearViewState(visualizer.tabId || '');
    
    // 更新状态栏
    updateStatusBar(visualizer);
  } catch (err) {
    console.error('重置视图失败:', err);
  }
}

/**
 * 显示所有节点（取消过滤）
 */
function showAllNodes(visualizer: Visualizer): void {
  if (!visualizer || !visualizer.container) return;
  
  try {
    const container = visualizer.container;
    
    // 显示所有节点和连接线
    container.querySelectorAll('.node, .edge, .link')
      .forEach((el: Element) => {
        (el as HTMLElement).style.display = '';
      });
    
    // 隐藏过滤指示器
    hideFilteringIndicator(visualizer);
    
    // 更新状态栏
    updateStatusBar(visualizer);
  } catch (err) {
    console.error('显示所有节点失败:', err);
  }
}

// 工具函数：获取节点重要性评分
function getNodeImportance(node: Element): number {
  // 基础分值
  let score = 50;
  
  try {
    // 根据节点类型调整分数
    if (node.classList.contains('root')) {
      score += 40; // 根节点总是显示
    }
    
    if (node.classList.contains('session')) {
      score += 30; // 会话节点很重要
    }
    
    if (node.classList.contains('highlighted')) {
      score += 50; // 高亮节点总是显示
    }
    
    if (node.classList.contains('tracking')) {
      score += 30; // 跟踪页面很重要
    }
    
    // 根据子节点数量加分
    const childCount = node.querySelectorAll('.node').length;
    score += Math.min(childCount * 5, 25); // 最多加25分
  } catch (err) {
    console.warn('计算节点重要性时出错:', err);
  }
  
  return score;
}

// 工具函数：检查节点是否在视图中
function isInViewport(nodeRect: DOMRect, viewBox: {x: number, y: number, width: number, height: number}): boolean {
  // 简单的边界框检查
  return (nodeRect.right >= viewBox.x && 
          nodeRect.left <= viewBox.x + viewBox.width &&
          nodeRect.bottom >= viewBox.y && 
          nodeRect.top <= viewBox.y + viewBox.height);
}

// 工具函数：获取边连接的节点
function getConnectedNodes(edge: Element, container: Element): Element[] {
  try {
    // 更健壮的实现方式，处理各种可能的边数据格式
    
    // 尝试从各种可能的属性和数据存储中获取源和目标ID
    let sourceId = '';
    let targetId = '';
    
    // 1. 尝试从常见数据属性获取
    sourceId = edge.getAttribute('data-source') || 
              edge.getAttribute('source') || 
              edge.getAttribute('data-source-id') || '';
              
    targetId = edge.getAttribute('data-target') || 
              edge.getAttribute('target') || 
              edge.getAttribute('data-target-id') || '';
    
    // 2. 尝试从D3数据中获取 (不同浏览器存储方式可能不同)
    if ((!sourceId || !targetId) && typeof (edge as any).__data__ !== 'undefined') {
      const data = (edge as any).__data__;
      if (data) {
        if (typeof data.source === 'object' && data.source && data.source.id) {
          sourceId = data.source.id;
        } else if (typeof data.source === 'string') {
          sourceId = data.source;
        }
        
        if (typeof data.target === 'object' && data.target && data.target.id) {
          targetId = data.target.id;
        } else if (typeof data.target === 'string') {
          targetId = data.target;
        }
      }
    }
    
    // 3. 如果还没找到，尝试从内嵌的<path>, <line>等元素获取
    if ((!sourceId || !targetId) && edge.children && edge.children.length > 0) {
      for (let i = 0; i < edge.children.length; i++) {
        const child = edge.children[i];
        if (!sourceId) {
          sourceId = child.getAttribute('data-source') || 
                    child.getAttribute('source') || '';
        }
        if (!targetId) {
          targetId = child.getAttribute('data-target') || 
                    child.getAttribute('target') || '';
        }
        if (sourceId && targetId) break;
      }
    }
    
    // 4. 如果仍无法获取ID，则放弃并返回空数组
    if (!sourceId || !targetId) {
      console.debug('无法从边数据中提取源和目标ID:', edge);
      return [];
    }
    
    // 尝试查找源节点和目标节点，使用不同的选择器格式
    const selectors = [
      `.node[data-id="${sourceId}"]`, 
      `.node[id="${sourceId}"]`,
      `[data-node-id="${sourceId}"]`,
      `.node-${sourceId}`
    ];
    
    const targetSelectors = [
      `.node[data-id="${targetId}"]`, 
      `.node[id="${targetId}"]`,
      `[data-node-id="${targetId}"]`,
      `.node-${targetId}`
    ];
    
    // 查找源节点
    let sourceNode: Element | null = null;
    for (const selector of selectors) {
      sourceNode = container.querySelector(selector);
      if (sourceNode) break;
    }
    
    // 查找目标节点
    let targetNode: Element | null = null;
    for (const selector of targetSelectors) {
      targetNode = container.querySelector(selector);
      if (targetNode) break;
    }
    
    // 返回找到的节点，过滤掉null值
    return [sourceNode, targetNode].filter((node): node is Element => node !== null);
  } catch (err) {
    console.warn('获取连接节点时出错:', err);
    return [];
  }
}