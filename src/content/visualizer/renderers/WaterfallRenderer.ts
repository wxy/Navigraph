import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { NavNode, NavLink, Visualizer } from '../../types/navigation.js';
import { BaseRenderer } from './BaseRenderer.js';

const d3 = window.d3;
const logger = new Logger('WaterfallRenderer');

export class WaterfallRenderer implements BaseRenderer {
  private visualizer: Visualizer;
  private svg: any = null;
  private container: HTMLElement | null = null;
  private width: number = 0;
  private height: number = 0;
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
    logger.log(_('waterfall_renderer_created', '瀑布视图渲染器已创建'));
  }
  
  initialize(svg: any, container: HTMLElement, width: number, height: number): void {
    this.svg = svg;
    this.container = container;
    this.width = width;
    this.height = height;
    
    logger.log(_('waterfall_renderer_initialized', '瀑布视图渲染器已初始化，尺寸: {0}x{1}'), width, height);
  }
  
  render(nodes: NavNode[], edges: NavLink[], options: { restoreTransform?: boolean } = {}): void {
    if (!this.svg || !this.container) {
      logger.error(_('waterfall_renderer_cannot_render', '瀑布渲染器无法渲染：SVG或容器未初始化'));
      return;
    }
    
    logger.log(_('waterfall_renderer_render_start', '开始渲染瀑布视图，节点数: {0}，边数: {1}'), nodes.length, edges.length);
    
    try {
      // 调用瀑布布局渲染函数
      renderWaterfallLayout(
        this.container,
        this.svg,
        nodes,
        edges,
        this.width,
        this.height,
        this.visualizer
      );
    } catch (error) {
      logger.error(_('waterfall_renderer_render_error', '瀑布视图渲染失败: {0}'), error);
      throw error;
    }
  }
  
  cleanup(): void {
    if (this.svg) {
      this.svg.selectAll("*").remove();
    }
    
    this.svg = null;
    this.container = null;
    
    logger.log(_('waterfall_renderer_cleaned_up', '瀑布视图渲染器已清理'));
  }
}

/**
 * 瀑布布局渲染函数
 */
function renderWaterfallLayout(
  container: HTMLElement,
  svg: any,
  nodes: NavNode[],
  edges: NavLink[],
  width: number,
  height: number,
  visualizer: Visualizer
): void {
  logger.log(_('waterfall_layout_start', '开始渲染瀑布布局'));
  
  try {
    // 清除现有内容
    svg.selectAll("*").remove();
    
    // 创建主组
    const mainGroup = svg.append('g').attr('class', 'waterfall-main-group');
    
    // Phase 2: 实现真正的瀑布布局
    const layoutData = calculateWaterfallLayout(nodes, edges, width, height);
    
    // 渲染时间轴
    renderTimeAxis(mainGroup, layoutData, width, height);
    
    // 渲染URL节点
    renderUrlNodes(mainGroup, layoutData, visualizer);
    
    // 渲染URL连接线
    renderUrlConnections(mainGroup, layoutData);
    
    logger.log(_('waterfall_layout_complete', '瀑布布局渲染完成'));
  } catch (error) {
    logger.error(_('waterfall_layout_error', '瀑布布局渲染失败: {0}'), error);
    throw new _Error('waterfall_layout_render_failed', '瀑布布局渲染失败', error);
  }
}

// 数据接口定义
interface UrlNodeData {
  id: string;
  url: string;
  title: string;
  x: number;
  y: number;
  tabId: number;
  timestamp: number;
  isFirstInTab: boolean;
  domain: string;
  node: NavNode; // 保存原始节点数据
}

interface TimeSlotData {
  timestamp: number;
  x: number;
  urls: UrlNodeData[];
}

interface TimeAxisData {
  startX: number;
  endX: number;
  y: number;
  timeSlots: {
    x: number;
    timestamp: number;
    label: string;
  }[];
}

interface WaterfallLayoutData {
  timeSlots: TimeSlotData[];
  urlNodes: UrlNodeData[];
  timeAxisData: TimeAxisData;
}

/**
 * 计算瀑布布局
 */
function calculateWaterfallLayout(nodes: NavNode[], edges: NavLink[], width: number, height: number): WaterfallLayoutData {
  logger.log(_('waterfall_layout_calculation_start', '开始计算瀑布布局: {0} 个节点'), nodes.length);
  
  // 过滤有效的导航节点（排除根节点）
  const sortedNodes = nodes
    .filter(node => node.id !== 'session-root' && node.url && node.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序排列（最新的在左边）
  
  if (sortedNodes.length === 0) {
    return {
      timeSlots: [],
      urlNodes: [],
      timeAxisData: {
        startX: 100,
        endX: width - 100,
        y: height - 100,
        timeSlots: []
      }
    };
  }
  
  // 配置参数 - 增加时间槽和节点宽度
  const config = {
    leftMargin: 100,
    rightMargin: 100,
    topMargin: 80,
    bottomMargin: 120,
    timeSlotWidth: 160,  // 增加时间槽宽度从120到160
    nodeHeight: 40,      // 保持节点高度40
    nodeSpacing: 15,     // 保持节点间距15
    maxNodesPerColumn: 6 // 保持每列最大节点数6
  };
  
  // 计算时间范围
  const maxTime = Math.max(...sortedNodes.map(n => n.timestamp));
  const minTime = Math.min(...sortedNodes.map(n => n.timestamp));
  
  // 计算时间槽 - 使用5分钟间隔，对齐到5分钟边界
  const fiveMinutes = 5 * 60 * 1000; // 5分钟的毫秒数
  
  // 将最大时间向上取整到下一个5分钟边界
  const alignedMaxTime = Math.ceil(maxTime / fiveMinutes) * fiveMinutes;
  // 将最小时间向下取整到前一个5分钟边界  
  const alignedMinTime = Math.floor(minTime / fiveMinutes) * fiveMinutes;
  
  const timeRange = alignedMaxTime - alignedMinTime;
  const availableWidth = width - config.leftMargin - config.rightMargin;
  const maxSlots = Math.floor(availableWidth / config.timeSlotWidth);
  
  // 根据对齐的时间范围计算槽数
  const timeBasedSlots = Math.ceil(timeRange / fiveMinutes);
  const numSlots = Math.min(maxSlots, Math.max(timeBasedSlots, 4)); // 至少4个槽，最多受宽度限制
  const slotInterval = fiveMinutes; // 固定5分钟间隔
  
  const timeSlots: TimeSlotData[] = [];
  const urlNodes: UrlNodeData[] = [];
  
  // 创建时间槽 - 从对齐的最新时间开始
  for (let i = 0; i < numSlots; i++) {
    const slotTime = alignedMaxTime - (i * slotInterval);
    const x = config.leftMargin + (i * config.timeSlotWidth);
    
    if (x > width - config.rightMargin) break;
    
    timeSlots.push({
      timestamp: slotTime,
      x: x,
      urls: []
    });
  }
  
  // 为每个时间槽分配URL节点
  let globalNodeIndex = 0;
  
  timeSlots.forEach(timeSlot => {
    // 找到属于该时间槽的节点
    const slotNodes = sortedNodes.filter(node => 
      node.timestamp <= timeSlot.timestamp && 
      node.timestamp > timeSlot.timestamp - slotInterval
    );
    
    slotNodes.forEach((node, nodeIndex) => {
      if (globalNodeIndex >= config.maxNodesPerColumn * timeSlots.length) return;
      
      const y = config.topMargin + (nodeIndex * (config.nodeHeight + config.nodeSpacing));
      if (y > height - config.bottomMargin) return;
      
      // 获取域名
      const domain = node.url ? new URL(node.url).hostname : 'unknown';
      
      // 检查是否是该标签页的第一个节点
      const tabId = node.tabId || 0;
      const isFirstInTab = !urlNodes.some(existing => 
        existing.tabId === tabId && existing.timestamp < node.timestamp
      );
      
      // 使用与其他视图相同的标题处理逻辑
      const title = node.title || node.url || _('unnamed_node', '未命名节点');
      
      const urlData: UrlNodeData = {
        id: node.id,
        url: node.url || '',
        title: title,
        x: timeSlot.x,
        y: y,
        tabId: tabId,
        timestamp: node.timestamp,
        isFirstInTab: isFirstInTab,
        domain: domain,
        node: node // 保存原始节点数据
      };
      
      timeSlot.urls.push(urlData);
      urlNodes.push(urlData);
      globalNodeIndex++;
    });
  });
  
  // 时间轴数据 - 移到底部并占满宽度
  const timeAxisData: TimeAxisData = {
    startX: 0,  // 从最左边开始
    endX: width, // 到最右边结束
    y: height - 40, // 移到底部，留40px边距
    timeSlots: timeSlots.map(slot => ({
      x: slot.x,
      timestamp: slot.timestamp,
      label: new Date(slot.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }))
  };
  
  logger.log(_('waterfall_layout_calculation_complete', '瀑布布局计算完成，时间槽: {0}，URL节点: {1}'), 
    timeSlots.length, urlNodes.length);
  
  return {
    timeSlots,
    urlNodes,
    timeAxisData
  };
}

/**
 * 渲染时间轴（从右到左）
 */
function renderTimeAxis(mainGroup: any, layoutData: WaterfallLayoutData, width: number, height: number): void {
  const axisGroup = mainGroup.append('g').attr('class', 'waterfall-time-axis');
  
  // 添加时间条带背景 - 条带边界与5分钟时间线对齐
  const stripHeight = height - 100; // 从顶部到时间轴上方的高度
  const slotWidth = 160; // 更新时间槽宽度，与config.timeSlotWidth一致
  
  // 重新计算条带，让条带边界与时间线对齐
  for (let i = 0; i < layoutData.timeAxisData.timeSlots.length; i++) {
    const slot = layoutData.timeAxisData.timeSlots[i];
    
    // 条带的左边界应该是前一个时间点，右边界是当前时间点
    // 对于第一个条带，从当前时间点向左延伸一个槽宽
    // 对于后续条带，从前一个时间点到当前时间点
    let stripX: number;
    let stripWidth: number;
    
    if (i === 0) {
      // 第一个条带：从当前时间点向左延伸
      stripX = slot.x - slotWidth;
      stripWidth = slotWidth;
    } else {
      // 后续条带：从前一个时间点到当前时间点
      const prevSlot = layoutData.timeAxisData.timeSlots[i - 1];
      stripX = prevSlot.x;
      stripWidth = slot.x - prevSlot.x;
    }
    
    // 交替明暗条带 - 边界与时间线对齐
    axisGroup.append('rect')
      .attr('x', stripX)
      .attr('y', 60)  // 从导航栏下方开始
      .attr('width', stripWidth)
      .attr('height', stripHeight)
      .attr('fill', i % 2 === 0 ? '#f0f2f5' : '#ffffff')  // 更明显的灰白对比
      .attr('opacity', 0.8)  // 增加不透明度
      .attr('class', `time-strip time-strip-${i}`)
      .attr('data-time', new Date(slot.timestamp).toISOString()); // 添加时间数据便于调试
  }
  
  // 添加最后一个条带（最右边的时间段）
  if (layoutData.timeAxisData.timeSlots.length > 0) {
    const lastSlot = layoutData.timeAxisData.timeSlots[layoutData.timeAxisData.timeSlots.length - 1];
    const lastStripIndex = layoutData.timeAxisData.timeSlots.length;
    
    axisGroup.append('rect')
      .attr('x', lastSlot.x)
      .attr('y', 60)
      .attr('width', slotWidth)
      .attr('height', stripHeight)
      .attr('fill', lastStripIndex % 2 === 0 ? '#f0f2f5' : '#ffffff')
      .attr('opacity', 0.8)
      .attr('class', `time-strip time-strip-${lastStripIndex}`)
      .attr('data-time', 'future');
  }
  
  // 绘制时间轴背景 - 使用浅色主题匹配
  axisGroup.append('rect')
    .attr('class', 'waterfall-time-axis-background')
    .attr('x', 0)
    .attr('y', layoutData.timeAxisData.y - 20)
    .attr('width', width)  // 占满整个宽度
    .attr('height', 50)
    .attr('fill', '#f8f9fa')  // 浅灰色背景，匹配主题
    .attr('stroke', '#dee2e6')  // 添加边框
    .attr('stroke-width', 1);
  
  // 绘制主轴线
  axisGroup.append('line')
    .attr('x1', layoutData.timeAxisData.startX + 20)
    .attr('y1', layoutData.timeAxisData.y)
    .attr('x2', layoutData.timeAxisData.endX - 20)
    .attr('y2', layoutData.timeAxisData.y)
    .style('stroke', '#6c757d')  // 深灰色轴线
    .style('stroke-width', 2);
  
  // 添加箭头指向过去（右侧）
  axisGroup.append('polygon')
    .attr('points', `${layoutData.timeAxisData.endX - 30},${layoutData.timeAxisData.y-6} ${layoutData.timeAxisData.endX - 30},${layoutData.timeAxisData.y+6} ${layoutData.timeAxisData.endX - 18},${layoutData.timeAxisData.y}`)
    .style('fill', '#6c757d');
  
  // 时间标签
  axisGroup.append('text')
    .attr('x', 30)
    .attr('y', layoutData.timeAxisData.y - 25)
    .attr('text-anchor', 'start')
    .style('font-size', '14px')
    .style('font-weight', 'bold')
    .style('fill', '#495057')  // 深灰色文字
    .text(_('waterfall_timeline_now', '现在'));
  
  axisGroup.append('text')
    .attr('x', width - 30)
    .attr('y', layoutData.timeAxisData.y - 25)
    .attr('text-anchor', 'end')
    .style('font-size', '14px')
    .style('font-weight', 'bold')
    .style('fill', '#495057')  // 深灰色文字
    .text(_('waterfall_timeline_past', '过去'));
  
  // 时间刻度
  layoutData.timeAxisData.timeSlots.forEach(slot => {
    // 主刻度线
    axisGroup.append('line')
      .attr('x1', slot.x)
      .attr('y1', layoutData.timeAxisData.y - 8)
      .attr('x2', slot.x)
      .attr('y2', layoutData.timeAxisData.y + 8)
      .style('stroke', '#6c757d')
      .style('stroke-width', 2);
    
    // 时间标签
    axisGroup.append('text')
      .attr('x', slot.x)
      .attr('y', layoutData.timeAxisData.y + 25)
      .attr('text-anchor', 'middle')
      .style('font-size', '11px')
      .style('font-weight', 'normal')
      .style('fill', '#6c757d')  // 深灰色文字
      .text(slot.label);
  });
}

/**
 * 渲染URL节点
 */
function renderUrlNodes(mainGroup: any, layoutData: WaterfallLayoutData, visualizer: Visualizer): void {
  const nodeGroup = mainGroup.append('g').attr('class', 'waterfall-url-nodes');
  
  layoutData.urlNodes.forEach(urlNode => {
    const node = nodeGroup.append('g')
      .attr('class', `url-node ${urlNode.isFirstInTab ? 'first-in-tab' : 'continuation'}`)
      .attr('transform', `translate(${urlNode.x}, ${urlNode.y})`);
    
    // URL节点背景 - 增加宽度并在条带中居中
    node.append('rect')
      .attr('width', 130)    // 增加宽度从100到130（条带宽度160px，留30px空隙，节点居中）
      .attr('height', 35)    // 保持高度35
      .attr('rx', 6)         // 保持圆角6
      .attr('x', 15)         // 向右偏移15px使节点在条带中居中（130px节点在160px条带中居中需要偏移(160-130)/2=15px）
      .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#e8f0fe')
      .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#4285f4')
      .style('stroke-width', 1);
    
    // 域名图标/标识 - 调整位置以适应居中的节点
    node.append('circle')
      .attr('cx', 27)        // 调整x位置（12 + 15 = 27，适应节点x偏移）
      .attr('cy', 17.5)      // 保持y位置
      .attr('r', 8)          // 保持半径8
      .style('fill', urlNode.isFirstInTab ? '#ffffff' : '#4285f4')
      .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
      .style('stroke-width', 1);
    
    // 优先显示 favicon，如果没有则显示域名首字母或标签页ID
    if (urlNode.node.favicon) {
      // 添加 favicon 图标 - 调整位置以适应居中的节点
      node.append('image')
        .attr('xlink:href', urlNode.node.favicon)
        .attr('x', 21)         // 调整x位置（6 + 15 = 21，适应节点x偏移）
        .attr('y', 11.5)       // 保持y位置
        .attr('width', 12)     // 保持尺寸
        .attr('height', 12)    // 保持尺寸
        .style('clip-path', 'circle(6px at 6px 6px)')
        .on('error', function(this: SVGImageElement) {
          // 图像加载失败时显示域名首字母
          d3.select(this).remove();
          const fallbackText = urlNode.isFirstInTab && urlNode.domain !== 'unknown' 
            ? urlNode.domain.charAt(0).toUpperCase() 
            : (urlNode.tabId === 0 ? 'M' : `${urlNode.tabId}`);
          
          node.append('text')
            .attr('x', 27)      // 调整x位置（12 + 15 = 27，适应节点x偏移）
            .attr('y', 21)      // 保持y位置
            .attr('text-anchor', 'middle')
            .style('font-size', '10px')  // 保持字体大小
            .style('font-weight', 'bold')
            .style('fill', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
            .text(fallbackText);
        });
    } else {
      // 没有 favicon 时显示域名首字母或标签页标识 - 调整位置以适应居中的节点
      const displayText = urlNode.isFirstInTab && urlNode.domain !== 'unknown' 
        ? urlNode.domain.charAt(0).toUpperCase() 
        : (urlNode.tabId === 0 ? 'M' : `${urlNode.tabId}`);
      
      node.append('text')
        .attr('x', 27)          // 调整x位置（12 + 15 = 27，适应节点x偏移）
        .attr('y', 21)          // 保持y位置
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')  // 保持字体大小
        .style('font-weight', 'bold')
        .style('fill', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
        .text(displayText);
    }
    
    // 页面标题文本 - 调整位置以适应居中的节点和增大的节点宽度
    const titleText = urlNode.title.length > 16 ? urlNode.title.substring(0, 16) + '...' : urlNode.title;
    node.append('text')
      .attr('x', 43)          // 调整x位置（28 + 15 = 43，适应节点x偏移）
      .attr('y', 21)          // 保持y位置
      .style('font-size', '12px')  // 保持字体12px
      .style('fill', urlNode.isFirstInTab ? 'white' : '#1a73e8')
      .text(titleText);
    
    // 鼠标悬停显示完整信息
    node.append('title')
      .text(`${urlNode.title}\n${urlNode.url}\n${new Date(urlNode.timestamp).toLocaleString()}\n标签页: ${urlNode.tabId}`);
    
    // 点击事件
    node.style('cursor', 'pointer')
      .on('click', function() {
        // 显示节点详情 - 传递原始节点数据
        if (visualizer && typeof visualizer.showNodeDetails === 'function') {
          visualizer.showNodeDetails(urlNode.node);
        }
      });
  });
}

/**
 * 渲染URL连接线
 */
function renderUrlConnections(mainGroup: any, layoutData: WaterfallLayoutData): void {
  const connectionGroup = mainGroup.append('g').attr('class', 'waterfall-url-connections');
  
  // 按标签页分组URL，绘制同一标签页内URL之间的连接线
  const urlsByTab = new Map<number, UrlNodeData[]>();
  layoutData.urlNodes.forEach(urlNode => {
    if (!urlsByTab.has(urlNode.tabId)) {
      urlsByTab.set(urlNode.tabId, []);
    }
    urlsByTab.get(urlNode.tabId)!.push(urlNode);
  });
  
  urlsByTab.forEach(urls => {
    // 按时间排序
    const sortedUrls = urls.sort((a, b) => a.timestamp - b.timestamp);
    
    for (let i = 0; i < sortedUrls.length - 1; i++) {
      const fromUrl = sortedUrls[i];
      const toUrl = sortedUrls[i + 1];
      
      // 绘制连接线 - 调整位置以适应居中的节点（130px宽度，+15px偏移）
      connectionGroup.append('line')
        .attr('x1', fromUrl.x + 80)   // 节点中心：130px宽度/2 + 15px偏移 = 65 + 15 = 80px
        .attr('y1', fromUrl.y + 17.5) // 保持起点y位置到节点中心
        .attr('x2', toUrl.x + 80)     // 节点中心：130px宽度/2 + 15px偏移 = 65 + 15 = 80px
        .attr('y2', toUrl.y + 17.5)   // 保持终点y位置到节点中心
        .style('stroke', '#36a2eb')
        .style('stroke-width', 2)     // 保持线宽2px
        .style('stroke-dasharray', '4,4') // 保持虚线样式
        .style('opacity', 0.8)        // 保持不透明度
        .attr('class', 'url-connection');
    }
  });
}