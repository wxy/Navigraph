import { UrlUtils } from '../../../lib/utils/url-utils.js';
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
  // 原生 SVG 层级的 wheel 处理器引用（用于移除）
  private svgWheelHandler: ((e: WheelEvent) => void) | null = null;
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
  private readonly SWIMLANE_SEPARATOR_COLOR = '#333333'; // 虚线颜色（加深以免被抽屉遮挡时不清晰）
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
      // 如果在 body.node() 上绑定了原生 wheel 处理器，清理它
      try {
        const bodyNode = body.node && body.node();
        if (bodyNode && (bodyNode as any).__navigraph_wheel_handler) {
          try { bodyNode.removeEventListener('wheel', (bodyNode as any).__navigraph_wheel_handler, true); } catch(e) {}
          try { delete (bodyNode as any).__navigraph_wheel_handler; } catch(e) {}
        }
      } catch(e) {}
      const bg = body.select('.drawer-bg');
      const items = body.selectAll('.drawer-item');

      // 快速收起（不做复杂动画）
      try { items.attr('opacity', 0).style('pointer-events', 'none'); } catch(e) {}
      try { bg.attr('height', 0); } catch(e) {}
      try { body.attr('opacity', 0).style('pointer-events', 'none'); } catch(e) {}
      try { drawerSel.attr('data-open', 'false'); } catch(e) {}
      // restore display node's badge count if applicable
      try {
        const groupId = drawerSel.attr && drawerSel.attr('data-collapse-group');
        if (groupId) {
          const badgeSel = this.svg && this.svg.select ? this.svg.select(`.group-badge[data-collapse-group="${groupId}"]`) : null;
          if (badgeSel && !badgeSel.empty()) {
            try {
              // prefer original saved badge text if present on the element
              const orig = badgeSel.attr && badgeSel.attr('data-original-badge');
              if (orig != null && String(orig) !== '') {
                try { badgeSel.select('text').text(String(orig)); } catch(e) {}
                try { badgeSel.attr('data-original-badge', null); } catch(e) {}
              } else {
                // find collapsedGroup count if available in memory; support both new (displayNode.id) and old (tabId) keys
                const cg = this.collapsedGroups ? this.collapsedGroups.find(g => (g.displayNode && g.displayNode.id === groupId) || g.tabId === groupId) : null;
                const txt = cg ? String(cg.count) : (badgeSel.select('text').text() || '0');
                try { badgeSel.select('text').text(txt); } catch(e) {}
              }
            } catch(e) {}
          }
        }
      } catch(e) {}
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
  // Debug flag: keep disabled in production
  const DRAWER_DEBUG = false;
  const mount = this.scrollableGroup || this.svg;
  // Use a per-display-node key to identify the prebuilt drawer. Using tabId
  // caused collisions when the same tab had folded groups across multiple segments.
  const collapseKey = (collapsedGroup && collapsedGroup.displayNode && collapsedGroup.displayNode.id) ? collapsedGroup.displayNode.id : (collapsedGroup && collapsedGroup.tabId) || '';
  const drawerSel = mount.select(`g.collapsed-drawer[data-collapse-group="${collapseKey}"]`);
      if (drawerSel.empty()) return;

      const itemsGroup = drawerSel.select('.drawer-items');
      // use data-open attr + opacity/pointer-events instead of display:none so that
      // the contained display node remains visible (drawer contains the display node)
      const isOpen = drawerSel.attr('data-open') === 'true';

      if (!isOpen) {
        // 如果正在进行动画，则忽略重复打开请求
        if (this.drawerTransitioning) return;
        this.drawerTransitioning = true;
        // Defensive cleanup: remove any leftover handlers from previous openings
        try {
          const containerNode: any = this.container || (this.svg && this.svg.node && this.svg.node());
          if (containerNode) {
            try {
              if ((containerNode as any).__drawerWheelContainerHandler) {
                try { containerNode.removeEventListener && containerNode.removeEventListener('wheel', (containerNode as any).__drawerWheelContainerHandler, true); } catch(e) {}
                try { delete (containerNode as any).__drawerWheelContainerHandler; } catch(e) {}
              }
            } catch(e) {}
            try {
              if ((containerNode as any).__drawerDebugDocHandler) {
                try { document.removeEventListener && document.removeEventListener('wheel', (containerNode as any).__drawerDebugDocHandler, true); } catch(e) {}
                try { delete (containerNode as any).__drawerDebugDocHandler; } catch(e) {}
              }
            } catch(e) {}
          }
        } catch(e) {}
        // if another drawer is open, normalize its z-order then close it first
        try {
          if (this.currentOpenDrawerSel && !this.currentOpenDrawerSel.empty()) {
            try {
              // Bring previous drawer/swimlane to front without reparenting
              const prevNode = this.currentOpenDrawerSel.node() as any;
              try { d3.select(prevNode).raise(); } catch (e) {}
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
        // defensive: remove any leftover body-level handlers/state from previous openings
        try {
          const bodyNodeAny: any = body.node && body.node();
          if (bodyNodeAny) {
            try { if (bodyNodeAny.__drawerWheelHandler) { bodyNodeAny.removeEventListener && bodyNodeAny.removeEventListener('wheel', bodyNodeAny.__drawerWheelHandler, true); } } catch(e) {}
            try { delete bodyNodeAny.__drawerWheelHandler; } catch(e) {}
            try { bodyNodeAny.__drawerWheelAccum = 0; } catch(e) {}
            try { bodyNodeAny.__drawerWheelRaf = null; } catch(e) {}
            try { bodyNodeAny.__drawerAnim = null; } catch(e) {}
            try { bodyNodeAny.__drawerTarget = 0; } catch(e) {}
          }
        } catch(e) {}

        // bring drawer to front within its current parent (avoid reparenting)
        try {
          try { drawerSel.raise(); } catch (e) {}
        } catch (e) {}

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
          // Prefer CSS-based scroll isolation (overscroll-behavior). Do not attach non-passive wheel handlers here.
          // If needed later, a carefully added passive:false handler can be introduced in a later step.
          try { /* no-op: CSS should handle scroll isolation */ } catch(e) {}

          // ensure x alignment with swimlane nodes by using same centerOffset calculation
          const nodeWidthLocal = this.NODE_WIDTHS[segment.displayMode];
          const centerOffset = (segment.allocatedWidth - nodeWidthLocal) / 2;
          const baseX = segment.startX + Math.max(0, centerOffset);

                const nodeHeightLocal = nodeHeight || (itemNodes.length > 0 ? (() => {
            try { const firstChildRect = d3.select(itemNodes[0]).select('rect'); if (!firstChildRect.empty()) return parseFloat(firstChildRect.attr('height')) || 0; } catch(e) {}
            return nodeHeight || 0;
          })() : nodeHeight || 0);

          // slot layout params
          const slots = collapsedGroup.nodes.length;
          // VISIBLE_FOLDED_CHILDREN_LIMIT represents how many folded children we want
          // to show in addition to the display node. Per Option B we show display + up to 5 children.
          const VISIBLE_FOLDED_CHILDREN_LIMIT = 5;
          const visibleSlots = Math.min(slots, 1 + VISIBLE_FOLDED_CHILDREN_LIMIT); // include display slot
          const slotHeight = this.SWIMLANE_HEIGHT;
          const paddingAround = 0; // no vertical padding to align to swimlane boundaries
          const preferredTop = collapsedGroup.swimlaneY || (drawerSel.attr('data-lane-index') ? (this.swimlanes[parseInt(drawerSel.attr('data-lane-index'), 10)]?.y || 0) : 0);

          const drawerFullHeight = visibleSlots * slotHeight + paddingAround * 2; // cap visible height
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
          let maxScroll = Math.max(0, (slots * slotHeight + paddingAround * 2) - actualDrawerHeight);
          // Edge-case guard: if there are hidden slots but computed maxScroll is 0 due to rounding/space constraints,
          // ensure scrolling is possible for the hidden items.
              try {
                const hiddenCountLocal = Math.max(0, slots - visibleSlots);
                if (hiddenCountLocal > 0 && maxScroll === 0) {
                  maxScroll = hiddenCountLocal * slotHeight;
                  try { logger.log(`drawer ${collapseKey} adjusted maxScroll fallback=${maxScroll}`); } catch(e) {}
                }
              } catch(e) {}
          // local scroll offset for this drawer instance
          let drawerScrollOffset = 0;

          // animate bg to cover full slot area (horizontally bg x/width already set when prebuilt)
          try {
            body.style('pointer-events', 'none');
            body.attr('opacity', 1);
            // ensure bg is fully opaque
            try { bg.attr('fill-opacity', 1); } catch(e) {}
            // create a clipPath for the visible drawer area so labels/items outside are masked
            try {
              const defsSel = (this.svg.select && this.svg.select('defs')) ? this.svg.select('defs') : null;
              const clipId = `drawer-clip-${collapseKey}`;
                if (DRAWER_DEBUG) {
                  try {
                    const dbg = {
                      tabId: collapseKey,
                      nodeX: nodeX,
                      nodeY: nodeY,
                      nodeWidth: nodeWidth,
                      drawerTop: drawerTop,
                      actualDrawerHeight: actualDrawerHeight,
                      slots: slots,
                      slotHeight: slotHeight,
                      preferredTop: preferredTop
                    };
                    // debug info removed
                  } catch(e) {}
                }
              if (defsSel && !defsSel.empty && !defsSel.empty()) {
                try { defsSel.select(`#${clipId}`).remove(); } catch(e) {}
                try {
                  defsSel.append('clipPath')
                    .attr('id', clipId)
                    .attr('clipPathUnits', 'userSpaceOnUse')
                    .append('rect')
                    .attr('x', parseFloat(bg.attr('x')) || nodeX)
                    .attr('y', drawerTop)
                    .attr('width', parseFloat(bg.attr('width')) || nodeWidth)
                    .attr('height', actualDrawerHeight);
                } catch(e) {}
                try { body.attr('clip-path', `url(#${clipId})`); } catch(e) {}
                  if (DRAWER_DEBUG) {
                    try {
                      const bgNode: any = body.select && body.select('.drawer-bg') && body.select('.drawer-bg').node && body.select('.drawer-bg').node();
                      // debug info removed
                    } catch(e) {}
                  }
              } else if (this.svg.append) {
                // create defs if missing
                try {
                  const newDefs = this.svg.append('defs');
                  newDefs.append('clipPath')
                    .attr('id', clipId)
                    .attr('clipPathUnits', 'userSpaceOnUse')
                    .append('rect')
                    .attr('x', parseFloat(bg.attr('x')) || nodeX)
                    .attr('y', drawerTop)
                    .attr('width', parseFloat(bg.attr('width')) || nodeWidth)
                    .attr('height', actualDrawerHeight);
                  try { body.attr('clip-path', `url(#${clipId})`); } catch(e) {}
                } catch(e) {}
              }
            } catch(e) {}
            bg.transition().duration(200).attr('y', drawerTop).attr('height', actualDrawerHeight);
          } catch(e) {}

          // compute slot centers for all slots (we want to position all hidden nodes
          // at their target slots so a future internal scroll can reveal them)
          const fullSlotYs: number[] = [];
          for (let i = 0; i < slots; i++) {
            const slotTop = drawerTop + i * slotHeight;
            const slotCenter = slotTop + slotHeight / 2;
            fullSlotYs.push(slotCenter);
          }
          // visible slot centers (first visibleSlots entries)
          const slotYs = fullSlotYs.slice(0, visibleSlots);

          if (DRAWER_DEBUG) {
            try {
              const itemInitialTransforms = itemNodes.map((n: any) => {
                try { return d3.select(n).attr('transform'); } catch(e) { return null; }
              });
              // debug info removed
            } catch(e) {}
          }

          // render time-diff labels between slots (centered horizontally on bg)
            try {
            // remove any existing labels group
            body.selectAll('.drawer-labels').remove();
            // Prefer placing labels inside the scroll group so they translate with items
            const scrollGroupForLabels = body.select && body.select('.drawer-scroll') ? body.select('.drawer-scroll') : null;
            const labelsGroup = (scrollGroupForLabels && !scrollGroupForLabels.empty()) ? scrollGroupForLabels.append('g').attr('class', 'drawer-labels') : body.append('g').attr('class', 'drawer-labels');
            const otherNodes = collapsedGroup.nodes.filter(n => n.id !== collapsedGroup.displayNode.id);
            // labels between display slot (slot 0) and each child slot — use fullSlotYs so labels for offscreen slots are still computed
            for (let j = 0; j < otherNodes.length; j++) {
              const slotA = fullSlotYs[j];
              const slotB = fullSlotYs[j + 1] || fullSlotYs[fullSlotYs.length - 1];
              const labelY = Math.round((slotA + slotB) / 2);
              const timeDiff = Math.abs(otherNodes[j].timestamp - (collapsedGroup.displayNode.timestamp || 0));
              this.renderTimeDiffLabel(labelsGroup, bg.attr && parseFloat(bg.attr('x')) || (nodeX), labelY, (bg.attr && parseFloat(bg.attr('width')) ) || nodeWidth, timeDiff);
            }
          } catch(e) {}

          // animate items into their slots (children occupy slot 1..N-1)
          const itemDuration = 180;
          const stagger = 40;
          // Only animate up to visibleSlots-1 children into visible slots (slot 0 is display); keep extras hidden
          const maxVisibleChildren = Math.max(0, visibleSlots - 1);
          // Before animating, try to elevate the swimlane-group (so drawer items aren't occluded)
          try {
            const laneIndexAttr = drawerSel.attr && drawerSel.attr('data-lane-index');
            if (laneIndexAttr != null) {
              const laneIndex = parseInt(laneIndexAttr, 10);
              // find the swimlane-group within the same time-strip that matches this lane
              try {
                const swimlaneSelector = `.swimlane-${laneIndex}`;
                // locate swimlane group node relative to drawerSel
                let swimlaneNode: any = null;
                try {
                  swimlaneNode = (drawerSel.node && drawerSel.node().parentNode) ? drawerSel.node().parentNode.querySelector(swimlaneSelector) : null;
                } catch (e) {
                  swimlaneNode = null;
                }
                // fallback: search up to nearest .time-strip ancestor and then query inside it
                if (!swimlaneNode) {
                  let parent: any = drawerSel.node && drawerSel.node().parentNode;
                  while (parent && parent !== document && !parent.classList.contains('time-strip')) {
                    parent = parent.parentNode;
                  }
                  if (parent && parent.classList && parent.classList.contains('time-strip')) {
                    try { swimlaneNode = parent.querySelector(swimlaneSelector); } catch(e) { swimlaneNode = null; }
                  }
                }

                if (swimlaneNode) {
                  // append swimlaneNode to its time-strip parent to bring it to front within same coordinate system
                  const timeStrip = swimlaneNode.parentNode;
                  try {
                    if (timeStrip && timeStrip.appendChild) {
                      timeStrip.appendChild(swimlaneNode);
                      // also try to append the display node element (if present) to the swimlane so it sits above the drawer
                      try {
                        const displayNodeId = collapsedGroup && collapsedGroup.displayNode && collapsedGroup.displayNode.id;
                        if (displayNodeId) {
                          const displaySelector = `.navigation-node[data-node-id="${displayNodeId}"]`;
                          let displayNodeEl: any = null;
                          try { displayNodeEl = timeStrip.querySelector(displaySelector); } catch(e) { displayNodeEl = null; }
                          // if not found directly under timeStrip, try within swimlaneNode
                          if (!displayNodeEl) {
                            try { displayNodeEl = swimlaneNode.querySelector(displaySelector); } catch(e) { displayNodeEl = null; }
                          }
                          if (displayNodeEl && swimlaneNode.appendChild) {
                            try { swimlaneNode.appendChild(displayNodeEl); } catch(e) { /* ignore */ }
                          }
                        }
                      } catch(e) { /* ignore */ }
                    } else {
                      // fallback to d3.raise if appendChild not possible
                      try { d3.select(swimlaneNode).raise(); } catch(e) {}
                    }
                  } catch (e) {
                    try { d3.select(swimlaneNode).raise(); } catch(e) {}
                  }
                } else {
                  // final fallback: try to raise the drawer itself
                  try { drawerSel.raise(); } catch(e) {}
                }
              } catch (e) {
                try { drawerSel.raise(); } catch(e) {}
              }
            }
          } catch (e) {}

          items.each(function(this: any, d: any, i: number) {
            try {
              const childIndex = i; // order corresponds to otherNodes
              // target slot index for this child (slot 0 is display node)
              const slotIndex = Math.min(childIndex + 1, fullSlotYs.length - 1);
              const targetCenter = fullSlotYs[slotIndex];
              const targetTop = targetCenter - (nodeHeightLocal / 2);
              if (childIndex < maxVisibleChildren) {
                // animate visible children into place
                d3.select(this)
                  .style('pointer-events', 'none')
                  .attr('opacity', 0)
                  .transition()
                  .delay(i * stagger)
                  .duration(itemDuration)
                  .attr('transform', `translate(${baseX}, ${targetTop})`)
                  .attr('opacity', 1)
                  .on('end', function(this: any) { try { d3.select(this).style('pointer-events', 'all'); } catch(e) {} });
                d3.select(this).on('click.drawerItem', function(event: MouseEvent) { try { event.stopPropagation(); } catch(e) {} });
              } else {
                // position offscreen/hidden children at their target slots so they can be revealed by scrolling later
                try { d3.select(this).attr('transform', `translate(${baseX}, ${targetTop})`).attr('opacity', 0).style('pointer-events', 'none'); } catch(e) {}
              }
            } catch(e) {}
          });

          const totalAnim = 220 + itemNodes.length * stagger + itemDuration;
          this.schedule(() => {
            try { body.style('pointer-events', 'all'); } catch(e) {}
            // set the display node's collapse badge text to 0 while drawer is open
            try {
              const badgeSel = (this.svg && this.svg.select) ? this.svg.select(`.group-badge[data-collapse-group="${collapseKey}"]`) : null;
              if (badgeSel && !badgeSel.empty()) {
                try {
                  // save original badge text so we can restore it reliably on close
                  try {
                    const textSel = badgeSel.select('text');
                    const origTxt = (textSel && !textSel.empty()) ? String(textSel.text()) : '';
                    if (origTxt !== '') {
                      try { badgeSel.attr('data-original-badge', origTxt); } catch(e) {}
                    }
                  } catch(e) {}
                  try { badgeSel.select('text').text('0'); } catch(e) {}
                } catch(e) {}
              }
            } catch(e) {}
            this.currentOpenCollapseId = collapseKey;
            this.currentOpenDrawerSel = drawerSel;
            try { this.bindDocumentClickToClose(); } catch(e) {}

            // setup local wheel handler to perform internal scroll by translating .drawer-scroll
            try {
              const scrollGroupSel = body.select('.drawer-scroll');
              if (scrollGroupSel && !scrollGroupSel.empty() && maxScroll > 0) {
                // ensure initial transform
                try { scrollGroupSel.attr('transform', `translate(0, ${-drawerScrollOffset})`); } catch(e) {}
                const bodyNode: any = body.node();
                // accumulator + rAF to combine small fractional deltas (Magic Mouse)
                try { (bodyNode as any).__drawerWheelAccum = 0; } catch(e) {}
                try { (bodyNode as any).__drawerWheelRaf = null; } catch(e) {}
            const WHEEL_SCALE = 6; // amplify small deltas (tuned)
              // debug flag already defined in outer scope

                const applyAccumulated = () => {
                  try {
                    const accum: number = (bodyNode as any).__drawerWheelAccum || 0;
                    if (accum === 0) { (bodyNode as any).__drawerWheelRaf = null; return; }
                    // apply scaled delta
                    const delta = accum * WHEEL_SCALE;
                    (bodyNode as any).__drawerWheelAccum = 0;
                    const before = drawerScrollOffset;
                    if (DRAWER_DEBUG) {
                      try {
                        // Print compact snapshot of key variables to diagnose centering/clamping issues
                        const slotsCount = fullSlotYs ? fullSlotYs.length : 0;
                        const sampleSlots = (fullSlotYs && fullSlotYs.length > 0) ? fullSlotYs.slice(0, 50) : fullSlotYs;
                        // debug info removed
                      } catch(e) {}
                    }
                    // Step-based: snap target to slot boundaries (one swimlane per step)
                    try {
                      const tentative = drawerScrollOffset + delta;
                      // desired screen center is the swimlane middle (fallback to drawer center)
                      const desiredScreenCenter = (collapsedGroup && typeof collapsedGroup.swimlaneY === 'number') ? (collapsedGroup.swimlaneY + (this.SWIMLANE_HEIGHT / 2)) : (drawerTop + (actualDrawerHeight / 2));
                      // determine current slot using direct index math to avoid noisy per-item loops
                      // map drawerScrollOffset -> index: compute the distance from slot0 center
                      // to the desiredScreenCenter, then translate offset into slot steps.
                      let currentSlot = 0;
                      try {
                        const baseCenter = fullSlotYs && fullSlotYs.length > 0 ? fullSlotYs[0] : 0; // center of slot 0
                        // when drawerScrollOffset == 0, slot0 is centered; increasing drawerScrollOffset moves to higher index
                        const relative = (drawerScrollOffset + desiredScreenCenter) - baseCenter; // px distance from slot0 center
                        const idx = Math.round(relative / slotHeight);
                        currentSlot = Math.max(0, Math.min((fullSlotYs ? fullSlotYs.length - 1 : 0), idx));
                      } catch(e) { currentSlot = 0; }

                      // compute step count from delta; prefer a conservative 1-slot-per-gesture
                      const direction = delta > 0 ? 1 : (delta < 0 ? -1 : 0);
                      let stepCount = 1; // default at least one slot
                      // if delta magnitude suggests multiple slots, scale it
                      if (Math.abs(delta) > slotHeight * 1.5) {
                        stepCount = Math.max(1, Math.round(Math.abs(delta) / slotHeight));
                      }
                      let desiredSlot = currentSlot + direction * stepCount;
                      // nudge when there is no movement due to rounding or epsilon issues
                      if (desiredSlot === currentSlot && direction !== 0) {
                        desiredSlot = currentSlot + direction;
                      }
                      desiredSlot = Math.max(0, Math.min(fullSlotYs.length - 1, desiredSlot));
                      const boundedSlot = desiredSlot;
                      // compute centered target aligning slot center to swimlane center
                      // compute centered target (slot center aligned to swimlane center)
                      const centeredTarget = fullSlotYs[boundedSlot] - desiredScreenCenter;
                      // avoid destructive rounding: allow sub-pixel target and use epsilon when comparing
                      const EPS = 0.5;
                      let target = centeredTarget;
                      if (Math.abs(target) < EPS) target = 0;
                      // clamp to scrollable range
                      target = Math.max(0, Math.min(maxScroll, Math.round(target)));
                      if (DRAWER_DEBUG) {
                        // debug info removed
                      }

                      // helper to update visibility of items based on current drawerScrollOffset
                      const updateVisibility = () => {
                        try {
                          const itemsSel = scrollGroupSel.selectAll('.drawer-item');
                          const visibleTop = drawerTop + drawerScrollOffset;
                          const visibleBottom = drawerTop + drawerScrollOffset + actualDrawerHeight;
                          itemsSel.each(function(this: any, d: any, i: number) {
                            try {
                              const childIndex = i;
                              const slotIndex = Math.min(childIndex + 1, fullSlotYs.length - 1);
                              const originalCenter = fullSlotYs[slotIndex];
                              const originalTop = originalCenter - (nodeHeightLocal / 2);
                              const originalBottom = originalTop + nodeHeightLocal;
                              const isVisible = (originalBottom > visibleTop) && (originalTop < visibleBottom);
                              const sel = d3.select(this);
                              if (isVisible) {
                                sel.attr('opacity', 1).style('pointer-events', 'all');
                              } else {
                                sel.attr('opacity', 0).style('pointer-events', 'none');
                              }
                            } catch(e) {}
                          });
                        } catch(e) {}
                      };

                      // animate towards target with per-frame max step to reduce jitter
                      try {
                        (bodyNode as any).__drawerTarget = target;
                        // If the user produced a large delta, apply an immediate jump to the
                        // computed target (avoids waiting on rAF smoothing and helps
                        // validate target semantics). Use slotHeight as natural scale.
                        if (Math.abs(delta) > (slotHeight * 0.5)) {
                          try {
                            drawerScrollOffset = target;
                            try { scrollGroupSel.attr('transform', `translate(0, ${-drawerScrollOffset})`); } catch(e) {}
                            try { updateVisibility(); } catch(e) {}
                            // debug info removed
                          } catch(e) {}
                          // do not schedule animation loop for this gesture
                          return;
                        }
                        // always (re)schedule the per-frame step loop to ensure animation starts
                        const MAX_STEP = 32; // px per frame max (allow larger per-frame move)
                        const STEP_FACTOR_DOWN = 0.75; // fraction for moving down (faster)
                        const STEP_FACTOR_UP = 0.35; // fraction for moving up (slower) - reduced to slow upward motion
                        const stepLoop = () => {
                          try {
                            const cur = drawerScrollOffset;
                            const tgt = (bodyNode as any).__drawerTarget || cur;
                            const diff = tgt - cur;
                            if (Math.abs(diff) < 0.5) {
                              drawerScrollOffset = tgt;
                              try { scrollGroupSel.attr('transform', `translate(0, ${-drawerScrollOffset})`); } catch(e) {}
                              try { updateVisibility(); } catch(e) {}
                              (bodyNode as any).__drawerAnim = null;
                              return;
                            }
                            const proportional = diff * (diff > 0 ? STEP_FACTOR_DOWN : STEP_FACTOR_UP);
                            const step = Math.sign(proportional) * Math.min(Math.abs(proportional), MAX_STEP);
                            const newOffset = Math.max(0, Math.min(maxScroll, cur + step));
                            drawerScrollOffset = newOffset;
                            try { scrollGroupSel.attr('transform', `translate(0, ${-drawerScrollOffset})`); } catch(e) {}
                            try { updateVisibility(); } catch(e) {}
                            if (DRAWER_DEBUG) {
                              try { console.debug(`drawer-frame tab=${collapseKey} cur=${cur.toFixed(2)} tgt=${tgt.toFixed(2)} diff=${diff.toFixed(2)} proportional=${proportional.toFixed(2)} step=${step.toFixed(2)} newOffset=${newOffset.toFixed(2)}`); } catch(e) {}
                              try { console.debug(`drawer-frame-transform ${scrollGroupSel.attr && scrollGroupSel.attr('transform')}`); } catch(e) {}
                            }
                          } catch(e) {}
                          (bodyNode as any).__drawerAnim = requestAnimationFrame(stepLoop);
                        };
                        try {
                          if ((bodyNode as any).__drawerAnim) {
                            try { cancelAnimationFrame((bodyNode as any).__drawerAnim); } catch(e) {}
                            (bodyNode as any).__drawerAnim = null;
                          }
                        } catch(e) {}
                        try {
                          (bodyNode as any).__drawerAnim = requestAnimationFrame(stepLoop);
                          // debug info removed
                        } catch(e) {
                          // fallback: best-effort
                          // debug info removed
                        }
                      } catch(e) {}
                    } catch(e) {
                      if (DRAWER_DEBUG) try { logger.error(`drawer ${collapseKey} rAF schedule error ${String(e)}`); } catch(e) {}
                    }

                    
                  } catch(e) {
                    try { logger.error(`drawer ${collapseKey} rAF apply error ${String(e)}`); } catch(e) {}
                  } finally {
                    (bodyNode as any).__drawerWheelRaf = null;
                  }
                };

                const onWheel = (ev: WheelEvent) => {
                  try {
                    ev.preventDefault();
                    ev.stopPropagation();
                  } catch(e) {}
                  try {
                    const rawDelta = ev.deltaY || 0;
                    // accumulate
                    try { (bodyNode as any).__drawerWheelAccum = ((bodyNode as any).__drawerWheelAccum || 0) + rawDelta; } catch(e) {}
                    if (DRAWER_DEBUG) {
                      // debug info removed
                    }
                    // schedule rAF
                    try {
                      if (!(bodyNode as any).__drawerWheelRaf) {
                        (bodyNode as any).__drawerWheelRaf = requestAnimationFrame(() => applyAccumulated());
                      }
                    } catch(e) {
                      // fallback: immediate apply
                      try { applyAccumulated(); } catch(e) {}
                    }
                  } catch(e) {
                    try { logger.error(`drawer ${collapseKey} wheel handler error ${String(e)}`); } catch(e) {}
                  }
                };

                try {
                    if (bodyNode && bodyNode.addEventListener) {
                      // passive:false so we can call preventDefault(); use capture to get events earlier
                      try {
                        // avoid double-binding
                        if (!(bodyNode as any).__drawerWheelHandler) {
                          try { bodyNode.addEventListener('wheel', onWheel, { passive: false, capture: true }); } catch(e) { try { bodyNode.addEventListener('wheel', onWheel, true); } catch(e) {} }
                          // store reference for cleanup
                          (bodyNode as any).__drawerWheelHandler = onWheel;
                          // debug info removed
                        }
                      } catch(e) {}
                    }

                    // also bind a container-level handler that forwards wheel events when the event path contains the drawer node
                    try {
                      const containerNode: any = this.container || (this.svg && this.svg.node && this.svg.node());
                      const drawerNode: any = drawerSel && drawerSel.node && drawerSel.node();
                      if (containerNode && containerNode.addEventListener && drawerNode) {
                        const onWheelContainer = (ev: WheelEvent) => {
                          try {
                            // Prefer geometric hit test: if the wheel event's clientX/Y falls within the drawer bg rect,
                            // treat it as targeting the drawer (this handles gaps where the pointer is over transparent area).
                            let shouldForward = false;
                            try {
                              const bgNode: any = body.select && body.select('.drawer-bg') && body.select('.drawer-bg').node && body.select('.drawer-bg').node();
                              if (bgNode && bgNode.getBoundingClientRect) {
                                const r = bgNode.getBoundingClientRect();
                                const cx = (ev as any).clientX;
                                const cy = (ev as any).clientY;
                                if (typeof cx === 'number' && typeof cy === 'number') {
                                  if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) shouldForward = true;
                                }
                              }
                            } catch(e) {}

                            // fallback: see if event path contains drawer (shadow DOM or normal)
                            if (!shouldForward) {
                              try {
                                const path = (ev as any).composedPath ? (ev as any).composedPath() : (ev as any).path || [];
                                if (path && path.length) {
                                  for (let i = 0; i < path.length; i++) { if (path[i] === drawerNode) { shouldForward = true; break; } }
                                }
                                if (!shouldForward) {
                                  let n: any = ev.target as any;
                                  while (n) { if (n === drawerNode) { shouldForward = true; break; } n = n.parentNode; }
                                }
                              } catch(e) {}
                            }

                            if (shouldForward) {
                              onWheel(ev);
                            }
                          } catch(e) {}
                        };

                        try {
                          if (!(containerNode as any).__drawerWheelContainerHandler) {
                            try { containerNode.addEventListener('wheel', onWheelContainer, { passive: false, capture: true }); } catch(e) { try { containerNode.addEventListener('wheel', onWheelContainer, true); } catch(e) {} }
                            (containerNode as any).__drawerWheelContainerHandler = onWheelContainer;
                          }
                        } catch(e) {}

                        // debug: also install a document-level capture listener (passive) to observe raw wheel events
                        try {
                          const debugDocHandler = (ev: WheelEvent) => {
                            try {
                              const delta = ev.deltaY || 0;
                              let pathContains = false;
                              try {
                                const path = (ev as any).composedPath ? (ev as any).composedPath() : (ev as any).path || [];
                                if (path && path.length) {
                                  for (let i = 0; i < path.length; i++) { if (path[i] === drawerNode) { pathContains = true; break; } }
                                }
                              } catch(e) {}
                              if (!pathContains) {
                                let n: any = ev.target as any;
                                while (n) { if (n === drawerNode) { pathContains = true; break; } n = n.parentNode; }
                              }
                              // suppressed noisy debug doc logging
                            } catch(e) {}
                          };
                          try {
                            if (!(containerNode as any).__drawerDebugDocHandler) {
                              try { document.addEventListener('wheel', debugDocHandler, { capture: true, passive: true }); } catch(e) { try { document.addEventListener('wheel', debugDocHandler, true); } catch(e) {} }
                              (containerNode as any).__drawerDebugDocHandler = debugDocHandler;
                            }
                          } catch(e) {}
                        } catch(e) {}
                      }
                    } catch(e) {}
                } catch(e) {}
              }
            } catch(e) {}

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
        this.schedule(() => {
            try {
            bg.transition().duration(160).attr('height', parseFloat(bg.attr('height')) ? parseFloat(bg.attr('height')) * 0 : 0).on('end', () => {
              try {
                // remove any local wheel handler attached to the body
                try {
                  const bodyNode: any = body.node && body.node();
                  if (bodyNode && (bodyNode as any).__drawerWheelHandler) {
                    try { bodyNode.removeEventListener && bodyNode.removeEventListener('wheel', (bodyNode as any).__drawerWheelHandler, true); } catch(e) {}
                    try { delete (bodyNode as any).__drawerWheelHandler; } catch(e) {}
                  }
                } catch(e) {}
                // reset scroll transform and animation state
                try {
                  const scrollGroupSel = body.select && body.select('.drawer-scroll');
                  if (scrollGroupSel && !scrollGroupSel.empty()) {
                    try { scrollGroupSel.attr('transform', `translate(0, 0)`); } catch(e) {}
                  }
                } catch(e) {}
                try {
                  const bodyNode: any = body.node && body.node();
                  if (bodyNode) {
                    try { if ((bodyNode as any).__drawerAnim) { cancelAnimationFrame((bodyNode as any).__drawerAnim); } } catch(e) {}
                    try { (bodyNode as any).__drawerAnim = null; } catch(e) {}
                    try { (bodyNode as any).__drawerTarget = 0; } catch(e) {}
                    try { (bodyNode as any).__drawerWheelAccum = 0; } catch(e) {}
                    try { (bodyNode as any).__drawerWheelRaf = null; } catch(e) {}
                  }
                } catch(e) {}
                // also remove container/document handlers if present
                try {
                  const containerNode: any = this.container || (this.svg && this.svg.node && this.svg.node());
                  if (containerNode && (containerNode as any).__drawerWheelContainerHandler) {
                    try { containerNode.removeEventListener && containerNode.removeEventListener('wheel', (containerNode as any).__drawerWheelContainerHandler, true); } catch(e) {}
                    try { delete (containerNode as any).__drawerWheelContainerHandler; } catch(e) {}
                  }
                } catch(e) {}
                try {
                  const containerNode: any = this.container || (this.svg && this.svg.node && this.svg.node());
                  if (containerNode && (containerNode as any).__drawerDebugDocHandler) {
                    try { document.removeEventListener && document.removeEventListener('wheel', (containerNode as any).__drawerDebugDocHandler, true); } catch(e) {}
                    try { delete (containerNode as any).__drawerDebugDocHandler; } catch(e) {}
                  }
                } catch(e) {}
                  body.attr('opacity', 0).style('pointer-events', 'none'); drawerSel.attr('data-open', 'false').style('pointer-events', 'none');
                  // restore the display node's collapse badge text
                  try {
                    const badgeSel = (this.svg && this.svg.select) ? this.svg.select(`.group-badge[data-collapse-group="${collapseKey}"]`) : null;
                    if (badgeSel && !badgeSel.empty()) {
                      try {
                        // prefer original saved text if present
                        const orig = badgeSel.attr && badgeSel.attr('data-original-badge');
                        if (orig != null && String(orig) !== '') {
                          try { badgeSel.select('text').text(String(orig)); } catch(e) {}
                          try { badgeSel.attr('data-original-badge', null); } catch(e) {}
                        } else {
                          try { badgeSel.select('text').text(String(collapsedGroup.count)); } catch(e) {}
                        }
                      } catch(e) {}
                    }
                  } catch(e) {}
              } catch(e) {}
              // cleanup currentOpen if this was the current
              if (this.currentOpenCollapseId === collapseKey) {
                this.currentOpenCollapseId = null;
                this.currentOpenDrawerSel = null;
              }
              // 取消文档点击绑定
              try { this.unbindDocumentClickToClose(); } catch(e) {}
              // remove clipPath associated with this drawer to avoid accumulating defs
              try {
                const clipId = `drawer-clip-${collapseKey}`;
                const defsSel = (this.svg.select && this.svg.select('defs')) ? this.svg.select('defs') : null;
                if (defsSel && !defsSel.empty && !defsSel.empty()) {
                  try { defsSel.select(`#${clipId}`).remove(); } catch(e) {}
                }
              } catch(e) {}
              this.drawerTransitioning = false;
            });
          } catch(e) {
            try {
              // remove any local wheel handler attached to the body
              try {
                const bodyNode: any = body.node && body.node();
                if (bodyNode && (bodyNode as any).__drawerWheelHandler) {
                  try { bodyNode.removeEventListener && bodyNode.removeEventListener('wheel', (bodyNode as any).__drawerWheelHandler, true); } catch(e) {}
                  try { delete (bodyNode as any).__drawerWheelHandler; } catch(e) {}
                  try { logger.log(`drawer ${collapseKey} unbound wheel handler`); } catch(e) {}
                }

                // cancel any pending rAF and clear accumulator
                try {
                  if (bodyNode) {
                    try { if ((bodyNode as any).__drawerWheelRaf) { cancelAnimationFrame((bodyNode as any).__drawerWheelRaf); } } catch(e) {}
                    try { (bodyNode as any).__drawerWheelRaf = null; } catch(e) {}
                    try { (bodyNode as any).__drawerWheelAccum = 0; } catch(e) {}
                  }
                } catch(e) {}

                // remove container-level forwarder if present
                try {
                  const containerNode: any = this.container || (this.svg && this.svg.node && this.svg.node());
                  if (containerNode && (containerNode as any).__drawerWheelContainerHandler) {
                    try { containerNode.removeEventListener && containerNode.removeEventListener('wheel', (containerNode as any).__drawerWheelContainerHandler, true); } catch(e) {}
                    try { delete (containerNode as any).__drawerWheelContainerHandler; } catch(e) {}
                    try { logger.log(_('waterfall_drawer_wheel_unbound_container', 'drawer %s unbound container wheel handler'), collapseKey); } catch(e) {}
                  }
                } catch(e) {}

                // remove debug document-level handler if present
                try {
                  const containerNode: any = this.container || (this.svg && this.svg.node && this.svg.node());
                  if (containerNode && (containerNode as any).__drawerDebugDocHandler) {
                    try { document.removeEventListener && document.removeEventListener('wheel', (containerNode as any).__drawerDebugDocHandler, true); } catch(e) {}
                    try { delete (containerNode as any).__drawerDebugDocHandler; } catch(e) {}
                    try { logger.log(_('waterfall_drawer_wheel_debugdoc_unbound', 'drawer %s unbound debug document wheel listener'), collapseKey); } catch(e) {}
                  }
                } catch(e) {}
              } catch(e) {}
            } catch(e) {}
            body.attr('opacity', 0).style('pointer-events', 'none'); drawerSel.attr('data-open', 'false').style('pointer-events', 'none');
            if (this.currentOpenCollapseId === collapseKey) {
              this.currentOpenCollapseId = null;
              this.currentOpenDrawerSel = null;
            }
            try { this.unbindDocumentClickToClose(); } catch(e) {}
            // try to remove clipPath even on error
            try {
              const clipId = `drawer-clip-${collapseKey}`;
              const defsSel = (this.svg.select && this.svg.select('defs')) ? this.svg.select('defs') : null;
              if (defsSel && !defsSel.empty && !defsSel.empty()) {
                try { defsSel.select(`#${clipId}`).remove(); } catch(e) {}
              }
            } catch(e) {}
            this.drawerTransitioning = false;
          }
        }, totalAnim);
      }
    } catch (e) {
      // error suppressed: handled upstream or not actionable here
    }
  }

  initialize(svg: any, container: HTMLElement, width: number, height: number): void {
    // badge styles are provided by main.css (merged at build time)
    this.svg = svg;
    this.container = container;
    this.width = width;
    this.height = height;
  }

  private timers = new Set<ReturnType<typeof setTimeout>>();
  private schedule(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, delay);
    this.timers.add(timer);
    return timer;
  }
  cleanup(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.wheelScrollTimeout) clearTimeout(this.wheelScrollTimeout);
    const svgNode = this.svg?.node();
    if (svgNode && this.svgWheelHandler) svgNode.removeEventListener('wheel', this.svgWheelHandler, true);
    for (const node of [this.container, ...Array.from(this.container?.querySelectorAll('*') || [])] as any[]) {
      if (!node) continue;
      for (const key of ['__drawerWheelHandler', '__drawerWheelContainerHandler', '__navigraph_wheel_handler']) {
        if (node[key]) { node.removeEventListener('wheel', node[key], true); delete node[key]; }
      }
      if (node.__drawerDebugDocHandler) { document.removeEventListener('wheel', node.__drawerDebugDocHandler, true); delete node.__drawerDebugDocHandler; }
      for (const key of ['__drawerAnim', '__drawerWheelRaf']) { if (node[key]) cancelAnimationFrame(node[key]); }
    }
    this.svg?.on('.zoom', null);
    this.svg?.selectAll('*').interrupt();
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
      logger.warn(_('waterfall_no_nodes', '没有节点数据可渲染'));
      return;
    }

    // 🛡️ 安全检查：验证时间戳有效性
    let validNodes = nodes.filter(node => {
      if (typeof node.timestamp !== 'number' || !Number.isFinite(node.timestamp)) {
        logger.warn(_('waterfall_invalid_timestamp_node', '发现无效时间戳的节点，已过滤:'), node);
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
      logger.warn(_('waterfall_no_nodes_after_filter', '筛选后没有可显示的节点'));
      return;
    }

    // 🔄 恢复观察窗口位置
    // 优先级：内存中的值 > localStorage 中的值 > 默认值 0
    let savedObservationIndex = this.visualizer.waterfallObservationIndex;
    
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
    
    // 确保 drag-layer-group 在 scrollable 内容中位于最上层，优先覆盖 closure markers 等元素，
    // 但仍保持在 time-strips/swimlane separators 之上。此操作是防御性的，避免某些分支
    // 在后续渲染中将 closure markers 或其它元素追加到 drag-layer 之上导致遮挡抽屉。
    try {
      if (this.scrollableGroup && this.scrollableGroup.select) {
        const dl = this.scrollableGroup.select('.drag-layer-group');
        if (dl && !dl.empty && !dl.empty()) {
          try { dl.raise(); } catch(e) {}
        }
      }
    } catch(e) {}
    
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
            logger.warn(_('waterfall_swimlane_not_found', '未找到标签页 {0} 对应的泳道'), tabId);
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
  // NOTE: swimlane separators should be created early so they render behind nodes and
  // any drag-layer overlays (drawers). Place separators first to lock their z-order.
  const swimlaneSeperatorsGroup = contentGroup.append('g').attr('class', 'swimlane-separators-group');
  // Place closure markers before time strips to ensure their z-order sits below strips
  // but above baseline elements. This prevents closure markers being reparented
  // later and ending up above overlays like drawers.
  const closureMarkersGroup = contentGroup.append('g').attr('class', 'closure-markers-group');
  const timeStripsGroup = contentGroup.append('g').attr('class', 'time-strips-group');
    
  const nodesGroup = contentGroup.append('g').attr('class', 'nodes-group');
    
    // 🎯 重新设计：拖拽层放在节点层之后，这样节点可以直接接收点击事件
    const dragLayerGroup = contentGroup.append('g').attr('class', 'drag-layer-group');
    
    // 焦点覆盖组（固定在顶部，不参与滚动）
    const focusOverlayGroup = container.append('g').attr('class', 'focus-overlay-group');
    
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
  .attr('opacity', 0.75) // 增加可见性
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
    .attr('opacity', 0.9);
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
        .attr('opacity', 0.6)
        .style('transition', 'opacity 0.2s ease');
      
      // 不要在 hover 时改变条带透明度，保持稳定视觉（避免覆盖抽屉）
      
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
  }

  /**
   * 按段渲染节点
   */
  private renderSegmentNodes(group: any, layout: LayoutResult): void {

    let totalNodesRendered = 0;
    const MAX_NODES_TO_RENDER = Number.POSITIVE_INFINITY; // 防止渲染过多节点

    layout.segments.forEach((segment, segIndex) => {
      if (totalNodesRendered >= MAX_NODES_TO_RENDER) {
        return;
      }

      // 🎯 使用strips数组中对应的条带分组
      const strip = this.strips[segIndex];
      if (!strip) {
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
            // Prefer placing prebuilt drawers into the drag-layer so they render above
            // closure markers / sticks. Fallback to swimlane group when drag-layer is missing.
            let parentSel: any = null;
            try {
              if (this.scrollableGroup && this.scrollableGroup.select) {
                const dl = this.scrollableGroup.select('.drag-layer-group');
                if (dl && !dl.empty && !dl.empty()) parentSel = dl;
              }
            } catch (e) { parentSel = null; }
            if (!parentSel) parentSel = d3.select((swimlaneGroup && swimlaneGroup.node()) || nodeGroup.node());

            // when inserting into drag-layer we append; when inserting into swimlaneGroup we keep relative insert
            const drawerSel = (parentSel && parentSel.attr && (parentSel.attr('class') || '').indexOf('drag-layer-group') !== -1)
              ? parentSel.append('g')
              : parentSel.insert('g', () => (createdNodeGroup && createdNodeGroup.node()) as any);
            drawerSel
              .attr('class', 'collapsed-drawer')
              .attr('data-collapse-group', collapsedGroup ? (collapsedGroup.displayNode && collapsedGroup.displayNode.id ? collapsedGroup.displayNode.id : collapsedGroup.tabId) : `none-${node.id}`)
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
                  .attr('stroke', 'rgba(74, 144, 226, 0.6)')
                  .attr('stroke-width', 1)
                  .style('pointer-events', 'none');

                // wrap items in a scrollable group so we can translate it for internal scrolling
                const scrollGroup = bodyGroup.append('g').attr('class', 'drawer-scroll');
                const itemsGroup = scrollGroup.append('g').attr('class', 'drawer-items');

              // 其他节点按顺序创建（不包含 displayNode），初始都重叠在 displayNode 位置并不可交互
              const otherNodes = collapsedGroup.nodes.filter(n => n.id !== node.id);
              otherNodes.forEach((childNode, idx) => {
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
                // add a small right-bottom index badge on each folded child (1..n-1)
                try {
                  const badgeText = String(idx + 1);
                  // Use same sizing as collapse badge for visual consistency
                  // For icon mode, make the badge width equal to the icon width and height half the icon height
                  const badgeWidth = (segment.displayMode === 'icon') ? nodeWidth : 22;
                  const badgeHeight = Math.max(12, Math.floor(nodeHeight / 2));
                  const badgeGroup = this.appendBadge(item, nodeWidth - badgeWidth, nodeHeight - badgeHeight, badgeText, { corner: 'bottom', fixedWidth: badgeWidth, minHeight: badgeHeight, fontSize: 7 });
                  badgeGroup.attr('class', 'drawer-item-index-badge').style('pointer-events', 'none');
                } catch(e) {}
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
            logger.warn(_('waterfall_prebuild_drawer_error', '预构建抽屉错误'), e);
          }
        }
        
        totalNodesRendered++;
      });
    });

    //logger.log(_('waterfall_total_nodes_rendered', '✅ 总共渲染了 {0} 个节点'), totalNodesRendered);
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

    //logger.log(_('waterfall_render_closure_markers', '🔴 渲染 {0} 个关闭标记'), this.closureMarkers.length);

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
        /*logger.error(_('waterfall_closure_marker_debug', '❌ 关闭标记调试信息:'));
        logger.error(_('waterfall_closure_marker_id', '   标签ID: {0}'), marker.tabId);
        logger.error(_('waterfall_closure_marker_timestamp', '   时间戳: {0} ({1})'), marker.timestamp, new Date(marker.timestamp).toLocaleString());
        logger.error(_('waterfall_closure_marker_swimlane_index', '   泳道索引: {0}'), marker.swimlaneIndex);
        logger.error(_('waterfall_closure_marker_segment_found', '   找到的段: {0}'), segment ? '是' : '否');
        logger.error(_('waterfall_closure_marker_swimlane_found', '   找到的泳道: {0}'), swimlane ? '是' : '否');
        logger.error(_('waterfall_closure_marker_total_segments', '   总段数: {0}'), layout.segments.length);
        logger.error(_('waterfall_closure_marker_total_swimlanes', '   总泳道数: {0}'), this.swimlanes.length);
        */
        if (layout.segments.length > 0) {
          const firstSegment = layout.segments[0];
          const lastSegment = layout.segments[layout.segments.length - 1];
          logger.error(_('waterfall_closure_marker_segment_range', '   段时间范围: {0} - {1}'), firstSegment.startTime, lastSegment.endTime);
          logger.error(_('waterfall_closure_marker_segment_range_readable', '   段时间范围（可读）: {0} - {1}'), new Date(firstSegment.startTime).toLocaleString(), new Date(lastSegment.endTime).toLocaleString());
        }
        
        //logger.warn(_('waterfall_cannot_find_closure_marker', '⚠️ 无法找到关闭标记 {0} 的对应段或泳道'), marker.tabId);
        return;
      }

      // 🎯 只跳过填充的空白段中的关闭标记，但允许在数据空段中显示
      if (segment.isFiller) {
        //logger.log(_('waterfall_skip_filler_closure', '⚡ 跳过填充空白段中的关闭标记: {0}'), marker.tabId);
        return;
      }
      
      if (segment.displayMode === 'dot' || segment.displayMode === 'icon') {
        //logger.log(_('waterfall_skip_compressed_closure', '⚡ 跳过压缩条带中的关闭标记: {0} (模式: {1})'), marker.tabId, segment.displayMode);
        return;
      }

      // 🎯 关闭标记应该显示在找到的时间段的中央
      // 因为整个段都表示"该泳道现在可以复用"的状态
      const markerX = segment.startX + (segment.allocatedWidth / 2);
      const markerY = swimlane.y + (this.SWIMLANE_HEIGHT / 2); // 泳道中央
      
      //logger.log(_('waterfall_closure_marker_render_pos', '🎯 关闭标记 {0} 显示在段中央: X={1}, 段范围=[{2}-{3}]'), marker.tabId, markerX.toFixed(1), segment.startTime, segment.endTime);
      
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
    
    if (layout.segments.length > 0) {

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
  // 如果是 icon 模式，徽章宽度应与图标同宽且高度为图标高度的一半；其它模式保持默认宽度
  const badgeWidth = (segment.displayMode === 'icon') ? nodeWidth : 22;
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
  // For icon displayMode we show a non-interactive badge (cannot open drawer). For other modes make it interactive.
  const badgeCornerOption = (segment.displayMode === 'icon') ? 'bottom-both' : 'bottom';
  const collapseBadgeGroup = this.appendBadge(group, badgeTransformX, badgeTransformY, badgeText, { corner: badgeCornerOption as any, fixedWidth: badgeWidth, minHeight: badgeHeight, fontSize: 7 });
  collapseBadgeGroup.attr('class', 'group-badge').attr('data-collapse-group', (collapsedGroup.displayNode && collapsedGroup.displayNode.id) ? collapsedGroup.displayNode.id : collapsedGroup.tabId);
  if (segment.displayMode === 'icon') {
    // show but not interactive
    collapseBadgeGroup.style('cursor', 'default').style('pointer-events', 'none');
  } else {
    collapseBadgeGroup.style('cursor', 'pointer').style('pointer-events', 'all');
  }

    // 悬停效果：只对可交互的徽章生效
    if (segment.displayMode !== 'icon') {
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
    }

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

    // 点击事件 - 仅对非-icon 模式启用（dot 模式已在外层被排除）
    if (segment.displayMode !== 'icon') {
      collapseBadgeGroup.on('click', (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
        try {
          this.togglePrebuiltDrawer(collapsedGroup, segment, nodeX, nodeY, nodeWidth, nodeHeight);
        } catch (e) {
          // fallback
          try { this.showCollapsedNodesDrawer(collapsedGroup, node, segment, nodeX, nodeY, nodeWidth, nodeHeight); } catch(e) {}
        }
      });
    }

  }

  /**
   * 统一的徽章创建器：在 parent 上创建一个带 path + text 的 badge
   * 返回创建的 badgeGroup 供外部进一步调整/绑定事件
   */
  private appendBadge(parent: any, x: number, y: number, text: string, options?: { corner?: 'top' | 'bottom' | 'bottom-both', minWidth?: number, fixedWidth?: number, minHeight?: number, fontSize?: number }) {
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
    } else if (corner === 'bottom-both') {
      // Round both bottom corners (left & right)
      // M 0,0 -> top-left; L finalW,0 -> top-right; L finalW,finalHeight-radius -> arc to finalW-radius,finalHeight
      // L radius,finalHeight -> arc to 0,finalHeight-radius -> back to 0,0
      pathD = `M 0,0 L ${finalW},0 L ${finalW},${finalHeight - radius} Q ${finalW},${finalHeight} ${finalW - radius},${finalHeight} L ${radius},${finalHeight} Q 0,${finalHeight} 0,${finalHeight - radius} Z`;
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
    let maxScroll = Math.max(0, drawerFullHeight - actualDrawerHeight);
    // Edge-case guard: if there are hidden slots but computed maxScroll is 0 due to rounding/space constraints,
    // ensure scrolling is possible for the hidden items.
    try {
      const hiddenCountLocal = Math.max(0, slots - Math.floor(actualDrawerHeight / slotHeight));
      if (hiddenCountLocal > 0 && maxScroll === 0) {
        maxScroll = hiddenCountLocal * slotHeight;
        try { logger.log(`drawer fallback maxScroll=${maxScroll} hiddenCount=${hiddenCountLocal}`); } catch(e) {}
      }
    } catch(e) {}

    // Try to mount the drawer into the scrollable drag layer (above swimlane separators)
    let drawer: any;
    try {
      const scrollable = this.scrollableGroup || this.svg;
      const dragLayerSel = (scrollable && typeof scrollable.select === 'function') ? scrollable.select('.drag-layer-group') : null;
      if (dragLayerSel && !dragLayerSel.empty()) {
        drawer = dragLayerSel.append('g')
          .attr('class', 'collapsed-nodes-drawer')
          .attr('data-swimlane', `lane-${swimlane.laneIndex}`)
          .style('pointer-events', 'none');
      } else {
        drawer = this.svg.append('g')
          .attr('class', 'collapsed-nodes-drawer')
          .attr('data-swimlane', `lane-${swimlane.laneIndex}`)
          .style('pointer-events', 'none');
      }
    } catch (e) {
      drawer = this.svg.append('g')
        .attr('class', 'collapsed-nodes-drawer')
        .attr('data-swimlane', `lane-${swimlane.laneIndex}`)
        .style('pointer-events', 'none');
    }

    // 背景矩形在水平上扩展，以便左右超出节点
    const bgX = Math.max(0, nodeX - horizontalPadding);
    const bgWidth = nodeWidth + horizontalPadding * 2;

  // debug console removed

    // 背景矩形初始化为与 display node 同高，稍后可扩展至 full height
    const bgRect = drawer.append('rect')
      .attr('class', 'drawer-bg')
      .attr('x', bgX)
      .attr('y', nodeY)
      .attr('width', bgWidth)
      .attr('height', nodeHeight)
      .attr('fill', '#e6f2ff')
      .attr('fill-opacity', 1)
      .attr('stroke', 'rgba(74, 144, 226, 0.6)')
      .attr('stroke-width', 1)
      .style('pointer-events', 'none');

    // container for rendered nodes
    const nodesContainer = drawer.append('g').attr('class', 'drawer-nodes').style('pointer-events', 'none');

    // Ensure the drawer group is mounted into the drag-layer-group (if present)
    try {
      const overlay = this.scrollableGroup || this.svg;
      const overlayNode = overlay.node() as any;
      const drawerNode = drawer.node() as any;
      if (overlayNode && drawerNode) {
        try {
          const dragLayer = overlayNode.querySelector && overlayNode.querySelector('.drag-layer-group');
          if (dragLayer) {
            try { dragLayer.appendChild(drawerNode); } catch (e) { /* ignore */ }
          } else {
            try { overlayNode.appendChild(drawerNode); } catch (e) { /* ignore */ }
          }
        } catch (e) {
          try { overlayNode.appendChild(drawerNode); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) {
      // ignore move errors
    }
    
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
      
      // 🐛 调试日志（已移除以减少控制台噪音）
      // 原始代码在此处以 1% 抽样打印节点定位，用于线下调试。
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
      .attr('data-node-id', node.id)
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
        .attr('href', UrlUtils.getFaviconUrl(node.url))
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
        .attr('href', UrlUtils.getFaviconUrl(node.url))
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
      case 'history':
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
  

    const timeAxisY = 80; // 时间轴横线的Y坐标（与renderTimeAxis保持一致）
    const sliderHeight = 16; // 滑块高度（更扁平，适合在线上）
    const sliderY = timeAxisY - sliderHeight / 2; // 居中在时间轴线上

    // 🎯 关键逻辑：判断是否有压缩段
    const hasCompression = layout.compressedSegments.length > 0;
    
    if (!hasCompression) {
      // ✅ 无压缩情况：观察窗口覆盖所有条带的实际宽度
  
      
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
    
    //logger.log(_('waterfall_observation_drag_setup', '🔍 观察窗口拖拽设置: 总段数={0}, 观察窗口段数={1}, 最大起始索引={2}'), this.allSegments.length, layout.normalDisplaySegments.length, maxObservationStartIndex);
    //logger.log(_('waterfall_observation_drag_range_info', '🔍 拖拽范围段: 从第{0}段 到 第{1}段（允许覆盖所有段）'), 0, this.allSegments.length - 1);

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
        
        //logger.log(_('waterfall_drag_boundary_check', '🔍 拖动边界检查: minX={0}, maxX={1}, targetX={2}, 最后段={3}'), minX, maxX, targetX, lastSegment ? `${lastSegment.startX}-${lastSegment.startX + lastSegment.allocatedWidth}` : 'N/A');
        
        // 🎯 修复右边界问题：严格限制边界，不允许超出
        // 如果吸附位置超出边界，优先保证边界限制，放弃吸附
        if (targetX > maxX) {
          targetX = maxX;
          self.lastDragSnapped = false; // 取消吸附状态
          //logger.log(_('waterfall_reject_right_boundary_snap', '🚫 拒绝超出右边界的吸附，强制限制在边界内: {0}'), targetX);
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
          //logger.log(_('waterfall_correct_drag_end_pos', '🎯 修正拖拽结束位置: {0} -> {1}'), currentX.toFixed(1), correctedX.toFixed(1));
          rect.attr('x', correctedX);
        }
        
        // 🎯 根据最终位置计算新的观察窗口起始索引（基于覆盖比例）
        const finalX = correctedX;
        const windowLeftEdge = finalX;
        const windowRightEdge = finalX + observationWindowWidth;
        
        //logger.log(_('waterfall_drag_end_analysis', '🔍 拖拽结束位置分析: 窗口位置=[{0}, {1}], 宽度={2}'), windowLeftEdge.toFixed(1), windowRightEdge.toFixed(1), observationWindowWidth.toFixed(1));
        
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
          //logger.log(_('waterfall_detect_left_boundary_drag', '🎯 检测到左边界拖拽：窗口左边缘={0}, 最小拖拽X={1}, 显示最新时间段（索引=0）'), windowLeftEdge.toFixed(1), minDragX.toFixed(1));
        } else if (isAtRightBoundary) {
          // 🎯 用户拖拽到最右边，确保观察窗口覆盖最后几个时间段
          const maxObservationStartIndex = Math.max(0, self.allSegments.length - layout.normalDisplaySegments.length);
          newStartIndex = maxObservationStartIndex;
          //logger.log(_('waterfall_detect_right_boundary_drag', '🎯 检测到右边界拖拽：窗口左边缘={0}, 最大拖拽X={1}, 显示最老时间段（索引={2}）'), windowLeftEdge.toFixed(1), maxDragX.toFixed(1), newStartIndex);
        } else {
          // 🎯 根据拖拽方向确定观察窗口停止位置
          // 向左拖拽：以左边缘对齐时间条带；向右拖拽：以右边缘对齐时间条带
          
          // 检测拖拽方向（基于最终位置与当前显示的第一个条带的相对位置）
          const currentFirstSegment = layout.normalDisplaySegments[0];
          const currentWindowLeftEdge = currentFirstSegment ? currentFirstSegment.startX : 0;
          
          const isDraggingRight = windowLeftEdge > currentWindowLeftEdge;
          
          //logger.log(_('waterfall_drag_direction_analysis', '🔍 拖拽方向分析: 当前窗口左边缘={0}, 新位置={1}, 向右拖拽={2}'), currentWindowLeftEdge.toFixed(1), windowLeftEdge.toFixed(1), isDraggingRight);
          
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
              //logger.log(_('waterfall_drag_right_target', '🎯 向右拖拽: 目标条带={0}, 计算起始索引={1}'), targetSegmentIndex, newStartIndex);
            } else {
              // 回退到最大索引
              newStartIndex = Math.max(0, self.allSegments.length - layout.normalDisplaySegments.length);
              //logger.log(_('waterfall_drag_right_no_target', '🎯 向右拖拽: 未找到合适条带，使用最大索引={0}'), newStartIndex);
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
            //logger.log(_('waterfall_drag_left', '🎯 向左拖拽: 目标条带={0}, 起始索引={1}'), targetSegmentIndex, newStartIndex);
          }
        }
        
        //logger.log(_('waterfall_drag_end_target_index', '🖱️ 拖动结束，目标起始索引: {0}, 当前: {1}'), newStartIndex, self.observationStartIndex);
        
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
    //logger.log(_('waterfall_rerender_for_new_window', '🔄 根据新观察窗口位置重新渲染，起始索引: {0}'), observationStartIndex);
    
    // 🎯 更新当前观察窗口起始索引
    this.observationStartIndex = observationStartIndex;
    
    // 💾 保存观察窗口索引到内存和 localStorage
    this.visualizer.waterfallObservationIndex = observationStartIndex;
    
    // 保存到 localStorage
    const tabId = this.visualizer.tabId || '';
    //logger.log(_('waterfall_save_observation_index_prepare', '💾 准备保存观察窗口索引到 localStorage:'), {tabId,observationStartIndex});
    
    saveViewState(tabId, {
      viewType: 'waterfall',
      waterfallObservationIndex: observationStartIndex
    });
    
    //logger.log(_('waterfall_saved_observation_index', '✅ 已保存观察窗口索引到 localStorage'));
    
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
        //logger.log(_('waterfall_strip_entered_observation', '✨ 条带 {0} 进入观察窗口，展开节点'), i);
        if (isFullyExpanded) {
          this.renderSegmentNodesExpanded(segment, strip, layoutSegment);
        } else {
          // 即使不是完全展开，也需要更新为压缩模式（icon）
          this.renderSegmentNodesCompressed(segment, strip, layoutSegment);
        }
      } else if (isLeaving) {
        // 🎯 离开观察窗口：压缩为圆点
        //logger.log(_('waterfall_segment_leaving', '💨 条带 {0} 离开观察窗口，压缩节点'), i);
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
    try {
      if (this.svgWheelHandler && this.svg && this.svg.node) {
        const node = this.svg.node();
        try { node.removeEventListener('wheel', this.svgWheelHandler, true); } catch(e) {}
        this.svgWheelHandler = null;
      }
    } catch(e) {}
    
    // 计算最大垂直滚动距离
    this.calculateMaxVerticalScroll();
    
    // 添加新的原生滚轮事件监听器（仅用于垂直滚动）
    try {
      const node = this.svg.node();
      if (node) {
        const handler = (ev: WheelEvent) => {
          // 如果正在拖拽观察窗口或垂直拖拽，阻止默认并停止传播
          if (self.isDraggingObservationWindow || self.isDraggingVertical) {
            try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
            return;
          }

          // 优先通过 CSS overscroll-behavior 避免到达这里，但仍然需要处理垂直滚动逻辑
          try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}

          if (self.maxVerticalScroll > 0) {
            const delta = ev.deltaY;
            const newOffset = self.verticalScrollOffset + delta;
            self.setVerticalScrollOffset(newOffset);
          }
        };

        // use capture phase and explicit passive:false to be allowed to call preventDefault
        try { node.addEventListener('wheel', handler, { capture: true, passive: false }); } catch(e) {
          // fallback for older browsers
          try { node.addEventListener('wheel', handler, true); } catch(e) {}
        }

        this.svgWheelHandler = handler;
      }
    } catch(e) {}
    
    
  }

  /**
   * 计算最大垂直滚动距离 - 新版本：基于viewport架构
   */
  private calculateMaxVerticalScroll(): void {
    if (!this.swimlanes || this.swimlanes.length === 0) {
      this.maxVerticalScroll = 0;
      
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
    
  
  }

  /**
   * 设置垂直拖拽滚动 - 升级版本：整个泳道区域都可以拖拽
   */
  private setupVerticalDragScroll(): void {
  
  
    
    if (!this.scrollableGroup) {
      logger.warn(_('waterfall_no_scrollable_group', '⚠️ scrollableGroup 不存在，无法设置拖拽'));
      return;
    }
    
    if (this.maxVerticalScroll <= 0) {
      
      return;
    }

  
    
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
  
    
    timeStripBackgrounds.on('mousedown', function(this: SVGElement, event: any, d: any) {
      // 🎯 关键：只有当点击的是时间条带本身时才启动拖拽
      if (event.target === this) {
        
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
    
  
    
    // 🎯 滚动过程中：只更新视觉效果（条带宽度和观察窗口位置）
    this.updateObservationWindowVisuals(newStartIndex);
    
    // 🎯 使用防抖：滚动停止后才完全重新渲染
    if (this.wheelScrollTimeout) {
      clearTimeout(this.wheelScrollTimeout);
    }
    
    this.wheelScrollTimeout = window.setTimeout(() => {
      
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
    
  }
}