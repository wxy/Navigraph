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
  displayMode: 'full' | 'short' | 'icon' | 'bar';
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
    full: 150,
    short: 120,
    icon: 20,
    bar: 4
  };
  private readonly NODE_HEIGHTS = {
    full: 40,
    short: 25,
    icon: 20,
    bar: 12
  };

  private currentLayout: LayoutResult | null = null;
  private observationWindow: ObservationWindow | null = null;
  private svg: any;
  private container: HTMLElement | null = null;
  private width: number = 0;
  private height: number = 0;
  
  // 存储原始数据，用于拖动时重新计算布局
  private allSegments: TimeSegment[] = [];
  private renderOptions: any = null;

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
      const segmentWidth = availableWidth / segments.length;
      
      segments.forEach(segment => {
        segment.displayMode = 'full';
        segment.allocatedWidth = segmentWidth;
        segment.startX = currentX;
        currentX += segmentWidth;
      });
      
      normalSegments = segments;
      compressedSegments = [];
      
      console.log('✅ 无需压缩，所有段以全节点模式显示');
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
        
        let displayMode: 'short' | 'icon' | 'bar' = 'short';
        if (beforeSegmentWidth < this.NODE_WIDTHS.short) displayMode = 'icon';
        if (beforeSegmentWidth < this.NODE_WIDTHS.icon) displayMode = 'bar';

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
        
        let displayMode: 'short' | 'icon' | 'bar' = 'short';
        if (afterSegmentWidth < this.NODE_WIDTHS.short) displayMode = 'icon';
        if (afterSegmentWidth < this.NODE_WIDTHS.icon) displayMode = 'bar';

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
    console.log('🕐 渲染时间轴（带明暗条带）');

    // 🎨 V2样式：创建时间轴的子分组结构
    const backgroundGroup = group.append('g').attr('class', 'time-axis-backgrounds');
    const labelGroup = group.append('g').attr('class', 'time-axis-labels');

    // 🎨 V2样式：添加明暗条带背景 - 每个段对应一个竖向条带
    const stripTop = 40; // 条带顶部位置
    const stripHeight = this.height - 120; // 条带高度（留出底部空间）
    
    layout.segments.forEach((segment) => {
      // 🎯 使用原始索引决定明暗，保证条带颜色不会因为拖动而改变
      const isEven = segment.originalIndex % 2 === 0;
      
      // 竖向条带背景
      backgroundGroup.append('rect')
        .attr('x', segment.startX)
        .attr('y', stripTop)
        .attr('width', segment.allocatedWidth)
        .attr('height', stripHeight)
        .attr('fill', isEven ? '#f0f2f5' : '#ffffff')  // 基于原始索引交替灰白
        .attr('opacity', 0.8)
        .attr('class', `time-strip time-strip-${segment.originalIndex}`)
        .attr('data-time', new Date(segment.endTime).toISOString());

      // 🎯 时间标签在条带顶部
      if (segment.displayMode === 'full' || segment.displayMode === 'short') {
        const timeLabel = new Date(segment.endTime).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        });

        labelGroup.append('text')
          .attr('x', segment.startX + segment.allocatedWidth / 2) // 条带中央
          .attr('y', stripTop + 20) // 条带顶部下方20px
          .attr('text-anchor', 'middle') // 居中对齐
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
    
    // 🎯 瀑布布局：节点在条带内从顶部开始纵向堆叠
    // X坐标：条带起始位置 + 居中偏移
    const centerOffset = (segment.allocatedWidth - width) / 2;
    const nodeX = segment.startX + Math.max(0, centerOffset);
    
    // Y坐标：从条带顶部（时间标签下方）开始，纵向堆叠
    const stripTop = 40; // 条带顶部
    const labelHeight = 35; // 时间标签占用的高度
    const nodeY = stripTop + labelHeight + (index * (height + 8)); // 每个节点间隔8px

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
    } else if (segment.displayMode === 'bar') {
      this.renderBarNode(nodeGroup, node, width, height);
    }
  }

  /**
   * 渲染完整节点 - V2样式：显示标题和URL
   */
  private renderFullNode(group: any, node: NavNode, width: number, height: number): void {
    // 背景矩形
    group.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 3)
      .attr('fill', '#f0f0f0')
      .attr('stroke', '#ddd');

    // 标题文本
    const title = node.title || this.getNodeLabel(node);
    group.append('text')
      .attr('x', 6)
      .attr('y', 15)
      .attr('font-size', '11px')
      .attr('fill', '#333')
      .text(this.truncateText(title, 20));

    // URL文本
    if (node.url) {
      group.append('text')
        .attr('x', 6)
        .attr('y', 30)
        .attr('font-size', '9px')
        .attr('fill', '#666')
        .text(this.truncateUrl(node.url));
    }
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
   * 渲染简短节点 - V2样式
   */
  private renderShortNode(group: any, node: NavNode, width: number, height: number): void {
    group.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 2)
      .attr('fill', '#e8e8e8')
      .attr('stroke', '#ccc');

    const label = node.title || this.getNodeLabel(node);
    group.append('text')
      .attr('x', 4)
      .attr('y', height / 2 + 4)
      .attr('font-size', '9px')
      .attr('fill', '#555')
      .text(this.truncateText(label, 15));
  }

  /**
   * 渲染图标节点 - V2样式
   */
  private renderIconNode(group: any, node: NavNode, width: number, height: number): void {
    group.append('circle')
      .attr('cx', width / 2)
      .attr('cy', height / 2)
      .attr('r', Math.min(width, height) / 2 - 1)
      .attr('fill', '#d0d0d0')
      .attr('stroke', '#aaa')
      .attr('stroke-width', 0.5);
  }

  /**
   * 渲染条形节点 - V2样式
   */
  private renderBarNode(group: any, node: NavNode, width: number, height: number): void {
    group.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', '#c0c0c0')
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
   * 渲染观察窗口滑块 - V2胶囊形状样式 + V3逻辑
   */
  private renderObservationWindowSlider(group: any, layout: LayoutResult): void {
    console.log('🎚️ 渲染观察窗口滑块');

    // 🎯 关键逻辑：判断是否有压缩段
    const hasCompression = layout.compressedSegments.length > 0;
    
    if (!hasCompression) {
      // ✅ 无压缩情况：观察窗口覆盖整个时间轴，且不可拖动
      console.log('✅ 无压缩，观察窗口覆盖整个时间轴');
      
      const windowStartX = layout.timeAxisData.startX;
      const windowEndX = layout.timeAxisData.endX;
      const windowWidth = windowEndX - windowStartX;
      const windowY = 5;
      const windowHeight = 28;
      const radius = windowHeight / 2;

      // 观察窗口覆盖整个时间轴，使用更淡的颜色表示全覆盖状态
      group.append('rect')
        .attr('class', 'observation-border-full')
        .attr('x', windowStartX)
        .attr('y', windowY)
        .attr('width', windowWidth)
        .attr('height', windowHeight)
        .attr('rx', radius)
        .attr('ry', radius)
        .attr('fill', 'rgba(0, 123, 255, 0.05)') // 更淡的填充
        .attr('stroke', '#007bff')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '5,5') // 虚线边框
        .style('cursor', 'default'); // 不可拖动

      // 标签显示"全部可见"
      group.append('text')
        .attr('x', windowStartX + windowWidth / 2)
        .attr('y', windowY + windowHeight / 2 + 5)
        .attr('text-anchor', 'middle')
        .attr('font-size', '11px')
        .attr('fill', '#007bff')
        .attr('font-weight', 'bold')
        .text('全部可见');

      this.observationWindow = {
        centerSegmentIndex: 0,
        startX: windowStartX,
        width: windowWidth,
        segments: layout.segments // 所有段都可见
      };
      
      return;
    }

    // ⚠️ 有压缩情况：观察窗口只覆盖正常显示区域，可拖动
    console.log('⚠️ 有压缩，观察窗口覆盖正常显示区域');
    
    if (layout.normalDisplaySegments.length === 0) {
      return;
    }

    const windowStartX = layout.normalDisplaySegments[0].startX;
    const windowEndX = layout.normalDisplaySegments[layout.normalDisplaySegments.length - 1].startX + 
                      layout.normalDisplaySegments[layout.normalDisplaySegments.length - 1].allocatedWidth;
    const windowWidth = windowEndX - windowStartX;
    const windowY = 5;
    const windowHeight = 28;
    const radius = windowHeight / 2;

    // 可拖动的观察窗口
    const observationRect = group.append('rect')
      .attr('class', 'observation-border')
      .attr('x', windowStartX)
      .attr('y', windowY)
      .attr('width', windowWidth)
      .attr('height', windowHeight)
      .attr('rx', radius)
      .attr('ry', radius)
      .attr('fill', 'rgba(0, 123, 255, 0.1)') // 正常填充
      .attr('stroke', '#007bff')
      .attr('stroke-width', 2)
      .style('cursor', 'grab');

    // 标签显示"观察窗口"
    const observationText = group.append('text')
      .attr('x', windowStartX + windowWidth / 2)
      .attr('y', windowY + windowHeight / 2 + 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
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
        // 计算对应最大索引的段的起始X位置
        const firstSegment = self.allSegments[0];
        const lastValidSegment = self.allSegments[maxObservationStartIndex];
        
        const minX = firstSegment ? firstSegment.startX : layout.timeAxisData.startX;
        const maxX = lastValidSegment ? lastValidSegment.startX : layout.timeAxisData.startX;
        
        const clampedX = Math.max(minX, Math.min(maxX, newX));
        
        rect.attr('x', clampedX);
        text.attr('x', clampedX + parseFloat(rect.attr('width')) / 2);
        
        startX = event.x;
      })
      .on('end', function(event: any) {
        isDragging = false;
        rect.style('cursor', 'grab');
        
        // 🎯 根据最终位置计算新的观察窗口起始索引
        const finalX = parseFloat(rect.attr('x'));
        const newStartIndex = self.calculateObservationStartIndex(finalX, layout);
        
        console.log('🖱️ 拖动结束，重新计算布局:', {
          原索引: currentObservationStartIndex,
          新索引: newStartIndex,
          最大索引: maxObservationStartIndex
        });
        
        if (newStartIndex !== currentObservationStartIndex) {
          currentObservationStartIndex = newStartIndex;
          // 重新布局和渲染
          self.reRenderWithObservationWindow(newStartIndex);
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