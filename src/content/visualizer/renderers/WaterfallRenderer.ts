import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { NavNode, NavLink, Visualizer } from '../../types/navigation.js';
import { BaseRenderer } from './BaseRenderer.js';
import { saveViewState, getViewState } from '../../utils/state-manager.js';

const d3 = window.d3;
const logger = new Logger('WaterfallRenderer_v3');

/**
 * 瀑布渲染器 v3 - 基于正确的70/30布局原则
 * 
 * 核心设计思路：
 * 1. 以10分钟为单位将时间分段（避免条带过多导致压缩区域过窄）
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
  isFiller?: boolean;     // 🎯 标识是否为填充段（为了铺满而添加的空白段）
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

/**
 * 标签页生命周期 - 一个标签页从打开到关闭的完整周期
 */
interface TabLifecycle {
  tabId: string;           // 标签页 ID
  startTime: number;       // 标签页开始时间
  endTime: number;         // 标签页结束时间（关闭时间）
  isClosed: boolean;       // 是否已明确关闭
  nodes: NavNode[];        // 该周期内的所有节点
  closureMarkerTime?: number; // 关闭标记显示的时间（下一个时段）
}

/**
 * 关闭标记 - 表示标签页关闭的视觉标记
 */
interface ClosureMarker {
  tabId: string;           // 关闭的标签页 ID  
  timestamp: number;       // 显示时间（关闭后的下一个时段）
  swimlaneIndex: number;   // 所在泳道索引
}

/**
 * 泳道接口 - V2版本：支持多个标签页周期复用
 */
interface Swimlane {
  laneIndex: number;       // 泳道编号
  y: number;               // 泳道的 Y 坐标
  height: number;          // 泳道高度
  lifecycles: TabLifecycle[]; // 该泳道承载的多个标签页生命周期
  isAvailable: boolean;    // 当前是否可用于分配新标签页
  lastActivityTime: number; // 最后活动时间
}

/**
 * 泳道分配结果
 */
interface LaneAllocation {
  swimlanes: Swimlane[];   // 分配后的泳道列表
  closureMarkers: ClosureMarker[]; // 所有关闭标记
  totalTabCount: number;   // 总标签页数量
  reuseCount: number;      // 复用次数
}

/**
 * 折叠节点组 - 同一条带同一标签页的多个节点
 */
interface CollapsedNodeGroup {
  tabId: string;                    // 标签页 ID
  segmentIndex: number;             // 所在条带索引
  nodes: NavNode[];                 // 包含的所有节点
  displayNode: NavNode;             // 显示的节点（最早的）
  swimlaneY: number;                // 所属泳道的 Y 坐标
  count: number;                    // 节点数量
}

export class WaterfallRenderer implements BaseRenderer {
  private readonly SEGMENT_DURATION = 10 * 60 * 1000; // 10分钟 - 改为10分钟间隔，避免条带过多导致压缩区域过窄
  private readonly MAX_COMPRESSED_RATIO = 0.3; // 最大压缩区域占比30%
  private readonly NODE_WIDTHS = {
    full: 150,   // 全节点：图标 + 标题
    short: 120,  // 短节点：标题
    icon: 20,    // 图标节点：完整图标
    dot: 10      // 圆点节点：小圆点（最小压缩级别）- 调整为10px以容纳点+间隙
  };
  private readonly NODE_HEIGHTS = {
    full: 40,
    short: 25,
    icon: 20,
    dot: 8
  };

  // 泳道配置常量
  private readonly SWIMLANE_HEIGHT = 50; // 每个泳道的高度（包含间距）
  private readonly SWIMLANE_NODE_HEIGHT = 40; // 泳道内节点的实际高度
  private readonly SWIMLANE_SEPARATOR_DASH = '5,3'; // 虚线样式
  private readonly SWIMLANE_SEPARATOR_COLOR = '#555'; // 虚线颜色
  private readonly MAX_SWIMLANES = 20; // 最大泳道数量（防止过多标签页导致布局溢出）
  private readonly COLLAPSE_THRESHOLD = 2; // 折叠阈值：>=2个节点时折叠

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
  private observationStartIndex: number = 0; // 当前观察窗口起始索引
  private strips: any[] = []; // 存储所有条带的D3选择器，用于拖动时更新
  private currentNormalSegmentIndices: Set<number> = new Set(); // 当前在观察窗口内的条带索引
  private prevWindowCenter: number | undefined; // 🎯 记录上一次观察窗口中心位置，用于检测移动方向
  private wheelScrollTimeout: number | null = null; // 滚轮滚动防抖定时器
  
  // 泳道数据 - V2版本：支持复用
  private swimlanes: Swimlane[] = []; // 当前渲染的泳道列表（新结构）
  private closureMarkers: ClosureMarker[] = []; // 关闭标记列表
  private collapsedGroups: CollapsedNodeGroup[] = []; // 折叠的节点组
  private laneAllocation: LaneAllocation | null = null; // 泳道分配结果

  // 时间段常量（10分钟）
  private readonly TIME_SEGMENT_DURATION = 10 * 60 * 1000; // 10分钟（毫秒）

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

  /**
   * 获取当前观察窗口的时间范围信息
   * @returns 时间范围字符串，格式为 "HH:MM - HH:MM"，如果无法获取则返回 null
   */
  getObservationWindowTimeRange(): string | null {
    if (!this.allSegments || this.allSegments.length === 0) {
      return null;
    }

    if (!this.currentLayout || !this.currentLayout.normalDisplaySegments || this.currentLayout.normalDisplaySegments.length === 0) {
      return null;
    }

    // 获取正常显示区域的第一个和最后一个时间段
    const normalSegments = this.currentLayout.normalDisplaySegments;
    const firstSegment = normalSegments[0]; // 最新的时间段
    const lastSegment = normalSegments[normalSegments.length - 1]; // 最旧的时间段

    // 格式化时间为 HH:MM
    const formatTime = (timestamp: number): string => {
      const date = new Date(timestamp);
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    };

    // 因为时间段是从新到旧排序的，且时间标签显示的是 endTime：
    // - 观察窗口的起始时间（最旧）= 最后一个段的 endTime（因为标签显示的就是 endTime）
    // - 观察窗口的结束时间（最新）= 第一个段的 endTime
    const startTime = formatTime(lastSegment.endTime);   // 最旧条带的标签时间
    const endTime = formatTime(firstSegment.endTime);     // 最新条带的标签时间

    return `${startTime} - ${endTime}`;
  }

  render(nodes: NavNode[], edges: NavLink[], options?: any): void {
    console.log('🔥🔥🔥 WaterfallRenderer v3 开始渲染，节点数量:', nodes?.length || 0);
    
    // 清空容器
    this.svg.selectAll('*').remove();
    
    // 🎨 添加SVG渐变和滤镜定义
    this.addSVGDefinitions();
    
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

    // 🔄 恢复观察窗口位置
    // 优先级：内存中的值 > localStorage 中的值 > 默认值 0
    let savedObservationIndex = this.visualizer.waterfallObservationIndex;
    
    console.log(`🔍 开始恢复观察窗口位置检查:`, {
      tabId: this.visualizer.tabId,
      memoryValue: savedObservationIndex,
      restoreTransform: options?.restoreTransform
    });
    
    // 如果内存中没有值，尝试从 localStorage 恢复
    if (savedObservationIndex === undefined && options?.restoreTransform) {
      const savedState = getViewState(this.visualizer.tabId || '', 'waterfall');
      console.log(`📂 从 localStorage 读取的状态:`, savedState);
      
      if (savedState && savedState.waterfallObservationIndex !== undefined) {
        savedObservationIndex = savedState.waterfallObservationIndex;
        console.log(`💾 从 localStorage 恢复观察窗口索引: ${savedObservationIndex}`);
        // 同步到内存
        this.visualizer.waterfallObservationIndex = savedObservationIndex;
      } else {
        console.log(`⚠️ localStorage 中没有保存的观察窗口索引`);
      }
    }
    
    const useRestoredPosition = options?.restoreTransform && savedObservationIndex !== undefined;
    
    console.log(`📍 观察窗口恢复检查:`, {
      savedObservationIndex,
      restoreTransform: options?.restoreTransform,
      useRestoredPosition
    });
    
    if (useRestoredPosition && savedObservationIndex !== 0) {
      console.log(`🔄 恢复观察窗口位置，起始索引: ${savedObservationIndex}`);
      this.observationStartIndex = savedObservationIndex!;
    } else if (savedObservationIndex === 0 && options?.restoreTransform) {
      console.log(`🔄 恢复观察窗口到起始位置（索引: 0）`);
      this.observationStartIndex = 0;
    } else {
      console.log(`🆕 使用默认观察窗口位置（起始索引: 0）`);
      this.observationStartIndex = 0;
    }

    // 1. 🎯 智能泳道分配（支持复用）
    this.laneAllocation = this.allocateSwimlanesWithReuse(validNodes);
    this.swimlanes = this.laneAllocation.swimlanes;
    this.closureMarkers = this.laneAllocation.closureMarkers;

    // 2. 计算时间分段和布局（使用保存的观察窗口位置）
    const layout = this.calculateSegmentLayout(validNodes, this.width, this.observationStartIndex);
    this.currentLayout = layout;

    // 3. 识别需要折叠的节点组
    this.collapsedGroups = this.identifyCollapsedGroups(layout.segments, this.swimlanes);

    // 4. 创建SVG分组
    const mainGroup = this.createSVGGroups(this.svg);

    // 5. 渲染各个部分
    this.renderTimeAxis(mainGroup.timeAxisGroup, layout);
    this.renderSwimlaneSeparators(mainGroup.nodesGroup, layout); // 绘制泳道分隔线
    this.renderSegmentNodes(mainGroup.nodesGroup, layout);
    // this.renderConnections(mainGroup.connectionsGroup, layout); // 已禁用：泳道布局下连接线会造成视觉混乱
    this.renderObservationWindowSlider(mainGroup.focusOverlayGroup, layout);
    
    // 6. 设置滚轮事件来滚动观察窗口
    this.setupWheelScroll();
    
    // 7. 存储选项供后续使用
    this.renderOptions = options;
  }

  /**
   * 🎨 添加SVG渐变和滤镜定义
   */
  private addSVGDefinitions(): void {
    const defs = this.svg.append('defs');
    
    // 条带背景渐变 - 偶数行
    const stripGradientEven = defs.append('linearGradient')
      .attr('id', 'stripGradientEven')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    stripGradientEven.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#fafafa')
      .attr('stop-opacity', 1);
    stripGradientEven.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#f0f0f0')
      .attr('stop-opacity', 1);
    
    // 条带背景渐变 - 奇数行
    const stripGradientOdd = defs.append('linearGradient')
      .attr('id', 'stripGradientOdd')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    stripGradientOdd.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#f8f8f8')
      .attr('stop-opacity', 1);
    stripGradientOdd.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#e8e8e8')
      .attr('stop-opacity', 1);
    
    // 节点背景渐变
    const nodeGradient = defs.append('linearGradient')
      .attr('id', 'nodeGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    nodeGradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#f8f8f8')
      .attr('stop-opacity', 1);
    nodeGradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#e8e8e8')
      .attr('stop-opacity', 1);
    
    // 节点背景渐变 - 浅色版
    const nodeGradientLight = defs.append('linearGradient')
      .attr('id', 'nodeGradientLight')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    nodeGradientLight.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#fcfcfc')
      .attr('stop-opacity', 1);
    nodeGradientLight.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#eeeeee')
      .attr('stop-opacity', 1);
    
    // 观察窗口滤镜 - 轻微阴影
    const windowShadow = defs.append('filter')
      .attr('id', 'windowShadow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    windowShadow.append('feGaussianBlur')
      .attr('in', 'SourceAlpha')
      .attr('stdDeviation', 2);
    windowShadow.append('feOffset')
      .attr('dx', 0)
      .attr('dy', 1)
      .attr('result', 'offsetblur');
    const windowMerge = windowShadow.append('feMerge');
    windowMerge.append('feMergeNode');
    windowMerge.append('feMergeNode')
      .attr('in', 'SourceGraphic');
    
    // 节点阴影滤镜
    const nodeShadow = defs.append('filter')
      .attr('id', 'nodeShadow')
      .attr('x', '-20%')
      .attr('y', '-20%')
      .attr('width', '140%')
      .attr('height', '140%');
    nodeShadow.append('feGaussianBlur')
      .attr('in', 'SourceAlpha')
      .attr('stdDeviation', 1);
    nodeShadow.append('feOffset')
      .attr('dx', 0)
      .attr('dy', 0.5)
      .attr('result', 'offsetblur');
    const nodeMerge = nodeShadow.append('feMerge');
    nodeMerge.append('feMergeNode');
    nodeMerge.append('feMergeNode')
      .attr('in', 'SourceGraphic');
  }

  /**
   * 计算时间分段和布局分配
   * @param nodes 节点数组（首次调用时使用）
   * @param containerWidth 容器宽度
   * @param observationStartIndex 观察窗口起始索引（可选）
   */
  /**
   * 🗂️ 旧版本泳道分析方法（已弃用，保留用于参考）
   * @deprecated 请使用 allocateSwimlanesWithReuse 方法
   */
  private analyzeSwimlanes_deprecated(nodes: NavNode[]): any[] {
    // 该方法已弃用，返回空数组避免编译错误
    console.warn('⚠️ analyzeSwimlanes_deprecated 方法已弃用，请使用新的泳道复用算法');
    return [];
  }

  /**
   * 🎯 新版本：智能泳道分配算法（支持复用）
   * @param nodes 所有节点
   * @returns 泳道分配结果
   */
  private allocateSwimlanesWithReuse(nodes: NavNode[]): LaneAllocation {
    // 1. 收集所有标签页的生命周期信息
    const tabLifecycles = this.collectTabLifecycles(nodes);
    
    // 2. 按时间顺序排序标签页生命周期
    const sortedLifecycles = Array.from(tabLifecycles.values())
      .sort((a, b) => a.startTime - b.startTime);
    
    // 3. 智能分配泳道
    const { swimlanes, closureMarkers, reuseCount } = this.assignLanesWithReuse(sortedLifecycles);
    
    // 4. 分配Y坐标
    this.assignSwimlanePositions(swimlanes);
    
    console.log(`🏊 智能泳道分配完成: ${swimlanes.length}个泳道, ${reuseCount}次复用, ${closureMarkers.length}个关闭标记`);
    
    return {
      swimlanes,
      closureMarkers,
      totalTabCount: tabLifecycles.size,
      reuseCount
    };
  }

  /**
   * 收集所有标签页的生命周期信息
   */
  private collectTabLifecycles(nodes: NavNode[]): Map<string, TabLifecycle> {
    const lifecycles = new Map<string, TabLifecycle>();
    
    // 按时间排序处理节点
    const sortedNodes = [...nodes].sort((a, b) => a.timestamp - b.timestamp);
    
    sortedNodes.forEach(node => {
      const tabId = node.tabId || 'unknown';
      
      if (!lifecycles.has(tabId)) {
        lifecycles.set(tabId, {
          tabId,
          startTime: node.timestamp,
          endTime: node.timestamp,
          isClosed: false,
          nodes: []
        });
      }
      
      const lifecycle = lifecycles.get(tabId)!;
      lifecycle.endTime = node.timestamp;
      lifecycle.isClosed = node.isClosed || false;
      lifecycle.nodes.push(node);
    });

    // 计算关闭标记时间（关闭后的下一个时段）
    lifecycles.forEach(lifecycle => {
      if (lifecycle.isClosed) {
        lifecycle.closureMarkerTime = lifecycle.endTime + this.TIME_SEGMENT_DURATION;
      }
    });
    
    return lifecycles;
  }

  /**
   * 智能分配泳道（支持复用）
   */
  private assignLanesWithReuse(lifecycles: TabLifecycle[]): {
    swimlanes: Swimlane[];
    closureMarkers: ClosureMarker[];
    reuseCount: number;
  } {
    const swimlanes: Swimlane[] = [];
    const closureMarkers: ClosureMarker[] = [];
    let reuseCount = 0;

    lifecycles.forEach(lifecycle => {
      let assignedLaneIndex = -1;

      // 🔄 尝试复用已有泳道
      for (let i = 0; i < swimlanes.length; i++) {
        const lane = swimlanes[i];
        
        if (this.canReuseLane(lane, lifecycle)) {
          assignedLaneIndex = i;
          reuseCount++;
          console.log(`🔄 泳道 ${i} 复用: ${lifecycle.tabId}`);
          break;
        }
      }

      // 如果没有可复用的泳道，创建新泳道
      if (assignedLaneIndex === -1) {
        assignedLaneIndex = swimlanes.length;
        swimlanes.push({
          laneIndex: assignedLaneIndex,
          y: 0, // 稍后分配
          height: this.SWIMLANE_HEIGHT,
          lifecycles: [],
          isAvailable: true,
          lastActivityTime: 0
        });
        console.log(`🆕 创建新泳道 ${assignedLaneIndex} for ${lifecycle.tabId}`);
      }

      // 分配标签页到泳道
      const lane = swimlanes[assignedLaneIndex];
      lane.lifecycles.push(lifecycle);
      lane.lastActivityTime = lifecycle.endTime;
      lane.isAvailable = !lifecycle.isClosed || !!lifecycle.closureMarkerTime;

      // 添加关闭标记（如果需要）
      if (lifecycle.isClosed && lifecycle.closureMarkerTime) {
        const marker = {
          tabId: lifecycle.tabId,
          timestamp: lifecycle.closureMarkerTime,
          swimlaneIndex: assignedLaneIndex
        };
        closureMarkers.push(marker);
        console.log(`🔴 创建关闭标记: 标签${marker.tabId}, 时间戳=${marker.timestamp}, 泳道=${marker.swimlaneIndex}`);
      }
    });

    return { swimlanes, closureMarkers, reuseCount };
  }

  /**
   * 检查泳道是否可以被复用
   */
  private canReuseLane(lane: Swimlane, newLifecycle: TabLifecycle): boolean {
    if (lane.lifecycles.length === 0) return true;

    const lastLifecycle = lane.lifecycles[lane.lifecycles.length - 1];
    
    // 必须是已关闭的标签页
    if (!lastLifecycle.isClosed) return false;
    
    // 必须有明确的关闭标记时间
    if (!lastLifecycle.closureMarkerTime) return false;
    
    // 🎯 关键修复：新标签页开始时间必须在关闭标记时间之后
    // 这确保了关闭标记和新节点不会重合
    const canReuse = newLifecycle.startTime >= lastLifecycle.closureMarkerTime + this.TIME_SEGMENT_DURATION;
    
    if (canReuse) {
      console.log(`✅ 泳道可复用检查通过: 新标签 ${newLifecycle.tabId} (${new Date(newLifecycle.startTime).toLocaleTimeString()}) 在关闭标记 ${new Date(lastLifecycle.closureMarkerTime).toLocaleTimeString()} 之后开始`);
    } else {
      console.log(`❌ 泳道复用检查失败: 新标签 ${newLifecycle.tabId} 时间冲突`);
    }
    
    return canReuse;
  }

  /**
   * 分配泳道Y坐标
   */
  private assignSwimlanePositions(swimlanes: Swimlane[]): void {
    const timeAxisY = 80;
    const startGap = 15;
    const swimlaneStartY = timeAxisY + startGap;
    
    swimlanes.forEach((lane, index) => {
      lane.y = swimlaneStartY + (index * this.SWIMLANE_HEIGHT);
    });
  }

  /**
   * 识别需要折叠的节点组
   * @param segments 所有时间段
   * @param swimlanes 泳道列表
   * @returns 需要折叠的节点组列表
   */
  private identifyCollapsedGroups(
    segments: TimeSegment[], 
    swimlanes: Swimlane[]
  ): CollapsedNodeGroup[] {
    const groups: CollapsedNodeGroup[] = [];
    
    // 遍历每个时间段
    segments.forEach((segment, segmentIndex) => {
      // 按 tabId 分组该段内的节点
      const tabGroups = new Map<string, NavNode[]>();
      
      segment.nodes.forEach(node => {
        const tabId = node.tabId || 'unknown';
        if (!tabGroups.has(tabId)) {
          tabGroups.set(tabId, []);
        }
        tabGroups.get(tabId)!.push(node);
      });
      
      // 检查每个 tabId 组的节点数量
      tabGroups.forEach((nodes, tabId) => {
        if (nodes.length >= this.COLLAPSE_THRESHOLD) {
          // 需要折叠：按时间排序，取最早的节点作为显示节点
          const sortedNodes = nodes.sort((a, b) => a.timestamp - b.timestamp);
          const displayNode = sortedNodes[0];
          
          // 找到对应的泳道 - V2版本：在所有生命周期中查找
          const swimlane = this.findSwimlaneByTabId(tabId);
          
          if (!swimlane) {
            console.warn(`⚠️ 未找到标签页 ${tabId} 对应的泳道`);
            return;
          }
          
          groups.push({
            tabId,
            segmentIndex,
            nodes: sortedNodes,
            displayNode,
            swimlaneY: swimlane?.y || 0,
            count: sortedNodes.length
          });
        }
      });
    });
    
    console.log(`🎯 识别出 ${groups.length} 个折叠节点组`, groups);
    
    return groups;
  }

  private calculateSegmentLayout(
    nodes: NavNode[] | TimeSegment[], 
    containerWidth: number, 
    observationStartIndex?: number
  ): LayoutResult {
    // 🎯 判断是首次调用还是重新布局
    let segments: TimeSegment[];
    
    if (Array.isArray(nodes) && nodes.length > 0 && 'timestamp' in nodes[0]) {
      // 首次调用：nodes是NavNode数组，需要创建时间段
      const navNodes = nodes as NavNode[];
      
      // 1. 找到时间范围并对齐到10分钟边界
      const times = navNodes.map(node => node.timestamp).sort((a, b) => b - a); // 最新的在前
      const maxTimeRaw = times[0];
      const minTimeRaw = times[times.length - 1];
      
      // 🎯 对齐到10分钟整数边界
      const maxTime = Math.ceil(maxTimeRaw / this.SEGMENT_DURATION) * this.SEGMENT_DURATION;
      const minTime = Math.floor(minTimeRaw / this.SEGMENT_DURATION) * this.SEGMENT_DURATION;
      
      console.log(`🎯 时间段生成: 节点时间范围 ${maxTimeRaw}-${minTimeRaw}, 段时间范围 ${maxTime}-${minTime}`);

      // 2. 创建时间分段
      segments = [];
      let currentTime = maxTime;
      let safetyCounter = 0;
      const MAX_ITERATIONS = 1000;
      let segmentIndex = 0;
      
      while (currentTime > minTime && safetyCounter < MAX_ITERATIONS) {
        safetyCounter++;
        
        const segmentEnd = currentTime;
        const segmentStart = currentTime - this.SEGMENT_DURATION;
        
        const segmentNodes = navNodes.filter(node => 
          node.timestamp < segmentEnd && node.timestamp >= segmentStart
        );

        segments.push({
          startTime: segmentStart,
          endTime: segmentEnd,
          nodes: segmentNodes,
          displayMode: 'full',
          allocatedWidth: 0,
          startX: 0,
          originalIndex: segmentIndex++
        });

        currentTime = segmentStart;
      }
      
      if (safetyCounter >= MAX_ITERATIONS) {
        console.error('⚠️ 时间分段循环达到最大迭代次数，强制终止');
      }

      console.log('创建了', segments.length, '个时间段');

      // 保存所有段用于后续拖动
      this.allSegments = segments;
    } else {
      // 重新布局：使用已有的segments
      segments = this.allSegments;
    }

    // 3. 计算布局分配
    return this.allocateSegmentLayout(segments, containerWidth, observationStartIndex || 0);
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

    // 🎯 关键逻辑：判断是否需要压缩
    // 计算如果所有段都以full模式显示需要的总宽度
    const fullModeRequiredWidth = segments.length * this.NODE_WIDTHS.full;
    const needCompression = fullModeRequiredWidth > availableWidth;

    let normalSegments: TimeSegment[] = [];
    let compressedSegments: TimeSegment[] = [];
    let currentX = startX;

    if (!needCompression) {
      // ✅ 不需要压缩：所有段都以full模式显示
      // 🎯 修复：保持标准宽度，在右侧填充空白区段来铺满空间
      const standardSegmentWidth = this.NODE_WIDTHS.full;
      
      // 计算实际内容占用的宽度
      const contentWidth = segments.length * standardSegmentWidth;
      
      // 如果还有剩余空间，在右侧添加空白区段
      let allSegments = [...segments];
      let totalUsedWidth = contentWidth;
      
      if (contentWidth < availableWidth) {
        const remainingWidth = availableWidth - contentWidth;
        const additionalSegmentCount = Math.floor(remainingWidth / standardSegmentWidth);
        
        console.log(`🎯 添加 ${additionalSegmentCount} 个空白区段以铺满空间`);
        
        // 生成空白区段（时间递减，从左到右）
        for (let i = 0; i < additionalSegmentCount; i++) {
          const lastRealSegment = segments[segments.length - 1]; // 使用原始数据段
          const emptySegment: TimeSegment = {
            // 🎯 瀑布视图是逆时间轴：空白段时间应该更早（递减）
            startTime: lastRealSegment.startTime - ((i + 1) * this.TIME_SEGMENT_DURATION),
            endTime: lastRealSegment.startTime - (i * this.TIME_SEGMENT_DURATION),
            nodes: [], // 空白段没有节点
            displayMode: 'full',
            allocatedWidth: standardSegmentWidth,
            startX: 0, // 将在下面设置
            originalIndex: lastRealSegment.originalIndex + i + 1, // 继续索引序列
            isFiller: true // 🎯 标识为填充段
          };
          allSegments.push(emptySegment);
        }
        
        totalUsedWidth = allSegments.length * standardSegmentWidth;
      }
      
      // 设置所有段的位置
      allSegments.forEach((segment, index) => {
        segment.displayMode = 'full';
        segment.allocatedWidth = standardSegmentWidth;
        segment.startX = startX + (index * standardSegmentWidth);
      });
      
      // 🎯 更新 currentX 以包含所有段（包括空白段）
      currentX = startX + (allSegments.length * standardSegmentWidth);
      
      normalSegments = allSegments;
      compressedSegments = [];
      
      console.log(`✅ 无需压缩，${segments.length}个数据段 + ${allSegments.length - segments.length}个空白段，标准宽度 ${standardSegmentWidth}px`);
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
  /**
   * 渲染泳道分隔线
   * @param group SVG 分组
   * @param layout 布局信息
   */
  private renderSwimlaneSeparators(group: any, layout: LayoutResult): void {
    if (this.swimlanes.length === 0) {
      return;
    }

    console.log(`🏊 渲染 ${this.swimlanes.length} 条泳道分隔线和数字标识`);

    const separatorGroup = group.append('g').attr('class', 'swimlane-separators');

    // 🎯 获取条带区域的左右边界
    const leftBoundary = layout.timeAxisData.startX;
    const rightBoundary = layout.timeAxisData.endX;

    // 🔢 创建泳道数字标识分组
    const numberGroup = group.append('g').attr('class', 'swimlane-numbers');

    // 渲染每个泳道的数字标识和分隔线
    this.swimlanes.forEach((lane, index) => {
      // 🔢 添加泳道数字标识（左侧空白区域）
      const numberX = 20; // 距离左边缘20px
      const numberY = lane.y + (this.SWIMLANE_HEIGHT / 2); // 泳道中央
      
      numberGroup.append('text')
        .attr('class', 'swimlane-number')
        .attr('x', numberX)
        .attr('y', numberY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-family', 'Arial, sans-serif')
        .attr('font-size', '32px')
        .attr('font-weight', 'bold')
        .attr('font-style', 'italic') // 🎯 添加斜体样式
        .attr('fill', '#666666')
        .attr('opacity', 0.4) // 半透明效果
        .text(index + 1); // 显示1、2、3...

      // 绘制泳道底部的分隔线（除了最后一条）
      if (index < this.swimlanes.length - 1) {
        const separatorY = lane.y + this.SWIMLANE_HEIGHT;
        
        separatorGroup.append('line')
          .attr('class', 'swimlane-separator')
          .attr('x1', leftBoundary)  // 从条带左边界开始
          .attr('x2', rightBoundary) // 到条带右边界结束
          .attr('y1', separatorY)
          .attr('y2', separatorY)
          .attr('stroke', this.SWIMLANE_SEPARATOR_COLOR)
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', this.SWIMLANE_SEPARATOR_DASH)
          .attr('opacity', 0.5);
      }
    });
  }

  /**
   * 获取节点所属的泳道 - V2版本：支持多生命周期
   * @param node 节点
   * @returns 泳道对象，如果找不到则返回 null
   */
  private getSwimlaneForNode(node: NavNode): Swimlane | null {
    const tabId = node.tabId || 'unknown';
    
    // 在所有泳道的所有生命周期中查找包含该节点的泳道
    for (const lane of this.swimlanes) {
      for (const lifecycle of lane.lifecycles) {
        if (lifecycle.tabId === tabId && lifecycle.nodes.includes(node)) {
          return lane;
        }
      }
    }
    
    return null;
  }

  /**
   * 根据标签页ID查找对应的泳道
   */
  private findSwimlaneByTabId(tabId: string): Swimlane | null {
    for (const lane of this.swimlanes) {
      for (const lifecycle of lane.lifecycles) {
        if (lifecycle.tabId === tabId) {
          return lane;
        }
      }
    }
    return null;
  }

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
    
    // � 清空并重建strips数组
    this.strips = [];
    
    // �🎨 添加明暗条带背景 - 从顶部延伸到底部
    layout.segments.forEach((segment) => {
      // 🎯 使用原始索引决定明暗，保证条带颜色不会因为拖动而改变
      const isEven = segment.originalIndex % 2 === 0;
      
      // 创建条带分组（包含背景和节点）
      const stripGroup = backgroundGroup.append('g')
        .attr('class', `time-strip time-strip-${segment.originalIndex}`)
        .attr('data-time', new Date(segment.endTime).toISOString())
        .attr('data-segment-index', segment.originalIndex);
      
      // 竖向条带背景 - 添加微妙的渐变和悬停效果
      const stripBg = stripGroup.append('rect')
        .attr('class', 'strip-background')
        .attr('x', segment.startX)
        .attr('y', stripTop)
        .attr('width', segment.allocatedWidth)
        .attr('height', stripHeight)
        .attr('fill', isEven ? 'url(#stripGradientEven)' : 'url(#stripGradientOdd)')
        .attr('opacity', 0.9)
        .style('transition', 'opacity 0.2s ease');
      
      // 添加悬停效果
      stripBg.on('mouseenter', function(this: SVGRectElement) {
        d3.select(this).attr('opacity', 1);
      }).on('mouseleave', function(this: SVGRectElement) {
        d3.select(this).attr('opacity', 0.9);
      });
      
      // 添加节点分组（暂时为空，稍后渲染）
      const nodeGroup = stripGroup.append('g')
        .attr('class', 'node-group')
        .attr('transform', `translate(0, 0)`);
      
      // 保存到strips数组
      this.strips.push(stripGroup);
    });

    // 🎯 绘制时间轴横线（带箭头）- 使用布局结果中的所有段确保完整
    const allLayoutSegments = layout.segments;
    const firstSegment = allLayoutSegments[0];
    const lastSegment = allLayoutSegments[allLayoutSegments.length - 1];
    const lineStartX = firstSegment ? firstSegment.startX : 50;
    const lineEndX = lastSegment ? (lastSegment.startX + lastSegment.allocatedWidth) : 200;
    
    console.log(`🎯 时间轴延伸: 从 ${lineStartX} 到 ${lineEndX} (共 ${allLayoutSegments.length} 个段)`);
    
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

    // 🎯 时间标签归属于条带，添加到条带分组中
    this.strips.forEach((strip, i) => {
      const segment = layout.segments[i];
      if (segment && (segment.displayMode === 'full' || segment.displayMode === 'short')) {
        this.addTimeLabelToStrip(strip, segment, timeAxisY);
      }
    });
  }

  /**
   * 🎯 添加时间标签到条带（时间标签归属于条带）
   */
  private addTimeLabelToStrip(strip: any, segment: TimeSegment, timeAxisY: number = 80): void {
    const timeLabel = new Date(segment.endTime).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // 刻度线（向下）
    strip.append('line')
      .attr('class', 'time-tick')
      .attr('x1', segment.startX + segment.allocatedWidth / 2)
      .attr('y1', timeAxisY)
      .attr('x2', segment.startX + segment.allocatedWidth / 2)
      .attr('y2', timeAxisY + 5)
      .attr('stroke', '#999')
      .attr('stroke-width', 1);

    // 时间标签在横线上方，远离观察窗口
    strip.append('text')
      .attr('class', 'time-label')
      .attr('x', segment.startX + segment.allocatedWidth / 2)
      .attr('y', timeAxisY - 20) // 增加距离，从-8改为-20
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', 'bold')
      .attr('fill', '#666')
      .text(timeLabel);
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

      // 🎯 使用strips数组中对应的条带分组
      const strip = this.strips[segIndex];
      if (!strip) {
        console.warn(`⚠️ 找不到段 ${segIndex} 的条带分组`);
        return;
      }
      
      // 获取节点分组
      const nodeGroup = strip.select('.node-group');
      
      // 🎯 找出该段内需要折叠的节点组
      const collapsedGroupsInSegment = this.collapsedGroups.filter(
        g => g.segmentIndex === segIndex
      );
      
      // 创建一个 Set 存储应该被折叠（不显示）的节点 ID
      const hiddenNodeIds = new Set<string>();
      collapsedGroupsInSegment.forEach(group => {
        // 除了 displayNode，其他节点都隐藏
        group.nodes.forEach(node => {
          if (node.id !== group.displayNode.id) {
            hiddenNodeIds.add(node.id);
          }
        });
      });
      
      segment.nodes.forEach((node, index) => {
        if (totalNodesRendered >= MAX_NODES_TO_RENDER) {
          return;
        }
        
        // 🎯 跳过被折叠的节点
        if (hiddenNodeIds.has(node.id)) {
          console.log(`🔽 跳过折叠节点: ${node.title || node.url}`);
          return;
        }
        
        this.renderSingleNode(nodeGroup, node, segment, index);
        
        // 🎯 如果这个节点是折叠组的显示节点，渲染折叠角标
        // 但是 dot 模式不需要折叠角标
        if (segment.displayMode !== 'dot') {
          const collapsedGroup = collapsedGroupsInSegment.find(
            g => g.displayNode.id === node.id
          );
          if (collapsedGroup) {
            this.renderCollapseBadge(nodeGroup, node, segment, collapsedGroup);
          }
        }
        
        totalNodesRendered++;
      });
    });

    // 🎯 渲染关闭标记
    this.renderClosureMarkers(group, layout);

    console.log(`✅ 总共渲染了 ${totalNodesRendered} 个节点`);
  }

  /**
   * 🎯 渲染关闭标记
   * @param group SVG 分组  
   * @param layout 布局信息
   */
  private renderClosureMarkers(group: any, layout: LayoutResult): void {
    if (!this.closureMarkers || this.closureMarkers.length === 0) {
      return;
    }

    console.log(`🔴 渲染 ${this.closureMarkers.length} 个关闭标记`);

    // 创建关闭标记分组
    const markerGroup = group.append('g').attr('class', 'closure-markers');

    this.closureMarkers.forEach(marker => {
      // 🎯 边界外过滤：跳过超出时间段范围的关闭标记（节省空间）
      if (layout.segments.length > 0) {
        const firstSegment = layout.segments[0]; // 最新时间段
        const lastSegment = layout.segments[layout.segments.length - 1]; // 最早时间段
        
        if (marker.timestamp > firstSegment.endTime || marker.timestamp < lastSegment.startTime) {
          console.log(`⚡ 跳过边界外关闭标记: 标签${marker.tabId}, 时间戳=${marker.timestamp} 超出段范围[${lastSegment.startTime}-${firstSegment.endTime}]`);
          return;
        }
      }
      
      // 找到标记对应的时间段和泳道
      const segment = this.findSegmentByTimestamp(marker.timestamp, layout);
      const swimlane = this.swimlanes[marker.swimlaneIndex];
      
      if (!segment || !swimlane) {
        console.error(`❌ 关闭标记调试信息:`);
        console.error(`   标签ID: ${marker.tabId}`);
        console.error(`   时间戳: ${marker.timestamp} (${new Date(marker.timestamp).toLocaleString()})`);
        console.error(`   泳道索引: ${marker.swimlaneIndex}`);
        console.error(`   找到的段: ${segment ? '是' : '否'}`);
        console.error(`   找到的泳道: ${swimlane ? '是' : '否'}`);
        console.error(`   总段数: ${layout.segments.length}`);
        console.error(`   总泳道数: ${this.swimlanes.length}`);
        
        if (layout.segments.length > 0) {
          const firstSegment = layout.segments[0];
          const lastSegment = layout.segments[layout.segments.length - 1];
          console.error(`   段时间范围: ${firstSegment.startTime} - ${lastSegment.endTime}`);
          console.error(`   段时间范围（可读）: ${new Date(firstSegment.startTime).toLocaleString()} - ${new Date(lastSegment.endTime).toLocaleString()}`);
        }
        
        console.warn(`⚠️ 无法找到关闭标记 ${marker.tabId} 的对应段或泳道`);
        return;
      }

      // 🎯 只跳过填充的空白段中的关闭标记，但允许在数据空段中显示
      if (segment.isFiller) {
        console.log(`⚡ 跳过填充空白段中的关闭标记: ${marker.tabId}`);
        return;
      }
      
      if (segment.displayMode === 'dot' || segment.displayMode === 'icon') {
        console.log(`⚡ 跳过压缩条带中的关闭标记: ${marker.tabId} (模式: ${segment.displayMode})`);
        return;
      }

      // 🎯 关闭标记应该显示在找到的时间段的中央
      // 因为整个段都表示"该泳道现在可以复用"的状态
      const markerX = segment.startX + (segment.allocatedWidth / 2);
      const markerY = swimlane.y + (this.SWIMLANE_HEIGHT / 2); // 泳道中央
      
      console.log(`🎯 关闭标记 ${marker.tabId} 显示在段中央: X=${markerX.toFixed(1)}, 段范围=[${segment.startTime}-${segment.endTime}]`);
      
      // 🎯 日本麻将立直棒样式设计
      const stickHeight = this.SWIMLANE_HEIGHT * 0.6; // 棒子高度（稍小一些）
      const stickWidth = 5; // 棒子宽度
      const cornerRadius = 3; // 两端圆角半径
      const centerDotRadius = 2; // 中心红点半径（更小）

      // 渲染关闭标记（日本麻将立直棒样式）
      const markerContainer = markerGroup.append('g')
        .attr('class', 'closure-marker')
        .attr('data-tab-id', marker.tabId)
        .attr('transform', `translate(${markerX}, ${markerY})`);

      // 主棒身（白色竖直矩形，圆角端点）
      markerContainer.append('rect')
        .attr('x', -stickWidth / 2)
        .attr('y', -stickHeight / 2)
        .attr('width', stickWidth)
        .attr('height', stickHeight)
        .attr('fill', '#ffffff')
        .attr('stroke', '#cccccc')
        .attr('stroke-width', 1)
        .attr('rx', cornerRadius)
        .attr('ry', cornerRadius); // 两端圆角

      // 中心红色圆点（更小）
      markerContainer.append('circle')
        .attr('r', centerDotRadius)
        .attr('fill', '#e74c3c')
        .attr('stroke', 'none');

      // 添加提示标题
      markerContainer.append('title')
        .text(`标签页 ${marker.tabId} 已关闭`);

      console.log(`🔴 已渲染关闭标记: ${marker.tabId} at (${markerX.toFixed(1)}, ${markerY.toFixed(1)})`);
    });
  }

  /**
   * 根据时间戳查找对应的时间段
   */
  private findSegmentByTimestamp(timestamp: number, layout: LayoutResult): TimeSegment | null {
    // 🎯 首先在所有段中查找（包括空段，因为关闭标记可能显示在空段中）
    for (const segment of layout.segments) {
      if (timestamp >= segment.startTime && timestamp <= segment.endTime) {
        return segment;
      }
    }
    
    // 🎯 如果没找到，输出调试信息
    console.warn(`🔍 findSegmentByTimestamp 调试信息:`);
    console.warn(`   查找时间戳: ${timestamp} (${new Date(timestamp).toLocaleString()})`);
    console.warn(`   总段数: ${layout.segments.length}`);
    
    if (layout.segments.length > 0) {
      console.warn(`   段列表:`);
      layout.segments.forEach((seg, index) => {
        const inRange = timestamp >= seg.startTime && timestamp <= seg.endTime;
        console.warn(`     [${index}] ${seg.startTime}-${seg.endTime} (${new Date(seg.startTime).toLocaleString()} - ${new Date(seg.endTime).toLocaleString()}) ${inRange ? '✅' : '❌'} nodes:${seg.nodes.length} filler:${seg.isFiller}`);
      });
    }
    
    // 🎯 对于关闭标记：如果时间戳在所有段之外，尝试找到最近的段
    // 这种情况常发生在关闭标记时间戳为 lifecycle.endTime + TIME_SEGMENT_DURATION
    if (layout.segments.length > 0) {
      const lastSegment = layout.segments[layout.segments.length - 1];
      
      // 🎯 更宽松的容错范围：如果时间戳在最后段结束后的合理范围内，使用最后段
      // 扩大到 3 倍时间段长度，覆盖各种时间计算误差
      if (timestamp > lastSegment.endTime && 
          timestamp <= lastSegment.endTime + this.TIME_SEGMENT_DURATION * 3) {
        console.log(`🎯 关闭标记时间戳 ${timestamp} 超出范围，使用最后段 [${lastSegment.startTime}-${lastSegment.endTime}]`);
        return lastSegment;
      }
      
      // 🎯 如果时间戳甚至超出了3倍范围，尝试查找最接近的段
      let closestSegment = lastSegment;
      let minDistance = Math.abs(timestamp - lastSegment.endTime);
      
      for (const segment of layout.segments) {
        const distanceToStart = Math.abs(timestamp - segment.startTime);
        const distanceToEnd = Math.abs(timestamp - segment.endTime);
        const minSegmentDistance = Math.min(distanceToStart, distanceToEnd);
        
        if (minSegmentDistance < minDistance) {
          minDistance = minSegmentDistance;
          closestSegment = segment;
        }
      }
      
      // 如果找到了相对接近的段（在1小时内），使用它
      if (minDistance <= 60 * 60 * 1000) { // 1小时容错
        console.log(`🎯 关闭标记时间戳 ${timestamp} 找到最接近段 [${closestSegment.startTime}-${closestSegment.endTime}]，距离 ${(minDistance / 1000).toFixed(1)}秒`);
        return closestSegment;
      }
    }
    
    return null;
  }

  /**
   * 渲染折叠角标
   * @param group SVG 分组（应该传入节点的 group，这样角标在节点内部）
   * @param node 显示的节点
   * @param segment 所在时间段
   * @param collapsedGroup 折叠组信息
   */
  private renderCollapseBadge(
    group: any,
    node: NavNode,
    segment: TimeSegment,
    collapsedGroup: CollapsedNodeGroup
  ): void {
    const swimlane = this.getSwimlaneForNode(node);
    if (!swimlane) return;
    
    const nodeWidth = this.NODE_WIDTHS[segment.displayMode];
    const nodeHeight = this.NODE_HEIGHTS[segment.displayMode];
    const verticalPadding = (this.SWIMLANE_HEIGHT - nodeHeight) / 2;
    
    const centerOffset = (segment.allocatedWidth - nodeWidth) / 2;
    const nodeX = segment.startX + Math.max(0, centerOffset);
    const nodeY = swimlane.y + verticalPadding;
    
    // 🎯 成组标记：占据节点右侧整个边，右侧圆角吻合节点
    const badgeText = `${collapsedGroup.count}`;
    const badgeWidth = 22; // 稍微增加宽度
    
    const badgeX = nodeX + nodeWidth - badgeWidth; // 节点右侧边
    const badgeY = nodeY; // 与节点顶部对齐
    
    const badgeGroup = group.append('g')
      .attr('class', 'group-badge')
      .attr('transform', `translate(${badgeX}, ${badgeY})`)
      .style('cursor', 'pointer')
      .attr('data-collapse-group', collapsedGroup.tabId);
    
    // 🎯 使用 path 创建右侧圆角的矩形
    // 左侧直角，右侧圆角（与节点圆角一致）
    const radius = 4; // 圆角半径，与节点的 rx 一致
    const path = `
      M 0,0
      L ${badgeWidth - radius},0
      Q ${badgeWidth},0 ${badgeWidth},${radius}
      L ${badgeWidth},${nodeHeight - radius}
      Q ${badgeWidth},${nodeHeight} ${badgeWidth - radius},${nodeHeight}
      L 0,${nodeHeight}
      Z
    `;
    
    badgeGroup.append('path')
      .attr('d', path)
      .attr('fill', '#2c2c2c') // 深黑色背景
      .attr('opacity', 0.95)
      .attr('stroke', 'rgba(255,255,255,0.2)') // 微妙的白色边框
      .attr('stroke-width', 0.5);
    
    // 🎯 文字：垂直居中，白色文字
    badgeGroup.append('text')
      .attr('class', 'group-badge-text') // 添加特定的CSS类
      .attr('x', badgeWidth / 2)
      .attr('y', nodeHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#fff') // 白色文字，与深黑背景形成最佳对比
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text(badgeText)
      .style('pointer-events', 'none');
    
    // 悬停效果
    badgeGroup.on('mouseenter', function(this: SVGGElement) {
      d3.select(this).select('path')
        .transition()
        .duration(200)
        .attr('opacity', 1)
        .attr('fill', '#1a1a1a'); // 悬停时更深的黑色
    }).on('mouseleave', function(this: SVGGElement) {
      d3.select(this).select('path')
        .transition()
        .duration(200)
        .attr('opacity', 0.95)
        .attr('fill', '#2c2c2c'); // 回到原来的深黑色
    });
    
    // 点击事件 - 显示/隐藏抽屉
    badgeGroup.on('click', (event: MouseEvent) => {
      event.stopPropagation(); // 防止触发节点点击事件
      event.preventDefault();
      
      console.log('🎯 折叠角标被点击:', {
        tabId: collapsedGroup.tabId,
        count: collapsedGroup.count,
        nodes: collapsedGroup.nodes.map(n => n.title || n.url)
      });
      
      // 🎯 显示抽屉
      this.showCollapsedNodesDrawer(collapsedGroup, node, segment, nodeX, nodeY, nodeWidth, nodeHeight);
    });
    
    console.log(`🎯 渲染折叠角标: ${collapsedGroup.tabId} (${collapsedGroup.count}个节点)`);
  }

  /**
   * 显示折叠节点抽屉（原位展开）
   */
  private showCollapsedNodesDrawer(
    collapsedGroup: CollapsedNodeGroup,
    firstNode: NavNode,
    firstSegment: TimeSegment,
    nodeX: number,
    nodeY: number,
    nodeWidth: number,
    nodeHeight: number
  ): void {
    // 移除已存在的抽屉
    d3.select('.collapsed-nodes-drawer').remove();
    
    // 获取泳道信息
    const swimlane = this.getSwimlaneForNode(firstNode);
    if (!swimlane) return;
    
    // 计算其他节点（排除第一个显示的节点）
    const otherNodes = collapsedGroup.nodes.filter(n => n.id !== firstNode.id);
    if (otherNodes.length === 0) return;
    
    // 🎯 节点间距：与泳道之间的垂直距离一致
    const nodeGap = this.SWIMLANE_HEIGHT - nodeHeight; // 泳道间的垂直距离
    
    // 🎯 第一个节点和展开节点之间的间隙
    const firstNodeGap = nodeGap;
    
    // 计算总高度（包含第一个间隙）
    const drawerHeight = firstNodeGap + otherNodes.length * (nodeHeight + nodeGap);
    
    // 检查空间：优先向下延伸，如果空间不够向上延伸
    const svgHeight = this.height;
    const availableDownSpace = svgHeight - (nodeY + nodeHeight);
    const availableUpSpace = nodeY;
    
    // 🎯 浮层重叠到原位节点，越过圆角（4px）
    const overlapAmount = 4; // 节点的圆角半径
    let drawerY = nodeY + nodeHeight - overlapAmount; // 向上重叠4px
    let expandDirection: 'down' | 'up' = 'down';
    
    if (drawerHeight > availableDownSpace && availableUpSpace > availableDownSpace) {
      // 向上展开：浮层下边界重叠原位节点上边界
      expandDirection = 'up';
      drawerY = nodeY - drawerHeight + overlapAmount; // 向下重叠4px
    }
    
    // 🎯 滚动偏移量（提前声明，供全局处理器使用）
    let scrollOffset = 0;
    const maxScroll = Math.max(0, drawerHeight - (expandDirection === 'down' ? availableDownSpace : availableUpSpace));
    
    // 🎯 创建抽屉容器 - 使用 append 正常添加，但设置 pointer-events: none
    // 让鼠标事件穿透到下层，保证原位节点和成组标记可以被点击
    const drawer = this.svg.append('g')
      .attr('class', 'collapsed-nodes-drawer')
      .attr('data-swimlane', `lane-${swimlane.laneIndex}`)
      .style('pointer-events', 'none'); // 🎯 让鼠标事件穿透
    
    // 🎯 浮层区域的边界（用于检测鼠标是否在浮层内）
    const actualDrawerHeight = Math.min(drawerHeight, expandDirection === 'down' ? availableDownSpace : availableUpSpace);
    const drawerBounds = {
      x: nodeX,
      y: drawerY,
      width: nodeWidth,
      height: actualDrawerHeight
    };
    
    // 🎯 背景矩形（不透明蓝色背景，避免与泳道线重叠）
    // 边框 1px 细线，直角无圆角
    // 🎯 恢复 pointer-events，可以捕获滚动和点击事件
    const bgRect = drawer.append('rect')
      .attr('x', nodeX)
      .attr('y', expandDirection === 'down' ? drawerY : drawerY)
      .attr('width', nodeWidth)
      .attr('height', actualDrawerHeight)
      .attr('fill', 'rgb(230, 242, 255)') // 不透明的浅蓝色背景
      .attr('stroke', 'rgba(74, 144, 226, 0.5)') // 稍微深一点的边框
      .attr('stroke-width', 1) // 细线
      .style('pointer-events', 'all') // 🎯 恢复鼠标事件
      .style('cursor', 'default');
    
    // 🎯 创建可滚动的节点容器（在背景矩形之后，确保节点在背景上方）
    const nodesContainer = drawer.append('g')
      .attr('class', 'drawer-nodes-container');
    
    // 🎯 在背景矩形上直接处理滚动事件（nodesContainer已创建，可以使用）
    bgRect.on('wheel', (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      
      console.log('🎯 浮层滚动事件被拦截');
      
      if (maxScroll > 0) {
        // 需要滚动：处理滚动
        const delta = event.deltaY;
        scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset + delta * 0.5));
        nodesContainer.attr('transform', `translate(0, ${-scrollOffset})`);
        
        // 更新箭头可见性
        const arrow = drawer.select('.scroll-arrow');
        if (!arrow.empty()) {
          if (scrollOffset >= maxScroll - 5) {
            arrow.attr('opacity', 0);
          } else {
            arrow.attr('opacity', 1);
          }
        }
      }
      // 如果不需要滚动，仅阻止事件传播（已在上面处理）
    });
    
    // 🎯 渲染其他节点（从第一个间隙之后开始）
    otherNodes.forEach((node, index) => {
      const currentNodeY = expandDirection === 'down' 
        ? drawerY + firstNodeGap + index * (nodeHeight + nodeGap)
        : drawerY + firstNodeGap + index * (nodeHeight + nodeGap);
      
      // 🎯 在间隙中显示时间差标签
      if (index === 0) {
        // 第一个节点：显示与原位节点的时间差
        const timeDiff = Math.abs(node.timestamp - firstNode.timestamp);
        this.renderTimeDiffLabel(nodesContainer, nodeX, currentNodeY - firstNodeGap / 2, nodeWidth, timeDiff);
      } else {
        // 后续节点：显示与前一个节点的时间差
        const prevNode = otherNodes[index - 1];
        const timeDiff = Math.abs(node.timestamp - prevNode.timestamp);
        this.renderTimeDiffLabel(nodesContainer, nodeX, currentNodeY - nodeGap / 2, nodeWidth, timeDiff);
      }
      
      const nodeGroup = nodesContainer.append('g')
        .attr('class', 'drawer-node')
        .attr('data-node-id', node.id)
        .attr('transform', `translate(${nodeX}, ${currentNodeY})`)
        .style('cursor', 'pointer')
        .style('pointer-events', 'all'); // 🎯 恢复鼠标事件，可以点击
      
      // 根据显示模式渲染节点（不需要传X,Y坐标，已通过transform定位）
      if (firstSegment.displayMode === 'full') {
        this.renderFullNode(nodeGroup, node, nodeWidth, nodeHeight);
      } else if (firstSegment.displayMode === 'short') {
        this.renderShortNode(nodeGroup, node, nodeWidth, nodeHeight);
      } else if (firstSegment.displayMode === 'icon') {
        this.renderIconNode(nodeGroup, node, 20, 20);
      }
      
      // 🎯 点击节点触发详情显示
      nodeGroup.on('click', (event: MouseEvent) => {
        event.stopPropagation();
        console.log('🎯 抽屉节点被点击:', node.title || node.url);
        
        // 触发节点详情显示
        this.visualizer.showNodeDetails(node);
        
        // 不关闭抽屉，允许连续查看多个节点
      });
    });
    
    // 🎯 如果需要滚动，创建滚动指示箭头
    if (maxScroll > 0) {
      const arrowY = drawerY + actualDrawerHeight - 12; // 距离底部12px
      const arrowX = nodeX + nodeWidth / 2;
      
      const scrollArrow = drawer.append('g')
        .attr('class', 'scroll-arrow')
        .attr('transform', `translate(${arrowX}, ${arrowY})`);
      
      // 向下箭头（SVG path）
      scrollArrow.append('path')
        .attr('d', 'M -4,-2 L 0,2 L 4,-2')
        .attr('fill', 'none')
        .attr('stroke', '#4a90e2')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.6);
    }
    
    // 点击外部关闭
    const closeDrawer = () => {
      drawer.remove();
      this.svg.on('click.drawer', null);
    };
    
    this.svg.on('click.drawer', (event: MouseEvent) => {
      closeDrawer();
    });
    
    // 点击抽屉背景关闭（但不包括节点）
    drawer.select('rect').on('click', (event: MouseEvent) => {
      event.stopPropagation();
      closeDrawer();
    });
    
    // 防止点击抽屉本身时关闭
    drawer.on('click', (event: MouseEvent) => {
      event.stopPropagation();
    });
    
    console.log(`🎯 显示抽屉: ${collapsedGroup.tabId} (${otherNodes.length}个节点, ${expandDirection})`);
  }

  /**
   * 渲染时间差标签（在节点间隙中显示）
   */
  private renderTimeDiffLabel(
    container: any,
    x: number,
    y: number,
    width: number,
    timeDiffMs: number
  ): void {
    // 格式化时间差
    let timeDiffText = '';
    if (timeDiffMs < 1000) {
      // 小于1秒，显示毫秒
      timeDiffText = `${timeDiffMs}ms`;
    } else if (timeDiffMs < 60000) {
      // 小于1分钟，显示秒
      const seconds = (timeDiffMs / 1000).toFixed(1);
      timeDiffText = `${seconds}s`;
    } else if (timeDiffMs < 3600000) {
      // 小于1小时，显示分钟
      const minutes = Math.floor(timeDiffMs / 60000);
      const seconds = Math.floor((timeDiffMs % 60000) / 1000);
      timeDiffText = seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    } else {
      // 1小时以上，显示小时
      const hours = Math.floor(timeDiffMs / 3600000);
      const minutes = Math.floor((timeDiffMs % 3600000) / 60000);
      timeDiffText = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    
    // 渲染标签（极小的灰色文字，稍微下移一点）
    container.append('text')
      .attr('x', x + width / 2)
      .attr('y', y + 1) // 向下偏移1px
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#999')
      .attr('font-size', '8px')
      .attr('font-style', 'italic')
      .attr('opacity', 0.7)
      .text(`+${timeDiffText}`)
      .style('pointer-events', 'none');
  }

  /**
   * 渲染单个节点
   */
  private renderSingleNode(group: any, node: NavNode, segment: TimeSegment, index: number): void {
    // 🎯 对于dot模式，使用动态宽度；其他模式使用固定宽度
    let width: number;
    let height: number;
    
    if (segment.displayMode === 'dot') {
      // dot模式：动态调整大小以适应条带宽度
      const availableWidth = segment.allocatedWidth;
      const maxDotSize = 10;
      const minDotSize = 4;
      const horizontalGap = 2;
      
      // 根据条带宽度动态调整点的大小
      const dotSize = Math.max(minDotSize, Math.min(maxDotSize, availableWidth - horizontalGap * 2));
      width = dotSize;
      height = dotSize;
    } else {
      // 其他模式：使用预定义的固定宽度
      width = this.NODE_WIDTHS[segment.displayMode];
      height = this.NODE_HEIGHTS[segment.displayMode];
    }
    
    let nodeX: number;
    let nodeY: number;
    
    // 🏊 使用泳道布局（如果有）
    const swimlane = this.getSwimlaneForNode(node);
    
    if (swimlane) {
      // 🎯 泳道模式：所有节点水平对齐在泳道的Y坐标上
      const centerOffset = (segment.allocatedWidth - width) / 2;
      nodeX = segment.startX + Math.max(0, centerOffset);
      
      // 节点垂直居中在泳道内 - 使用节点的实际高度来计算居中位置
      const verticalPadding = (this.SWIMLANE_HEIGHT - height) / 2;
      nodeY = swimlane.y + verticalPadding;
      
      // 🐛 调试日志：输出节点定位信息
      if (Math.random() < 0.01) { // 只输出1%的节点避免日志过多
        console.log(`🏊 泳道节点定位:`, {
          tabId: node.tabId,
          swimlaneY: swimlane.y,
          swimlaneHeight: this.SWIMLANE_HEIGHT,
          nodeHeight: height,
          verticalPadding,
          finalNodeY: nodeY
        });
      }
    } else {
      // 🎯 无泳道模式（回退到原有逻辑）
      const timeAxisY = 80; // 时间轴横线的Y坐标
      const startGap = 15; // 时间轴下方的起始间隔
      
      // 根据显示模式决定布局方式
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
    // � 添加裁剪路径，防止文字溢出
    const clipId = `node-clip-${Math.random().toString(36).substr(2, 9)}`;
    const defs = group.append('defs');
    defs.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 4); // 与节点圆角一致
    
    // 应用裁剪路径到整个节点组
    group.attr('clip-path', `url(#${clipId})`);
    
    // �🎨 根据导航类型获取颜色
    const nodeColor = this.getNodeColor(node);
    const strokeColor = this.adjustBrightness(nodeColor, -30);
    const hoverColor = this.adjustBrightness(nodeColor, -20);
    
    // 背景矩形
    const bgRect = group.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 4)
      .attr('fill', nodeColor)
      .attr('stroke', strokeColor)
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .attr('opacity', 0.95);
    
    // 悬停效果
    bgRect.on('mouseenter', function(this: SVGRectElement) {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('fill', hoverColor)
        .attr('opacity', 1);
    }).on('mouseleave', function(this: SVGRectElement) {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('fill', nodeColor)
        .attr('opacity', 0.95);
    });

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
    const textWidth = width - textX - 8; // 剩余宽度，留更多右边距
    
    // 🎯 更精确的字符数计算：11px字体大约每个字符6.5px宽度
    const maxChars = Math.max(1, Math.floor(textWidth / 6.5));
    
    group.append('text')
      .attr('x', textX)
      .attr('y', height / 2 + 4)
      .attr('font-size', '11px')
      .attr('fill', '#333')
      .text(this.truncateText(title, maxChars))
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
    // � 添加裁剪路径，防止文字溢出
    const clipId = `short-clip-${Math.random().toString(36).substr(2, 9)}`;
    const defs = group.append('defs');
    defs.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 3); // 与短节点圆角一致
    
    // 应用裁剪路径到整个节点组
    group.attr('clip-path', `url(#${clipId})`);
    
    // �🎨 根据导航类型获取颜色
    const nodeColor = this.getNodeColor(node);
    const strokeColor = this.adjustBrightness(nodeColor, -30);
    const hoverColor = this.adjustBrightness(nodeColor, -20);
    
    const bgRect = group.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 3)
      .attr('fill', nodeColor)
      .attr('stroke', strokeColor)
      .attr('stroke-width', 1)
      .attr('opacity', 0.9)
      .style('cursor', 'pointer');
    
    // 悬停效果
    bgRect.on('mouseenter', function(this: SVGRectElement) {
      d3.select(this)
        .transition()
        .duration(150)
        .attr('fill', hoverColor)
        .attr('opacity', 1);
    }).on('mouseleave', function(this: SVGRectElement) {
      d3.select(this)
        .transition()
        .duration(150)
        .attr('fill', nodeColor)
        .attr('opacity', 0.9);
    });

    const label = node.title || this.getNodeLabel(node);
    // 🎯 更精确的字符数计算：9px字体大约每个字符5px宽度，留边距
    const maxChars = Math.max(1, Math.floor((width - 8) / 5));
    
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
      // 先获取颜色，避免在回调中的 this 绑定问题
      const nodeColor = this.getNodeColor(node);
      const strokeColor = this.adjustBrightness(nodeColor, -30);
      
      group.append('image')
        .attr('x', (width - iconSize) / 2)
        .attr('y', (height - iconSize) / 2)
        .attr('width', iconSize)
        .attr('height', iconSize)
        .attr('href', node.favicon)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('pointer-events', 'none')
        .on('error', function(this: SVGImageElement) {
          // 如果图标加载失败，显示基于导航类型的彩色圆形
          d3.select(this).remove();
          group.append('circle')
            .attr('cx', width / 2)
            .attr('cy', height / 2)
            .attr('r', iconSize / 2)
            .attr('fill', nodeColor)
            .attr('stroke', strokeColor)
            .attr('stroke-width', 0.5)
            .style('pointer-events', 'none');
        });
    } else {
      // 默认圆形图标 - 使用基于导航类型的颜色
      const nodeColor = this.getNodeColor(node);
      const strokeColor = this.adjustBrightness(nodeColor, -30);
      
      group.append('circle')
        .attr('cx', width / 2)
        .attr('cy', height / 2)
        .attr('r', iconSize / 2)
        .attr('fill', nodeColor)
        .attr('stroke', strokeColor)
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
   * 渲染圆点节点 - 最小化显示，使用彩色点
   * 🎯 点的大小已经在 renderSingleNode 中动态计算，这里直接使用传入的 width/height
   */
  private renderDotNode(group: any, node: NavNode, width: number, height: number): void {
    const radius = Math.min(width, height) / 2;
    
    // 🎨 根据标签页ID或URL生成彩色
    const nodeColor = this.getNodeColor(node);
    const hoverColor = this.adjustBrightness(nodeColor, -20); // 悬停时变深
    
    const circle = group.append('circle')
      .attr('cx', width / 2)
      .attr('cy', height / 2)
      .attr('r', radius)
      .attr('fill', nodeColor)
      .attr('stroke', this.adjustBrightness(nodeColor, -30))
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.85)
      .style('cursor', 'pointer');
    
    // 悬停缩放效果
    circle.on('mouseenter', function(this: SVGCircleElement) {
      d3.select(this)
        .transition()
        .duration(150)
        .attr('r', radius * 1.3)
        .attr('opacity', 1)
        .attr('fill', hoverColor);
    }).on('mouseleave', function(this: SVGCircleElement) {
      d3.select(this)
        .transition()
        .duration(150)
        .attr('r', radius)
        .attr('opacity', 0.85)
        .attr('fill', nodeColor);
    });
  }

  /**
   * 🎨 根据节点生成颜色（基于tabId或URL哈希）
   */
  /**
   * 获取节点颜色 - 基于导航类型（与树形图保持一致）
   */
  private getNodeColor(node: NavNode): string {
    const type = node.type || 'default';
    
    let color: string;
    switch (type) {
      case 'link_click':
        color = '#7cb9e8'; // 蓝色 - 链接点击
        break;
      case 'address_bar':
        color = '#c0e8a5'; // 绿色 - 地址栏输入
        break;
      case 'form_submit':
        color = '#f5d76e'; // 黄色 - 表单提交
        break;
      case 'reload':
        color = '#bcbcbc'; // 灰色 - 页面刷新
        break;
      case 'history_back':
      case 'history_forward':
        color = '#d3a4f9'; // 紫色 - 历史导航
        break;
      case 'redirect':
        color = '#ff9966'; // 橙色 - 页面重定向
        break;
      case 'javascript':
        color = '#66ccff'; // 青色 - JavaScript导航
        break;
      default:
        color = '#e0e0e0'; // 更浅的灰色 - 默认
        break;
    }
    
    // 🐛 调试日志：显示节点类型和颜色
    console.log(`🎨 节点颜色: ${type} → ${color} (${node.title || node.url || 'Unknown'})`);
    
    return color;
  }

  /**
   * 🎨 调整颜色亮度
   */
  private adjustBrightness(hex: string, percent: number): string {
    // 移除 # 号
    hex = hex.replace('#', '');
    
    // 转换为 RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // 调整亮度
    const newR = Math.max(0, Math.min(255, r + percent));
    const newG = Math.max(0, Math.min(255, g + percent));
    const newB = Math.max(0, Math.min(255, b + percent));
    
    // 转换回 hex
    return '#' + 
      newR.toString(16).padStart(2, '0') +
      newG.toString(16).padStart(2, '0') +
      newB.toString(16).padStart(2, '0');
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
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .style('cursor', 'default');

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

    // 可拖动的观察窗口滑块 - 现代化设计
    const observationRect = group.append('rect')
      .attr('class', 'observation-slider')
      .attr('x', windowStartX)
      .attr('y', sliderY)
      .attr('width', windowWidth)
      .attr('height', sliderHeight)
      .attr('rx', sliderHeight / 2)
      .attr('ry', sliderHeight / 2)
      .attr('fill', 'url(#observationGradient)')
      .attr('stroke', '#4A90E2')
      .attr('stroke-width', 1)
      .attr('filter', 'url(#observationShadow)')
      .style('cursor', 'grab')
      .style('transition', 'all 0.2s ease');

    // 添加渐变定义
    const defs = group.append('defs');
    
    // 观察窗口渐变
    const gradient = defs.append('linearGradient')
      .attr('id', 'observationGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    
    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#E3F2FD')
      .attr('stop-opacity', 0.4);
    
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#BBDEFB')
      .attr('stop-opacity', 0.6);
    
    // 阴影效果
    const shadow = defs.append('filter')
      .attr('id', 'observationShadow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    
    shadow.append('feGaussianBlur')
      .attr('in', 'SourceAlpha')
      .attr('stdDeviation', 2);
    
    shadow.append('feOffset')
      .attr('dx', 0)
      .attr('dy', 1)
      .attr('result', 'offsetblur');
    
    shadow.append('feComponentTransfer')
      .append('feFuncA')
      .attr('type', 'linear')
      .attr('slope', 0.3);
    
    const feMerge = shadow.append('feMerge');
    feMerge.append('feMergeNode');
    feMerge.append('feMergeNode')
      .attr('in', 'SourceGraphic');

    // 去掉文字标签，保持简洁

    this.observationWindow = {
      centerSegmentIndex: Math.floor(layout.normalDisplaySegments.length / 2),
      startX: windowStartX,
      width: windowWidth,
      segments: layout.normalDisplaySegments
    };

    // 🎯 添加拖动功能（不再需要text参数）
    this.setupObservationWindowDrag(observationRect, null, layout);
  }

  /**
   * 设置观察窗口拖动功能
   */
  private setupObservationWindowDrag(rect: any, text: any | null, layout: LayoutResult): void {
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
          } else if (rightDistance < leftDistance) {
            // 右边界更近，只吸附右边界
            targetX = rightSnapX;
            self.lastDragSnapped = true;
          } else {
            // 距离相等（极少情况），默认优先左边界
            targetX = leftSnapX;
            self.lastDragSnapped = true;
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
        
        // 视觉反馈 - 保持 1px 边框
        if (self.lastDragSnapped) {
          rect.style('cursor', 'grabbing').attr('stroke-width', 1.5);
        } else {
          rect.attr('stroke-width', 1);
        }
        
        rect.attr('x', clampedX);
        // text 参数已移除，不再更新文字位置
        
        // 🎯✨ 拖动过程中实时更新条带布局（基于视觉位置）
        self.updateSegmentLayoutDuringDrag(clampedX, observationWindowWidth);
        
        startX = event.x;
      })
      .on('end', function(event: any) {
        isDragging = false;
        rect.style('cursor', 'grab')
            .attr('stroke-width', 1); // 恢复正常边框
        
        // 🎯 根据最终位置计算新的观察窗口起始索引（基于覆盖比例）
        const finalX = parseFloat(rect.attr('x'));
        const observationWindowWidth = parseFloat(rect.attr('width'));
        const windowLeftEdge = finalX;
        const windowRightEdge = finalX + observationWindowWidth;
        
        // 计算每个条带的覆盖比例
        const stripCoverages = self.allSegments.map((segment, i) => {
          const stripLeft = segment.startX;
          const stripRight = segment.startX + segment.allocatedWidth;
          const stripWidth = segment.allocatedWidth;
          
          const overlapLeft = Math.max(windowLeftEdge, stripLeft);
          const overlapRight = Math.min(windowRightEdge, stripRight);
          const overlapWidth = Math.max(0, overlapRight - overlapLeft);
          const coverageRatio = stripWidth > 0 ? overlapWidth / stripWidth : 0;
          
          return { index: i, coverageRatio, overlapWidth };
        });
        
        // 找出覆盖比例最高的条带
        const bestMatch = stripCoverages
          .filter(s => s.coverageRatio > 0)
          .sort((a, b) => {
            if (Math.abs(a.coverageRatio - b.coverageRatio) > 0.01) {
              return b.coverageRatio - a.coverageRatio;
            }
            return b.overlapWidth - a.overlapWidth;
          })[0];
        
        const newStartIndex = bestMatch ? bestMatch.index : 0;
        
        console.log('🖱️ 拖动结束，最佳匹配条带:', newStartIndex, '覆盖比例:', (bestMatch?.coverageRatio * 100).toFixed(1) + '%');
        
        // 🎯 拖动结束后完全重新渲染（确保节点正确显示）
        if (newStartIndex !== self.observationStartIndex) {
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
    
    // 🎯 更新当前观察窗口起始索引
    this.observationStartIndex = observationStartIndex;
    
    // 💾 保存观察窗口索引到内存和 localStorage
    this.visualizer.waterfallObservationIndex = observationStartIndex;
    
    // 保存到 localStorage
    const tabId = this.visualizer.tabId || '';
    console.log(`💾 准备保存观察窗口索引到 localStorage:`, {
      tabId,
      observationStartIndex
    });
    
    saveViewState(tabId, {
      viewType: 'waterfall',
      waterfallObservationIndex: observationStartIndex
    });
    
    console.log(`✅ 已保存观察窗口索引到 localStorage`);
    
    // 重新计算布局
    const newLayout = this.allocateSegmentLayout(this.allSegments, this.width, observationStartIndex);
    this.currentLayout = newLayout;

    // 🎯 重新识别折叠组
    this.collapsedGroups = this.identifyCollapsedGroups(newLayout.segments, this.swimlanes);

    // 清空并重新渲染
    this.svg.selectAll('*').remove();
    
    // 🎨 重新添加 SVG 定义
    this.addSVGDefinitions();
    
    const mainGroup = this.createSVGGroups(this.svg);

    // 渲染各个部分
    this.renderTimeAxis(mainGroup.timeAxisGroup, newLayout);
    this.renderSwimlaneSeparators(mainGroup.nodesGroup, newLayout); // 🏊 重新绘制泳道分隔线
    this.renderSegmentNodes(mainGroup.nodesGroup, newLayout);
    this.renderConnections(mainGroup.connectionsGroup, newLayout);
    this.renderObservationWindowSlider(mainGroup.focusOverlayGroup, newLayout);
    
    // 重新设置滚轮事件
    this.setupWheelScroll();
    
    // 更新状态栏以显示新的时间范围
    this.visualizer.updateStatusBar();
  }

  /**
   * 🎯 拖动时更新条带布局（按覆盖比例排序）
   */
  private updateSegmentLayoutDuringDrag(observationWindowX: number, observationWindowWidth: number): void {
    if (!this.currentLayout) return;
    
    const timeAxisY = 80;
    const windowLeftEdge = observationWindowX;
    const windowRightEdge = observationWindowX + observationWindowWidth;
    
    // 🎯 使用初始布局中的正常显示段数（固定值）
    const maxNormalSegments = this.currentLayout.normalDisplaySegments.length;
    
    // 1. 计算每个条带的覆盖情况
    const stripCoverages = this.allSegments.map((segment, i) => {
      const stripLeft = segment.startX;
      const stripRight = segment.startX + segment.allocatedWidth;
      const stripWidth = segment.allocatedWidth;
      
      // 计算重叠区域
      const overlapLeft = Math.max(windowLeftEdge, stripLeft);
      const overlapRight = Math.min(windowRightEdge, stripRight);
      const overlapWidth = Math.max(0, overlapRight - overlapLeft);
      
      // 条带自身的覆盖比例
      const selfCoverageRatio = stripWidth > 0 ? overlapWidth / stripWidth : 0;
      
      return { 
        index: i, 
        overlapWidth,
        selfCoverageRatio
      };
    });
    
    // 2. 🎯 固定展开maxNormalSegments个条带，按自身覆盖比例排序
    const sortedStrips = stripCoverages.sort((a, b) => b.selfCoverageRatio - a.selfCoverageRatio);
    
    // 取前maxNormalSegments个（固定数量）
    const selectedStrips = sortedStrips.slice(0, maxNormalSegments);
    
    // 3. 创建展开条带的集合
    const newExpanded = new Set<number>();
    selectedStrips.forEach(s => newExpanded.add(s.index));
    
    // 4. 应用更新
    if (newExpanded.size > 0) {
      const startIndex = Math.min(...Array.from(newExpanded));
      this.applySegmentUpdates(newExpanded, startIndex, timeAxisY);
    }
  }

  /**
   * 🎯 应用条带更新（提取为独立方法以减少重复代码）
   */
  private applySegmentUpdates(
    normalSegmentIndices: Set<number>, 
    startIndex: number,
    timeAxisY: number
  ): void {
    // 记录上一次的展开状态
    const oldNormalIndices = this.currentNormalSegmentIndices || new Set();
    this.currentNormalSegmentIndices = normalSegmentIndices;
    
    // 重新计算布局
    const layout = this.calculateSegmentLayout(this.allSegments, this.width, startIndex);
    
    // 更新每个条带
    this.strips.forEach((strip, i) => {
      const segment = this.allSegments[i];
      const layoutSegment = layout.segments[i];
      
      if (!segment || !layoutSegment) return;
      
      const width = layoutSegment.allocatedWidth;
      const startX = layoutSegment.startX;
      
      // 🎨 更新条带背景宽度和位置，保持原有的渐变样式
      const isEven = segment.originalIndex % 2 === 0;
      strip.select('.strip-background')
        .attr('x', startX)
        .attr('width', width)
        .attr('fill', isEven ? 'url(#stripGradientEven)' : 'url(#stripGradientOdd)')
        .attr('opacity', 0.9);
      
      // 更新时间标签
      const timeLabel = strip.select('.time-label');
      const timeTick = strip.select('.time-tick');
      
      const isInWindow = normalSegmentIndices.has(i);
      const wasInWindow = oldNormalIndices.has(i);
      const isFullyExpanded = layoutSegment.displayMode === 'full' || layoutSegment.displayMode === 'short';
      
      if (isInWindow && isFullyExpanded) {
        if (timeLabel.empty()) {
          this.addTimeLabelToStrip(strip, layoutSegment, timeAxisY);
        } else {
          const centerX = startX + width / 2;
          timeLabel.attr('x', centerX);
          timeTick.attr('x1', centerX).attr('x2', centerX);
        }
      } else {
        timeLabel.remove();
        timeTick.remove();
      }
      
      // 🎯 关键修复：判断节点显示策略的变化
      const isEntering = isInWindow && !wasInWindow;  // 进入观察窗口
      const isLeaving = wasInWindow && !isInWindow;   // 离开观察窗口
      
      if (isEntering) {
        // 🎯 进入观察窗口：展开节点显示
        console.log(`✨ 条带 ${i} 进入观察窗口，展开节点`);
        if (isFullyExpanded) {
          this.renderSegmentNodesExpanded(segment, strip, layoutSegment);
        } else {
          // 即使不是完全展开，也需要更新为压缩模式（icon）
          this.renderSegmentNodesCompressed(segment, strip, layoutSegment);
        }
      } else if (isLeaving) {
        // 🎯 离开观察窗口：压缩为圆点
        console.log(`💨 条带 ${i} 离开观察窗口，压缩节点`);
        this.renderSegmentNodesAsDots(segment, strip, layoutSegment);
      } else if (isInWindow) {
        // 🎯 保持在观察窗口内：根据当前模式更新节点
        if (isFullyExpanded) {
          this.renderSegmentNodesExpanded(segment, strip, layoutSegment);
        } else {
          this.renderSegmentNodesCompressed(segment, strip, layoutSegment);
        }
      }
    });
  }

  /**
   * 判断条带是否正在改变状态（新进入或即将离开观察窗口）
   */
  private isSegmentChangingState(index: number, newStartIndex: number, windowSize: number): boolean {
    const oldStartIndex = this.observationStartIndex;
    
    // 新进入观察窗口的条带
    const justEntered = index >= newStartIndex && 
                       index < newStartIndex + windowSize &&
                       (index < oldStartIndex || index >= oldStartIndex + windowSize);
    
    // 即将离开观察窗口的条带
    const justLeft = (index < newStartIndex || index >= newStartIndex + windowSize) &&
                     index >= oldStartIndex && 
                     index < oldStartIndex + windowSize;
    
    return justEntered || justLeft;
  }

  /**
   * 🎯 判断条带是否正在进入观察窗口
   */
  private isSegmentEntering(index: number, newStartIndex: number, windowSize: number): boolean {
    const oldStartIndex = this.observationStartIndex;
    
    return index >= newStartIndex && 
           index < newStartIndex + windowSize &&
           (index < oldStartIndex || index >= oldStartIndex + windowSize);
  }

  /**
   * 🎯 判断条带是否正在离开观察窗口
   */
  private isSegmentLeaving(index: number, newStartIndex: number, windowSize: number): boolean {
    const oldStartIndex = this.observationStartIndex;
    
    return (index < newStartIndex || index >= newStartIndex + windowSize) &&
           index >= oldStartIndex && 
           index < oldStartIndex + windowSize;
  }

  /**
   * 判断条带是否在观察窗口内
   */
  private isInObservationWindow(index: number, startIndex: number, windowSize: number): boolean {
    return index >= startIndex && index < startIndex + windowSize;
  }

  /**
   * 将条带的节点快速渲染为dot模式（最轻量）
   */
  private renderSegmentNodesAsDots(
    segment: TimeSegment, 
    strip: any, 
    layoutSegment: TimeSegment
  ): void {
    const nodeGroup = strip.select('.node-group');
    nodeGroup.selectAll('.navigation-node').remove();
    
    const timeAxisY = 80;
    const startGap = 15;
    
    // 🎯 动态计算点的大小，确保不超过条带宽度
    const availableWidth = layoutSegment.allocatedWidth;
    const maxDotSize = 8;
    const minDotSize = 4;
    const horizontalGap = 2;
    const verticalGap = 2;
    
    // 根据条带宽度动态调整点的大小
    const dotSize = Math.max(minDotSize, Math.min(maxDotSize, availableWidth - horizontalGap * 2));
    
    // 🎯 横向排列dot节点（简单布局）
    const itemsPerRow = Math.max(1, Math.floor(availableWidth / (dotSize + horizontalGap)));
    
    segment.nodes.forEach((node, index) => {
      const row = Math.floor(index / itemsPerRow);
      const col = index % itemsPerRow;
      
      const nodeX = layoutSegment.startX + (col * (dotSize + horizontalGap));
      const nodeY = timeAxisY + startGap + (row * (dotSize + verticalGap));
      
      const dotGroup = nodeGroup.append('g')
        .attr('class', 'navigation-node')
        .attr('transform', `translate(${nodeX}, ${nodeY})`);
      
      // 🎨 使用彩色点渲染
      const nodeColor = this.getNodeColor(node);
      const hoverColor = this.adjustBrightness(nodeColor, -20);
      
      const circle = dotGroup.append('circle')
        .attr('cx', dotSize / 2)
        .attr('cy', dotSize / 2)
        .attr('r', dotSize / 2)
        .attr('fill', nodeColor)
        .attr('stroke', this.adjustBrightness(nodeColor, -30))
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.85)
        .style('cursor', 'pointer');
      
      // 悬停效果
      circle.on('mouseenter', function(this: SVGCircleElement) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('r', dotSize / 2 * 1.3)
          .attr('opacity', 1)
          .attr('fill', hoverColor);
      }).on('mouseleave', function(this: SVGCircleElement) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('r', dotSize / 2)
          .attr('opacity', 0.85)
          .attr('fill', nodeColor);
      });
      
      // 点击事件
      dotGroup.on('click', () => {
        this.visualizer.showNodeDetails(node);
      });
    });
  }

  /**
   * 将条带的节点渲染为展开模式（full或short）
   */
  private renderSegmentNodesExpanded(
    segment: TimeSegment, 
    strip: any, 
    layoutSegment: TimeSegment
  ): void {
    const nodeGroup = strip.select('.node-group');
    nodeGroup.selectAll('.navigation-node').remove();
    
    // 🎯 使用标准的节点渲染方法
    segment.nodes.forEach((node, index) => {
      this.renderSingleNode(nodeGroup, node, layoutSegment, index);
    });
  }

  /**
   * 将条带的节点渲染为压缩模式（icon或dot）
   */
  private renderSegmentNodesCompressed(
    segment: TimeSegment, 
    strip: any, 
    layoutSegment: TimeSegment
  ): void {
    const nodeGroup = strip.select('.node-group');
    nodeGroup.selectAll('.navigation-node').remove();
    
    // 🎯 使用标准的节点渲染方法（根据displayMode自动选择压缩级别）
    segment.nodes.forEach((node, index) => {
      this.renderSingleNode(nodeGroup, node, layoutSegment, index);
    });
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
   * 设置滚轮事件来滚动观察窗口
   */
  private setupWheelScroll(): void {
    if (!this.svg || !this.currentLayout) {
      console.warn('⚠️ 无法设置滚轮事件：SVG或布局不存在');
      return;
    }
    
    const self = this;
    const layout = this.currentLayout;
    
    // 移除之前的滚轮事件监听器（如果有）
    this.svg.on('wheel', null);
    
    // 添加新的滚轮事件监听器
    this.svg.on('wheel', function(this: any, event: any) {
      // D3 v7 会将原生事件作为参数传递
      const wheelEvent = event as WheelEvent;
      wheelEvent.preventDefault();
      wheelEvent.stopPropagation();
      
      if (!self.currentLayout || !self.allSegments || self.allSegments.length === 0) {
        console.warn('⚠️ 无法滚动：布局或段数据不存在');
        return;
      }
      
      // 计算滚动方向和步长
      const delta = wheelEvent.deltaY;
      const step = delta > 0 ? 1 : -1;
      
      // 计算新的观察窗口起始索引
      const maxStartIndex = Math.max(0, self.allSegments.length - layout.normalDisplaySegments.length);
      const newStartIndex = Math.max(0, Math.min(maxStartIndex, self.observationStartIndex + step));
      
      // 如果索引没有变化，不需要更新
      if (newStartIndex === self.observationStartIndex) {
        console.log('⚠️ 观察窗口已到达边界，无法继续滚动');
        return;
      }
      
      console.log(`🖱️ 滚轮滚动观察窗口: ${self.observationStartIndex} -> ${newStartIndex}`);
      
      // 🎯 滚动过程中：只更新视觉效果（条带宽度和观察窗口位置）
      self.updateObservationWindowVisuals(newStartIndex);
      
      // 🎯 使用防抖：滚动停止后才完全重新渲染
      if (self.wheelScrollTimeout) {
        clearTimeout(self.wheelScrollTimeout);
      }
      
      self.wheelScrollTimeout = window.setTimeout(() => {
        console.log('⏱️ 滚轮停止，完全重新渲染');
        self.reRenderWithObservationWindow(newStartIndex);
        self.wheelScrollTimeout = null;
      }, 200); // 200ms 后认为滚动已停止
    });
    
    console.log('✅ 滚轮滚动观察窗口已设置，当前段数:', this.allSegments.length);
  }

  /**
   * 🎯 更新观察窗口视觉效果（滚动过程中的快速更新）
   * 只更新条带宽度和观察窗口滑块位置，不重新渲染节点
   */
  private updateObservationWindowVisuals(newStartIndex: number): void {
    // 更新当前索引（用于下次对比）
    this.observationStartIndex = newStartIndex;
    
    // 💾 保存观察窗口索引到内存（滚动停止后会保存到 localStorage）
    this.visualizer.waterfallObservationIndex = newStartIndex;
    
    if (!this.currentLayout) return;
    
    const maxNormalSegments = this.currentLayout.normalDisplaySegments.length;
    
    // 🎯 计算新的观察窗口位置和宽度
    const endIndex = Math.min(newStartIndex + maxNormalSegments - 1, this.allSegments.length - 1);
    const startSegment = this.allSegments[newStartIndex];
    const endSegment = this.allSegments[endIndex];
    
    if (!startSegment || !endSegment) return;
    
    const observationWindowX = startSegment.startX;
    const observationWindowWidth = (endSegment.startX + endSegment.allocatedWidth) - startSegment.startX;
    
    // 🎯 先使用拖动时的更新逻辑（更新条带宽度和时间标签）
    this.updateSegmentLayoutDuringDrag(observationWindowX, observationWindowWidth);
    
    // 🎯 再更新观察窗口滑块位置（确保在条带更新后）
    const windowRect = this.svg.select('.observation-slider');
    if (!windowRect.empty()) {
      windowRect
        .attr('x', observationWindowX)
        .attr('width', observationWindowWidth);
      
      console.log(`✅ 观察窗口滑块已更新: x=${observationWindowX.toFixed(0)}, width=${observationWindowWidth.toFixed(0)}`);
    } else {
      console.warn('⚠️ 未找到观察窗口滑块 .observation-slider');
    }
    
    // 🎯 实时更新状态栏显示的时间范围
    this.visualizer.updateStatusBar();
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