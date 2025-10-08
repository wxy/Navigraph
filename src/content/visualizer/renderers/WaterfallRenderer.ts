import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { NavNode, NavLink, Visualizer } from '../../types/navigation.js';
import { BaseRenderer } from './BaseRenderer.js';

const d3 = window.d3;
const logger = new Logger('WaterfallRenderer_v3');

/**
 * 瀑布渲染器 v3 - 基于正确的70/30布局原则
 * 
 * 核心设计思路：
 * 1. 以5分钟为单位将时间分段
 * 2. 根据屏幕宽度分配正常显示区域(70%)和压缩区域(30%)
 * 3. 观察窗口决定哪个时间段处于正常显示区域
 * 4. 时间轴比例与节点显示比例完全一致
 */

interface TimeSegment {
  startTime: number;
  endTime: number;
  nodes: NavNode[];
  displayMode: 'full' | 'short' | 'icon' | 'dot';
  allocatedWidth: number;
  startX: number;
  originalIndex: number;  // 🎯 添加原始索引，用于保持明暗条纹一致性
}

interface LayoutResult {
  segments: TimeSegment[];
  normalDisplaySegments: TimeSegment[];  // 正常显示的段
  compressedSegments: TimeSegment[];     // 压缩显示的段
  totalWidth: number;
  timeAxisData: {
    startX: number;
    endX: number;
    y: number;
    segments: TimeSegment[];
  };
}

interface ObservationWindow {
  centerSegmentIndex: number;  // 观察窗口中心所在的段索引
  startX: number;
  width: number;
  segments: TimeSegment[];     // 观察窗口覆盖的段
}

export class WaterfallRenderer implements BaseRenderer {
  private readonly SEGMENT_DURATION = 5 * 60 * 1000; // 5分钟
  private readonly MAX_COMPRESSED_RATIO = 0.3; // 最大压缩区域占比30%
  private readonly NODE_WIDTHS = {
    full: 150,   // 全节点：图标 + 标题
    short: 120,  // 短节点：标题
    icon: 20,    // 图标节点：完整图标
    dot: 8       // 圆点节点：小圆点（最小压缩级别）
  };
  private readonly NODE_HEIGHTS = {
    full: 40,
    short: 25,
    icon: 20,
    dot: 8
  };

  private visualizer: Visualizer;
  private currentLayout: LayoutResult | null = null;
  private observationWindow: ObservationWindow | null = null;
  private svg: any;
  private container: HTMLElement | null = null;
  private width: number = 0;
  private height: number = 0;
  
  // 存储原始数据，用于拖动时重新计算布局
  private allSegments: TimeSegment[] = [];
  private renderOptions: any = null;
  private lastDragSnapped: boolean = false; // 记录拖动时是否吸附

  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }

  initialize(svg: any, container: HTMLElement, width: number, height: number): void {
    this.svg = svg;
    this.container = container;
    this.width = width;
    this.height = height;
  }

  cleanup(): void {
    this.currentLayout = null;
    this.observationWindow = null;
    this.svg = null;
    this.container = null;
  }

  render(nodes: NavNode[], edges: NavLink[], options?: any): void {
    console.log('🔥🔥🔥 WaterfallRenderer v3 开始渲染，节点数量:', nodes?.length || 0);
    
    // 清空容器
    this.svg.selectAll('*').remove();
    
    if (!nodes || nodes.length === 0) {
      logger.warn('没有节点数据可渲染');
      return;
    }

    // 🛡️ 安全检查：限制节点数量，防止性能问题
    const MAX_NODES = 500;
    if (nodes.length > MAX_NODES) {
      console.warn(`⚠️ 节点数量过多(${nodes.length})，限制为${MAX_NODES}个`);
      nodes = nodes.slice(0, MAX_NODES);
    }

    // 🛡️ 安全检查：验证时间戳有效性
    let validNodes = nodes.filter(node => {
      if (!node.timestamp || typeof node.timestamp !== 'number' || isNaN(node.timestamp)) {
        console.warn('⚠️ 发现无效时间戳的节点，已过滤:', node);
        return false;
      }
      return true;
    });

    // 🎯 应用筛选器：处理已关闭节点的显示
    // 如果没有传入过滤器选项，默认不显示已关闭的节点
    const showClosed = options?.filters?.closed !== false; // 默认为false（不显示）
    if (!showClosed) {
      const beforeFilter = validNodes.length;
      validNodes = validNodes.filter(node => !node.isClosed);
      console.log(`🎯 筛选已关闭节点: ${beforeFilter} -> ${validNodes.length}`);
    }

    if (validNodes.length === 0) {
      logger.warn('筛选后没有可显示的节点');
      return;
    }

    console.log(`✅ 使用 ${validNodes.length} 个有效节点进行渲染`);

    // 1. 计算时间分段和布局
    const layout = this.calculateSegmentLayout(validNodes, this.width);
    this.currentLayout = layout;

    // 2. 创建SVG分组结构
    const mainGroup = this.createSVGGroups(this.svg);

    // 3. 渲染时间轴（与节点布局完全一致）
    this.renderTimeAxis(mainGroup.timeAxisGroup, layout);

    // 4. 渲染节点（按段渲染）
    this.renderSegmentNodes(mainGroup.nodesGroup, layout);

    // 5. 渲染连接线
    this.renderConnections(mainGroup.connectionsGroup, layout);

    // 6. 渲染观察窗口滑块
    this.renderObservationWindowSlider(mainGroup.focusOverlayGroup, layout);

    console.log('🔥🔥🔥 WaterfallRenderer v3 渲染完成');
  }

  /**
   * 计算时间分段和布局分配
   */
  private calculateSegmentLayout(nodes: NavNode[], containerWidth: number): LayoutResult {
    console.log('📊 开始计算时间分段布局, 容器宽度:', containerWidth);

    // 1. 找到时间范围并对齐到5分钟边界
    const times = nodes.map(node => node.timestamp).sort((a, b) => b - a); // 最新的在前
    const maxTimeRaw = times[0];
    const minTimeRaw = times[times.length - 1];
    
    // 🎯 对齐到5分钟整数边界
    // 将maxTime向上对齐到下一个5分钟边界
    // 将minTime向下对齐到上一个5分钟边界
    const maxTime = Math.ceil(maxTimeRaw / this.SEGMENT_DURATION) * this.SEGMENT_DURATION;
    const minTime = Math.floor(minTimeRaw / this.SEGMENT_DURATION) * this.SEGMENT_DURATION;
    
    console.log('时间范围对齐:', {
      原始最新: new Date(maxTimeRaw).toLocaleTimeString(),
      对齐最新: new Date(maxTime).toLocaleTimeString(),
      原始最旧: new Date(minTimeRaw).toLocaleTimeString(),
      对齐最旧: new Date(minTime).toLocaleTimeString()
    });

    // 2. 创建时间分段（从最新时间开始，按5分钟分段）
    const segments: TimeSegment[] = [];
    let currentTime = maxTime;
    let safetyCounter = 0; // 防止无限循环
    const MAX_ITERATIONS = 1000;
    let segmentIndex = 0; // 🎯 原始索引计数器
    
    while (currentTime > minTime && safetyCounter < MAX_ITERATIONS) {
      safetyCounter++;
      
      const segmentEnd = currentTime;
      const segmentStart = currentTime - this.SEGMENT_DURATION;
      
      // 找到此段内的节点
      const segmentNodes = nodes.filter(node => 
        node.timestamp < segmentEnd && node.timestamp >= segmentStart
      );

      // 即使没有节点也创建段（保持时间轴连续）
      segments.push({
        startTime: segmentStart,
        endTime: segmentEnd,
        nodes: segmentNodes,
        displayMode: 'full', // 初始都设为full，后面会调整
        allocatedWidth: 0,
        startX: 0,
        originalIndex: segmentIndex++ // 🎯 记录原始索引
      });

      // 移动到下一个段
      currentTime = segmentStart;
    }
    
    if (safetyCounter >= MAX_ITERATIONS) {
      console.error('⚠️ 时间分段循环达到最大迭代次数，强制终止');
    }

    console.log('创建了', segments.length, '个时间段');

    // 保存所有段用于后续拖动
    this.allSegments = segments;

    // 3. 计算布局分配（默认观察窗口在最前面）
    return this.allocateSegmentLayout(segments, containerWidth, 0);
  }

  /**
   * 分配段的布局空间
   * @param segments 所有时间段
   * @param containerWidth 容器宽度
   * @param observationStartIndex 观察窗口起始段索引（默认0）
   */
  private allocateSegmentLayout(
    segments: TimeSegment[], 
    containerWidth: number, 
    observationStartIndex: number = 0
  ): LayoutResult {
    const availableWidth = containerWidth - 100; // 留出边距
    const startX = 50;

    console.log('布局分配:', {
      总段数: segments.length,
      总可用宽度: availableWidth
    });

    // 🎯 关键逻辑：判断是否需要压缩
    // 计算如果所有段都以full模式显示需要的总宽度
    const fullModeRequiredWidth = segments.length * this.NODE_WIDTHS.full;
    const needCompression = fullModeRequiredWidth > availableWidth;

    console.log('压缩判断:', {
      全节点所需宽度: fullModeRequiredWidth,
      可用宽度: availableWidth,
      需要压缩: needCompression
    });

    let normalSegments: TimeSegment[] = [];
    let compressedSegments: TimeSegment[] = [];
    let currentX = startX;

    if (!needCompression) {
      // ✅ 不需要压缩：所有段都以full模式显示
      // 🎯 固定条带宽度为 NODE_WIDTHS.full，右侧留白
      const segmentWidth = this.NODE_WIDTHS.full;
      
      segments.forEach(segment => {
        segment.displayMode = 'full';
        segment.allocatedWidth = segmentWidth;
        segment.startX = currentX;
        currentX += segmentWidth;
      });
      
      normalSegments = segments;
      compressedSegments = [];
      
      console.log('✅ 无需压缩，所有段以固定全节点宽度显示，右侧留白');
    } else {
      // ⚠️ 需要压缩：应用70/30原则
      const maxCompressedWidth = availableWidth * this.MAX_COMPRESSED_RATIO;
      const normalDisplayWidth = availableWidth - maxCompressedWidth;

      // 计算正常显示能容纳多少个段
      const maxNormalSegments = Math.floor(normalDisplayWidth / this.NODE_WIDTHS.full);
      
      // 🎯 根据observationStartIndex确定哪些段是正常显示
      // 确保不会超出范围
      const safeStartIndex = Math.max(0, Math.min(observationStartIndex, segments.length - maxNormalSegments));
      const endIndex = safeStartIndex + maxNormalSegments;
      
      // 分为三部分：前压缩段、正常段、后压缩段
      const beforeSegments = segments.slice(0, safeStartIndex);
      normalSegments = segments.slice(safeStartIndex, endIndex);
      const afterSegments = segments.slice(endIndex);
      compressedSegments = [...beforeSegments, ...afterSegments];

      console.log('⚠️ 需要压缩:', {
        正常显示区域: normalDisplayWidth,
        压缩区域: maxCompressedWidth,
        观察窗口起始索引: safeStartIndex,
        前压缩段数: beforeSegments.length,
        正常显示段数: normalSegments.length,
        后压缩段数: afterSegments.length
      });

      // 🎨 先渲染前面的压缩段
      if (beforeSegments.length > 0) {
        const beforeCompressedWidth = beforeSegments.length > 0 
          ? (maxCompressedWidth * beforeSegments.length / compressedSegments.length) 
          : 0;
        const beforeSegmentWidth = beforeCompressedWidth / beforeSegments.length;
        
        // 🎯 压缩级别：short → icon → dot（最小）
        let displayMode: 'short' | 'icon' | 'dot' = 'short';
        if (beforeSegmentWidth < this.NODE_WIDTHS.short) displayMode = 'icon';
        if (beforeSegmentWidth < this.NODE_WIDTHS.icon) displayMode = 'dot';

        beforeSegments.forEach(segment => {
          segment.displayMode = displayMode;
          segment.allocatedWidth = beforeSegmentWidth;
          segment.startX = currentX;
          currentX += beforeSegmentWidth;
        });
      }

      // 🎨 渲染正常显示段
      const normalSegmentWidth = normalSegments.length > 0 ? normalDisplayWidth / normalSegments.length : 0;

      normalSegments.forEach(segment => {
        segment.displayMode = 'full';
        segment.allocatedWidth = normalSegmentWidth;
        segment.startX = currentX;
        currentX += normalSegmentWidth;
      });

      // 🎨 渲染后面的压缩段
      if (afterSegments.length > 0) {
        const afterCompressedWidth = afterSegments.length > 0 
          ? (maxCompressedWidth * afterSegments.length / compressedSegments.length) 
          : 0;
        const afterSegmentWidth = afterCompressedWidth / afterSegments.length;
        
        // 🎯 压缩级别：short → icon → dot（最小）
        let displayMode: 'short' | 'icon' | 'dot' = 'short';
        if (afterSegmentWidth < this.NODE_WIDTHS.short) displayMode = 'icon';
        if (afterSegmentWidth < this.NODE_WIDTHS.icon) displayMode = 'dot';

        afterSegments.forEach(segment => {
          segment.displayMode = displayMode;
          segment.allocatedWidth = afterSegmentWidth;
          segment.startX = currentX;
          currentX += afterSegmentWidth;
        });
      }
    }

    // 创建时间轴数据（与节点布局完全一致）
    const timeAxisData = {
      startX: 50,
      endX: currentX,
      y: 100,
      segments: [...normalSegments, ...compressedSegments]
    };

    return {
      segments: [...normalSegments, ...compressedSegments],
      normalDisplaySegments: normalSegments,
      compressedSegments,
      totalWidth: currentX,
      timeAxisData
    };
  }

  /**
   * 创建SVG分组结构
   */
  private createSVGGroups(container: any) {
    return {
      timeAxisGroup: container.append('g').attr('class', 'time-axis-group'),
      connectionsGroup: container.append('g').attr('class', 'connections-group'),
      nodesGroup: container.append('g').attr('class', 'nodes-group'),
      focusOverlayGroup: container.append('g').attr('class', 'focus-overlay-group')
    };
  }

  /**
   * 渲染时间轴（与节点布局完全一致）+ V2样式：明暗条带
   */
  private renderTimeAxis(group: any, layout: LayoutResult): void {
    console.log('🕐 渲染时间轴（带明暗条带和横线）');

    // 🎨 创建分组结构
    const backgroundGroup = group.append('g').attr('class', 'time-axis-backgrounds');
    const axisLineGroup = group.append('g').attr('class', 'time-axis-line');
    const labelGroup = group.append('g').attr('class', 'time-axis-labels');

    // � 时间轴横线位置
    const timeAxisY = 80; // 时间轴横线的Y坐标（降低避免与顶部图标重叠）
    const stripTop = 0; // 条带从顶部开始
    const stripHeight = this.height; // 条带高度（覆盖整个高度）
    
    // 🎨 添加明暗条带背景 - 从顶部延伸到底部
    layout.segments.forEach((segment) => {
      // 🎯 使用原始索引决定明暗，保证条带颜色不会因为拖动而改变
      const isEven = segment.originalIndex % 2 === 0;
      
      // 竖向条带背景 - 覆盖整个高度
      backgroundGroup.append('rect')
        .attr('x', segment.startX)
        .attr('y', stripTop)
        .attr('width', segment.allocatedWidth)
        .attr('height', stripHeight)
        .attr('fill', isEven ? '#f0f2f5' : '#ffffff')  // 基于原始索引交替灰白
        .attr('opacity', 0.8)
        .attr('class', `time-strip time-strip-${segment.originalIndex}`)
        .attr('data-time', new Date(segment.endTime).toISOString());
    });

    // 🎯 绘制时间轴横线（带箭头）- 使用所有条带确保完整
    const allSegments = this.allSegments.length > 0 ? this.allSegments : layout.segments;
    const firstSegment = allSegments[0];
    const lastSegment = allSegments[allSegments.length - 1];
    const lineStartX = firstSegment.startX;
    const lineEndX = lastSegment.startX + lastSegment.allocatedWidth;
    
    // 主时间轴线
    axisLineGroup.append('line')
      .attr('x1', lineStartX)
      .attr('y1', timeAxisY)
      .attr('x2', lineEndX)
      .attr('y2', timeAxisY)
      .attr('stroke', '#666')
      .attr('stroke-width', 2)
      .attr('class', 'time-axis-main-line');
    
    // 右侧箭头
    const arrowSize = 8;
    axisLineGroup.append('polygon')
      .attr('points', `${lineEndX},${timeAxisY} ${lineEndX - arrowSize},${timeAxisY - arrowSize/2} ${lineEndX - arrowSize},${timeAxisY + arrowSize/2}`)
      .attr('fill', '#666')
      .attr('class', 'time-axis-arrow');

    // 🎯 时间标签在横线上方
    layout.segments.forEach((segment) => {
      if (segment.displayMode === 'full' || segment.displayMode === 'short') {
        const timeLabel = new Date(segment.endTime).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        });

        // 刻度线（向下）
        labelGroup.append('line')
          .attr('x1', segment.startX + segment.allocatedWidth / 2)
          .attr('y1', timeAxisY)
          .attr('x2', segment.startX + segment.allocatedWidth / 2)
          .attr('y2', timeAxisY + 5)
          .attr('stroke', '#999')
          .attr('stroke-width', 1);

        // 时间标签在横线上方
        labelGroup.append('text')
          .attr('x', segment.startX + segment.allocatedWidth / 2)
          .attr('y', timeAxisY - 8) // 横线上方
          .attr('text-anchor', 'middle')
          .attr('font-size', '11px')
          .attr('font-weight', 'bold')
          .attr('fill', '#666')
          .text(timeLabel);
      }
    });
  }

  /**
   * 按段渲染节点
   */
  private renderSegmentNodes(group: any, layout: LayoutResult): void {
    console.log('🎯 渲染段节点，段数量:', layout.segments.length);

    let totalNodesRendered = 0;
    const MAX_NODES_TO_RENDER = 500; // 防止渲染过多节点

    layout.segments.forEach((segment, segIndex) => {
      if (totalNodesRendered >= MAX_NODES_TO_RENDER) {
        console.warn(`⚠️ 已渲染${totalNodesRendered}个节点，跳过剩余段`);
        return;
      }

      const segmentGroup = group.append('g').attr('class', `segment-${segment.displayMode}`);
      
      segment.nodes.forEach((node, index) => {
        if (totalNodesRendered >= MAX_NODES_TO_RENDER) {
          return;
        }
        this.renderSingleNode(segmentGroup, node, segment, index);
        totalNodesRendered++;
      });
    });

    console.log(`✅ 总共渲染了 ${totalNodesRendered} 个节点`);
  }

  /**
   * 渲染单个节点
   */
  private renderSingleNode(group: any, node: NavNode, segment: TimeSegment, index: number): void {
    const width = this.NODE_WIDTHS[segment.displayMode];
    const height = this.NODE_HEIGHTS[segment.displayMode];
    
    const timeAxisY = 80; // 时间轴横线的Y坐标
    const startGap = 15; // 时间轴下方的起始间隔
    
    let nodeX: number;
    let nodeY: number;
    
    // 🎯 根据显示模式决定布局方式
    if (segment.displayMode === 'full' || segment.displayMode === 'short') {
      // 全节点和短节点：纵向堆叠
      const centerOffset = (segment.allocatedWidth - width) / 2;
      nodeX = segment.startX + Math.max(0, centerOffset);
      nodeY = timeAxisY + startGap + (index * (height + 8)); // 纵向，间隔8px
    } else {
      // 图标节点和圆点节点：横向排列+换行
      const itemsPerRow = Math.floor(segment.allocatedWidth / (width + 2)); // 每行能放多少个，间隔2px
      const row = Math.floor(index / Math.max(1, itemsPerRow)); // 第几行
      const col = index % Math.max(1, itemsPerRow); // 第几列
      
      const horizontalGap = 2; // 横向间隔
      const verticalGap = 2; // 纵向间隔
      
      nodeX = segment.startX + (col * (width + horizontalGap));
      nodeY = timeAxisY + startGap + (row * (height + verticalGap));
    }

    const nodeGroup = group.append('g')
      .attr('class', 'navigation-node')
      .attr('transform', `translate(${nodeX}, ${nodeY})`);

    // 根据显示模式渲染不同的节点样式
    if (segment.displayMode === 'full') {
      this.renderFullNode(nodeGroup, node, width, height);
    } else if (segment.displayMode === 'short') {
      this.renderShortNode(nodeGroup, node, width, height);
    } else if (segment.displayMode === 'icon') {
      this.renderIconNode(nodeGroup, node, width, height);
    } else if (segment.displayMode === 'dot') {
      this.renderDotNode(nodeGroup, node, width, height);
    }
  }

  /**
   * 渲染完整节点 - V2样式：图标 + 标题
   */
  private renderFullNode(group: any, node: NavNode, width: number, height: number): void {
    // 背景矩形
    group.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 3)
      .attr('fill', '#f0f0f0')
      .attr('stroke', '#ddd')
      .style('cursor', 'pointer');

    // 🎯 图标（favicon）
    const iconSize = 16;
    const iconX = 6;
    const iconY = (height - iconSize) / 2;
    
    if (node.favicon) {
      group.append('image')
        .attr('x', iconX)
        .attr('y', iconY)
        .attr('width', iconSize)
        .attr('height', iconSize)
        .attr('href', node.favicon)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('pointer-events', 'none')
        .on('error', function(this: SVGImageElement) {
          // 如果图标加载失败，显示默认圆形
          d3.select(this).remove();
          group.append('circle')
            .attr('cx', iconX + iconSize / 2)
            .attr('cy', iconY + iconSize / 2)
            .attr('r', iconSize / 2)
            .attr('fill', '#ccc')
            .attr('stroke', '#999')
            .attr('stroke-width', 1)
            .style('pointer-events', 'none');
        });
    } else {
      // 默认图标（圆形占位符）
      group.append('circle')
        .attr('cx', iconX + iconSize / 2)
        .attr('cy', iconY + iconSize / 2)
        .attr('r', iconSize / 2)
        .attr('fill', '#ccc')
        .attr('stroke', '#999')
        .attr('stroke-width', 1)
        .style('pointer-events', 'none');
    }

    // 🎯 标题文本（图标右侧）
    const title = node.title || this.getNodeLabel(node);
    const textX = iconX + iconSize + 4; // 图标 + 间隔
    const textWidth = width - textX - 6; // 剩余宽度
    
    group.append('text')
      .attr('x', textX)
      .attr('y', height / 2 + 4)
      .attr('font-size', '11px')
      .attr('fill', '#333')
      .text(this.truncateText(title, Math.floor(textWidth / 6))) // 大约6px每个字符
      .style('pointer-events', 'none');
    
    // 🎯 添加点击事件
    group.style('cursor', 'pointer')
      .on('click', () => {
        this.visualizer.showNodeDetails(node);
      });
  }

  /**
   * 截断文本
   */
  private truncateText(text: string, maxLength: number): string {
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }

  /**
   * 截断URL显示域名
   */
  private truncateUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      return domain.length > 15 ? domain.substring(0, 12) + '...' : domain;
    } catch {
      return url.length > 15 ? url.substring(0, 12) + '...' : url;
    }
  }

  /**
   * 渲染简短节点 - V2样式：只显示标题
   */
  private renderShortNode(group: any, node: NavNode, width: number, height: number): void {
    group.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 2)
      .attr('fill', '#e8e8e8')
      .attr('stroke', '#ccc')
      .style('cursor', 'pointer');

    const label = node.title || this.getNodeLabel(node);
    const maxChars = Math.floor(width / 5.5); // 大约5.5px每个字符
    
    group.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2 + 3)
      .attr('font-size', '9px')
      .attr('fill', '#555')
      .attr('text-anchor', 'middle')
      .text(this.truncateText(label, maxChars))
      .style('pointer-events', 'none');
    
    // 🎯 添加点击事件
    group.style('cursor', 'pointer')
      .on('click', () => {
        this.visualizer.showNodeDetails(node);
      });
  }

  /**
   * 渲染图标节点 - V2样式：显示favicon，横向排列+换行
   */
  private renderIconNode(group: any, node: NavNode, width: number, height: number): void {
    const iconSize = Math.min(width, height) - 2;
    
    if (node.favicon) {
      group.append('image')
        .attr('x', (width - iconSize) / 2)
        .attr('y', (height - iconSize) / 2)
        .attr('width', iconSize)
        .attr('height', iconSize)
        .attr('href', node.favicon)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('pointer-events', 'none')
        .on('error', function(this: SVGImageElement) {
          // 如果图标加载失败，显示默认圆形
          d3.select(this).remove();
          group.append('circle')
            .attr('cx', width / 2)
            .attr('cy', height / 2)
            .attr('r', iconSize / 2)
            .attr('fill', '#d0d0d0')
            .attr('stroke', '#aaa')
            .attr('stroke-width', 0.5)
            .style('pointer-events', 'none');
        });
    } else {
      // 默认圆形图标
      group.append('circle')
        .attr('cx', width / 2)
        .attr('cy', height / 2)
        .attr('r', iconSize / 2)
        .attr('fill', '#d0d0d0')
        .attr('stroke', '#aaa')
        .attr('stroke-width', 0.5)
        .style('pointer-events', 'none');
    }
    
    // 🎯 添加点击事件
    group.style('cursor', 'pointer')
      .on('click', () => {
        this.visualizer.showNodeDetails(node);
      });
  }

  /**
   * 渲染圆点节点 - 压缩的小圆点
   */
  private renderDotNode(group: any, node: NavNode, width: number, height: number): void {
    const radius = Math.min(width, height) / 2;
    
    group.append('circle')
      .attr('cx', width / 2)
      .attr('cy', height / 2)
      .attr('r', radius)
      .attr('fill', '#999')
      .attr('stroke', 'none');
  }

  /**
   * 渲染连接线 - V2样式：连接同一标签页的节点
   */
  private renderConnections(group: any, layout: LayoutResult): void {
    console.log('🔗 渲染连接线');
    
    // 收集所有节点并按标签页分组
    const nodesByTab = new Map<number, Array<{ node: NavNode; x: number; y: number }>>();
    
    layout.normalDisplaySegments.forEach(segment => {
      segment.nodes.forEach(node => {
        const tabId = node.tabId || 0;
        if (!nodesByTab.has(tabId)) {
          nodesByTab.set(tabId, []);
        }
        nodesByTab.get(tabId)!.push({
          node,
          x: segment.startX + 60, // 节点中心位置
          y: layout.timeAxisData.y + 40
        });
      });
    });
    
    layout.compressedSegments.forEach(segment => {
      segment.nodes.forEach(node => {
        const tabId = node.tabId || 0;
        if (!nodesByTab.has(tabId)) {
          nodesByTab.set(tabId, []);
        }
        nodesByTab.get(tabId)!.push({
          node,
          x: segment.startX + 60,
          y: layout.timeAxisData.y + 40
        });
      });
    });
    
    // 为每个标签页的节点绘制连接线
    nodesByTab.forEach(tabNodes => {
      if (tabNodes.length < 2) return;
      
      // 按时间排序
      tabNodes.sort((a, b) => a.node.timestamp - b.node.timestamp);
      
      // 连接相邻节点
      for (let i = 1; i < tabNodes.length; i++) {
        const prev = tabNodes[i - 1];
        const curr = tabNodes[i];
        
        group.append('line')
          .attr('x1', prev.x)
          .attr('y1', prev.y)
          .attr('x2', curr.x)
          .attr('y2', curr.y)
          .attr('stroke', '#ccc')
          .attr('stroke-width', 1)
          .attr('opacity', 0.5);
      }
    });
  }

  /**
   * 渲染观察窗口滑块 - 在时间轴横线上滑动
   */
  private renderObservationWindowSlider(group: any, layout: LayoutResult): void {
    console.log('🎚️ 渲染观察窗口滑块');

    const timeAxisY = 80; // 时间轴横线的Y坐标（与renderTimeAxis保持一致）
    const sliderHeight = 16; // 滑块高度（更扁平，适合在线上）
    const sliderY = timeAxisY - sliderHeight / 2; // 居中在时间轴线上

    // 🎯 关键逻辑：判断是否有压缩段
    const hasCompression = layout.compressedSegments.length > 0;
    
    if (!hasCompression) {
      // ✅ 无压缩情况：观察窗口覆盖所有条带的实际宽度
      console.log('✅ 无压缩，观察窗口覆盖所有条带实际宽度');
      
      const firstSegment = layout.segments[0];
      const lastSegment = layout.segments[layout.segments.length - 1];
      const windowStartX = firstSegment.startX;
      const windowEndX = lastSegment.startX + lastSegment.allocatedWidth;
      const windowWidth = windowEndX - windowStartX;

      // 观察窗口滑块 - 虚线边框表示全覆盖
      group.append('rect')
        .attr('class', 'observation-slider-full')
        .attr('x', windowStartX)
        .attr('y', sliderY)
        .attr('width', windowWidth)
        .attr('height', sliderHeight)
        .attr('rx', sliderHeight / 2)
        .attr('ry', sliderHeight / 2)
        .attr('fill', 'rgba(0, 123, 255, 0.1)')
        .attr('stroke', '#007bff')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,4')
        .style('cursor', 'default');

      // 标签
      group.append('text')
        .attr('x', windowStartX + windowWidth / 2)
        .attr('y', sliderY + sliderHeight / 2 + 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#007bff')
        .attr('font-weight', 'bold')
        .text('全部可见');

      this.observationWindow = {
        centerSegmentIndex: 0,
        startX: windowStartX,
        width: windowWidth,
        segments: layout.segments
      };
      
      return;
    }

    // ⚠️ 有压缩情况：观察窗口只覆盖正常显示区域，可拖动
    console.log('⚠️ 有压缩，观察窗口在时间轴上滑动');
    
    if (layout.normalDisplaySegments.length === 0) {
      return;
    }

    const windowStartX = layout.normalDisplaySegments[0].startX;
    const windowEndX = layout.normalDisplaySegments[layout.normalDisplaySegments.length - 1].startX + 
                      layout.normalDisplaySegments[layout.normalDisplaySegments.length - 1].allocatedWidth;
    const windowWidth = windowEndX - windowStartX;

    // 可拖动的观察窗口滑块 - 在时间轴上
    const observationRect = group.append('rect')
      .attr('class', 'observation-slider')
      .attr('x', windowStartX)
      .attr('y', sliderY)
      .attr('width', windowWidth)
      .attr('height', sliderHeight)
      .attr('rx', sliderHeight / 2)
      .attr('ry', sliderHeight / 2)
      .attr('fill', 'rgba(0, 123, 255, 0.2)')
      .attr('stroke', '#007bff')
      .attr('stroke-width', 2)
      .style('cursor', 'grab');

    // 标签
    const observationText = group.append('text')
      .attr('x', windowStartX + windowWidth / 2)
      .attr('y', sliderY + sliderHeight / 2 + 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#007bff')
      .attr('font-weight', 'bold')
      .text('观察窗口');

    this.observationWindow = {
      centerSegmentIndex: Math.floor(layout.normalDisplaySegments.length / 2),
      startX: windowStartX,
      width: windowWidth,
      segments: layout.normalDisplaySegments
    };

    // 🎯 添加拖动功能
    this.setupObservationWindowDrag(observationRect, observationText, layout);
  }

  /**
   * 设置观察窗口拖动功能
   */
  private setupObservationWindowDrag(rect: any, text: any, layout: LayoutResult): void {
    const self = this;
    let isDragging = false;
    let startX = 0;
    let currentObservationStartIndex = 0;

    // 计算当前观察窗口起始段索引
    if (layout.normalDisplaySegments.length > 0) {
      const firstNormalSegment = layout.normalDisplaySegments[0];
      currentObservationStartIndex = this.allSegments.findIndex(s => s === firstNormalSegment);
    }

    // 🎯 计算最大可拖动的起始索引（确保最后几个段也能被观察）
    const maxObservationStartIndex = Math.max(0, this.allSegments.length - layout.normalDisplaySegments.length);

    const drag = d3.drag()
      .on('start', function(event: any) {
        isDragging = true;
        startX = event.x;
        rect.style('cursor', 'grabbing');
        console.log('🖱️ 开始拖动观察窗口');
      })
      .on('drag', function(event: any) {
        const dx = event.x - startX;
        const currentX = parseFloat(rect.attr('x'));
        const newX = currentX + dx;
        
        // 🎯 限制拖动范围：从第一个段的起始位置到最后能完整显示观察窗口的位置
        const firstSegment = self.allSegments[0];
        const lastValidSegment = self.allSegments[maxObservationStartIndex];
        
        const minX = firstSegment ? firstSegment.startX : layout.timeAxisData.startX;
        const observationWindowWidth = parseFloat(rect.attr('width'));
        
        // 🧲✨ 统一的双向吸附逻辑
        const snapThreshold = 8;
        let targetX = newX;
        let snappedToLeft = false;   // 左边界是否吸附
        let snappedToRight = false;  // 右边界是否吸附
        let leftSnapX = newX;
        let rightSnapX = newX;
        let leftDistance = Infinity;
        let rightDistance = Infinity;
        
        // 🎯 检测左边界吸附（窗口左边 vs 所有条带左边）
        const windowLeftEdge = newX;
        for (let i = 0; i < self.allSegments.length; i++) {
          const segment = self.allSegments[i];
          if (segment) {
            const segmentLeftEdge = segment.startX;
            const distance = Math.abs(windowLeftEdge - segmentLeftEdge);
            
            if (distance < snapThreshold && distance < leftDistance) {
              leftSnapX = segmentLeftEdge;
              leftDistance = distance;
              snappedToLeft = true;
            }
          }
        }
        
        // 🎯 检测右边界吸附（窗口右边 vs 所有条带右边）
        const windowRightEdge = newX + observationWindowWidth;
        for (let i = 0; i < self.allSegments.length; i++) {
          const segment = self.allSegments[i];
          if (segment) {
            const segmentRightEdge = segment.startX + segment.allocatedWidth;
            const distance = Math.abs(windowRightEdge - segmentRightEdge);
            
            if (distance < snapThreshold && distance < rightDistance) {
              rightSnapX = segmentRightEdge - observationWindowWidth;
              rightDistance = distance;
              snappedToRight = true;
            }
          }
        }
        
        // 🎯 决定最终使用哪个吸附（防止抖动的关键逻辑）
        if (snappedToLeft && snappedToRight) {
          // 🎯✨ 同时触发两个吸附：只选择距离最近的那个，完全忽略另一个
          // 这样可以避免两个吸附逻辑互相干扰造成抖动
          if (leftDistance < rightDistance) {
            // 左边界更近，只吸附左边界
            targetX = leftSnapX;
            self.lastDragSnapped = true;
            console.log('🧲 双向吸附触发，选择左边界 (距离:', leftDistance.toFixed(2), 'px)');
          } else if (rightDistance < leftDistance) {
            // 右边界更近，只吸附右边界
            targetX = rightSnapX;
            self.lastDragSnapped = true;
            console.log('🧲 双向吸附触发，选择右边界 (距离:', rightDistance.toFixed(2), 'px)');
          } else {
            // 距离相等（极少情况），默认优先左边界
            targetX = leftSnapX;
            self.lastDragSnapped = true;
            console.log('🧲 双向吸附触发，距离相等，默认选择左边界');
          }
        } else if (snappedToLeft) {
          // 只有左边界吸附
          targetX = leftSnapX;
          self.lastDragSnapped = true;
        } else if (snappedToRight) {
          // 只有右边界吸附
          targetX = rightSnapX;
          self.lastDragSnapped = true;
        } else {
          // 没有吸附
          self.lastDragSnapped = false;
        }
        
        // 🎯 应用边界限制
        let maxX = lastValidSegment ? lastValidSegment.startX : layout.timeAxisData.startX;
        
        // 如果吸附位置超出了原本的边界，扩展边界以允许吸附
        if (self.lastDragSnapped && targetX > maxX) {
          maxX = targetX;
        }
        
        const clampedX = Math.max(minX, Math.min(maxX, targetX));
        
        // 视觉反馈
        if (self.lastDragSnapped) {
          rect.style('cursor', 'grabbing').attr('stroke-width', 3);
        } else {
          rect.attr('stroke-width', 2);
        }
        
        rect.attr('x', clampedX);
        text.attr('x', clampedX + observationWindowWidth / 2);
        
        startX = event.x;
      })
      .on('end', function(event: any) {
        isDragging = false;
        rect.style('cursor', 'grab')
            .attr('stroke-width', 2); // 恢复正常边框
        
        // 🎯 根据最终位置计算新的观察窗口起始索引
        const finalX = parseFloat(rect.attr('x'));
        const observationWindowWidth = parseFloat(rect.attr('width'));
        
        // 🎯✨ 全新的索引计算逻辑
        // 核心问题：我们不能用旧布局的视觉位置来计算，因为条带宽度是变化的
        // 
        // 新思路：
        // 1. 观察窗口的宽度是固定的（observationWindowWidth）
        // 2. 计算观察窗口能容纳多少个全尺寸条带
        // 3. 计算观察窗口在整个时间轴上的相对位置（百分比）
        // 4. 根据相对位置确定应该从哪个原始条带开始展开
        
        const windowLeftEdge = finalX;
        const windowRightEdge = finalX + observationWindowWidth;
        
        // 🎯 方法：计算窗口左边界相对于整个时间轴的位置比例
        // 获取时间轴的总范围
        const timeAxisStart = self.allSegments[0].startX;
        const lastSegment = self.allSegments[self.allSegments.length - 1];
        const timeAxisEnd = lastSegment.startX + lastSegment.allocatedWidth;
        const totalWidth = timeAxisEnd - timeAxisStart;
        
        // 窗口左边界在时间轴上的相对位置（0-1之间）
        const relativePosition = (windowLeftEdge - timeAxisStart) / totalWidth;
        
        // 根据相对位置计算应该从哪个原始条带开始
        // 使用四舍五入确保准确性
        const totalSegments = self.allSegments.length;
        let newStartIndex = Math.round(relativePosition * totalSegments);
        
        // 边界检查
        newStartIndex = Math.max(0, Math.min(newStartIndex, totalSegments - 1));
        
        console.log('🎯 拖动结束，计算新索引:', {
          观察窗口X: finalX,
          观察窗口宽度: observationWindowWidth,
          窗口左边界: windowLeftEdge,
          窗口右边界: windowRightEdge,
          时间轴起点: timeAxisStart,
          时间轴终点: timeAxisEnd,
          时间轴总宽度: totalWidth,
          相对位置: (relativePosition * 100).toFixed(2) + '%',
          总条带数: totalSegments,
          计算出的新索引: newStartIndex,
          是否吸附: self.lastDragSnapped
        });
        
        // 🎯✨ 如果发生了吸附，不需要微调动画（已经在正确位置）
        // 如果没有吸附，执行微调动画让窗口对齐到段的左边界
        let needsAnimation = false;
        if (!self.lastDragSnapped) {
          const targetSegment = self.allSegments[newStartIndex];
          if (targetSegment) {
            const targetX = targetSegment.startX;
            const currentX = parseFloat(rect.attr('x'));
            
            // 如果位置不完全精确，添加微调动画
            if (Math.abs(currentX - targetX) > 0.5) {
              needsAnimation = true;
              rect.transition()
                .duration(150)
                .ease(d3.easeQuadOut)
                .attr('x', targetX);
              
              text.transition()
                .duration(150)
                .ease(d3.easeQuadOut)
                .attr('x', targetX + parseFloat(rect.attr('width')) / 2);
            }
          }
        }
        
        console.log('🖱️ 拖动结束，重新计算布局:', {
          原索引: currentObservationStartIndex,
          新索引: newStartIndex,
          最大索引: maxObservationStartIndex,
          需要动画: needsAnimation,
          发生吸附: self.lastDragSnapped
        });
        
        if (newStartIndex !== currentObservationStartIndex) {
          currentObservationStartIndex = newStartIndex;
          
          // 🎯✨ 如果发生了吸附，立即重新布局；否则等待微调动画完成
          if (self.lastDragSnapped || !needsAnimation) {
            // 吸附情况：立即重新渲染
            self.reRenderWithObservationWindow(newStartIndex);
          } else {
            // 非吸附情况：延迟重新布局，等待微调动画完成
            setTimeout(() => {
              self.reRenderWithObservationWindow(newStartIndex);
            }, 200);
          }
        }
      });

    rect.call(drag);
  }

  /**
   * 根据X坐标计算观察窗口应该从哪个段开始
   */
  private calculateObservationStartIndex(x: number, layout: LayoutResult): number {
    // 找到X坐标对应的段
    for (let i = 0; i < this.allSegments.length; i++) {
      const segment = this.allSegments[i];
      if (segment.startX <= x && x < segment.startX + segment.allocatedWidth) {
        return i;
      }
    }
    return 0;
  }

  /**
   * 根据新的观察窗口位置重新渲染
   */
  private reRenderWithObservationWindow(observationStartIndex: number): void {
    console.log('🔄 根据新观察窗口位置重新渲染，起始索引:', observationStartIndex);
    
    // 重新计算布局
    const newLayout = this.allocateSegmentLayout(this.allSegments, this.width, observationStartIndex);
    this.currentLayout = newLayout;

    // 清空并重新渲染
    this.svg.selectAll('*').remove();
    const mainGroup = this.createSVGGroups(this.svg);

    // 渲染各个部分
    this.renderTimeAxis(mainGroup.timeAxisGroup, newLayout);
    this.renderSegmentNodes(mainGroup.nodesGroup, newLayout);
    this.renderConnections(mainGroup.connectionsGroup, newLayout);
    this.renderObservationWindowSlider(mainGroup.focusOverlayGroup, newLayout);
  }

  /**
   * 获取节点标签
   */
  private getNodeLabel(node: NavNode): string {
    if (!node.url) {
      return 'Unknown';
    }
    try {
      const url = new URL(node.url);
      return url.pathname.split('/').pop() || url.hostname;
    } catch {
      return node.url.substring(0, 20);
    }
  }

  /**
   * 移动观察窗口（用于交互）
   */
  public moveObservationWindow(direction: 'left' | 'right'): void {
    if (!this.currentLayout || !this.observationWindow) {
      return;
    }

    // TODO: 实现观察窗口移动逻辑
    // 这将重新计算布局并重新渲染
    console.log('移动观察窗口:', direction);
  }
}