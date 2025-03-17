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
 * 更新时间轴和网格线
 * @param transform 当前变换状态
 * @param timeAxisGroup 时间轴元素组
 * @param mainGroup 主内容组
 * @param timeRange 原始时间范围参数
 * @param dimensions 视图尺寸参数
 */
function updateTimeAxis(
  transform: any, 
  timeAxisGroup: any, 
  mainGroup: any, 
  timeRange: { minTime: number, maxTime: number }, 
  dimensions: { width: number, height: number }
): void {
  const { minTime, maxTime } = timeRange;
  const { width, height } = dimensions;

  // 计算当前可见区域的时间范围
  // 1. 计算当前可视区域的左右边界（相对于原始未变换坐标系）
  const visibleLeft = -transform.x / transform.k;
  const visibleRight = (width - transform.x) / transform.k;
  
  // 2. 将这些值从像素坐标系映射到时间值，并扩展范围确保两侧有足够空间
  const timeRatio = (maxTime - minTime) / width;
  // 扩展可见区域，确保包含更多网格线
  const extraRatio = 0.2; // 固定为较小值
  const visibleTimeSpan = visibleRight - visibleLeft;
  const visibleMinTime = minTime + (visibleLeft - visibleTimeSpan * extraRatio) * timeRatio;
  const visibleMaxTime = minTime + (visibleRight + visibleTimeSpan * extraRatio) * timeRatio;
  
  // 3. 根据当前缩放比例计算合适的刻度数量
  const baseTickCount = 10;
  let tickCount;
  const minLabelSpacing = 80; // 标签最小间距（像素）

  // 计算可用宽度下可容纳的最大刻度数
  const maxTicks = Math.floor(width / minLabelSpacing);

  // 限制刻度数量避免过度增长
  if (transform.k < 0.5) {
    // 低缩放级别 - 少量主要刻度
    tickCount = Math.min(Math.max(4, Math.floor(baseTickCount * transform.k)), maxTicks);
  } else if (transform.k <= 2) {
    // 中等缩放级别 - 适量刻度
    tickCount = Math.min(baseTickCount + Math.floor((transform.k - 1) * 3), maxTicks);
  } else {
    // 高缩放级别 - 适量刻度，避免过多
    tickCount = Math.min(15, maxTicks); // 限制最大刻度数为15
  }
  
  // 4. 创建新的时间轴比例尺和刻度格式化函数
  const timeScale = d3.scaleTime()
    .domain([new Date(visibleMinTime), new Date(visibleMaxTime)])
    .range([0, width]); // 固定范围，始终占满整个宽度
  
  // 5. 创建新的时间轴
  const timeAxis = d3.axisBottom(timeScale)
    .ticks(tickCount)
    .tickFormat((d: Date) => {
      // 判断是否是0点
      if (d.getHours() === 0 && d.getMinutes() === 0) {
        // 0点显示日期和时间
        return d3.timeFormat('%m-%d 00:00')(d);
      }
      // 其他时间点根据缩放级别显示
      return transform.k < 0.5 ? d3.timeFormat('%H:%M')(d) : d3.timeFormat('%H:%M:%S')(d);
    })
    .tickSize(6)
    .tickPadding(2);
    
  // 6. 更新时间轴元素
  timeAxisGroup.select('.time-axis')
    .attr('transform', 'translate(0, 20)') // 固定位置
    .call(timeAxis)
    .call(function(g: d3.Selection<SVGGElement, unknown, null, undefined>) {
      // 样式设置
      g.select('.domain')
        .attr('stroke', '#aaa')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7);
      
      g.selectAll('.tick line')
        .attr('stroke', '#aaa')
        .attr('y2', 6);
      
      // 标签样式
      g.selectAll('.tick text')
        .attr('fill', '#eee')
        .attr('font-size', '10px')
        .style('opacity', function(d: Date, i: number) {
          return i % 2 === 0 || transform.k < 4 ? 1 : 0.5;
        })
        .each(function(this: SVGTextElement, d: Date) {
          // 0点加粗显示
          if (d.getHours() === 0 && d.getMinutes() === 0) {
            d3.select(this)
              .attr('fill', '#fff')
              .attr('font-weight', 'bold')
              .style('opacity', 1);
            
            // 对应的刻度线也加粗
            const tickLine = d3.select(this.parentNode).select('line');
            tickLine
              .attr('stroke', '#fff')
              .attr('stroke-width', 1.5)
              .attr('y2', 10);
          }
        });
    });
    
  // 7. 更新网格线 - 确保网格线布满整个区域
  //updateGridLines(mainGroup, timeScale, transform, { width, height });
    
  // 8. 更新标题显示可见时间范围
  const formatTimeOnly = d3.timeFormat('%H:%M:%S');
  const formatDateOnly = d3.timeFormat('%Y-%m-%d');
  
  const visibleMinDate = new Date(visibleMinTime);
  const visibleMaxDate = new Date(visibleMaxTime);
  
  // 判断是否跨天
  const isSameDay = visibleMinDate.toDateString() === visibleMaxDate.toDateString();
  
  // 根据是否跨天显示不同格式
  let titleText;
  if (isSameDay) {
    // 同一天内 - 只显示一次日期
    titleText = `时间线 - ${formatDateOnly(visibleMinDate)} ${formatTimeOnly(visibleMinDate)} 至 ${formatTimeOnly(visibleMaxDate)}`;
  } else {
    // 跨天 - 显示完整日期和时间
    titleText = `时间线 - ${formatDateOnly(visibleMinDate)} ${formatTimeOnly(visibleMinDate)} 至 ${formatDateOnly(visibleMaxDate)} ${formatTimeOnly(visibleMaxDate)}`;
  }
  
  timeAxisGroup.select('text.time-axis-title')
    .text(titleText);
}

/**
 * 更新网格线 - 使用与时间轴相同的绘制逻辑
 */
function updateGridLines(
  mainGroup: any, 
  timeScale: any, 
  transform: any, 
  dimensions: { width: number, height: number }
): void {
  const { width, height } = dimensions;
  
  // 获取当前时间轴的刻度位置 - 动态调整密度
  const density = transform.k < 0.5 ? 30 :
  transform.k < 1 ? 60 :
  transform.k < 2 ? 120 :
  transform.k < 4 ? 180 : 240; // 大幅增加密度
  const timeAxisTicks = timeScale.ticks(density); // 使用变化的密度
  
  // 清除网格线，但保留容器
  const gridContainer = mainGroup.select('.grid');
  if (gridContainer.empty()) {
    // 如果不存在，创建新的网格容器
    mainGroup.append('g').attr('class', 'grid');
  } else {
    // 如果存在，只清除内部线条
    gridContainer.selectAll('*').remove();
  }
  
  // 获取最新的网格容器引用
  const currentGrid = mainGroup.select('.grid');
  
  // 直接基于时间轴位置添加网格线
  timeAxisTicks.forEach((tick: Date) => {
    const xPos = timeScale(tick);
    currentGrid.append('line')
      .attr('class', 'grid-line')
      .attr('x1', xPos)
      .attr('y1', -height) // 确保足够高，向上延伸
      .attr('x2', xPos)
      .attr('y2', height * 2) // 确保足够长，向下延伸
      .attr('stroke', '#555')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.3);
  });
  
  // 添加额外的左右边界辅助线，确保超出可见区域
  // 左侧边界外
  for (let i = 1; i <= 20; i++) { // 从10增加到20
    const domain = timeScale.domain();
    const timeSpan = domain[1].getTime() - domain[0].getTime();
    
    // 添加左侧辅助线 - 使用更大的比例扩展
    const leftTime = new Date(domain[0].getTime() - timeSpan * i / 4); // 从1/5改为1/4
    const leftPos = timeScale(leftTime);
    currentGrid.append('line')
      .attr('class', 'grid-line extra-line')
      .attr('x1', leftPos)
      .attr('y1', -height * 2) // 加大高度范围
      .attr('x2', leftPos)
      .attr('y2', height * 3)  // 加大高度范围
      .attr('stroke', '#555')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.3);
    
    // 添加右侧辅助线 - 同样使用更大比例扩展
    const rightTime = new Date(domain[1].getTime() + timeSpan * i / 4); // 从1/5改为1/4
    const rightPos = timeScale(rightTime);
    currentGrid.append('line')
      .attr('class', 'grid-line extra-line')
      .attr('x1', rightPos)
      .attr('y1', -height * 2) // 加大高度范围
      .attr('x2', rightPos)
      .attr('y2', height * 3)  // 加大高度范围
      .attr('stroke', '#555')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.3);
  }

  // 添加额外的内部网格线，确保密度足够
  const domain = timeScale.domain();
  const timeSpan = domain[1].getTime() - domain[0].getTime();
  const steps = 50; // 内部额外的网格线数量

  for (let i = 0; i <= steps; i++) {
    const time = domain[0].getTime() + (timeSpan * i / steps);
    const pos = timeScale(new Date(time));
    
    currentGrid.append('line')
      .attr('class', 'grid-line inner-line')
      .attr('x1', pos)
      .attr('y1', -height * 2)
      .attr('x2', pos)
      .attr('y2', height * 3)
      .attr('stroke', '#555')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.2); // 稍微淡一点
  }
}
/**
 * 渲染时间线布局
 */
export function renderTimelineLayout(
  container: any, 
  svg: any, 
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
    svg.selectAll("*").remove();
    
    if (!nodes || nodes.length === 0) {
      renderEmptyTimeline(svg, width);
      return;
    }

    // 先添加背景矩形，确保覆盖整个时间线区域
    svg.append('rect')
      .attr('class', 'timeline-background')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('x', 0)
      .attr('y', 0)
      .attr('fill', '#FFF');
    
    // 创建两个主要组：一个用于可缩放内容，一个用于固定的时间轴
    const mainGroup = svg.append('g')
      .attr('class', 'main-group');
    
    // 绘制时间轴组 - 保持在SVG上而不是mainGroup内
    const timeAxisGroup = svg.append('g')
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
    svg.append('defs').append('marker')
      .attr('id', 'timeline-arrow')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#333');
    
    // 绘制边 - 放在主组内以便缩放
    const linkElements = mainGroup.append('g')
      .attr('class', 'timeline-links-group')
      .selectAll('.edge')
      .data(links)
      .enter()
      .append('path')
      .attr('class', function(d: NavLink) {
        return `edge ${d.type || ''}`;
      })
      .attr('marker-end', 'url(#timeline-arrow)')
      .attr('d', function(d: NavLink) {
        // 安全地获取源节点和目标节点ID
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
    
    // 绘制节点 - 放在主组内以便缩放
    const nodeElements = mainGroup.append('g')
      .attr('class', 'timeline-nodes-group')
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
      .attr('fill', '#333')  // 使用深色文字以便在白色背景下可见
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
      
      svg.selectAll('.node')
        .classed('highlighted', false);
      
      d3.select(this)
        .classed('highlighted', true);
    });

    // 绘制时间轴背景 - 固定在顶部
    timeAxisGroup.append('rect')
      .attr('class', 'time-axis-background')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', 55) // 覆盖时间轴及其标签的高度
      .attr('fill', '#212730'); // 深蓝灰色背景
    
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
      .call(function(g: d3.Selection<SVGGElement, unknown, null, undefined>) {
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
    
    //mainGroup.append('g')
    //  .attr('class', 'grid')
    //  .attr('pointer-events', 'none'); // 避免网格线干扰点击事件
    
    // 添加时间线标签
    const formatDateForTitle = d3.timeFormat('%Y年%m月%d日'); // 日期格式化函数
    const formatTimeForTitle = d3.timeFormat('%H:%M:%S'); // 时间格式化函数

    timeAxisGroup.append('text')
      .attr('class', 'time-axis-title')
      .attr('x', width / 2)
      .attr('y', 12)
      .attr('text-anchor', 'middle')
      .attr('fill', '#FFF')
      .style('font-size', '11px');
    
    // 设置缩放行为，关键是让时间轴与内容同步缩放和移动
    try {
      console.log('为时间线视图设置缩放行为');
      
      // 获取DOM引用
      const mainGroup = svg.select('.main-group');

      // 保存时间和尺寸信息以便在事件处理函数中使用
      const timeRangeInfo = { minTime, maxTime };
      const dimensionsInfo = { width, height };
      
      // 创建缩放处理函数
      const zoomHandler = function(event: d3.D3ZoomEvent<SVGElement, unknown>) {
        if (!event || !event.transform) return;
        // 检查变换是否有效
        const { x, y, k } = event.transform;
        if (!isFinite(x) || !isFinite(y) || !isFinite(k) ||
            Math.abs(x) > width * 2 || Math.abs(y) > height * 2 || 
            k < 0.01 || k > 100) {
          console.warn('检测到无效变换:', event.transform, '，恢复到安全状态');
          // 重置到安全变换
          const safeTransform = d3.zoomIdentity.translate(0, 0).scale(0.8);
          if (visualizer.zoom) {
            svg.call(visualizer.zoom.transform, safeTransform);
          }
          return;
        }        
        // 1. 更新主内容组的变换
        mainGroup.attr('transform', event.transform);
        
        // 2. 时间轴组保持固定位置，只更新刻度
        // 不要对 timeAxisGroup 应用任何变换
        
        // 3. 更新时间轴刻度和标签
        updateTimeAxis(event.transform, timeAxisGroup, mainGroup, timeRangeInfo, dimensionsInfo);
        
        // 4. 根据缩放级别调整标签可见性
        if (event.transform.k < 0.5) {
          mainGroup.selectAll('text').style('display', 'none');
        } else {
          mainGroup.selectAll('text').style('display', null);
        }
        
        // 5. 保存当前变换状态
        if (visualizer && !visualizer._isRestoringTransform) {
          // 在保存前进行安全检查
          const safeTransform = {
            x: Math.max(-width * 2, Math.min(event.transform.x, width * 2)),
            y: Math.max(-height * 2, Math.min(event.transform.y, height * 2)),
            k: Math.max(0.1, Math.min(event.transform.k, 8))
          };
          
          // 只在变换合理时保存
          if (Math.abs(safeTransform.x) < width * 2 && 
              Math.abs(safeTransform.y) < height * 2) {
            saveViewState(visualizer.tabId || '', { transform: safeTransform });
          } else {
            console.warn('变换超出合理范围，跳过保存');
          }
        }
      };
    
      // 创建缩放行为
      const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on('zoom', zoomHandler);
    
      // 保存并应用缩放行为
      visualizer.zoom = zoom;
      svg.call(zoom)
        .style('cursor', 'move'); // 添加鼠标指针样式，表明可拖动
    
      console.log('已设置时间线缩放行为');
    } catch (error) {
      console.error('设置时间线缩放失败:', error);
    }    
    // 恢复保存的变换状态或应用默认缩放
    setTimeout(() => {
      try {
        // 获取DOM引用
        const mainGroup = svg.select('.main-group');
        
        // 保存时间和尺寸信息
        const timeRangeInfo = { minTime, maxTime };
        const dimensionsInfo = { width, height };
            
        // 如果有保存的变换状态，应用它
        if (visualizer._isRestoringTransform && visualizer._savedTransform) {
          const { x, y, k } = visualizer._savedTransform;
          // 检查变换的每个组成部分是否有效
          if (!isFinite(x) || !isFinite(y) || !isFinite(k)) {
            console.warn('保存的变换包含无效值，使用默认变换');
            visualizer._isRestoringTransform = false;
            return; // 跳过应用无效变换，改用默认变换
          }
          
          // 限制缩放范围
          const validK = Math.max(0.1, Math.min(k, 8));
          
          // 限制平移范围
          const validX = Math.max(-width * 2, Math.min(x, width * 2));
          const validY = Math.max(-height * 2, Math.min(y, height * 2));
          
          const transform = d3.zoomIdentity
            .translate(validX, validY)
            .scale(validK);
          
          if (visualizer.zoom) {
            console.log('恢复保存的变换状态:', visualizer._savedTransform);
            svg.call(visualizer.zoom.transform, transform);
            // 立即触发时间轴更新
            updateTimeAxis(transform, timeAxisGroup, mainGroup, timeRangeInfo, dimensionsInfo);
            
            // 清除标记
            visualizer._isRestoringTransform = false;
            
            return; // 跳过自动居中
          }
        }
        
        // 如果没有保存状态，应用默认缩放以显示所有节点
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
          
          // 计算节点中心点
          const centerNodeX = (minX + maxX) / 2;
          const centerNodeY = (minY + maxY) / 2;
          
          // 使用固定的缩放值
          const scaleFactor = 0.8;
          
          // 计算变换，使节点中心点与视图中心对齐
          const centerX = width/2 - centerNodeX * scaleFactor;
          const centerY = height/2 - centerNodeY * scaleFactor;
          
          // 创建并应用变换
          const transform = d3.zoomIdentity
            .translate(centerX, centerY)
            .scale(scaleFactor);
          
          if (visualizer.zoom) {
            svg.call(visualizer.zoom.transform, transform);
            // 立即触发时间轴更新
            updateTimeAxis(transform, timeAxisGroup, mainGroup, timeRangeInfo, dimensionsInfo);
          }
        }
      } catch (err) {
        console.error('应用变换失败:', err);
      }
    }, 100);
    
    // 为缩放状态同步准备变量
    visualizer.timeScale = timeScale;
    visualizer.timeAxisGroup = timeAxisGroup;
    
  } catch (err) {
    console.error('时间线渲染过程中出错:', err);
    
    // 渲染错误信息
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'red')
      .text(`时间线渲染错误: ${err && (err as Error).message ? (err as Error).message : '未知错误'}`);
    
    // 渲染简单的空白时间线
    renderEmptyTimeline(svg, width, height);
  }
}

/**
 * 渲染空白时间线
 */
function renderEmptyTimeline(svg: any, width: number, height: number = 200): void {
  svg.selectAll("*").remove();
  
  // 添加背景
  svg.append('rect')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('fill', '#FFF');
  
  // 添加时间轴区域
  svg.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', width)
    .attr('height', 55)
    .attr('fill', '#212730');
  
  // 添加空状态文字 - 放在页面中间
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', '#333')
    .text('无时间数据可显示');
  
  // 添加时间轴标题
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 20)
    .attr('text-anchor', 'middle')
    .attr('fill', '#FFF')
    .style('font-size', '11px')
    .text('时间线');
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