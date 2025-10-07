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
    const validNodes = nodes.filter(node => {
      if (!node.timestamp || typeof node.timestamp !== 'number' || isNaN(node.timestamp)) {
        console.warn('⚠️ 发现无效时间戳的节点，已过滤:', node);
        return false;
      }
      return true;
    });

    if (validNodes.length === 0) {
      logger.warn('所有节点的时间戳都无效');
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

    // 1. 找到时间范围
    const times = nodes.map(node => node.timestamp).sort((a, b) => b - a); // 最新的在前
    const maxTime = times[0];
    const minTime = times[times.length - 1];
    
    console.log('时间范围:', {
      最新: new Date(maxTime).toLocaleTimeString(),
      最旧: new Date(minTime).toLocaleTimeString()
    });

    // 2. 创建时间分段（从最新时间开始，按5分钟分段）
    const segments: TimeSegment[] = [];
    let currentTime = maxTime;
    let safetyCounter = 0; // 防止无限循环
    const MAX_ITERATIONS = 1000;
    
    while (currentTime > minTime && safetyCounter < MAX_ITERATIONS) {
      safetyCounter++;
      
      const segmentStart = currentTime;
      const segmentEnd = Math.max(currentTime - this.SEGMENT_DURATION, minTime);
      
      // 找到此段内的节点
      const segmentNodes = nodes.filter(node => 
        node.timestamp <= segmentStart && node.timestamp > segmentEnd
      );

      if (segmentNodes.length > 0) {
        segments.push({
          startTime: segmentEnd,
          endTime: segmentStart,
          nodes: segmentNodes,
          displayMode: 'full', // 初始都设为full，后面会调整
          allocatedWidth: 0,
          startX: 0
        });
      }

      // 确保currentTime减小，避免无限循环
      currentTime = segmentEnd;
      if (currentTime === segmentStart) {
        // 如果没有变化，强制退出
        break;
      }
    }
    
    if (safetyCounter >= MAX_ITERATIONS) {
      console.error('⚠️ 时间分段循环达到最大迭代次数，强制终止');
    }

    console.log('创建了', segments.length, '个时间段');

    // 3. 计算布局分配
    return this.allocateSegmentLayout(segments, containerWidth);
  }

  /**
   * 分配段的布局空间
   */
  private allocateSegmentLayout(segments: TimeSegment[], containerWidth: number): LayoutResult {
    const availableWidth = containerWidth - 100; // 留出边距
    const maxCompressedWidth = availableWidth * this.MAX_COMPRESSED_RATIO;
    const normalDisplayWidth = availableWidth - maxCompressedWidth;

    console.log('布局分配:', {
      总可用宽度: availableWidth,
      正常显示区域: normalDisplayWidth,
      最大压缩区域: maxCompressedWidth
    });

    // 计算正常显示能容纳多少个段
    const maxNormalSegments = Math.floor(normalDisplayWidth / this.NODE_WIDTHS.full);
    
    let normalSegments = segments.slice(0, maxNormalSegments);
    let compressedSegments = segments.slice(maxNormalSegments);

    console.log('段分配:', {
      正常显示段数: normalSegments.length,
      压缩段数: compressedSegments.length
    });

    // 为正常显示段分配空间
    const normalSegmentWidth = normalSegments.length > 0 ? normalDisplayWidth / normalSegments.length : 0;
    let currentX = 50; // 起始位置

    normalSegments.forEach(segment => {
      segment.displayMode = 'full';
      segment.allocatedWidth = normalSegmentWidth;
      segment.startX = currentX;
      currentX += normalSegmentWidth;
    });

    // 为压缩段分配空间和显示模式
    if (compressedSegments.length > 0) {
      const compressedSegmentWidth = maxCompressedWidth / compressedSegments.length;
      
      // 根据分配到的宽度决定显示模式
      let displayMode: 'short' | 'icon' | 'bar' = 'short';
      if (compressedSegmentWidth < this.NODE_WIDTHS.short) {
        displayMode = 'icon';
      }
      if (compressedSegmentWidth < this.NODE_WIDTHS.icon) {
        displayMode = 'bar';
      }

      compressedSegments.forEach(segment => {
        segment.displayMode = displayMode;
        segment.allocatedWidth = compressedSegmentWidth;
        segment.startX = currentX;
        currentX += compressedSegmentWidth;
      });
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
    const scaleGroup = group.append('g').attr('class', 'time-axis-scales');
    const labelGroup = group.append('g').attr('class', 'time-axis-labels');

    // 🎨 V2样式：添加明暗条带背景 - 每个段对应一个条带
    const stripHeight = this.height - 100; // 从顶部到时间轴上方的高度
    
    layout.segments.forEach((segment, index) => {
      backgroundGroup.append('rect')
        .attr('x', segment.startX)
        .attr('y', 60)  // 从导航栏下方开始
        .attr('width', segment.allocatedWidth)
        .attr('height', stripHeight)
        .attr('fill', index % 2 === 0 ? '#f0f2f5' : '#ffffff')  // 交替灰白
        .attr('opacity', 0.8)
        .attr('class', `time-strip time-strip-${index}`)
        .attr('data-time', new Date(segment.endTime).toISOString());
    });

    // 🎨 V2样式：绘制时间轴背景
    backgroundGroup.append('rect')
      .attr('class', 'waterfall-time-axis-background')
      .attr('x', 0)
      .attr('y', layout.timeAxisData.y - 20)
      .attr('width', this.width)
      .attr('height', 50)
      .attr('fill', '#f8f9fa')  // 浅灰色背景
      .attr('stroke', '#dee2e6')
      .attr('stroke-width', 1);

    // 绘制主轴线
    scaleGroup.append('line')
      .attr('x1', layout.timeAxisData.startX)
      .attr('x2', layout.timeAxisData.endX)
      .attr('y1', layout.timeAxisData.y)
      .attr('y2', layout.timeAxisData.y)
      .attr('stroke', '#e0e0e0')
      .attr('stroke-width', 1);

    // 为每个段添加时间刻度
    layout.segments.forEach(segment => {
      const centerX = segment.startX + segment.allocatedWidth / 2;
      
      // 刻度线
      scaleGroup.append('line')
        .attr('x1', centerX)
        .attr('x2', centerX)
        .attr('y1', layout.timeAxisData.y - 5)
        .attr('y2', layout.timeAxisData.y + 5)
        .attr('stroke', '#ccc');

      // 时间标签（根据显示模式调整）
      if (segment.displayMode === 'full' || segment.displayMode === 'short') {
        const timeLabel = new Date(segment.endTime).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        });

        labelGroup.append('text')
          .attr('x', centerX)
          .attr('y', layout.timeAxisData.y + 20)
          .attr('text-anchor', 'middle')
          .attr('font-size', '12px')
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
    
    // 在段内的位置分配
    const nodeX = segment.startX + (index * width);
    const nodeY = 150 + (index * (height + 5)); // 垂直堆叠

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

    if (layout.normalDisplaySegments.length === 0) {
      return;
    }

    // 观察窗口覆盖正常显示区域
    const windowStartX = layout.normalDisplaySegments[0].startX;
    const windowEndX = layout.normalDisplaySegments[layout.normalDisplaySegments.length - 1].startX + 
                      layout.normalDisplaySegments[layout.normalDisplaySegments.length - 1].allocatedWidth;
    const windowWidth = windowEndX - windowStartX;

    const windowY = layout.timeAxisData.y - 35;
    const windowHeight = 24;
    const radius = windowHeight / 2;

    // V2样式胶囊形状边框
    group.append('rect')
      .attr('class', 'observation-border')
      .attr('x', windowStartX)
      .attr('y', windowY)
      .attr('width', windowWidth)
      .attr('height', windowHeight)
      .attr('rx', radius)
      .attr('ry', radius)
      .attr('fill', 'rgba(0, 123, 255, 0.1)') // 淡蓝色填充
      .attr('stroke', '#007bff')
      .attr('stroke-width', 2)
      .style('cursor', 'grab');

    // 添加观察窗口标签
    group.append('text')
      .attr('x', windowStartX + windowWidth / 2)
      .attr('y', windowY + windowHeight / 2 + 4)
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