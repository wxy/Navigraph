/**
 * 时间线视图渲染模块
 * 负责绘制基于时间的导航历史
 */

const d3 = window.d3;

import { NavNode, NavLink, Visualizer } from '../types/navigation.js';
import { 
  getNodeColor, 
  getEdgeColor, 
  isTrackingPage,
  renderEmptyTreeMessage 
} from '../utils/visualization-utils.js';
// 合并导入，避免重复
import { 
  saveViewState, 
  getViewState, 
  setupZoomHandling, 
  updateStatusBar 
} from '../utils/state-manager.js';

// 扩展NavNode类型以包含渲染坐标
interface RenderableNode extends NavNode {
  renderX?: number;
  renderY?: number;
}

/**
 * 渲染时间线布局
 */
export function renderTimelineLayout(
  container: any, 
  timelineSvg: any, 
  nodes: NavNode[], 
  links: NavLink[], 
  width: number, 
  height: number, 
  visualizer: Visualizer
): void {
  console.log('使用模块化时间线渲染器');
  
  try {
    // 先尝试恢复保存的缩放状态
    const tabId = visualizer.tabId || '';
    const savedState = getViewState(tabId);
    
    if (savedState && savedState.transform && !visualizer._isRestoringTransform) {
      console.log('检测到保存的变换状态:', savedState.transform);
      visualizer._isRestoringTransform = true;
      
      // 将状态保存到可视化器，在渲染后应用
      visualizer._savedTransform = savedState.transform;
    }
    
    // 清除现有内容
    timelineSvg.selectAll("*").remove();
    
    if (!nodes || nodes.length === 0) {
      renderEmptyTimeline(timelineSvg, width);
      return;
    }
    
    // 先添加背景矩形，确保覆盖整个时间线区域
    timelineSvg.append('rect')
      .attr('class', 'timeline-background')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('x', 0)
      .attr('y', 0)
      .attr('fill', '#333');
    
    // 绘制时间轴组
    const timeAxisGroup = timelineSvg.append('g')
      .attr('class', 'time-axis-group')
      .attr('transform', 'translate(0, 0)');
    
    // 计算时间范围
    const timestamps = nodes.map(node => node.timestamp || Date.now());
    let minTime = Math.min(...timestamps);
    let maxTime = Math.max(...timestamps);
    let timeRange = maxTime - minTime;
    
    // 确保有最小时间范围，避免除零错误
    if (timeRange < 60000) { // 小于1分钟
      const mid = (minTime + maxTime) / 2;
      minTime = mid - 30000; // 扩展30秒
      maxTime = mid + 30000; // 扩展30秒
      timeRange = 60000;
    }
    
    // 扩展时间范围以充满宽度
    const extraPercentage = 0.2; // 两侧各增加20%
    minTime -= timeRange * extraPercentage;
    maxTime += timeRange * extraPercentage;
    
    // 创建时间刻度 - 覆盖整个宽度
    const timeScale = d3.scaleTime()
      .domain([new Date(minTime), new Date(maxTime)])
      .range([0, width]);
    
    // 创建可渲染节点数据，避免直接修改原始节点
    const renderableNodes: RenderableNode[] = nodes.map(node => {
      const renderNode = { ...node };
      
      // X坐标基于时间
      renderNode.renderX = timeScale(new Date(node.timestamp || Date.now()));
      
      // Y坐标基于类型，分层展示
      let yBase = 0;
      switch (node.type) {
        case 'link_click': yBase = height * 0.25; break;
        case 'address_bar': yBase = height * 0.45; break;
        case 'form_submit': yBase = height * 0.65; break;
        default: yBase = height * 0.4;
      }
      
      // 添加一些随机偏移避免重叠
      renderNode.renderY = yBase + (Math.random() - 0.5) * height * 0.25;
      
      return renderNode;
    });
    
    // 避免节点重叠的布局优化
    optimizeNodeLayout(renderableNodes);
    
    // 创建箭头定义
    container.append('defs').append('marker')
      .attr('id', 'timeline-arrow')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#999');
    
    // 绘制边
    const linkElements = container.append('g')
      .selectAll('.edge')
      .data(links)
      .enter()
      .append('path')
      .attr('class', function(d: NavLink) {
        return `edge ${d.type || ''}`;
      })
      .attr('marker-end', 'url(#timeline-arrow)')
      .attr('d', function(d: NavLink) {
        // 安全地获取源节点和目标节点ID - 修正为直接使用字符串
        const sourceId = d.source;
        const targetId = d.target;
        
        if (!sourceId || !targetId) return '';
        
        // 找到对应的可渲染节点
        const sourceNode = renderableNodes.find(n => n.id === sourceId);
        const targetNode = renderableNodes.find(n => n.id === targetId);
                    
        if (!sourceNode || !targetNode) return '';
        
        // 获取渲染坐标
        const source = {
          x: typeof sourceNode.renderX === 'number' ? sourceNode.renderX : 0, 
          y: typeof sourceNode.renderY === 'number' ? sourceNode.renderY : 0
        };
        
        const target = {
          x: typeof targetNode.renderX === 'number' ? targetNode.renderX : 0, 
          y: typeof targetNode.renderY === 'number' ? targetNode.renderY : 0
        };
        
        // 根据链接类型生成适当的路径
        if (sourceId === targetId) {
          // 自循环 - 绘制一个小循环
          const dx = source.x;
          const dy = source.y;
          const dr = 30;
          return `M ${dx},${dy} a ${dr},${dr} 0 1,1 0,0.01`;
        } else if (d.type === 'history_back' || d.type === 'history_forward') {
          // 历史导航 - 使用弯曲的曲线
          return `M${source.x},${source.y} 
                  C${source.x + (target.x - source.x) * 0.5},${source.y} 
                    ${source.x + (target.x - source.x) * 0.5},${target.y} 
                    ${target.x},${target.y}`;
        } else {
          // 标准连接线 - 使用直线
          return `M${source.x},${source.y} L${target.x},${target.y}`;
        }
      })
      .attr('stroke', function(d: NavLink) {
        return getEdgeColor(d.type || '');
      })
      .attr('stroke-width', 1.5)
      .attr('fill', 'none');
    
    // 绘制节点
    const nodeElements = container.append('g')
      .selectAll('.node')
      .data(renderableNodes)
      .enter()
      .append('g')
      .attr('class', function(d: RenderableNode) {
        // 组合多个类名
        let classes = `node ${d.type || ''}`;
        
        // 添加关闭状态
        if (d.isClosed) {
          classes += ' closed';
        }
        
        // 添加跟踪标记
        if (typeof isTrackingPage === 'function' && isTrackingPage(d, visualizer)) {
          classes += ' tracking';
        }
        
        return classes;
      })
      .attr('transform', function(d: RenderableNode) {
        const x = typeof d.renderX === 'number' ? d.renderX : 0;
        const y = typeof d.renderY === 'number' ? d.renderY : 0;
        return `translate(${x},${y})`;
      });
    
    nodeElements.append('circle')
      .attr('r', 20)
      .attr('fill', function(d: RenderableNode) {
        return getNodeColor(d.type || '');
      });
    
    nodeElements.append('title')
      .text(function(d: RenderableNode) {
        return d.title || d.url || '';
      });
    
    // 添加节点图标
    nodeElements.filter(function(d: RenderableNode) {
        return !!d.favicon;
      })
      .append('image')
      .attr('xlink:href', function(d: RenderableNode) {
        return d.favicon || '';
      })
      .attr('x', -8)
      .attr('y', -8)
      .attr('width', 16)
      .attr('height', 16)
      .on('error', function(this: SVGGElement) {
        // 图像加载失败时替换为默认图标
        d3.select(this)
          .attr('xlink:href', chrome.runtime.getURL('images/logo-48.png'))
          .classed('default-icon', true);
      });
    
    // 添加节点文本标签
    nodeElements.append('text')
      .attr('dy', 35)
      .attr('text-anchor', 'middle')
      .attr('fill', '#fff')
      .style('font-size', '12px')
      .text(function(d: RenderableNode) {
        if (!d.title) return '';
        // 截断长标题
        return d.title.length > 10 ? d.title.substring(0, 10) + '...' : d.title;
      });
    
    // 添加事件处理程序
    nodeElements.on('click', function(this: SVGGElement, event: MouseEvent, d: RenderableNode) {
      if (visualizer && typeof visualizer.showNodeDetails === 'function') {
        visualizer.showNodeDetails(d);
      }
      
      container.selectAll('.node')
        .classed('highlighted', false);
      
      d3.select(this)
        .classed('highlighted', true);
    });
    
    // 绘制时间轴
    const xAxis = d3.axisBottom(timeScale)
      .ticks(15)
      .tickFormat(d3.timeFormat('%H:%M:%S'))
      .tickSize(6)
      .tickPadding(2);
    
    // 渲染时间轴 - 确保从左到右完全对齐
    timeAxisGroup.append('g')
      .attr('class', 'time-axis')
      .attr('transform', `translate(0, 20)`)
      .call(xAxis)
      .call(function(g: any) {
        // 设置轴线样式
        g.select('.domain')
          .attr('stroke', '#aaa')
          .attr('stroke-width', 1)
          .attr('opacity', 0.7);
        
        // 设置刻度线样式
        g.selectAll('.tick line')
          .attr('stroke', '#aaa')
          .attr('y2', 6);
        
        // 设置文字样式
        g.selectAll('.tick text')
          .attr('fill', '#eee')
          .attr('font-size', '10px');
      });
    
    // 添加网格线以提高可读性
    timeAxisGroup.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0, 0)`)
      .call(d3.axisBottom(timeScale)
        .tickSize(40)
        .tickFormat('')
        .ticks(30))
      .call(function(g: any) {
        g.select('.domain').remove();
        g.selectAll('.tick line')
          .attr('stroke', '#555')
          .attr('stroke-width', 0.5)
          .attr('opacity', 0.3);
      });
    
    // 添加时间线标签
    timeAxisGroup.append('text')
      .attr('x', width / 2)
      .attr('y', 12)
      .attr('text-anchor', 'middle')
      .attr('fill', '#aaa')
      .style('font-size', '11px')
      .text('时间线 - ' + new Date(minTime).toLocaleDateString());
    
    // 延迟应用动态居中计算
    setTimeout(() => {
      try {
        // 如果有保存的变换状态，应用它
        if (visualizer._isRestoringTransform && visualizer._savedTransform) {
          const { x, y, k } = visualizer._savedTransform;
          const transform = d3.zoomIdentity.translate(x, y).scale(k);
          
          if (visualizer.svg && visualizer.zoom) {
            console.log('恢复保存的变换状态:', visualizer._savedTransform);
            visualizer.svg.call(visualizer.zoom.transform, transform);
            
            // 清除标记和临时状态
            delete visualizer._isRestoringTransform;
            delete visualizer._savedTransform;
            
            return; // 跳过自动居中
          }
        }
        
        // 如果正在恢复变换状态，跳过自动居中
        // 使用可选链和类型保护检查属性是否存在
        const isRestoringTransform = 
          visualizer && 
          typeof visualizer === 'object' && 
          '_isRestoringTransform' in visualizer && 
          visualizer._isRestoringTransform;
          
        if (isRestoringTransform) {
          console.log('跳过时间线自动居中，正在恢复用户设置的变换');
          return;
        }
        
        // 如果有节点，计算边界以实现真正的居中
        if (renderableNodes.length > 0) {
          // 获取所有节点的位置信息
          const xValues = renderableNodes.map(node => 
            typeof node.renderX === 'number' ? node.renderX : 0);
          const yValues = renderableNodes.map(node => 
            typeof node.renderY === 'number' ? node.renderY : 0);
          
          // 计算实际内容边界
          const minX = Math.min(...xValues);
          const maxX = Math.max(...xValues);
          const minY = Math.min(...yValues);
          const maxY = Math.max(...yValues);
          
          // 计算内容尺寸，增加边距使视觉更平衡
          const contentWidth = maxX - minX + 80; // 增加水平边距
          const contentHeight = maxY - minY + 80; // 增加垂直边距
          
          console.log('时间线节点边界:', {minX, maxX, minY, maxY, contentWidth, contentHeight});
          
          // 时间线高度使用固定值40
          const timelineHeight = 40;
          
          // 计算更精确的缩放因子 - 考虑可用空间
          const availableHeight = height - timelineHeight; // 减去时间线高度后的可用空间
          
          const scaleFactor = Math.min(
            (width * 0.9) / Math.max(contentWidth, 1), // 水平方向留出10%边距
            (availableHeight * 0.9) / Math.max(contentHeight, 1), // 垂直方向留出10%边距
            0.9 // 最大缩放限制
          );
          
          // 计算更精确的中心点 - 关键改进
          // 水平中心点：容器中心 + 适当偏移
          const centerX = (width - contentWidth * scaleFactor) / 2 + (20 - minX) * scaleFactor;
          
          // 垂直中心点：考虑时间线，计算可用空间的中心
          const centerY = (availableHeight - contentHeight * scaleFactor) / 2 + (20 - minY) * scaleFactor;
          
          // 创建并应用变换
          const transform = d3.zoomIdentity
            .translate(centerX, centerY)
            .scale(scaleFactor);
          
          if (visualizer.svg && visualizer.zoom) {
            console.log('应用时间线居中变换:', {centerX, centerY, scaleFactor, availableHeight});
            visualizer.svg.call(visualizer.zoom.transform, transform);
          }
        } else {
          // 没有节点，使用默认变换
          const transform = d3.zoomIdentity
            .translate(width / 2, height / 3)
            .scale(0.9);
          
          if (visualizer.svg && visualizer.zoom) {
            visualizer.svg.call(visualizer.zoom.transform, transform);
          }
        }
      } catch (err) {
        console.error('应用时间线居中失败:', err);
        delete visualizer._isRestoringTransform;
        delete visualizer._savedTransform;
      }
    }, 150);  // 延时确保DOM完全渲染   
    
    // 为缩放同步准备变量 - 使用类型断言避免类型错误
    (visualizer as any).timeScale = timeScale;
    
    // 设置缩放行为，并添加状态保存
    if (visualizer.zoom) {
      visualizer.zoom.on('zoom.saveState', (event: any) => {
        if (visualizer._isRestoringTransform) return; // 恢复过程中不保存
        
        // 防抖：使用节流避免频繁保存
        clearTimeout(visualizer._saveStateTimeout);
        visualizer._saveStateTimeout = setTimeout(() => {
          const tabId = visualizer.tabId || '';
          const transform = event.transform;
          
          // 保存当前变换状态
          saveViewState(tabId, {
            viewType: 'timeline',
            transform: {
              x: transform.x,
              y: transform.y,
              k: transform.k
            }
          });
          
          // 使用导入的通用状态栏更新函数
          updateStatusBar(visualizer);
        }, 300); // 300ms防抖
      });
    }

    // 设置缩放和状态管理
    if (!visualizer.zoom) {
      setupZoomHandling(visualizer, timelineSvg, container, width, height);
    }

    // 更新状态栏 - 使用导入的通用函数
    updateStatusBar(visualizer);
    
  } catch (err) {
    console.error('时间线渲染过程中出错:', err);
    
    // 渲染错误信息
    timelineSvg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'red')
      .text(`时间线渲染错误: ${err && (err as Error).message ? (err as Error).message : '未知错误'}`);
    
    // 渲染简单的空白时间线
    renderEmptyTimeline(timelineSvg, width);
  }
}

/**
 * 渲染空白时间线
 */
function renderEmptyTimeline(timelineSvg: any, width: number): void {
  // 添加背景
  timelineSvg.append('rect')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('fill', '#333');
  
  // 添加空状态文字
  timelineSvg.append('text')
    .attr('x', width / 2)
    .attr('y', 20)
    .attr('text-anchor', 'middle')
    .attr('fill', '#999')
    .text('无时间数据可显示');
}

/**
 * 优化节点布局，避免重叠
 */
function optimizeNodeLayout(nodes: RenderableNode[]): void {
  // 按X坐标排序
  const sortedNodes = [...nodes].sort((a, b) => {
    const aX = typeof a.renderX === 'number' ? a.renderX : 0;
    const bX = typeof b.renderX === 'number' ? b.renderX : 0;
    return aX - bX;
  });
  
  // 碰撞检测和解决
  const minDistance = 40; // 最小节点间距
  
  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const current = sortedNodes[i];
    const next = sortedNodes[i + 1];
    
    if (!current || !next) continue;
    
    const currentX = typeof current.renderX === 'number' ? current.renderX : 0;
    const nextX = typeof next.renderX === 'number' ? next.renderX : 0;
    const currentY = typeof current.renderY === 'number' ? current.renderY : 0;
    const nextY = typeof next.renderY === 'number' ? next.renderY : 0;
    
    const xDistance = nextX - currentX;
    
    // 如果X距离过小，可能会重叠
    if (xDistance < minDistance) {
      // 检查Y距离是否也很小
      const yDistance = Math.abs(nextY - currentY);
      
      if (yDistance < minDistance) {
        // 如果两个节点太近，增加Y轴的距离
        const displacement = (minDistance - yDistance) / 2;
        current.renderY = currentY - displacement;
        next.renderY = nextY + displacement;
      }
    }
  }
}