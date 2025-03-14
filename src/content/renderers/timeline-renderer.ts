/**
 * 时间线视图渲染模块
 * 负责绘制基于时间的导航可视化
 */

// 导入依赖
import * as d3 from 'd3';
import { NavNode, NavLink, Visualizer } from '../types/navigation';
import { 
  getNodeColor, 
  getEdgeColor, 
  isTrackingPage,
  calculateLinkPath 
} from '../utils/visualization-utils';

// 导出主渲染函数
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
  
  // 清除现有内容以避免重复
  timelineSvg.selectAll("*").remove();
  
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

  if (nodes.length > 0) {
    // 计算时间范围
    let minTime = Math.min(...nodes.map(node => node.timestamp));
    let maxTime = Math.max(...nodes.map(node => node.timestamp));
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
    
    // 计算节点位置
    nodes.forEach(node => {
      // X坐标基于时间
      node.renderX = timeScale(new Date(node.timestamp));
      
      // Y坐标基于类型，分层展示
      let yBase = 0;
      switch (node.type) {
        case 'link_click': yBase = height * 0.25; break;
        case 'address_bar': yBase = height * 0.45; break;
        case 'form_submit': yBase = height * 0.65; break;
        default: yBase = height * 0.4;
      }
      
      // 添加一些随机偏移避免重叠
      node.renderY = yBase + (Math.random() - 0.5) * height * 0.25;
    });
    
    // 创建箭头定义
    container.append('defs').append('marker')
      .attr('id', 'arrowhead')
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
      .attr('class', (d: NavLink) => `edge ${d.type}`)
      .attr('marker-end', 'url(#arrowhead)')
      .attr('d', (d: NavLink) => {
        const sourceNode = visualizer.nodeMap ? visualizer.nodeMap.get(d.source) : 
                           nodes.find(n => n.id === d.source);
        const targetNode = visualizer.nodeMap ? visualizer.nodeMap.get(d.target) : 
                           nodes.find(n => n.id === d.target);
                  
        if (!sourceNode || !targetNode) return '';
        
        const source = {x: sourceNode.renderX || 0, y: sourceNode.renderY || 0};
        const target = {x: targetNode.renderX || 0, y: targetNode.renderY || 0};
        
        // 使用导入的工具函数
        return calculateLinkPath(source, target, d.type);
      })
      .attr('stroke', (d: NavLink) => getEdgeColor(d.type))
      .attr('stroke-width', 1.5)
      .attr('fill', 'none');
    
    // 绘制节点
    const nodeElements = container.append('g')
      .selectAll('.node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', (d: NavNode) => {
        // 组合多个类名
        let classes = `node ${d.type}`;
        
        // 添加关闭状态
        if (d.isClosed) {
          classes += ' closed';
        }
        
        // 添加跟踪标记
        if (isTrackingPage(d, visualizer)) {
          classes += ' tracking';
        }
        
        return classes;
      })
      .attr('transform', (d: NavNode) => `translate(${d.renderX || 0},${d.renderY || 0})`);
    
    nodeElements.append('circle')
      .attr('r', 20)
      .attr('fill', (d: NavNode) => getNodeColor(d.type));
    
    nodeElements.append('title')
      .text((d: NavNode) => d.title || d.url || '');
    
    nodeElements.filter((d: NavNode) => !!d.favicon)
      .append('image')
      .attr('xlink:href', (d: NavNode) => d.favicon || '')
      .attr('x', -8)
      .attr('y', -8)
      .attr('width', 16)
      .attr('height', 16)
      .on('error', function(this: SVGImageElement) { // 添加this类型声明
        // 图像加载失败时替换为默认图标
        d3.select(this)
          .attr('xlink:href', chrome.runtime.getURL('images/logo-48.png'))
          .classed('default-icon', true);
      });
    
    nodeElements.append('text')
      .attr('dy', 35)
      .attr('text-anchor', 'middle')
      .attr('fill', '#fff')
      .style('font-size', '12px')
      .text((d: NavNode) => d.title ? d.title.substring(0, 10) + '...' : '');
    
    // 添加交互
    nodeElements.on('click', (event: MouseEvent, d: NavNode) => {
      if (visualizer && typeof visualizer.showNodeDetails === 'function') {
        visualizer.showNodeDetails(d);
      }
      
      container.selectAll('.node')
        .classed('highlighted', false);
      
      d3.select(event.currentTarget as Element)
        .classed('highlighted', true);
    });
    
    // 绘制时间轴 - 使用整个宽度
    const xAxis = d3.axisBottom(timeScale)
      .ticks(15)
      .tickFormat(d3.timeFormat('%H:%M:%S') as any)
      .tickSize(6) 
      .tickPadding(2);
    
    // 渲染时间轴 - 确保从左到右完全对齐
    timeAxisGroup.append('g')
      .attr('class', 'time-axis')
      .attr('transform', `translate(0, 20)`)
      .call(xAxis)
      .call((g: any) => {
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
        .tickFormat('' as any)
        .ticks(30))
      .call((g: any) => {
        g.select('.domain').remove();
        g.selectAll('.tick line')
          .attr('stroke', '#555')
          .attr('stroke-width', 0.5)
          .attr('opacity', 0.3);
      });
    
    // 延迟应用动态居中计算
    setTimeout(() => {
      try {
        // 如果正在恢复变换状态，跳过自动居中
        if (visualizer._isRestoringTransform) {
          console.log('跳过时间线自动居中，正在恢复用户设置的变换');
          return;
        }
        // 如果有节点，计算边界以实现真正的居中
        if (nodes.length > 0) {
          // 获取所有节点的位置信息
          const xValues = nodes.map(node => node.renderX || 0);
          const yValues = nodes.map(node => node.renderY || 0);
          
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
      }
    }, 150);  // 延时确保DOM完全渲染   
  } else {
    // 没有节点时显示默认时间线
    const now = new Date();
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const minTime = now.getTime() - sixHoursMs;
    const maxTime = now.getTime() + sixHoursMs;
    
    const timeScale = d3.scaleTime()
      .domain([new Date(minTime), new Date(maxTime)])
      .range([0, width]);
    
    const xAxis = d3.axisBottom(timeScale)
      .ticks(15)
      .tickFormat(d3.timeFormat('%H:%M:%S') as any)
      .tickSize(6)
      .tickPadding(2);
    
    timeAxisGroup.append('g')
      .attr('class', 'time-axis')
      .attr('transform', `translate(0, 20)`)
      .call(xAxis)
      .call((g: any) => {
        g.select('.domain')
          .attr('stroke', '#aaa')
          .attr('stroke-width', 1)
          .attr('opacity', 0.7);
        
        g.selectAll('.tick text')
          .attr('fill', '#999')
          .attr('font-size', '10px');
      });
      
    // 添加提示文本
    timeAxisGroup.append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#999')
      .text('无时间数据可显示');
  }
}