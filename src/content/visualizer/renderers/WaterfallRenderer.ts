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
    dot: 10      // 圆点节点：小圆点（最小压缩级别）
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
  
  // 垂直滚动支持
  private verticalScrollOffset: number = 0; // 垂直滚动偏移量（像素）
  private maxVerticalScroll: number = 0; // 最大垂直滚动距离
  private scrollableGroup: any = null; // 可滚动组的引用
  private isDraggingVertical: boolean = false; // 是否正在拖拽垂直滚动
  private isDraggingObservationWindow: boolean = false; // 是否正在拖拽观察窗口
  
  // 泳道数据 - V2版本：支持复用
  private swimlanes: Swimlane[] = []; // 当前渲染的泳道列表（新结构）
  private closureMarkers: ClosureMarker[] = []; // 关闭标记列表
  private collapsedGroups: CollapsedNodeGroup[] = []; // 折叠的节点组
  private laneAllocation: LaneAllocation | null = null; // 泳道分配结果
  // 当前打开的抽屉状态
  private currentOpenCollapseId: string | null = null;
  private currentOpenDrawerSel: any = null;
  // 抽屉动画互斥标志，防止重复打开/关闭导致的竞态
  private drawerTransitioning: boolean = false;
  // 文档级捕获点击处理器（用于点击外部关闭抽屉）
  private documentClickHandler: ((e: Event) => void) | null = null;

  // 时间段常量（10分钟）
  private readonly TIME_SEGMENT_DURATION = 10 * 60 * 1000; // 10分钟（毫秒）

  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }

  // 关闭指定 drawer sel（安全地收起）
  private closeDrawerSel(drawerSel: any): void {
    try {
      if (!drawerSel || drawerSel.empty()) return;
      const body = drawerSel.select('.drawer-body');
      const bg = body.select('.drawer-bg');
      const items = body.selectAll('.drawer-item');

      // 快速收起（不做复杂动画）
      try { items.attr('opacity', 0).style('pointer-events', 'none'); } catch(e) {}
      try { bg.attr('height', 0); } catch(e) {}
      try { body.attr('opacity', 0).style('pointer-events', 'none'); } catch(e) {}
      try { drawerSel.attr('data-open', 'false'); } catch(e) {}
    } catch (e) {
      // ignore
    }
  }

  private closeCurrentDrawer(): void {
    try {
      if (this.currentOpenDrawerSel && !this.currentOpenDrawerSel.empty()) {
        this.closeDrawerSel(this.currentOpenDrawerSel);
      }
    } catch (e) {
      // ignore
    } finally {
      this.currentOpenCollapseId = null;
      this.currentOpenDrawerSel = null;
      try { this.svg.on('click.drawer', null); } catch(e) {}
      // 移除文档级捕获点击
      try { this.unbindDocumentClickToClose(); } catch (e) {}
      // 结束任何正在进行的互斥状态
      this.drawerTransitioning = false;
    }
  }

  // 绑定文档级捕获阶段点击，用于检测“外部点击”并关闭当前抽屉
  private bindDocumentClickToClose(): void {
    try {
      if (this.documentClickHandler) return; // already bound
      this.documentClickHandler = (e: Event) => {
        try {
          const drawerNode = this.currentOpenDrawerSel ? this.currentOpenDrawerSel.node() : null;
          if (!drawerNode) {
            this.closeCurrentDrawer();
            return;
          }

          // 使用 composedPath 优先判断（支持 Shadow DOM），否则回退到父链遍历
          const path: any[] = (e as any).composedPath ? (e as any).composedPath() : ((e as any).path || []);
          let clickedInside = false;
          if (path && path.length) {
            for (const p of path) {
              if (p === drawerNode) { clickedInside = true; break; }
            }
          } else {
            // fallback: walk up from target
            let node = e.target as Node | null;
            while (node) {
              if (node === drawerNode) { clickedInside = true; break; }
              node = node.parentNode;
            }
          }

          if (!clickedInside) {
            this.closeCurrentDrawer();
          }
        } catch (err) {
          // 保守策略：遇到错误直接关闭
          this.closeCurrentDrawer();
        }
      };

      document.addEventListener('click', this.documentClickHandler, true); // capture phase
    } catch (e) {
      // ignore
    }
  }

  private unbindDocumentClickToClose(): void {
    try {
      if (!this.documentClickHandler) return;
      document.removeEventListener('click', this.documentClickHandler, true);
      this.documentClickHandler = null;
    } catch (e) {
      // ignore
    }
  }

  /**
   * Toggle a prebuilt collapsed drawer (basic show/hide with simple animation)
   */
  private togglePrebuiltDrawer(
    collapsedGroup: CollapsedNodeGroup,
    segment: TimeSegment,
    nodeX: number,
    nodeY: number,
    nodeWidth: number,
    nodeHeight: number
  ): void {
    try {
  logger.log(_('waterfall_toggle_prebuilt_drawer_called', '🔔 togglePrebuiltDrawer called for {0}'), collapsedGroup.tabId);
  try { console.log('DEBUG: togglePrebuiltDrawer called for', collapsedGroup.tabId); } catch(e) {}
      const mount = this.scrollableGroup || this.svg;
      const drawerSel = mount.select(`g.collapsed-drawer[data-collapse-group="${collapsedGroup.tabId}"]`);
      if (drawerSel.empty()) return;

      const itemsGroup = drawerSel.select('.drawer-items');
      // use data-open attr + opacity/pointer-events instead of display:none so that
      // the contained display node remains visible (drawer contains the display node)
      const isOpen = drawerSel.attr('data-open') === 'true';

      if (!isOpen) {
        // 如果正在进行动画，则忽略重复打开请求
        if (this.drawerTransitioning) return;
        this.drawerTransitioning = true;
        // if another drawer is open, normalize its z-order then close it first
        try {
          if (this.currentOpenDrawerSel && !this.currentOpenDrawerSel.empty()) {
            try {
              const overlay = this.scrollableGroup || this.svg;
              const overlayNode = overlay.node() as any;
              const prevNode = this.currentOpenDrawerSel.node() as any;
              if (overlayNode && prevNode) try { overlayNode.appendChild(prevNode); } catch(e) {}
            } catch(e) {}
            this.closeCurrentDrawer();
          }
        } catch(e) {}

  // open: do down-direction expand animation (background stretch + per-item move)
        // keep the outer drawer container non-interactive so it doesn't block
        // clicks to sibling nodes; the inner body/items will be enabled
        // for pointer events after the open animation completes.
        drawerSel.attr('data-open', 'true')
          .style('pointer-events', 'none');

        // find the body and bg
        const body = drawerSel.select('.drawer-body');
        const bg = body.select('.drawer-bg');

        // ensure drawer is rendered on top within the same scrolling coordinate system
        try {
          const overlay = this.scrollableGroup || this.svg; // prefer same coordinate system to avoid visual shift
          const overlayNode = overlay.node() as any;
          const drawerNode = drawerSel.node() as any;
          if (overlayNode && drawerNode) {
              // raise the swimlane group containing this drawer to the end of its time-strip
              try {
                const laneIndexAttr = drawerSel.attr('data-lane-index');
                const laneIndex = laneIndexAttr ? parseInt(laneIndexAttr, 10) : null;
                // find nearest time-strip ancestor
                let timeStrip = drawerNode.closest && drawerNode.closest('.time-strip');
                if (!timeStrip) {
                  // fallback: use mount selection's time-strips-group
                  timeStrip = (overlayNode.querySelector && overlayNode.querySelector('.time-strip')) || null;
                }
                if (timeStrip && laneIndex !== null) {
                  const swimlaneSelector = `.swimlane-${laneIndex}`;
                  const swimlaneGroup = timeStrip.querySelector(swimlaneSelector) as any;
                  if (swimlaneGroup) {
                    try { timeStrip.appendChild(swimlaneGroup); } catch(e) {}
                  } else {
                    // if no swimlaneGroup found, as fallback append drawer itself to overlay
                    try { overlayNode.appendChild(drawerNode); } catch(e) {}
                  }
                } else {
                  try { overlayNode.appendChild(drawerNode); } catch(e) {}
                }
              } catch(e) {
                try { overlayNode.appendChild(drawerNode); } catch(e) {}
              }
            // NOTE: 不要尝试把 display node append 到 drawer 内（我们不 reparent）。
            // 画面层级控制改为在同一父容器内进行 append/raise（如果需要）。
          }
        } catch (e) {
          // ignore move errors
        }

        // compute item targets using slot-based layout anchored at swimlane top
  const items = body.selectAll('.drawer-item');
        const itemNodes = items.nodes();
        if (itemNodes.length === 0) {
          body.transition().duration(120).style('opacity', 1 as any).on('end', () => {
            try { body.style('pointer-events', 'all'); } catch(e) {}
            try { this.bindDocumentClickToClose(); } catch(e) {}
            this.drawerTransitioning = false;
          });
        } else {
          try { body.on('wheel', function(event: WheelEvent) { try { event.stopPropagation(); event.preventDefault(); } catch(e) {} }); } catch(e) {}

          const baseX = nodeX;

          const nodeHeightLocal = nodeHeight || (itemNodes.length > 0 ? (() => {
            try { const firstChildRect = d3.select(itemNodes[0]).select('rect'); if (!firstChildRect.empty()) return parseFloat(firstChildRect.attr('height')) || 0; } catch(e) {}
            return nodeHeight || 0;
          })() : nodeHeight || 0);

          // slot layout params
          const slots = collapsedGroup.nodes.length;
          const slotHeight = this.SWIMLANE_HEIGHT;
          const paddingAround = 0; // no vertical padding to align to swimlane boundaries
          const preferredTop = collapsedGroup.swimlaneY || (drawerSel.attr('data-lane-index') ? (this.swimlanes[parseInt(drawerSel.attr('data-lane-index'), 10)]?.y || 0) : 0);

          const drawerFullHeight = slots * slotHeight + paddingAround * 2;
          const svgHeight = this.height;
          const availableDownSpace = svgHeight - preferredTop;
          const availableUpSpace = preferredTop;
          let expandUp = false;
          let drawerTop = preferredTop;
          if (availableDownSpace < drawerFullHeight && availableUpSpace >= drawerFullHeight) {
            expandUp = true;
            drawerTop = preferredTop - (drawerFullHeight - slotHeight);
          }

          const actualDrawerHeight = Math.min(drawerFullHeight, expandUp ? Math.min(availableUpSpace + slotHeight, drawerFullHeight) : availableDownSpace);
          const maxScroll = Math.max(0, drawerFullHeight - actualDrawerHeight);

          // animate bg to cover full slot area (horizontally bg x/width already set when prebuilt)
          try {
            body.style('pointer-events', 'none');
            body.attr('opacity', 1);
            // ensure bg is fully opaque and marked for debug
            try { bg.attr('fill-opacity', 1).attr('data-debug-bg', '1'); } catch(e) {}
            bg.transition().duration(200).attr('y', drawerTop).attr('height', actualDrawerHeight);
          } catch(e) {}

          // compute slot centers without vertical padding: center of each swimlane slot
          const slotYs: number[] = [];
          for (let i = 0; i < slots; i++) {
            const slotTop = drawerTop + i * slotHeight;
            const slotCenter = slotTop + slotHeight / 2;
            slotYs.push(slotCenter);
          }

          // render time-diff labels between slots (centered horizontally on bg)
          try {
            // remove any existing labels group
            body.selectAll('.drawer-labels').remove();
            const labelsGroup = body.append('g').attr('class', 'drawer-labels');
            const otherNodes = collapsedGroup.nodes.filter(n => n.id !== collapsedGroup.displayNode.id);
            // labels between display slot (slot 0) and each child slot
            for (let j = 0; j < otherNodes.length; j++) {
              const slotA = slotYs[j];
              const slotB = slotYs[j + 1] || slotYs[slotYs.length - 1];
              const labelY = Math.round((slotA + slotB) / 2);
              const timeDiff = Math.abs(otherNodes[j].timestamp - (collapsedGroup.displayNode.timestamp || 0));
              this.renderTimeDiffLabel(labelsGroup, bg.attr && parseFloat(bg.attr('x')) || (nodeX), labelY, (bg.attr && parseFloat(bg.attr('width')) ) || nodeWidth, timeDiff);
            }
          } catch(e) {}

          // animate items into their slots (children occupy slot 1..N-1)
          const itemDuration = 180;
          const stagger = 40;
          items.each(function(this: any, d: any, i: number) {
            try {
              const slotIndex = Math.min(i + 1, slotYs.length - 1);
              const targetCenter = slotYs[slotIndex];
              const targetTop = targetCenter - (nodeHeightLocal / 2);
              d3.select(this).style('pointer-events', 'none').attr('opacity', 0).transition().delay(i * stagger).duration(itemDuration).attr('transform', `translate(${baseX}, ${targetTop})`).attr('opacity', 1).on('end', function(this: any) { try { d3.select(this).style('pointer-events', 'all'); } catch(e) {} });
              d3.select(this).on('click.drawerItem', function(event: MouseEvent) { try { event.stopPropagation(); } catch(e) {} });
            } catch(e) {}
          });

          const totalAnim = 220 + itemNodes.length * stagger + itemDuration;
          setTimeout(() => {
            try { body.style('pointer-events', 'all'); } catch(e) {}
            this.currentOpenCollapseId = collapsedGroup.tabId;
            this.currentOpenDrawerSel = drawerSel;
            try { this.bindDocumentClickToClose(); } catch(e) {}
            this.drawerTransitioning = false;
          }, totalAnim);
        }
      } else {
        // close: reverse animation - collapse items to base position then shrink bg and hide
    if (this.drawerTransitioning) return; // ignore close while transitioning
    this.drawerTransitioning = true;
        const body = drawerSel.select('.drawer-body');
        const bg = body.select('.drawer-bg');
  const items = body.selectAll('.drawer-item');
        const itemNodes = items.nodes();

        // compute base pos from first item's current transform (or bg y)
  // compute base pos: use provided nodeX/nodeY
  const baseX = nodeX;
  const baseY = nodeY;

        const itemDuration = 140;
        const stagger = 30;
        // animate items back to baseY and fade out
        items.each(function(this: any, d: any, i: number) {
          d3.select(this)
            .style('pointer-events', 'none')
            .transition()
            .delay(i * stagger)
            .duration(itemDuration)
            .attr('transform', `translate(${baseX}, ${baseY})`)
            .attr('opacity', 0);
        });

        // after items collapsed, shrink bg and hide body
        const totalAnim = itemNodes.length * stagger + itemDuration + 40;
        setTimeout(() => {
            try {
            bg.transition().duration(160).attr('height', parseFloat(bg.attr('height')) ? parseFloat(bg.attr('height')) * 0 : 0).on('end', () => {
              try { body.attr('opacity', 0).style('pointer-events', 'none'); drawerSel.attr('data-open', 'false').style('pointer-events', 'none'); } catch(e) {}
              // cleanup currentOpen if this was the current
              if (this.currentOpenCollapseId === collapsedGroup.tabId) {
                this.currentOpenCollapseId = null;
                this.currentOpenDrawerSel = null;
              }
              // 取消文档点击绑定
              try { this.unbindDocumentClickToClose(); } catch(e) {}
              this.drawerTransitioning = false;
            });
          } catch(e) {
            body.attr('opacity', 0).style('pointer-events', 'none'); drawerSel.attr('data-open', 'false').style('pointer-events', 'none');
            if (this.currentOpenCollapseId === collapsedGroup.tabId) {
              this.currentOpenCollapseId = null;
              this.currentOpenDrawerSel = null;
            }
            try { this.unbindDocumentClickToClose(); } catch(e) {}
            this.drawerTransitioning = false;
          }
        }, totalAnim);
      }
    } catch (e) {
      logger.log('togglePrebuiltDrawer error', e);
    }
  }

  initialize(svg: any, container: HTMLElement, width: number, height: number): void {
    // badge styles are provided by main.css (merged at build time)
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
      logger.warn(_('waterfall_nodes_too_many', '⚠️ 节点数量过多({0})，限制为{1}个'), nodes.length, MAX_NODES);
      nodes = nodes.slice(0, MAX_NODES);
    }

    // 🛡️ 安全检查：验证时间戳有效性
    let validNodes = nodes.filter(node => {
      if (!node.timestamp || typeof node.timestamp !== 'number' || isNaN(node.timestamp)) {
        logger.warn(_('waterfall_invalid_timestamp_node', '⚠️ 发现无效时间戳的节点，已过滤:'), node);
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
    }

    if (validNodes.length === 0) {
      logger.warn('筛选后没有可显示的节点');
      return;
    }

    // 🔄 恢复观察窗口位置
    // 优先级：内存中的值 > localStorage 中的值 > 默认值 0
    let savedObservationIndex = this.visualizer.waterfallObservationIndex;
    
    logger.log(_('waterfall_restoring_observation_window', '🔍 开始恢复观察窗口位置检查: tabId={0}, 内存值={1}, 恢复变换={2}'), this.visualizer.tabId, savedObservationIndex, options?.restoreTransform);
    
    // 如果内存中没有值，尝试从 localStorage 恢复
    if (savedObservationIndex === undefined && options?.restoreTransform) {
      const savedState = getViewState(this.visualizer.tabId || '', 'waterfall');
      
      if (savedState && savedState.waterfallObservationIndex !== undefined) {
        savedObservationIndex = savedState.waterfallObservationIndex;
        // 同步到内存
        this.visualizer.waterfallObservationIndex = savedObservationIndex;
      }
    }
    
    const useRestoredPosition = options?.restoreTransform && savedObservationIndex !== undefined;
    
    if (useRestoredPosition && savedObservationIndex !== 0) {
      this.observationStartIndex = savedObservationIndex!;
    } else if (savedObservationIndex === 0 && options?.restoreTransform) {
      this.observationStartIndex = 0;
    } else {
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

    // 5. 渲染各个部分（使用新的分离结构）
    this.renderTimeAxis(mainGroup.timeAxisGroup, layout); // 🕐 时间轴（固定，不滚动）
    this.renderTimeStrips(mainGroup.timeStripsGroup, layout); // 🎨 垂直时间条带（可滚动）
    this.renderSwimlaneSeparators(mainGroup.swimlaneSeperatorsGroup, layout); // 🏊 泳道分隔线（可滚动）
    this.renderSegmentNodes(mainGroup.nodesGroup, layout); // 🎯 纯粹的节点（可滚动）
    this.renderClosureMarkers(mainGroup.closureMarkersGroup, layout); // 🔴 关闭标记（可滚动）
    this.renderObservationWindowSlider(mainGroup.focusOverlayGroup, layout); // 🎚️ 观察窗口（固定，不滚动）
    
    // 6. 设置滚轮事件来滚动泳道（垂直方向）
    this.setupWheelScroll(); // 🎯 重新启用：只用于垂直滚动泳道
    
    // 7. 设置垂直拖拽滚动
    this.setupVerticalDragScroll();
    
    // 8. 存储选项供后续使用
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
      logger.warn(_('waterfall_analyze_swimlanes_deprecated', '⚠️ analyzeSwimlanes_deprecated 方法已弃用，请使用新的泳道复用算法'));
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
        logger.log(_('waterfall_create_closure_marker', '🔴 创建关闭标记: 标签{0}, 时间戳={1}, 泳道={2}'), marker.tabId, marker.timestamp, marker.swimlaneIndex);
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
      logger.log(_('waterfall_can_reuse_lane_ok', '✅ 泳道可复用检查通过: 新标签 {0} ({1}) 在关闭标记 {2} 之后开始'), newLifecycle.tabId, new Date(newLifecycle.startTime).toLocaleTimeString(), new Date(lastLifecycle.closureMarkerTime).toLocaleTimeString());
    } else {
      logger.log(_('waterfall_can_reuse_lane_fail', '泳道复用检查失败: 新标签 {0} 时间冲突'), newLifecycle.tabId);
    }
    
    return canReuse;
  }

  /**
   * 分配泳道Y坐标 - 新版本：所有泳道都完整渲染，从0开始
   */
  private assignSwimlanePositions(swimlanes: Swimlane[]): void {
    // 新架构：内容容器在viewport内部，坐标从0开始
    const startY = 20; // 顶部留一点间距
    
    swimlanes.forEach((lane, index) => {
      lane.y = startY + (index * this.SWIMLANE_HEIGHT);
    });
    
    logger.log(_('waterfall_assign_swimlane_positions', '🏊 分配泳道位置: 起始Y={0}, 泳道数={1}, 总高度={2}'), startY, swimlanes.length, startY + swimlanes.length * this.SWIMLANE_HEIGHT);
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
            logger.warn(_('waterfall_swimlane_not_found', '⚠️ 未找到标签页 {0} 对应的泳道'), tabId);
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
    
    logger.log(_('waterfall_identified_collapsed_groups', '🎯 识别出 {0} 个折叠节点组'), groups.length, groups);
    
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
      
      logger.log(_('waterfall_segments_generated', '🎯 时间段生成: 节点时间范围 {0}-{1}, 段时间范围 {2}-{3}'), maxTimeRaw, minTimeRaw, maxTime, minTime);

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
        logger.error(_('waterfall_segment_loop_max_iter', '⚠️ 时间分段循环达到最大迭代次数，强制终止'));
      }


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
        
    logger.log(_('waterfall_adding_filler_segments', '🎯 添加 {0} 个空白区段以铺满空间'), additionalSegmentCount);
        
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
      
    logger.log(_('waterfall_no_compression', '✅ 无需压缩，{0}个数据段 + {1}个空白段，标准宽度 {2}px'), segments.length, allSegments.length - segments.length, standardSegmentWidth);
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
   * 创建SVG分组结构 - 重新设计：明确的viewport和完整内容渲染
   */
  private createSVGGroups(container: any) {
    const timeAxisHeight = 100;
    
    // 时间轴组（固定在顶部，不参与滚动）
    const timeAxisGroup = container.append('g').attr('class', 'time-axis-group');
    
    // 创建可视区域viewport（明确的边界矩形）
    const viewportGroup = container.append('g')
      .attr('class', 'viewport-group')
      .attr('transform', `translate(0, ${timeAxisHeight})`); // 在时间轴下方
    
    // 添加viewport的边界矩形（用于裁剪）
    const viewportHeight = this.height - timeAxisHeight;
    const viewportDefs = container.append('defs');
    viewportDefs.append('clipPath')
      .attr('id', 'viewport-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', this.width)
      .attr('height', viewportHeight);
    
    // 应用裁剪到viewport
    viewportGroup.attr('clip-path', 'url(#viewport-clip)');
    
    // 在viewport内创建内容容器（这个容器会滚动）
    const contentGroup = viewportGroup.append('g').attr('class', 'content-group');
    
    // 保存引用
    this.scrollableGroup = contentGroup;
    
    // 在内容组内创建各个子组（所有内容都完整渲染）
    const timeStripsGroup = contentGroup.append('g').attr('class', 'time-strips-group');
    const swimlaneSeperatorsGroup = contentGroup.append('g').attr('class', 'swimlane-separators-group');
    
    const nodesGroup = contentGroup.append('g').attr('class', 'nodes-group');
    const closureMarkersGroup = contentGroup.append('g').attr('class', 'closure-markers-group');
    
    // 🎯 重新设计：拖拽层放在节点层之后，这样节点可以直接接收点击事件
    const dragLayerGroup = contentGroup.append('g').attr('class', 'drag-layer-group');
    
    // 焦点覆盖组（固定在顶部，不参与滚动）
    const focusOverlayGroup = container.append('g').attr('class', 'focus-overlay-group');
    
    logger.log(_('waterfall_created_svg_structure', '📦 创建SVG结构: viewport高度={0}, 时间轴高度={1}'), viewportHeight, timeAxisHeight);
    
    return {
      timeAxisGroup,
      viewportGroup,     // 新增：可视区域容器
      contentGroup,      // 新增：内容容器（可滚动）
      scrollableGroup: contentGroup, // 兼容性引用
      timeStripsGroup,
      swimlaneSeperatorsGroup,
      dragLayerGroup,    // 🎯 新增：拖拽层组
      nodesGroup,
      closureMarkersGroup,
      focusOverlayGroup
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

    logger.log(_('waterfall_render_swimlane_separators', '🏊 渲染 {0} 条泳道分隔线和数字标识'), this.swimlanes.length);

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
    logger.log(_('waterfall_render_time_axis_start', '🕐 渲染时间轴（仅横线、箭头、标签）- 清理旧内容'));

    // 🧹 清空时间轴组，避免重复渲染
    group.selectAll('*').remove();

    // 🎨 创建分组结构
    const axisLineGroup = group.append('g').attr('class', 'time-axis-line');
    const labelGroup = group.append('g').attr('class', 'time-axis-labels');

    // 📏 时间轴横线位置
    const timeAxisY = 80; // 时间轴横线的Y坐标（降低避免与顶部图标重叠）

    // 🎯 绘制时间轴横线（横贯整个时间轴区域）
    const timeAxisMargin = 50; // 时间轴左右边距
    const lineStartX = timeAxisMargin; // 从左边距开始
    const lineEndX = this.width - timeAxisMargin; // 到右边距结束
    
    logger.log(_('waterfall_time_axis_span', '🎯 时间轴横贯整个区域: 从 {0} 到 {1} (SVG宽度: {2})'), lineStartX, lineEndX, this.width);
    
    // 主时间轴线（横贯整个时间轴区域）
    axisLineGroup.append('line')
      .attr('x1', lineStartX)
      .attr('y1', timeAxisY)
      .attr('x2', lineEndX)
      .attr('y2', timeAxisY)
      .attr('stroke', '#666')
      .attr('stroke-width', 2)
      .attr('class', 'time-axis-main-line');
    
    // 时间方向箭头（在最右端 - 指向新时间方向）
    // 因为时间从右到左（最新在左），时间轴从旧到新，所以箭头在右端指向右
    const arrowSize = 8;
    axisLineGroup.append('polygon')
      .attr('points', `${lineEndX},${timeAxisY} ${lineEndX - arrowSize},${timeAxisY - arrowSize/2} ${lineEndX - arrowSize},${timeAxisY + arrowSize/2}`)
      .attr('fill', '#666')
      .attr('class', 'time-axis-arrow');

    // 🎯 渲染时间标签（在时间轴组中，固定显示）
    let labelCount = 0;
    layout.segments.forEach((segment, i) => {
      if (segment && (segment.displayMode === 'full' || segment.displayMode === 'short')) {
        this.addTimeLabelToTimeAxis(labelGroup, segment, timeAxisY);
        labelCount++;
      }
    });
    
    logger.log(_('waterfall_time_axis_done', '✅ 时间轴渲染完成: 横线 ✓, 箭头 ✓, 时间标签 {0} 个'), labelCount);
  }

  /**
   * 添加时间标签到时间轴（固定位置）
   */
  private addTimeLabelToTimeAxis(group: any, segment: TimeSegment, timeAxisY: number = 80): void {
    const timeLabel = new Date(segment.endTime).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const centerX = segment.startX + segment.allocatedWidth / 2;

    // 刻度线（向上，朝向时间标签）
    group.append('line')
      .attr('class', 'time-tick')
      .attr('x1', centerX)
      .attr('y1', timeAxisY)
      .attr('x2', centerX)
      .attr('y2', timeAxisY - 8)
      .attr('stroke', '#666')
      .attr('stroke-width', 1);

    // 时间标签在横线上方
    group.append('text')
      .attr('class', 'time-label')
      .attr('x', centerX)
      .attr('y', timeAxisY - 10)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'bottom')
      .attr('font-family', 'Arial, sans-serif')
      .attr('font-size', '11px')
      .attr('fill', '#666')
      .text(timeLabel);
  }

  /**
   * � 渲染独立的时间条带背景
   */
  private renderTimeStrips(group: any, layout: LayoutResult): void {
    logger.log(_('waterfall_render_time_strips', '🎨 渲染独立的时间条带背景（可滚动）'));

    // ⚡ 获取条带相关常量
    const stripTop = 0; // 条带顶部Y坐标（相对于组）
    const stripHeight = this.height; // 条带高度（覆盖整个高度）
    
    // 🧹 清空并重建strips数组（兼容现有系统）
    this.strips = [];
    
    // 🎨 渲染条带背景和创建strips数组
    layout.segments.forEach((segment) => {
      // 🎯 使用原始索引决定明暗，保证条带颜色不会因为拖动而改变
      const isEven = segment.originalIndex % 2 === 0;
      
  // （已移除）误插入的 appendBadge - badge 应由节点渲染函数内部创建
      const stripBg = group.append('rect')
        .attr('class', `strip-background strip-${segment.originalIndex}`)
        .attr('data-time', new Date(segment.endTime).toISOString())
        .attr('data-segment-index', segment.originalIndex)
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
      
      // 🎯 为兼容现有系统，创建虚拟的strip组
      // 这样现有的节点渲染逻辑可以继续工作
      const stripGroup = group.append('g')
        .attr('class', `time-strip time-strip-${segment.originalIndex}`)
        .attr('data-time', new Date(segment.endTime).toISOString())
        .attr('data-segment-index', segment.originalIndex);
      
      // 添加节点分组（现有系统期望的结构）
      const nodeGroup = stripGroup.append('g')
        .attr('class', 'node-group')
        .attr('transform', `translate(0, 0)`);
      
      // 保存到strips数组
      this.strips.push(stripGroup);
    });
    
  logger.log(_('waterfall_time_strips_done', '✅ 渲染了 {0} 个时间条带背景，创建了 {1} 个strips'), layout.segments.length, this.strips.length);
  }

  /**
   * �🎯 添加时间标签到条带（时间标签归属于条带）
   */
  /**
   * ⚠️ 已禁用 addTimeLabelToStrip 方法
   * 原因：条带中的时间标签与固定时间轴冲突，导致错误渲染
   * 现在时间标签统一由 addTimeLabelToTimeAxis 在固定时间轴中渲染
   */
  private addTimeLabelToStrip(strip: any, segment: TimeSegment, timeAxisY: number = 80): void {
    // 方法已禁用，时间标签由固定时间轴负责
  logger.warn(_('waterfall_addTimeLabel_disabled', '⚠️ addTimeLabelToStrip 已禁用，时间标签由固定时间轴负责'));
    return;
    
    /* 原代码已注释
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
    */
  }

  /**
   * 按段渲染节点
   */
  private renderSegmentNodes(group: any, layout: LayoutResult): void {
  logger.log(_('waterfall_render_segment_nodes', '🎯 渲染段节点，段数量: {0}'), layout.segments.length);

    let totalNodesRendered = 0;
    const MAX_NODES_TO_RENDER = 500; // 防止渲染过多节点

    layout.segments.forEach((segment, segIndex) => {
      if (totalNodesRendered >= MAX_NODES_TO_RENDER) {
  logger.warn(_('waterfall_max_nodes_rendered', '⚠️ 已渲染{0}个节点，跳过剩余段'), totalNodesRendered);
        return;
      }

      // 🎯 使用strips数组中对应的条带分组
      const strip = this.strips[segIndex];
      if (!strip) {
  logger.warn(_('waterfall_strip_not_found', '⚠️ 找不到段 {0} 的条带分组'), segIndex);
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
          return;
        }
        
        // Ensure nodes are grouped by swimlane inside the strip so we can z-order per-swimlane
        const swimlane = this.getSwimlaneForNode(node);
        const laneIndex = swimlane ? swimlane.laneIndex : 0;

        // find or create swimlane subgroup under nodeGroup
        let swimlaneGroup = nodeGroup.select(`g.swimlane-${laneIndex}`);
        if (swimlaneGroup.empty()) {
          swimlaneGroup = nodeGroup.append('g')
            .attr('class', `swimlane-group swimlane-${laneIndex}`)
            .attr('data-lane-index', laneIndex);
        }

        const createdNodeGroup = this.renderSingleNode(swimlaneGroup, node, segment, index);
        
        // 🎯 如果这个节点是折叠组的显示节点，渲染折叠角标
        // 但是 dot 模式不需要折叠角标
        if (segment.displayMode !== 'dot') {
          const collapsedGroup = collapsedGroupsInSegment.find(
            g => g.displayNode.id === node.id
          );
          // 无论是否有折叠组，都在节点处预建一个 collapsed-drawer 容器（默认为空/隐藏）
          try {
            // Prebuild drawer container as a child of the swimlane group so we can
            // raise the entire swimlane to control z-order when opening.
            const parentSel = d3.select((swimlaneGroup && swimlaneGroup.node()) || nodeGroup.node());
            const drawerSel = parentSel.insert('g', () => (createdNodeGroup && createdNodeGroup.node()) as any)
              .attr('class', 'collapsed-drawer')
              .attr('data-collapse-group', collapsedGroup ? collapsedGroup.tabId : `none-${node.id}`)
              .attr('data-open', 'false')
              .attr('data-lane-index', laneIndex)
              .style('pointer-events', 'none');

            // 创建 drawer-body（包含背景与 items），默认隐藏（opacity 0 和 pointer-events none）
            const bodyGroup = drawerSel.append('g')
              .attr('class', 'drawer-body')
              .style('pointer-events', 'none')
              .attr('opacity', 0);

            // 背景矩形（在后面计算 nodeX/nodeY 后创建）

            // NOTE: 不要把 navigation-node 移入 drawer 容器。
            // 把节点移动到 drawer 会导致当 drawer 的外层容器设置
            // pointer-events: none 时，节点也变得不可点击（SVG group 的 pointer-events
            // 会使子元素不可交互）。为避免此副作用，保持节点原位，不在此处 reparent。
            // 如果需要提升 z-order，请在打开抽屉时在同一父容器内做 append/raise（而不是把节点移动到 drawer 内）。

            // 如果存在折叠组则填充 drawer-items，否则保持空
            if (collapsedGroup) {
              this.renderCollapseBadge(createdNodeGroup || nodeGroup, node, segment, collapsedGroup);

              const nodeWidth = this.NODE_WIDTHS[segment.displayMode];
              const nodeHeight = this.NODE_HEIGHTS[segment.displayMode];
              const verticalPadding = (this.SWIMLANE_HEIGHT - nodeHeight) / 2;
              const centerOffset = (segment.allocatedWidth - nodeWidth) / 2;
              const nodeX = segment.startX + Math.max(0, centerOffset);
              const nodeY = (this.getSwimlaneForNode(node)?.y || 0) + verticalPadding;

                // 背景矩形（初始化为与 display node 同高，展开时再伸展）
                const bgRect = bodyGroup.append('rect')
                  .attr('class', 'drawer-bg')
                  .attr('x', nodeX)
                  .attr('y', nodeY)
                  .attr('width', nodeWidth)
                  .attr('height', nodeHeight)
                  .attr('fill', '#e6f2ff')
                  .attr('fill-opacity', 1)
                  .attr('data-debug-bg', '1')
                  .attr('stroke', 'rgba(74, 144, 226, 0.6)')
                  .attr('stroke-width', 1)
                  .style('pointer-events', 'none');

                const itemsGroup = bodyGroup.append('g').attr('class', 'drawer-items');

              // 其他节点按顺序创建（不包含 displayNode），初始都重叠在 displayNode 位置并不可交互
              const otherNodes = collapsedGroup.nodes.filter(n => n.id !== node.id);
              otherNodes.forEach((childNode) => {
                const item = itemsGroup.append('g')
                  .attr('class', 'drawer-item')
                  .attr('data-node-id', childNode.id)
                  .attr('transform', `translate(${nodeX}, ${nodeY})`)
                  .style('pointer-events', 'none')
                  .attr('opacity', 0);

                if (segment.displayMode === 'full') {
                  this.renderFullNode(item, childNode, nodeWidth, nodeHeight);
                } else if (segment.displayMode === 'short') {
                  this.renderShortNode(item, childNode, nodeWidth, nodeHeight);
                } else if (segment.displayMode === 'icon') {
                  this.renderIconNode(item, childNode, 20, 20);
                } else if (segment.displayMode === 'dot') {
                  this.renderDotNode(item, childNode, nodeWidth, nodeHeight);
                }
              });

              // 绑定折叠角标点击到切换预建抽屉
              try {
                const badgeSel = (createdNodeGroup || nodeGroup).select('.group-badge');
                if (!badgeSel.empty()) {
                  badgeSel.on('click', (event: MouseEvent) => {
                    event.stopPropagation();
                    this.togglePrebuiltDrawer(collapsedGroup, segment, nodeX, nodeY, nodeWidth, nodeHeight);
                  });
                }
              } catch (e) {
                // ignore
              }
            }
          } catch (e) {
            logger.log('prebuild drawer error', e);
          }
        }
        
        totalNodesRendered++;
      });
    });

  logger.log(_('waterfall_total_nodes_rendered', '✅ 总共渲染了 {0} 个节点'), totalNodesRendered);
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

  logger.log(_('waterfall_render_closure_markers', '🔴 渲染 {0} 个关闭标记'), this.closureMarkers.length);

    // 创建关闭标记分组
    const markerGroup = group.append('g').attr('class', 'closure-markers');

    this.closureMarkers.forEach(marker => {
      // 🎯 边界外过滤：跳过超出时间段范围的关闭标记（节省空间）
      if (layout.segments.length > 0) {
        const firstSegment = layout.segments[0]; // 最新时间段
        const lastSegment = layout.segments[layout.segments.length - 1]; // 最早时间段
        
        if (marker.timestamp > firstSegment.endTime || marker.timestamp < lastSegment.startTime) {
          return;
        }
      }
      
      // 找到标记对应的时间段和泳道
      const segment = this.findSegmentByTimestamp(marker.timestamp, layout);
      const swimlane = this.swimlanes[marker.swimlaneIndex];
      
      if (!segment || !swimlane) {
  logger.error(_('waterfall_closure_marker_debug', '❌ 关闭标记调试信息:'));
  logger.error(_('waterfall_closure_marker_id', '   标签ID: {0}'), marker.tabId);
  logger.error(_('waterfall_closure_marker_timestamp', '   时间戳: {0} ({1})'), marker.timestamp, new Date(marker.timestamp).toLocaleString());
  logger.error(_('waterfall_closure_marker_swimlane_index', '   泳道索引: {0}'), marker.swimlaneIndex);
  logger.error(_('waterfall_closure_marker_segment_found', '   找到的段: {0}'), segment ? '是' : '否');
  logger.error(_('waterfall_closure_marker_swimlane_found', '   找到的泳道: {0}'), swimlane ? '是' : '否');
  logger.error(_('waterfall_closure_marker_total_segments', '   总段数: {0}'), layout.segments.length);
  logger.error(_('waterfall_closure_marker_total_swimlanes', '   总泳道数: {0}'), this.swimlanes.length);
        
        if (layout.segments.length > 0) {
          const firstSegment = layout.segments[0];
          const lastSegment = layout.segments[layout.segments.length - 1];
          logger.error(_('waterfall_closure_marker_segment_range', '   段时间范围: {0} - {1}'), firstSegment.startTime, lastSegment.endTime);
          logger.error(_('waterfall_closure_marker_segment_range_readable', '   段时间范围（可读）: {0} - {1}'), new Date(firstSegment.startTime).toLocaleString(), new Date(lastSegment.endTime).toLocaleString());
        }
        
  logger.warn(_('waterfall_cannot_find_closure_marker', '⚠️ 无法找到关闭标记 {0} 的对应段或泳道'), marker.tabId);
        return;
      }

      // 🎯 只跳过填充的空白段中的关闭标记，但允许在数据空段中显示
      if (segment.isFiller) {
  logger.log(_('waterfall_skip_filler_closure', '⚡ 跳过填充空白段中的关闭标记: {0}'), marker.tabId);
        return;
      }
      
      if (segment.displayMode === 'dot' || segment.displayMode === 'icon') {
  logger.log(_('waterfall_skip_compressed_closure', '⚡ 跳过压缩条带中的关闭标记: {0} (模式: {1})'), marker.tabId, segment.displayMode);
        return;
      }

      // 🎯 关闭标记应该显示在找到的时间段的中央
      // 因为整个段都表示"该泳道现在可以复用"的状态
      const markerX = segment.startX + (segment.allocatedWidth / 2);
      const markerY = swimlane.y + (this.SWIMLANE_HEIGHT / 2); // 泳道中央
      
  logger.log(_('waterfall_closure_marker_render_pos', '🎯 关闭标记 {0} 显示在段中央: X={1}, 段范围=[{2}-{3}]'), marker.tabId, markerX.toFixed(1), segment.startTime, segment.endTime);
      
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

  logger.log(_('waterfall_closure_marker_rendered', '🔴 已渲染关闭标记: {0} at ({1}, {2})'), marker.tabId, markerX.toFixed(1), markerY.toFixed(1));
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
  logger.warn(_('waterfall_findSegment_debug', '🔍 findSegmentByTimestamp 调试信息:'));
  logger.warn(_('waterfall_findSegment_lookup_ts', '   查找时间戳: {0} ({1})'), timestamp, new Date(timestamp).toLocaleString());
  logger.warn(_('waterfall_findSegment_total_segments', '   总段数: {0}'), layout.segments.length);
    
    if (layout.segments.length > 0) {
      logger.warn(_('waterfall_findSegment_segments_list', '   段列表:'));
      layout.segments.forEach((seg, index) => {
        const inRange = timestamp >= seg.startTime && timestamp <= seg.endTime;
        logger.warn(_('waterfall_findSegment_segment_line', '     [{0}] {1}-{2} ({3} - {4}) {5} nodes:{6} filler:{7}'), index, seg.startTime, seg.endTime, new Date(seg.startTime).toLocaleString(), new Date(seg.endTime).toLocaleString(), inRange ? '✅' : '❌', seg.nodes.length, seg.isFiller);
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
        logger.log(_('waterfall_closure_ts_out_of_range_use_last', '🎯 关闭标记时间戳 {0} 超出范围，使用最后段 [{1}-{2}]'), timestamp, lastSegment.startTime, lastSegment.endTime);
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
        logger.log(_('waterfall_closure_ts_found_closest', '🎯 关闭标记时间戳 {0} 找到最接近段 [{1}-{2}]，距离 {3}秒'), timestamp, closestSegment.startTime, closestSegment.endTime, (minDistance / 1000).toFixed(1));
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
    
    // 🎯 改为只占据节点右下半高区域，释放右上区域给 SPA 角标使用
    const badgeText = `${collapsedGroup.count}`;
    const badgeWidth = 22; // 宽度保持不变
    const badgeHeight = Math.max(12, Math.floor(nodeHeight / 2)); // 占半高，至少12px

    // 右下角对齐：如果传入的 group 已经是单个节点的 group（navigation-node），
    // 则使用局部坐标 (相对于 nodeGroup)。否则使用绝对坐标（相对于 svg/contentGroup）。
    let badgeTransformX: number;
    let badgeTransformY: number;

    try {
      const parentEl = (group && typeof group.node === 'function') ? group.node() as Element : null;
      const parentClass = parentEl && parentEl.getAttribute ? parentEl.getAttribute('class') || '' : '';
      const isNodeGroup = parentClass.indexOf('navigation-node') !== -1;

      if (isNodeGroup) {
        // 在 nodeGroup 内使用局部坐标
        badgeTransformX = nodeWidth - badgeWidth;
        badgeTransformY = nodeHeight - badgeHeight;
      } else {
        // 使用绝对坐标
        badgeTransformX = nodeX + nodeWidth - badgeWidth;
        badgeTransformY = nodeY + nodeHeight - badgeHeight;
      }
    } catch (err) {
      // 如果检查失败，回退到绝对坐标
      badgeTransformX = nodeX + nodeWidth - badgeWidth;
      badgeTransformY = nodeY + nodeHeight - badgeHeight;
    }

    // 使用统一的 appendBadge 创建折叠徽章（右下圆角）
  const collapseBadgeGroup = this.appendBadge(group, badgeTransformX, badgeTransformY, badgeText, { corner: 'bottom', fixedWidth: badgeWidth, minHeight: badgeHeight, fontSize: 7 });
    collapseBadgeGroup.attr('class', 'group-badge').attr('data-collapse-group', collapsedGroup.tabId).style('cursor', 'pointer').style('pointer-events', 'all');

    // 悬停效果：只改变 path 的样式
    collapseBadgeGroup.on('mouseenter', function(this: SVGGElement) {
      d3.select(this).select('path')
        .transition()
        .duration(200)
        .attr('opacity', 1)
        .attr('fill', '#1a1a1a');
    }).on('mouseleave', function(this: SVGGElement) {
      d3.select(this).select('path')
        .transition()
        .duration(200)
        .attr('opacity', 0.95)
        .attr('fill', '#2c2c2c');
    });

      // 如果 node 上记录了 spa badge 的宽度，优先使用它来定位 SPA 徽章，确保两者不重叠
      try {
        const spaWidthFromNode = (node as any).__spaBadgeWidth || 0;
        const gapBetween = 6;
        if (spaWidthFromNode) {
          // 对齐到节点右侧：让 SPA badge 的右边贴合节点右边（与 collapse 的右边一致）
          const spaTargetX = Math.max(4, nodeWidth - spaWidthFromNode);
          const spaSel = (group && typeof group.select === 'function') ? group.select('.spa-request-badge') : null;
          if (spaSel && !spaSel.empty()) {
            // 保留 SPA badge 当前 Y 值，仅更新 X
            try {
              const curTransform = spaSel.attr('transform') || '';
              const m = /translate\(([-0-9.]+),\s*([-0-9.]+)\)/.exec(curTransform);
              const curY = m ? parseFloat(m[2]) : 0;
              spaSel.attr('transform', `translate(${spaTargetX}, ${curY})`);
            } catch (err) {
              spaSel.attr('transform', `translate(${spaTargetX}, 0)`);
            }
          }
        }
      } catch (e) {
        // ignore reposition errors
      }

    // 点击事件 - 切换预建抽屉（使用统一的 toggle 实现）
    collapseBadgeGroup.on('click', (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();

      logger.log(_('waterfall_collapse_badge_clicked', '🎯 折叠角标被点击: tabId={0}, count={1}'), collapsedGroup.tabId, collapsedGroup.count, collapsedGroup.nodes.map(n => n.title || n.url));

      try {
        this.togglePrebuiltDrawer(collapsedGroup, segment, nodeX, nodeY, nodeWidth, nodeHeight);
      } catch (e) {
        // fallback
        try { this.showCollapsedNodesDrawer(collapsedGroup, node, segment, nodeX, nodeY, nodeWidth, nodeHeight); } catch(e) {}
      }
    });

  }

  /**
   * 统一的徽章创建器：在 parent 上创建一个带 path + text 的 badge
   * 返回创建的 badgeGroup 供外部进一步调整/绑定事件
   */
  private appendBadge(parent: any, x: number, y: number, text: string, options?: { corner?: 'top' | 'bottom', minWidth?: number, fixedWidth?: number, minHeight?: number, fontSize?: number }) {
    const corner = options?.corner || 'top';
    const minWidth = options?.minWidth || 16;
    const fixedWidth = options?.fixedWidth;
    const fontSize = options?.fontSize || 12;

    const paddingX = 6; // 左右内边距
    const approxCharWidth = (fontSize >= 12) ? 7 : 5; // 粗略估算
    const estWidth = Math.max(minWidth, paddingX * 2 + approxCharWidth * text.length);
    const finalWidth = typeof fixedWidth === 'number' ? fixedWidth : estWidth;
  const estHeight = Math.max(10, Math.min(20, Math.round(fontSize * 1.6)));
  const finalHeight = Math.max(estHeight, options?.minHeight || 0);

    const badgeGroup = parent.append('g')
      .attr('class', 'spa-request-badge')
      .attr('transform', `translate(${x}, ${y})`);

    // 根据 corner 决定哪侧为圆角（top => 右上圆角, bottom => 右下圆角）
    const radius = Math.min(4, Math.floor(estHeight / 2));
  // finalHeight already computed above (considering minHeight)
  const finalW = Math.max(finalWidth, minWidth);
    let pathD: string;
    if (corner === 'top') {
      pathD = `M 0,0 L ${finalW - radius},0 Q ${finalW},0 ${finalW},${radius} L ${finalW},${finalHeight} L 0,${finalHeight} Z`;
    } else {
      pathD = `M 0,0 L ${finalW},0 L ${finalW},${finalHeight - radius} Q ${finalW},${finalHeight} ${finalW - radius},${finalHeight} L 0,${finalHeight} Z`;
    }

    badgeGroup.append('path')
      .attr('d', pathD)
      .attr('fill', '#2c2c2c')
      .attr('opacity', 0.95)
      .attr('stroke', 'rgba(255,255,255,0.2)')
      .attr('stroke-width', 0.5);

    badgeGroup.append('text')
      .attr('class', 'group-badge-text')
      .attr('x', finalW / 2)
      .attr('y', finalHeight / 2 + (fontSize >= 12 ? 1 : 0))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', `${fontSize}px`)
      .attr('font-weight', 'bold')
      .attr('fill', '#ffffff')
      .text(text)
      .style('pointer-events', 'none');

    // 标注固定宽高供外部使用（避免内部后置移动引入偏差）
    badgeGroup.attr('data-badge-width', finalW).attr('data-badge-height', finalHeight);

    return badgeGroup;
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

  logger.log(_('waterfall_show_collapsed_drawer_called', '🔔 showCollapsedNodesDrawer called for {0}'), collapsedGroup.tabId);
  // 抽屉布局规则：
    // - 顶部从显示节点泳道上缘开始（drawerTop = swimlane.y）
    // - 抽屉左右比节点宽，左右各有 horizontalPadding
    // - 抽屉高度为 slots * SWIMLANE_HEIGHT + paddingAround*2
    // - 每个槽高度为 SWIMLANE_HEIGHT，节点垂直居中于槽
    const slots = collapsedGroup.nodes.length; // 包含 display node
  const slotHeight = this.SWIMLANE_HEIGHT;
  const paddingAround = 0; // 不在垂直方向增加额外留白，确保抽屉底部在下一泳道线
    const horizontalPadding = Math.max(8, Math.round(nodeWidth * 0.15)); // 左右扩展，使抽屉比节点宽

    const preferredTop = swimlane.y; // 从泳道上缘开始
  const drawerFullHeight = slots * slotHeight; // 精确占用 N 个泳道高度

    const svgHeight = this.height;
    const availableDownSpace = svgHeight - preferredTop;
    const availableUpSpace = preferredTop;

    // 决定展开方向：优先向下；若下方空间不足且上方足够则向上
    let drawerTop = preferredTop;
    let expandUp = false;
    if (availableDownSpace < drawerFullHeight && availableUpSpace >= drawerFullHeight) {
      expandUp = true;
      // 使槽0（display node 的槽）位于泳道上缘
      drawerTop = swimlane.y - (drawerFullHeight - slotHeight);
    }

    // 实际可见高度（当空间不足时会剪裁并启用滚动）
    const actualDrawerHeight = Math.min(drawerFullHeight, expandUp ? Math.min(availableUpSpace + slotHeight, drawerFullHeight) : availableDownSpace);
    let scrollOffset = 0;
    const maxScroll = Math.max(0, drawerFullHeight - actualDrawerHeight);

    const drawer = this.svg.append('g')
      .attr('class', 'collapsed-nodes-drawer')
      .attr('data-swimlane', `lane-${swimlane.laneIndex}`)
      .style('pointer-events', 'none');

    // 背景矩形在水平上扩展，以便左右超出节点
    const bgX = Math.max(0, nodeX - horizontalPadding);
    const bgWidth = nodeWidth + horizontalPadding * 2;

    try { console.log('DEBUG: showCollapsedNodesDrawer called for', collapsedGroup.tabId); } catch(e) {}
    const bgRect = drawer.append('rect')
      .attr('x', bgX)
      .attr('y', drawerTop)
      .attr('width', bgWidth)
      .attr('height', actualDrawerHeight)
      .attr('fill', '#e6f2ff')
      .attr('data-debug-bg', '1')
      .attr('fill-opacity', 1)
      .attr('stroke', 'rgba(74, 144, 226, 0.6)')
      .attr('stroke-width', 1)
      .style('pointer-events', 'all')
      .style('cursor', 'default');

    const nodesContainer = drawer.append('g')
      .attr('class', 'drawer-nodes-container')
      .attr('transform', `translate(0, 0)`);
    
    // 🎯 在背景矩形上直接处理滚动事件（nodesContainer已创建，可以使用）
    bgRect.on('wheel', (event: WheelEvent) => {
      // 🛡️ 如果正在拖拽观察窗口，禁用抽屉内滚轮事件（防止Magic Mouse误触）
      if (this.isDraggingObservationWindow) {
        event.preventDefault();
        event.stopPropagation();
        logger.log(_('waterfall_drawer_wheel_disabled_during_observation_drag', '🚫 观察窗口拖拽期间禁用抽屉滚轮滚动（防止Magic Mouse误触）'));
        return;
      }
      
      event.preventDefault();
      event.stopPropagation();
      
  logger.log(_('waterfall_drawer_scroll_intercepted', '🎯 浮层滚动事件被拦截'));
      
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
    
    // 🎯 按槽位渲染所有节点（包含 display node 占 slot 0）
    const slotsCount = slots; // collapsedGroup.nodes.length
    const slotPad = (slotHeight - nodeHeight) / 2;

    // compute center Y for each slot (no vertical padding)
    const slotYs: number[] = [];
    for (let i = 0; i < slotsCount; i++) {
      const slotTop = drawerTop + i * slotHeight;
      const slotCenter = slotTop + slotHeight / 2;
      slotYs.push(slotCenter);
    }

    // children occupy slot 1..N-1 (slot 0 is display node)
    otherNodes.forEach((childNode, idx) => {
      const slotIndex = Math.min(idx + 1, slotYs.length - 1);
  const currentNodeY = slotYs[slotIndex];

      // 时间差标签放在相邻槽中心之间（标签居中于背景宽度）
      if (idx === 0) {
        const timeDiff = Math.abs(childNode.timestamp - firstNode.timestamp);
        const labelY = Math.round((slotYs[0] + currentNodeY) / 2);
        this.renderTimeDiffLabel(nodesContainer, bgX + bgWidth / 2, labelY, bgWidth, timeDiff);
      } else {
        const prevY = slotYs[slotIndex - 1];
        const timeDiff = Math.abs(childNode.timestamp - otherNodes[idx - 1].timestamp);
        const labelY = Math.round((prevY + currentNodeY) / 2);
        this.renderTimeDiffLabel(nodesContainer, bgX + bgWidth / 2, labelY, bgWidth, timeDiff);
      }

      const nodeGroup = nodesContainer.append('g')
        .attr('class', 'drawer-node')
        .attr('data-node-id', childNode.id)
        .attr('transform', `translate(${nodeX}, ${currentNodeY - nodeHeight / 2})`)
        .style('cursor', 'pointer')
        .style('pointer-events', 'all');

      if (firstSegment.displayMode === 'full') {
        this.renderFullNode(nodeGroup, childNode, nodeWidth, nodeHeight);
      } else if (firstSegment.displayMode === 'short') {
        this.renderShortNode(nodeGroup, childNode, nodeWidth, nodeHeight);
      } else if (firstSegment.displayMode === 'icon') {
        this.renderIconNode(nodeGroup, childNode, 20, 20);
      }

      nodeGroup.on('click', (event: MouseEvent) => {
        event.stopPropagation();
        logger.log(_('waterfall_drawer_node_clicked', '🎯 抽屉节点被点击: {0}'), childNode.title || childNode.url);
        this.visualizer.showNodeDetails(childNode);
      });
    });
    
    // 🎯 如果需要滚动，创建滚动指示箭头
    if (maxScroll > 0) {
      const arrowY = drawerTop + actualDrawerHeight - 12; // 距离底部12px
      const arrowX = bgX + bgWidth / 2;
      
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
    
  const dir = (availableDownSpace >= drawerFullHeight) ? 'down' : 'up';
  logger.log(_('waterfall_show_collapsed_drawer', '🎯 显示抽屉: {0} ({1}个节点, {2})'), collapsedGroup.tabId, otherNodes.length, dir);
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
      .attr('fill', '#666')
      .attr('font-size', '7px')
      .attr('font-style', 'italic')
      .attr('opacity', 0.85)
      .text(`+${timeDiffText}`)
      .style('pointer-events', 'none');
  }

  /**
   * 渲染单个节点
   */
  private renderSingleNode(group: any, node: NavNode, segment: TimeSegment, index: number): any {
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
  logger.log(_('waterfall_swimlane_node_position_debug', '🏊 泳道节点定位:'), {
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

    return nodeGroup;
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
  // 为角标和折叠标记保留少量间距（尽量显示更多标题）
  const reservedRightSpace = 6;
  const textWidth = width - textX - 8 - reservedRightSpace; // 剩余宽度

  // 🎯 字符宽度估算（11px 字体约6px/字符），更慷慨以显示更多文本
  const maxChars = Math.max(1, Math.floor(textWidth / 6));
    
    const titleTextSelection = group.append('text')
      .attr('x', textX)
      .attr('y', height / 2 + 4)
      .attr('font-size', '11px')
      .attr('fill', '#333')
      .text(this.truncateText(title, maxChars))
      .style('pointer-events', 'none');

    // 🎯 SPA 请求合并角标（仅在有合并计数时显示）
    try {
      const spaCount = (node as any).spaRequestCount || 0;
      if (spaCount > 0) {
        const badgeText = spaCount.toString();
        // 更宽更高以匹配折叠标记的视觉密度
        const badgeWidth = 22 + (badgeText.length > 2 ? (badgeText.length - 2) * 6 : 0);

        // collapse badge 的高度（renderCollapseBadge 使用的计算）
        const collapseBadgeHeight = Math.max(12, Math.floor(height / 2));
        const collapseY = height - collapseBadgeHeight;

        // 期望的 SPA 徽章高度范围与默认值
        const spaDesiredH = Math.max(14, Math.min(20, Math.floor(height / 2)));
        const minSpaH = 8;
        const spaTopDesired = 4; // 顶部偏移
        const verticalGap = 4; // SPA 与 collapse 之间的垂直间隙

        // 为了避免重叠，计算允许的最大 SPA 高度（以 spaTopDesired 为基准）
        const maxSpaHToAvoidOverlap = Math.max(minSpaH, collapseY - verticalGap - spaTopDesired);
        const spaHeight = Math.max(minSpaH, Math.min(spaDesiredH, maxSpaHToAvoidOverlap));

  // 水平位置（保持之前的确定性逻辑）
  const collapseBadgeWidthLocal = 22; // 与 renderCollapseBadge 保持一致
  const gapBetweenLocal = 6; // 两个角标之间的间隙
  let spaTargetX = width - collapseBadgeWidthLocal - gapBetweenLocal - badgeWidth;
        if (spaTargetX < 4) spaTargetX = 4;

        // 计算 SPA 顶部 Y，使其以 spaTopDesired 为优先，但尊重计算出的 spaHeight
        let spaTop = spaTopDesired;
        // 如果 spaTop + spaHeight + verticalGap 超过 collapseY，则尝试将 spaTop 更靠上
        if (spaTop + spaHeight + verticalGap > collapseY) {
          spaTop = Math.max(2, collapseY - verticalGap - spaHeight);
        }

    // 使用统一的 appendBadge 先绘制并返回 badgeGroup
  // 默认右对齐到节点右侧（当没有 collapse 时也对齐），并使用 collapse badge 高度作为最小高度
  const collapseBadgeWidth = 22;
  const spaGapBetween = 6;
  const spaFixedWidth = 22;
  const estX = Math.max(4, width - spaFixedWidth);
  const created = this.appendBadge(group, estX, 0, badgeText, { corner: 'top', fixedWidth: spaFixedWidth, minHeight: collapseBadgeHeight, fontSize: 7 });

        // 尝试读取真实尺寸并写回 node 上（如果可用）以便 collapse badge 使用
        try {
          // 读取 data 属性（appendBadge 已写入 final 尺寸），兼容没有测量环境的情况
          const wAttr = created.attr('data-badge-width');
          const hAttr = created.attr('data-badge-height');
          if (wAttr) (node as any).__spaBadgeWidth = parseFloat(wAttr);
          else (node as any).__spaBadgeWidth = badgeWidth;
          if (hAttr) (node as any).__spaBadgeHeight = parseFloat(hAttr);
          else (node as any).__spaBadgeHeight = spaHeight;
        } catch (e) {
          try { (node as any).__spaBadgeWidth = badgeWidth; (node as any).__spaBadgeHeight = spaHeight; } catch(e) {}
        }

        // 附加 title 提示
        created.append('title').text(`${spaCount} SPA requests merged`);
      }
    } catch (e) {
      // 不阻塞渲染
    }

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
  // 为徽章预留空间（约 20px）以避免覆盖标题
  const reservedRightSpace = 20;
  const maxChars = Math.max(1, Math.floor((width - 8 - reservedRightSpace) / 5));
    
    group.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2 + 3)
      .attr('font-size', '9px')
      .attr('fill', '#555')
      .attr('text-anchor', 'middle')
      .text(this.truncateText(label, maxChars))
      .style('pointer-events', 'none');
    
    // SPA 请求合并角标（短节点） - 确定性放置，使用 path 风格以匹配折叠标记
    try {
      const spaCount = (node as any).spaRequestCount || 0;
      if (spaCount > 0) {
        const badgeText = spaCount.toString();
        const badgeHeight = 12;
        const badgeWidth = 16 + (badgeText.length > 2 ? (badgeText.length - 2) * 6 : 0);

        const collapseBadgeHeight = Math.max(12, Math.floor(height / 2));
        const collapseY = height - collapseBadgeHeight;
        const spaTopDesired = 2;
        const verticalGap = 4;
        const spaDesiredH = badgeHeight;
        const minSpaH = 7;

        const maxSpaHToAvoidOverlap = Math.max(minSpaH, collapseY - verticalGap - spaTopDesired);
        const spaH = Math.max(minSpaH, Math.min(spaDesiredH, maxSpaHToAvoidOverlap));

        const collapseBadgeWidth = 22;
        const gapBetween = 6;
        let spaX = width - collapseBadgeWidth - gapBetween - badgeWidth;
        if (spaX < 4) spaX = 4;
        let spaY = spaTopDesired;
        if (spaY + spaH + verticalGap > collapseY) {
          spaY = Math.max(2, collapseY - verticalGap - spaH);
        }

  const created = this.appendBadge(group, spaX, 0, badgeText, { corner: 'top', fixedWidth: 22, minHeight: collapseBadgeHeight, fontSize: 7 });
        try {
          const wAttr = created.attr('data-badge-width');
          const hAttr = created.attr('data-badge-height');
          if (wAttr) (node as any).__spaBadgeWidth = parseFloat(wAttr);
          else (node as any).__spaBadgeWidth = badgeWidth;
          if (hAttr) (node as any).__spaBadgeHeight = parseFloat(hAttr);
          else (node as any).__spaBadgeHeight = spaH;
        } catch (e) {
          try { (node as any).__spaBadgeWidth = badgeWidth; (node as any).__spaBadgeHeight = spaH; } catch(e) {}
        }
      }
    } catch (e) {
      // ignore
    }

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
  /**
   * 渲染观察窗口滑块 - 在时间轴横线上滑动
   */
  private renderObservationWindowSlider(group: any, layout: LayoutResult): void {
  logger.log(_('waterfall_render_observation_slider', '🎚️ 渲染观察窗口滑块'));

    const timeAxisY = 80; // 时间轴横线的Y坐标（与renderTimeAxis保持一致）
    const sliderHeight = 16; // 滑块高度（更扁平，适合在线上）
    const sliderY = timeAxisY - sliderHeight / 2; // 居中在时间轴线上

    // 🎯 关键逻辑：判断是否有压缩段
    const hasCompression = layout.compressedSegments.length > 0;
    
    if (!hasCompression) {
      // ✅ 无压缩情况：观察窗口覆盖所有条带的实际宽度
  logger.log(_('waterfall_observation_no_compression', '✅ 无压缩，观察窗口覆盖所有条带实际宽度'));
      
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
  logger.log(_('waterfall_observation_has_compression', '⚠️ 有压缩，观察窗口在时间轴上滑动'));
    
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
    
  logger.log(_('waterfall_observation_drag_setup', '🔍 观察窗口拖拽设置: 总段数={0}, 观察窗口段数={1}, 最大起始索引={2}'), this.allSegments.length, layout.normalDisplaySegments.length, maxObservationStartIndex);
  logger.log(_('waterfall_observation_drag_range_info', '🔍 拖拽范围段: 从第{0}段 到 第{1}段（允许覆盖所有段）'), 0, this.allSegments.length - 1);

    const drag = d3.drag()
      .on('start', function(event: any) {
        isDragging = true;
        self.isDraggingObservationWindow = true; // 🛡️ 设置拖拽状态，防止滚轮误触
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
        
        // 🎯 应用边界限制 - 修复：严格限制右边界，防止越界和回弹
        // 计算真正的最大拖动位置：应该让观察窗口右边缘能到达最后一个时间段的右边缘
        const lastSegment = self.allSegments[self.allSegments.length - 1];
        const maxX = lastSegment ? 
          (lastSegment.startX + lastSegment.allocatedWidth - observationWindowWidth) : 
          layout.timeAxisData.startX;
        
  logger.log(_('waterfall_drag_boundary_check', '🔍 拖动边界检查: minX={0}, maxX={1}, targetX={2}, 最后段={3}'), minX, maxX, targetX, lastSegment ? `${lastSegment.startX}-${lastSegment.startX + lastSegment.allocatedWidth}` : 'N/A');
        
        // 🎯 修复右边界问题：严格限制边界，不允许超出
        // 如果吸附位置超出边界，优先保证边界限制，放弃吸附
        if (targetX > maxX) {
          targetX = maxX;
          self.lastDragSnapped = false; // 取消吸附状态
          logger.log(_('waterfall_reject_right_boundary_snap', '🚫 拒绝超出右边界的吸附，强制限制在边界内: {0}'), targetX);
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
        self.isDraggingObservationWindow = false; // 🛡️ 清除拖拽状态，恢复滚轮响应
        rect.style('cursor', 'grab')
            .attr('stroke-width', 1); // 恢复正常边框
        
        // 🎯 确保最终位置在正确的边界内
        const currentX = parseFloat(rect.attr('x'));
        const observationWindowWidth = parseFloat(rect.attr('width'));
        
        // 重新计算边界限制
        const firstSeg = self.allSegments[0];
        const lastSeg = self.allSegments[self.allSegments.length - 1];
        const minX = firstSeg ? firstSeg.startX : layout.timeAxisData.startX;
        const maxX = lastSeg ? 
          (lastSeg.startX + lastSeg.allocatedWidth - observationWindowWidth) : 
          layout.timeAxisData.startX;
        
        // 如果当前位置超出边界，强制回到边界内
        const correctedX = Math.max(minX, Math.min(maxX, currentX));
        if (Math.abs(correctedX - currentX) > 0.1) {
          logger.log(_('waterfall_correct_drag_end_pos', '🎯 修正拖拽结束位置: {0} -> {1}'), currentX.toFixed(1), correctedX.toFixed(1));
          rect.attr('x', correctedX);
        }
        
        // 🎯 根据最终位置计算新的观察窗口起始索引（基于覆盖比例）
        const finalX = correctedX;
        const windowLeftEdge = finalX;
        const windowRightEdge = finalX + observationWindowWidth;
        
  logger.log(_('waterfall_drag_end_analysis', '🔍 拖拽结束位置分析: 窗口位置=[{0}, {1}], 宽度={2}'), windowLeftEdge.toFixed(1), windowRightEdge.toFixed(1), observationWindowWidth.toFixed(1));
        
        // 计算每个条带的覆盖比例
        const stripCoverages = self.allSegments.map((segment, i) => {
          const stripLeft = segment.startX;
          const stripRight = segment.startX + segment.allocatedWidth;
          const stripWidth = segment.allocatedWidth;
          
          const overlapLeft = Math.max(windowLeftEdge, stripLeft);
          const overlapRight = Math.min(windowRightEdge, stripRight);
          const overlapWidth = Math.max(0, overlapRight - overlapLeft);
          const coverageRatio = stripWidth > 0 ? overlapWidth / stripWidth : 0;
          
          return { index: i, coverageRatio, overlapWidth, stripLeft, stripRight };
        });
        
        // 🎯 特殊处理边界情况：当用户拖拽到左边或右边界时，直接确定索引
        const firstSegment = self.allSegments[0];
        const lastSegment = self.allSegments[self.allSegments.length - 1];
        const minDragX = firstSegment ? firstSegment.startX : layout.timeAxisData.startX;
        const maxDragX = lastSegment ? 
          (lastSegment.startX + lastSegment.allocatedWidth - observationWindowWidth) : 
          layout.timeAxisData.startX;
        
        // 检测用户是否拖拽到了最左边位置（容差5px）
        const isAtLeftBoundary = Math.abs(windowLeftEdge - minDragX) < 5;
        // 🎯 检测用户是否拖拽到了最右边位置（容差5px）
        const isAtRightBoundary = Math.abs(windowLeftEdge - maxDragX) < 5;
        
        let newStartIndex = 0;
        
        if (isAtLeftBoundary) {
          // 用户拖拽到最左边，显示最新的时间段（从索引0开始）
          newStartIndex = 0;
          logger.log(_('waterfall_detect_left_boundary_drag', '🎯 检测到左边界拖拽：窗口左边缘={0}, 最小拖拽X={1}, 显示最新时间段（索引=0）'), windowLeftEdge.toFixed(1), minDragX.toFixed(1));
        } else if (isAtRightBoundary) {
          // 🎯 用户拖拽到最右边，确保观察窗口覆盖最后几个时间段
          const maxObservationStartIndex = Math.max(0, self.allSegments.length - layout.normalDisplaySegments.length);
          newStartIndex = maxObservationStartIndex;
          logger.log(_('waterfall_detect_right_boundary_drag', '🎯 检测到右边界拖拽：窗口左边缘={0}, 最大拖拽X={1}, 显示最老时间段（索引={2}）'), windowLeftEdge.toFixed(1), maxDragX.toFixed(1), newStartIndex);
        } else {
          // 🎯 根据拖拽方向确定观察窗口停止位置
          // 向左拖拽：以左边缘对齐时间条带；向右拖拽：以右边缘对齐时间条带
          
          // 检测拖拽方向（基于最终位置与当前显示的第一个条带的相对位置）
          const currentFirstSegment = layout.normalDisplaySegments[0];
          const currentWindowLeftEdge = currentFirstSegment ? currentFirstSegment.startX : 0;
          
          const isDraggingRight = windowLeftEdge > currentWindowLeftEdge;
          
          logger.log(_('waterfall_drag_direction_analysis', '🔍 拖拽方向分析: 当前窗口左边缘={0}, 新位置={1}, 向右拖拽={2}'), currentWindowLeftEdge.toFixed(1), windowLeftEdge.toFixed(1), isDraggingRight);
          
          if (isDraggingRight) {
            // 🎯 向右拖拽：找观察窗口右边缘覆盖的时间条带，让观察窗口右边缘对齐该条带右边缘
            let targetSegmentIndex = -1;
            for (let i = 0; i < self.allSegments.length; i++) {
              const segment = self.allSegments[i];
              const segmentRight = segment.startX + segment.allocatedWidth;
              
              // 找到右边缘最接近或刚好覆盖的条带
              if (windowRightEdge <= segmentRight + 5) { // 5px容差
                targetSegmentIndex = i;
                break;
              }
            }
            
            if (targetSegmentIndex >= 0) {
              // 计算让观察窗口右边缘对齐目标条带右边缘时的起始索引
              newStartIndex = Math.max(0, targetSegmentIndex - layout.normalDisplaySegments.length + 1);
              logger.log(_('waterfall_drag_right_target', '🎯 向右拖拽: 目标条带={0}, 计算起始索引={1}'), targetSegmentIndex, newStartIndex);
            } else {
              // 回退到最大索引
              newStartIndex = Math.max(0, self.allSegments.length - layout.normalDisplaySegments.length);
              logger.log(_('waterfall_drag_right_no_target', '🎯 向右拖拽: 未找到合适条带，使用最大索引={0}'), newStartIndex);
            }
          } else {
            // 🎯 向左拖拽：找观察窗口左边缘覆盖的时间条带，让观察窗口左边缘对齐该条带左边缘
            let targetSegmentIndex = -1;
            for (let i = 0; i < self.allSegments.length; i++) {
              const segment = self.allSegments[i];
              
              // 找到左边缘最接近或刚好覆盖的条带
              if (windowLeftEdge >= segment.startX - 5 && windowLeftEdge <= segment.startX + segment.allocatedWidth + 5) {
                targetSegmentIndex = i;
                break;
              }
            }
            
            newStartIndex = targetSegmentIndex >= 0 ? targetSegmentIndex : 0;
            logger.log(_('waterfall_drag_left', '🎯 向左拖拽: 目标条带={0}, 起始索引={1}'), targetSegmentIndex, newStartIndex);
          }
        }
        
  logger.log(_('waterfall_drag_end_target_index', '🖱️ 拖动结束，目标起始索引: {0}, 当前: {1}'), newStartIndex, self.observationStartIndex);
        
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
  logger.log(_('waterfall_rerender_for_new_window', '🔄 根据新观察窗口位置重新渲染，起始索引: {0}'), observationStartIndex);
    
    // 🎯 更新当前观察窗口起始索引
    this.observationStartIndex = observationStartIndex;
    
    // 💾 保存观察窗口索引到内存和 localStorage
    this.visualizer.waterfallObservationIndex = observationStartIndex;
    
    // 保存到 localStorage
    const tabId = this.visualizer.tabId || '';
    logger.log(_('waterfall_save_observation_index_prepare', '💾 准备保存观察窗口索引到 localStorage:'), {
      tabId,
      observationStartIndex
    });
    
    saveViewState(tabId, {
      viewType: 'waterfall',
      waterfallObservationIndex: observationStartIndex
    });
    
  logger.log(_('waterfall_saved_observation_index', '✅ 已保存观察窗口索引到 localStorage'));
    
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

    // 渲染各个部分（使用新的分离结构）
    this.renderTimeAxis(mainGroup.timeAxisGroup, newLayout); // 🕐 时间轴（固定，不滚动）
    this.renderTimeStrips(mainGroup.timeStripsGroup, newLayout); // � 垂直时间条带（可滚动）
    this.renderSwimlaneSeparators(mainGroup.swimlaneSeperatorsGroup, newLayout); // 🏊 泳道分隔线（可滚动）
    this.renderSegmentNodes(mainGroup.nodesGroup, newLayout); // 🎯 纯粹的节点（可滚动）
    this.renderClosureMarkers(mainGroup.closureMarkersGroup, newLayout); // 🔴 关闭标记（可滚动）
    this.renderObservationWindowSlider(mainGroup.focusOverlayGroup, newLayout); // 🎚️ 观察窗口（固定，不滚动）
    
    // 重新设置滚轮事件（垂直滚动泳道）
    this.setupWheelScroll(); // 🎯 重新启用：只用于垂直滚动泳道
    
    // 重新设置垂直拖拽滚动
    this.setupVerticalDragScroll();
    
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
      
      // 更新时间标签 - 注释：条带中不再添加时间标签，由固定时间轴负责
      // const timeLabel = strip.select('.time-label');
      // const timeTick = strip.select('.time-tick');
      
      const isInWindow = normalSegmentIndices.has(i);
      const wasInWindow = oldNormalIndices.has(i);
      const isFullyExpanded = layoutSegment.displayMode === 'full' || layoutSegment.displayMode === 'short';
      
      // 移除任何残留的条带时间标签和刻度（避免与固定时间轴冲突）
      strip.selectAll('.time-label').remove();
      strip.selectAll('.time-tick').remove();
      
      // 🎯 关键修复：判断节点显示策略的变化
      const isEntering = isInWindow && !wasInWindow;  // 进入观察窗口
      const isLeaving = wasInWindow && !isInWindow;   // 离开观察窗口
      
      if (isEntering) {
        // 🎯 进入观察窗口：展开节点显示
  logger.log(_('waterfall_strip_entered_observation', '✨ 条带 {0} 进入观察窗口，展开节点'), i);
        if (isFullyExpanded) {
          this.renderSegmentNodesExpanded(segment, strip, layoutSegment);
        } else {
          // 即使不是完全展开，也需要更新为压缩模式（icon）
          this.renderSegmentNodesCompressed(segment, strip, layoutSegment);
        }
      } else if (isLeaving) {
        // 🎯 离开观察窗口：压缩为圆点
        logger.log(_('waterfall_segment_leaving', '💨 条带 {0} 离开观察窗口，压缩节点'), i);
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
      const createdNodeGroup = this.renderSingleNode(nodeGroup, node, layoutSegment, index);
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
      const createdNodeGroup = this.renderSingleNode(nodeGroup, node, layoutSegment, index);
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
      logger.warn(_('waterfall_wheel_event_setup_no_svg', '⚠️ 无法设置滚轮事件：SVG或布局不存在'));
      return;
    }
    
    const self = this;
    const layout = this.currentLayout;
    
    // 移除之前的滚轮事件监听器（如果有）
    this.svg.on('wheel', null);
    
    // 计算最大垂直滚动距离
    this.calculateMaxVerticalScroll();
    
    // 添加新的滚轮事件监听器（仅用于垂直滚动）
    this.svg.on('wheel', function(this: any, event: any) {
      // D3 v7 会将原生事件作为参数传递
      const wheelEvent = event as WheelEvent;
      
      // 🛡️ 如果正在拖拽观察窗口，禁用滚轮事件（防止Magic Mouse误触）
        if (self.isDraggingObservationWindow) {
        	wheelEvent.preventDefault();
        	wheelEvent.stopPropagation();
        	logger.log(_('waterfall_wheel_disabled_during_observation_drag', '🚫 观察窗口拖拽期间禁用滚轮滚动（防止Magic Mouse误触）'));
        	return;
      }
      
      // 如果正在拖拽垂直滚动，禁用滚轮事件
      if (self.isDraggingVertical) {
        wheelEvent.preventDefault();
        wheelEvent.stopPropagation();
        logger.log(_('waterfall_wheel_disabled_during_vertical_drag', '🚫 拖拽期间禁用滚轮滚动'));
        return;
      }
      
      wheelEvent.preventDefault();
      wheelEvent.stopPropagation();
      
      // 🎯 只处理垂直滚动泳道，不处理水平滚动时间轴
      if (self.maxVerticalScroll > 0) {
        // 计算新的垂直偏移
        const delta = wheelEvent.deltaY;
        const newOffset = self.verticalScrollOffset + delta;
        self.setVerticalScrollOffset(newOffset);
      }
    });
    
    logger.log(_('waterfall_wheel_scroll_setup_done', '✅ 滚轮滚动已设置（仅垂直滚动），最大垂直滚动: {0}'), this.maxVerticalScroll);
  }

  /**
   * 计算最大垂直滚动距离 - 新版本：基于viewport架构
   */
  private calculateMaxVerticalScroll(): void {
    if (!this.swimlanes || this.swimlanes.length === 0) {
      this.maxVerticalScroll = 0;
      logger.log(_('waterfall_no_swimlanes_vertical_scroll', '🔢 无泳道数据，垂直滚动不可用'));
      return;
    }

    // 计算内容总高度（包括顶部间距）
    const startY = 20;
    const swimlaneHeight = this.SWIMLANE_HEIGHT;
    const totalContentHeight = startY + (this.swimlanes.length * swimlaneHeight);
    
    // viewport可视高度
    const timeAxisHeight = 100;
    const viewportHeight = this.height - timeAxisHeight;
    
    // 如果内容高度超过viewport高度，则需要滚动
    this.maxVerticalScroll = Math.max(0, totalContentHeight - viewportHeight);
    
    logger.log(_('waterfall_vertical_scroll_calc', '🔢 垂直滚动计算: 泳道数={0}, 内容总高度={1}, viewport高度={2}, 最大滚动={3}'), this.swimlanes.length, totalContentHeight, viewportHeight, this.maxVerticalScroll);
  }

  /**
   * 处理垂直滚动（泳道区域）- 简化版本
   */
  private handleVerticalScroll(deltaY: number): void {
    if (!this.scrollableGroup || this.maxVerticalScroll <= 0) {
      return;
    }

    // 计算滚动步长（像素）
    const scrollStep = 30;
    const direction = deltaY > 0 ? 1 : -1;
    const newOffset = this.verticalScrollOffset + (direction * scrollStep);
    
    this.setVerticalScrollOffset(newOffset);
  }

  /**
   * 设置垂直滚动偏移量
   */
  private setVerticalScrollOffset(newOffset: number): void {
    // 严格的滚动边界：不能向上滚动（偏移为负），不能超过最大滚动距离
    const clampedOffset = Math.max(0, Math.min(this.maxVerticalScroll, newOffset));
    
    if (clampedOffset === this.verticalScrollOffset) {
      return;
    }
    
    this.verticalScrollOffset = clampedOffset;
    
    // 应用变换到可滚动组
    if (this.scrollableGroup) {
      // 直接应用偏移，clipPath会确保内容不进入时间轴区域
      const transform = `translate(0, ${-this.verticalScrollOffset})`;
      this.scrollableGroup.attr('transform', transform);
    }
    
  logger.log(_('waterfall_vertical_scroll_update', '🔄 垂直滚动: {0}/{1}'), this.verticalScrollOffset, this.maxVerticalScroll);
  }

  /**
   * 设置垂直拖拽滚动 - 升级版本：整个泳道区域都可以拖拽
   */
  private setupVerticalDragScroll(): void {
  logger.log(_('waterfall_setup_vertical_drag_start', '🔍 开始设置垂直拖拽滚动（新的简化架构）...'));
  logger.log(_('waterfall_setup_vertical_drag_check', '📊 拖拽设置检查: scrollableGroup={0}, maxVerticalScroll={1}'), !!this.scrollableGroup, this.maxVerticalScroll);
    
    if (!this.scrollableGroup) {
      logger.warn(_('waterfall_no_scrollable_group', '⚠️ scrollableGroup 不存在，无法设置拖拽'));
      return;
    }
    
    if (this.maxVerticalScroll <= 0) {
      logger.log(_('waterfall_no_vertical_drag_needed', '🔢 无需设置垂直拖拽：内容未超出可视区域，maxVerticalScroll = {0}'), this.maxVerticalScroll);
      return;
    }

  logger.log(_('waterfall_setup_vertical_drag_on_strips', '🖱️ 设置垂直拖拽滚动（简化版：直接在时间条带上拖拽）'));
    
    const timeAxisHeight = 100;
    const self = this;
    let startY = 0;
    let startOffset = 0;
    let isDragging = false;

    // 🎯 新策略：直接在时间条带上设置拖拽，避免覆盖层
    const timeStripsGroup = this.scrollableGroup.select('.time-strips-group');
    
    if (timeStripsGroup.empty()) {
      logger.warn(_('waterfall_time_strips_group_missing', '⚠️ 时间条带组不存在，无法设置拖拽'));
      return;
    }

    // 🎯 为每个时间条带的背景添加拖拽功能
    const timeStripBackgrounds = timeStripsGroup.selectAll('rect.strip-background');
  logger.log(_('waterfall_time_strip_background_count', '🔍 找到的时间条带背景数量: {0}'), timeStripBackgrounds.size());
    
    timeStripBackgrounds.on('mousedown', function(this: SVGElement, event: any, d: any) {
      // 🎯 关键：只有当点击的是时间条带本身时才启动拖拽
      if (event.target === this) {
        logger.log(_('waterfall_time_strip_blank_start_drag', '🖱️ 在时间条带空白区域开始拖拽'));
        startDrag(event);
      }
    });

    // 🎯 为时间条带设置拖拽光标
    timeStripBackgrounds
      .style('cursor', 'ns-resize')
      .on('mousemove', function(this: SVGElement, event: any) {
        if (!self.isDraggingVertical) {
          // 检查鼠标是否在空白区域
          if (event.target === this) {
            d3.select(this).style('cursor', 'ns-resize');
          }
        }
      });

    function startDrag(event: any) {
      logger.log(_('waterfall_vertical_drag_start', '🖱️ 开始拖拽操作'));
      
      event.preventDefault();
      event.stopPropagation();
      
      isDragging = false;
      self.isDraggingVertical = false;
      startY = event.clientY;
      startOffset = self.verticalScrollOffset;
      
      // 鼠标移动事件
      const mousemove = function(moveEvent: any) {
        const deltaY = Math.abs(moveEvent.clientY - startY);
        
        if (!isDragging && deltaY > 3) {
          isDragging = true;
          self.isDraggingVertical = true;
          d3.select('body').style('cursor', 'ns-resize');
          logger.log(_('waterfall_vertical_drag_started', '🖱️ 开始垂直拖拽滚动'));
        }
        
        if (isDragging) {
          const deltaY = moveEvent.clientY - startY;
          const newOffset = startOffset - deltaY;
          self.setVerticalScrollOffset(newOffset);
        }
      };
      
      // 鼠标释放事件
      const mouseup = function() {
        if (isDragging) {
          logger.log(_('waterfall_vertical_drag_end', '🖱️ 结束垂直拖拽滚动'));
          isDragging = false;
          self.isDraggingVertical = false;
          d3.select('body').style('cursor', 'default');
        }
        
        d3.select(window).on('mousemove.vscroll', null);
        d3.select(window).on('mouseup.vscroll', null);
      };
      
      d3.select(window).on('mousemove.vscroll', mousemove);
      d3.select(window).on('mouseup.vscroll', mouseup);
    }

    logger.log(_('waterfall_vertical_drag_setup_done', '✅ 垂直拖拽已设置在时间条带上（简化版）'));
  }

  /**
   * 处理水平滚动（时间轴方向）
   */
  private handleHorizontalScroll(deltaY: number): void {
    const layout = this.currentLayout!;
    
    // 计算滚动方向和步长
    const delta = deltaY;
    const step = delta > 0 ? 1 : -1;
    
    // 计算新的观察窗口起始索引
    const maxStartIndex = Math.max(0, this.allSegments.length - layout.normalDisplaySegments.length);
    const newStartIndex = Math.max(0, Math.min(maxStartIndex, this.observationStartIndex + step));
    
    // 如果索引没有变化，不需要更新
    if (newStartIndex === this.observationStartIndex) {
      logger.warn(_('waterfall_observation_window_at_boundary', '⚠️ 观察窗口已到达边界，无法继续滚动'));
      return;
    }
    
  logger.log(_('waterfall_wheel_observation_scroll', '🖱️ 滚轮滚动观察窗口: {0} -> {1}'), this.observationStartIndex, newStartIndex);
    
    // 🎯 滚动过程中：只更新视觉效果（条带宽度和观察窗口位置）
    this.updateObservationWindowVisuals(newStartIndex);
    
    // 🎯 使用防抖：滚动停止后才完全重新渲染
    if (this.wheelScrollTimeout) {
      clearTimeout(this.wheelScrollTimeout);
    }
    
    this.wheelScrollTimeout = window.setTimeout(() => {
      logger.log(_('waterfall_wheel_stopped_full_rerender', '⏱️ 滚轮停止，完全重新渲染'));
      this.reRenderWithObservationWindow(newStartIndex);
      this.wheelScrollTimeout = null;
    }, 200); // 200ms 后认为滚动已停止
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
      
      logger.log(_('waterfall_observation_slider_updated', '✅ 观察窗口滑块已更新: x={0}, width={1}'), observationWindowX.toFixed(0), observationWindowWidth.toFixed(0));
    } else {
      logger.warn(_('waterfall_observation_slider_missing', '⚠️ 未找到观察窗口滑块 .observation-slider'));
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
    logger.log(_('waterfall_move_observation_window', '移动观察窗口: {0}'), direction);
  }
}