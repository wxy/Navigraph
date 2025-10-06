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
    
    // Phase 2.2: 支持动态观察区域的瀑布布局
    renderDynamicWaterfallLayout(mainGroup, nodes, edges, width, height, visualizer);
    
    logger.log(_('waterfall_layout_complete', '瀑布布局渲染完成'));
  } catch (error) {
    logger.error(_('waterfall_layout_error', '瀑布布局渲染失败: {0}'), error);
    throw new _Error('waterfall_layout_render_failed', '瀑布布局渲染失败', error);
  }
}

// Phase 2.2: 全局观察区域控制器
let globalFocusController: WaterfallFocusController | null = null;

/**
 * Phase 2.2: 支持动态观察区域的瀑布布局渲染
 */
function renderDynamicWaterfallLayout(
  mainGroup: any,
  nodes: NavNode[],
  edges: NavLink[],
  width: number,
  height: number,
  visualizer: Visualizer
): void {
  // 初始布局计算
  let layoutData = calculateWaterfallLayout(nodes, edges, width, height);
  
  // 创建观察区域控制器
  const timeRange = Math.max(...nodes.map(n => n.timestamp)) - Math.min(...nodes.map(n => n.timestamp));
  const focusConfig: FocusAreaController = {
    center: Math.max(...nodes.map(n => n.timestamp)) - (timeRange * 0.1),
    width: timeRange * 0.6,
    minTime: Math.min(...nodes.map(n => n.timestamp)),
    maxTime: Math.max(...nodes.map(n => n.timestamp)),
    containerWidth: width - 200, // 减去左右边距
    onUpdate: (newCenter: number) => {
      // 重新计算布局
      layoutData = recalculateLayout(nodes, edges, width, height, newCenter, focusConfig.width);
      // 重新渲染节点
      updateNodeRendering(mainGroup, layoutData, visualizer);
    }
  };
  
  globalFocusController = new WaterfallFocusController(focusConfig);
  
  // 初始渲染
  renderTimeAxis(mainGroup, layoutData, width, height);
  renderUrlNodes(mainGroup, layoutData, visualizer);
  renderUrlConnections(mainGroup, layoutData);
  
  // Phase 2.2: 在时间轴上添加观察区域控制器
  const axisGroup = mainGroup.select('.waterfall-time-axis');
  if (axisGroup && !axisGroup.empty()) {
    globalFocusController.renderFocusIndicator(axisGroup);
  }
}

/**
 * Phase 2.2: 重新计算布局（使用新的观察中心）
 */
function recalculateLayout(
  nodes: NavNode[],
  edges: NavLink[],
  width: number,
  height: number,
  newFocusCenter: number,
  focusWidth: number
): WaterfallLayoutData {
  // 复制原有的布局计算逻辑，但使用新的观察中心
  const sortedNodes = [...nodes].sort((a, b) => b.timestamp - a.timestamp);
  
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
  
  // 重新计算观察区域和渲染级别
  const config = {
    leftMargin: 100,
    rightMargin: 100,
    topMargin: 80,
    bottomMargin: 120,
    timeSlotWidth: 160,
    nodeHeight: 40,
    nodeSpacing: 15,
    maxNodesPerColumn: 6
  };
  
  // 计算时间范围
  const maxTime = Math.max(...sortedNodes.map(n => n.timestamp));
  const minTime = Math.min(...sortedNodes.map(n => n.timestamp));
  const fiveMinutes = 5 * 60 * 1000;
  const alignedMaxTime = Math.ceil(maxTime / fiveMinutes) * fiveMinutes;
  const alignedMinTime = Math.floor(minTime / fiveMinutes) * fiveMinutes;
  const timeRange = alignedMaxTime - alignedMinTime;
  const availableWidth = width - config.leftMargin - config.rightMargin;
  const maxSlots = Math.floor(availableWidth / config.timeSlotWidth);
  const timeBasedSlots = Math.ceil(timeRange / fiveMinutes);
  const numSlots = Math.min(maxSlots, Math.max(timeBasedSlots, 4));
  const slotInterval = fiveMinutes;
  
  // 使用新的观察中心
  const focusCenter = newFocusCenter;
  
  const timeSlots: TimeSlotData[] = [];
  const urlNodes: UrlNodeData[] = [];
  
  // 创建时间槽
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
  
  // 重新分配节点并计算渲染级别
  let globalNodeIndex = 0;
  timeSlots.forEach(timeSlot => {
    const slotNodes = sortedNodes.filter(node => 
      node.timestamp <= timeSlot.timestamp && 
      node.timestamp > timeSlot.timestamp - slotInterval
    );
    
    slotNodes.forEach((node, nodeIndex) => {
      if (globalNodeIndex >= config.maxNodesPerColumn * timeSlots.length) return;
      
      const y = config.topMargin + (nodeIndex * (config.nodeHeight + config.nodeSpacing));
      if (y > height - config.bottomMargin) return;
      
      const domain = node.url ? new URL(node.url).hostname : 'unknown';
      const tabId = node.tabId || 0;
      const isFirstInTab = !urlNodes.some(existing => 
        existing.tabId === tabId && existing.timestamp < node.timestamp
      );
      const title = node.title || node.url || _('unnamed_node', '未命名节点');
      
      // Phase 2.2: 使用新的观察中心计算渲染级别
      const distanceFromFocus = Math.abs(node.timestamp - focusCenter);
      const normalizedDistance = Math.min(distanceFromFocus / (focusWidth / 2), 1);
      
      let renderLevel: 'full' | 'short' | 'icon' | 'bar' = 'full';
      if (normalizedDistance > 0.7) {
        renderLevel = 'bar';
      } else if (normalizedDistance > 0.5) {
        renderLevel = 'icon';
      } else if (normalizedDistance > 0.3) {
        renderLevel = 'short';
      }
      
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
        node: node,
        renderLevel: renderLevel,
        distanceFromFocus: normalizedDistance
      };
      
      timeSlot.urls.push(urlData);
      urlNodes.push(urlData);
      globalNodeIndex++;
    });
  });
  
  // 时间轴数据
  const timeAxisData: TimeAxisData = {
    startX: 0,
    endX: width,
    y: height - 40,
    timeSlots: timeSlots.map(slot => ({
      x: slot.x,
      timestamp: slot.timestamp,
      label: new Date(slot.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }))
  };
  
  return {
    timeSlots: timeSlots,
    urlNodes: urlNodes,
    timeAxisData: timeAxisData
  };
}

/**
 * Phase 2.2: 更新节点渲染（不重新创建时间轴）
 */
function updateNodeRendering(
  mainGroup: any,
  layoutData: WaterfallLayoutData,
  visualizer: Visualizer
): void {
  // 移除现有的节点和连接线
  mainGroup.select('.waterfall-url-nodes').remove();
  mainGroup.select('.waterfall-url-connections').remove();
  
  // 重新渲染节点和连接线
  renderUrlNodes(mainGroup, layoutData, visualizer);
  renderUrlConnections(mainGroup, layoutData);
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
  renderLevel?: 'full' | 'short' | 'icon' | 'bar'; // 节点渲染级别
  distanceFromFocus?: number; // 距离观察中心的距离比例 0-1
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

// Phase 2.2: 观察区域控制器接口
interface FocusAreaController {
  center: number;        // 观察中心时间戳
  width: number;         // 观察区域宽度（毫秒）
  minTime: number;       // 最小时间
  maxTime: number;       // 最大时间
  containerWidth: number; // 容器宽度
  onUpdate: (newCenter: number) => void; // 更新回调
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
  
  // Phase 2.1: 定义观察区域配置 - 修正观察中心位置
  const focusCenter = alignedMaxTime - (timeRange * 0.1); // 观察中心在距离最新时间10%的位置，更靠近最新时间
  const focusWidth = timeRange * 0.6; // 观察区域覆盖60%的时间范围，确保最新节点在观察区域内
  
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
      
      // Phase 2.1: 计算节点渲染级别
      const distanceFromFocus = Math.abs(node.timestamp - focusCenter);
      const normalizedDistance = Math.min(distanceFromFocus / (focusWidth / 2), 1);
      
      // 根据距离确定渲染级别 - 调整阈值确保最新节点显示完整
      let renderLevel: 'full' | 'short' | 'icon' | 'bar' = 'full';
      if (normalizedDistance > 0.7) {
        renderLevel = 'bar';
      } else if (normalizedDistance > 0.5) {
        renderLevel = 'icon';
      } else if (normalizedDistance > 0.3) {
        renderLevel = 'short';
      }
      
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
        node: node, // 保存原始节点数据
        renderLevel: renderLevel,
        distanceFromFocus: normalizedDistance
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
      .attr('class', `url-node ${urlNode.isFirstInTab ? 'first-in-tab' : 'continuation'} render-${urlNode.renderLevel || 'full'}`)
      .attr('transform', `translate(${urlNode.x}, ${urlNode.y})`);
    
    // Phase 2.1: 根据渲染级别选择不同的渲染方式
    const renderLevel = urlNode.renderLevel || 'full';
    switch (renderLevel) {
      case 'full':
        renderFullNode(node, urlNode);
        break;
      case 'short':
        renderShortNode(node, urlNode);
        break;
      case 'icon':
        renderIconNode(node, urlNode);
        break;
      case 'bar':
        renderBarNode(node, urlNode);
        break;
      default:
        renderFullNode(node, urlNode);
        break;
    }
    
    // 添加点击事件处理
    node.style('cursor', 'pointer')
      .on('click', () => {
        if (visualizer && visualizer.showNodeDetails) {
          visualizer.showNodeDetails(urlNode.node);
        }
      });
  });
}

/**
 * 渲染URL之间的连接线
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
      
      // Phase 2.1: 绘制连接线 - 根据节点渲染级别计算连接点位置
      const fromCenter = getNodeCenter(fromUrl);
      const toCenter = getNodeCenter(toUrl);
      
      connectionGroup.append('line')
        .attr('x1', fromUrl.x + fromCenter.x)
        .attr('y1', fromUrl.y + fromCenter.y)
        .attr('x2', toUrl.x + toCenter.x)
        .attr('y2', toUrl.y + toCenter.y)
        .style('stroke', '#36a2eb')
        .style('stroke-width', 2)
        .style('stroke-dasharray', '4,4')
        .style('opacity', 0.8)
        .attr('class', 'url-connection');
    }
  });
}

// Phase 2.1: 辅助函数 - 根据渲染级别计算节点中心位置
function getNodeCenter(urlNode: UrlNodeData): { x: number; y: number } {
  const renderLevel = urlNode.renderLevel || 'full';
  
  switch (renderLevel) {
    case 'full':
      return { x: 80, y: 17.5 }; // 130px宽，15px偏移，中心在80px
    case 'short':
      return { x: 80, y: 15 };   // 100px宽，30px偏移，中心在80px
    case 'icon':
      return { x: 80, y: 17.5 }; // 圆形图标中心在80px
    case 'bar':
      return { x: 80, y: 17.5 }; // 竖条中心在80px
    default:
      return { x: 80, y: 17.5 };
  }
}

// Phase 2.1: 不同级别的节点渲染函数

/**
 * 渲染完整节点（观察区域内）
 */
function renderFullNode(node: any, urlNode: UrlNodeData): void {
  // 完整尺寸的节点背景
  node.append('rect')
    .attr('width', 130)
    .attr('height', 35)
    .attr('rx', 6)
    .attr('x', 15)
    .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#e8f0fe')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#4285f4')
    .style('stroke-width', 1);
  
  // 域名图标/标识
  node.append('circle')
    .attr('cx', 27)
    .attr('cy', 17.5)
    .attr('r', 8)
    .style('fill', urlNode.isFirstInTab ? '#ffffff' : '#4285f4')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
    .style('stroke-width', 1);
  
  // 优先显示 favicon
  if (urlNode.node.favicon) {
    renderFavicon(node, urlNode, 21, 11.5, 12, 12);
  } else {
    renderFallbackIcon(node, urlNode, 27, 21);
  }
  
  // 完整标题文本
  const titleText = urlNode.title.length > 16 ? urlNode.title.substring(0, 16) + '...' : urlNode.title;
  node.append('text')
    .attr('x', 43)
    .attr('y', 21)
    .style('font-size', '12px')
    .style('fill', urlNode.isFirstInTab ? 'white' : '#1a73e8')
    .text(titleText);
  
  // 悬停信息
  node.append('title')
    .text(`${urlNode.title}\n${urlNode.url}\nTab: ${urlNode.tabId}\nTime: ${new Date(urlNode.timestamp).toLocaleString('zh-CN')}`);
}

/**
 * 渲染短标题节点
 */
function renderShortNode(node: any, urlNode: UrlNodeData): void {
  // 较小的节点背景
  node.append('rect')
    .attr('width', 100)
    .attr('height', 30)
    .attr('rx', 5)
    .attr('x', 30)
    .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#e8f0fe')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#4285f4')
    .style('stroke-width', 1);
  
  // 较小的图标
  node.append('circle')
    .attr('cx', 40)
    .attr('cy', 15)
    .attr('r', 6)
    .style('fill', urlNode.isFirstInTab ? '#ffffff' : '#4285f4')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
    .style('stroke-width', 1);
  
  // Favicon 或后备图标
  if (urlNode.node.favicon) {
    renderFavicon(node, urlNode, 36, 11, 8, 8);
  } else {
    renderFallbackIcon(node, urlNode, 40, 18, '8px');
  }
  
  // 短标题
  const shortTitle = urlNode.title.length > 8 ? urlNode.title.substring(0, 8) + '...' : urlNode.title;
  node.append('text')
    .attr('x', 52)
    .attr('y', 18)
    .style('font-size', '10px')
    .style('fill', urlNode.isFirstInTab ? 'white' : '#1a73e8')
    .text(shortTitle);
  
  // 悬停信息
  node.append('title')
    .text(`${urlNode.title}\n${urlNode.url}`);
}

/**
 * 渲染仅图标节点
 */
function renderIconNode(node: any, urlNode: UrlNodeData): void {
  // 圆形图标背景
  node.append('circle')
    .attr('cx', 80)
    .attr('cy', 17.5)
    .attr('r', 12)
    .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#e8f0fe')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#4285f4')
    .style('stroke-width', 1);
  
  // Favicon 或后备图标
  if (urlNode.node.favicon) {
    renderFavicon(node, urlNode, 76, 13.5, 8, 8);
  } else {
    renderFallbackIcon(node, urlNode, 80, 21, '8px');
  }
  
  // 悬停信息
  node.append('title')
    .text(`${urlNode.title}\n${urlNode.url}`);
}

/**
 * 渲染竖条节点
 */
function renderBarNode(node: any, urlNode: UrlNodeData): void {
  // 竖条
  node.append('rect')
    .attr('width', 4)
    .attr('height', 35)
    .attr('x', 78)
    .attr('y', 0)
    .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#dee2e6')
    .style('opacity', 0.8);
  
  // 悬停信息
  node.append('title')
    .text(`${urlNode.title}\n${urlNode.url}`);
}

/**
 * 渲染 Favicon 图标
 */
function renderFavicon(node: any, urlNode: UrlNodeData, x: number, y: number, width: number, height: number): void {
  node.append('image')
    .attr('xlink:href', urlNode.node.favicon)
    .attr('x', x)
    .attr('y', y)
    .attr('width', width)
    .attr('height', height)
    .style('clip-path', `circle(${width/2}px at ${width/2}px ${height/2}px)`)
    .on('error', function(this: SVGImageElement) {
      d3.select(this).remove();
      renderFallbackIcon(node, urlNode, x + width/2, y + height - 2);
    });
}

/**
 * 渲染后备图标文字
 */
function renderFallbackIcon(node: any, urlNode: UrlNodeData, x: number, y: number, fontSize: string = '10px'): void {
  const fallbackText = urlNode.isFirstInTab && urlNode.domain !== 'unknown' 
    ? urlNode.domain.charAt(0).toUpperCase() 
    : (urlNode.tabId === 0 ? 'M' : `${urlNode.tabId}`);
  
  node.append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', 'middle')
    .style('font-size', fontSize)
    .style('font-weight', 'bold')
    .style('fill', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
    .text(fallbackText);
}

// Phase 2.2: 观察区域控制器类
class WaterfallFocusController {
  private config: FocusAreaController;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private initialCenter: number = 0;
  
  constructor(config: FocusAreaController) {
    this.config = config;
  }
  
  /**
   * 在时间轴上渲染观察区域控制器
   */
  renderFocusIndicator(axisGroup: any): void {
    const indicatorGroup = axisGroup.append('g')
      .attr('class', 'focus-area-indicator');
    
    // 计算观察区域在时间轴上的位置
    const focusAreaRect = this.calculateFocusAreaRect();
    
    // 绘制观察区域背景
    indicatorGroup.append('rect')
      .attr('class', 'focus-area-background')
      .attr('x', focusAreaRect.x)
      .attr('y', this.config.containerWidth > 800 ? -25 : -20) // 根据容器大小调整
      .attr('width', focusAreaRect.width)
      .attr('height', this.config.containerWidth > 800 ? 50 : 40)
      .style('fill', 'rgba(66, 133, 244, 0.1)')
      .style('stroke', '#4285f4')
      .style('stroke-width', 2)
      .style('stroke-dasharray', '5,5');
    
    // 绘制观察中心指示器
    const centerIndicator = indicatorGroup.append('g')
      .attr('class', 'focus-center-indicator')
      .style('cursor', 'grab');
    
    // 中心线
    centerIndicator.append('line')
      .attr('x1', focusAreaRect.centerX)
      .attr('y1', -30)
      .attr('x2', focusAreaRect.centerX)
      .attr('y2', 30)
      .style('stroke', '#1a73e8')
      .style('stroke-width', 3);
    
    // 中心圆点（拖拽手柄）
    centerIndicator.append('circle')
      .attr('cx', focusAreaRect.centerX)
      .attr('cy', 0)
      .attr('r', 8)
      .style('fill', '#4285f4')
      .style('stroke', '#ffffff')
      .style('stroke-width', 2);
    
    // 添加交互事件
    this.addInteractionEvents(centerIndicator, axisGroup);
  }
  
  /**
   * 计算观察区域在时间轴上的位置
   */
  private calculateFocusAreaRect(): {x: number, width: number, centerX: number} {
    const timeRange = this.config.maxTime - this.config.minTime;
    const pixelPerMs = this.config.containerWidth / timeRange;
    
    const centerOffset = (this.config.center - this.config.minTime) * pixelPerMs;
    const areaWidth = this.config.width * pixelPerMs;
    
    return {
      x: centerOffset - areaWidth / 2,
      width: areaWidth,
      centerX: centerOffset
    };
  }
  
  /**
   * 添加拖拽和点击交互事件
   */
  private addInteractionEvents(centerIndicator: any, axisGroup: any): void {
    const self = this;
    
    // 拖拽开始
    centerIndicator.on('mousedown', function(this: SVGElement, event: MouseEvent) {
      self.isDragging = true;
      self.dragStartX = event.clientX;
      self.initialCenter = self.config.center;
      
      // 更改光标样式
      d3.select(this).style('cursor', 'grabbing');
      
      // 阻止默认行为
      event.preventDefault();
    });
    
    // 全局鼠标移动事件
    d3.select(window).on('mousemove.focus-drag', function(event: MouseEvent) {
      if (!self.isDragging) return;
      
      const deltaX = event.clientX - self.dragStartX;
      const timeRange = self.config.maxTime - self.config.minTime;
      const deltaTime = (deltaX / self.config.containerWidth) * timeRange;
      
      const newCenter = Math.max(
        self.config.minTime + self.config.width / 2,
        Math.min(
          self.config.maxTime - self.config.width / 2,
          self.initialCenter + deltaTime
        )
      );
      
      // 更新观察中心
      self.updateFocusCenter(newCenter);
    });
    
    // 拖拽结束
    d3.select(window).on('mouseup.focus-drag', function() {
      if (self.isDragging) {
        self.isDragging = false;
        centerIndicator.style('cursor', 'grab');
      }
    });
    
    // 点击时间轴跳转
    axisGroup.on('click', function(this: SVGElement, event: MouseEvent) {
      if (self.isDragging) return; // 忽略拖拽时的点击
      
      const rect = this.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const timeRange = self.config.maxTime - self.config.minTime;
      const clickTime = self.config.minTime + (clickX / self.config.containerWidth) * timeRange;
      
      const newCenter = Math.max(
        self.config.minTime + self.config.width / 2,
        Math.min(
          self.config.maxTime - self.config.width / 2,
          clickTime
        )
      );
      
      self.updateFocusCenter(newCenter);
    });
  }
  
  /**
   * 更新观察中心位置
   */
  updateFocusCenter(newCenter: number): void {
    this.config.center = newCenter;
    this.config.onUpdate(newCenter);
  }
  
  /**
   * 获取当前观察区域配置
   */
  getFocusConfig(): {center: number, width: number} {
    return {
      center: this.config.center,
      width: this.config.width
    };
  }
}