import { animationDuration, animationsEnabled } from '../../utils/display-settings.js';
import { UrlUtils } from '../../../lib/utils/url-utils.js';
import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { NavNode, NavLink, Visualizer } from '../../types/navigation.js';
import type { BaseRenderer, GraphRenderOptions } from './BaseRenderer.js';
import { saveViewState, getViewState } from '../../utils/state-manager.js';
import { TREE_NODE_BATCH } from '../../../lib/graph/tree-day.js';
import { sendMessage } from '../../messaging/content-message-service.js';
import type { D3DragEvent } from 'd3';

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

interface DrawerOwner {
  drawer: any;
  body: any;
  anchor: SVGGElement;
  anchorMarker: Comment;
  container: HTMLElement | null;
  key: string;
  active: boolean;
  closing: boolean;
  timers: Set<ReturnType<typeof setTimeout>>;
  containerWheel?: EventListener;
  debugDocument?: EventListener;
  pager?: HTMLElement;
}

interface TimeSegment {
  startTime: number;
  endTime: number;
  nodes: NavNode[];
  nodesByLane?: Map<number, NavNode[]>;
  displayMode: 'full' | 'short' | 'icon' | 'dot';
  allocatedWidth: number;
  startX: number;
  originalIndex: number;  // 🎯 添加原始索引，用于保持明暗条纹一致性
  isFiller?: boolean;     // 🎯 标识是否为填充段（为了铺满而添加的空白段）
}

interface WaterfallCard {
  node: NavNode;
  body: any;
  width: number;
  height: number;
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

interface ObservationWindowBounds {
  x: number;
  width: number;
  minX: number;
  maxX: number;
  maxIndex: number;
}

/**
 * 标签页生命周期 - 一个标签页从打开到关闭的完整周期
 */
interface TabLifecycle {
  tabId: string;           // 标签页 ID
  startTime: number;       // 标签页开始时间
  endTime: number;         // 标签页结束时间（关闭时间）
  isClosed: boolean;       // 是否已明确关闭
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
}

/**
 * 泳道分配结果
 */
interface LaneAllocation {
  swimlanes: Swimlane[];   // 分配后的泳道列表
  closureMarkers: ClosureMarker[]; // 所有关闭标记
}

/**
 * 折叠节点组 - 同一条带同一标签页的多个节点
 */
interface CollapsedNodeGroup {
  tabId: string;                    // 标签页 ID
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
  private readonly TIME_AXIS_HEIGHT = 100;
  private readonly SWIMLANE_HEIGHT = 50; // 每个泳道的高度（包含间距）
  private readonly SWIMLANE_NODE_HEIGHT = 40; // 泳道内节点的实际高度
  private readonly SWIMLANE_SEPARATOR_DASH = '5,3'; // 虚线样式
  private readonly MAX_SWIMLANES = 20; // 最大泳道数量（防止过多标签页导致布局溢出）
  private readonly COLLAPSE_THRESHOLD = 2; // 折叠阈值：>=2个节点时折叠

  private visualizer: Visualizer;
  private currentLayout: LayoutResult | null = null;
  private svg: any;
  private container: HTMLElement | null = null;
  private width: number = 0;
  private height: number = 0;
  private viewportWidth = 0;
  
  // 存储原始数据，用于拖动时重新计算布局
  private allSegments: TimeSegment[] = [];
  private observationStartIndex: number = 0; // 当前观察窗口起始索引
  private densityOnly = false;
  private visibleLaneStart = -1;
  private visibleLaneEnd = -1;
  private scrollFrame: number | null = null;
  private nodeDetails = new Map<string, NavNode>();
  private detailRequests = new Map<string, Promise<void>>();
  
  // 垂直滚动支持
  private verticalScrollOffset: number = 0; // 垂直滚动偏移量（像素）
  private maxVerticalScroll: number = 0; // 最大垂直滚动距离
  private scrollableGroup: any = null; // 可滚动组的引用
  private isDraggingCanvas = false;
  private isDraggingObservationWindow: boolean = false; // 是否正在拖拽观察窗口
  
  // 泳道数据 - V2版本：支持复用
  private swimlanes: Swimlane[] = []; // 当前渲染的泳道列表（新结构）
  private closureMarkers: ClosureMarker[] = []; // 关闭标记列表
  private lanesByTab = new Map<string, Swimlane>();
  // 当前打开的抽屉状态
  private currentOpenCollapseId: string | null = null;
  private currentOpenDrawerSel: any = null;
  // 抽屉动画互斥标志，防止重复打开/关闭导致的竞态
  private drawerTransitioning: boolean = false;
  private drawerOwner: DrawerOwner | null = null;
  private disposed = false;
  // 文档级捕获点击处理器（用于点击外部关闭抽屉）
  private documentClickHandler: ((e: Event) => void) | null = null;

  // 时间段常量（10分钟）
  private readonly TIME_SEGMENT_DURATION = 10 * 60 * 1000; // 10分钟（毫秒）

  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }

  private ownsDrawer(owner: DrawerOwner): boolean {
    return !this.disposed && owner.active && this.drawerOwner === owner;
  }

  private moveDrawerAnchor(anchor: SVGGElement, move: () => void): void {
    const focus = document.activeElement;
    move();
    if (focus instanceof SVGElement && anchor.contains(focus)) focus.focus({ preventScroll: true });
  }

  /** Invalidate first: interrupted transitions and late frames must not revive this drawer. */
  private releaseDrawer(owner: DrawerOwner): void {
    if (!owner.active) return;
    owner.active = false;
    const isCurrent = this.drawerOwner === owner;
    if (isCurrent) {
      this.drawerOwner = null;
      this.currentOpenCollapseId = null;
      this.currentOpenDrawerSel = null;
      this.drawerTransitioning = false;
      this.unbindDocumentClickToClose();
    }
    for (const timer of owner.timers) { clearTimeout(timer); this.timers.delete(timer); }
    owner.timers.clear();
    owner.drawer.interrupt();
    owner.drawer.selectAll('*').interrupt();
    const bodyNode: any = owner.body.node();
    if (bodyNode) {
      for (const key of ['__drawerWheelHandler', '__navigraph_wheel_handler']) {
        const handler = bodyNode[key];
        if (handler) bodyNode.removeEventListener('wheel', handler, true);
        delete bodyNode[key];
      }
      for (const key of ['__drawerAnim', '__drawerWheelRaf']) {
        if (bodyNode[key] != null) cancelAnimationFrame(bodyNode[key]);
        bodyNode[key] = null;
      }
      bodyNode.__drawerTarget = 0;
      bodyNode.__drawerWheelAccum = 0;
    }
    // The container is shared across renderer lifetimes. Remove only our actual functions.
    const container: any = owner.container;
    if (owner.containerWheel && container) {
      container.removeEventListener('wheel', owner.containerWheel, true);
      if (container.__drawerWheelContainerHandler === owner.containerWheel) delete container.__drawerWheelContainerHandler;
    }
    if (owner.debugDocument) {
      document.removeEventListener('wheel', owner.debugDocument, true);
      if (container?.__drawerDebugDocHandler === owner.debugDocument) delete container.__drawerDebugDocHandler;
    }
    owner.pager?.remove();
    this.moveDrawerAnchor(owner.anchor, () => owner.anchorMarker.replaceWith(owner.anchor));
    owner.drawer.remove();
    this.svg?.selectAll('clipPath').filter(function(this: Element) {
      return this.id === `drawer-clip-${owner.key}`;
    }).remove();
    const badge = this.svg?.select(`.group-badge[data-collapse-group="${owner.key}"]`);
    if (badge && !badge.empty()) {
      const label = badge.attr('data-original-badge');
      if (label) badge.select('text').text(label);
      badge.attr('data-original-badge', null).attr('aria-expanded', 'false');
    }
  }

  private closeCurrentDrawer(): void {
    if (this.drawerOwner) this.releaseDrawer(this.drawerOwner);
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
          if (this.drawerOwner?.pager && path.includes(this.drawerOwner.pager)) return;
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
   * Animate the current drawer, created when its group is opened.
   */
  private toggleDrawer(
    anchor: SVGGElement,
    collapsedGroup: CollapsedNodeGroup,
    nodeX: number,
    nodeY: number,
    nodeWidth: number,
    nodeHeight: number
  ): void {
    if (this.disposed) return;
    let operationOwner: DrawerOwner | null = null;
    try {
  // Debug flag: keep disabled in production
  const DRAWER_DEBUG = false;
  const mount = this.scrollableGroup || this.svg;
  // Use a per-display-node key to identify the prebuilt drawer. Using tabId
  // caused collisions when the same tab had folded groups across multiple segments.
  const collapseKey = (collapsedGroup && collapsedGroup.displayNode && collapsedGroup.displayNode.id) ? collapsedGroup.displayNode.id : (collapsedGroup && collapsedGroup.tabId) || '';
  const drawerSel = mount.select(`g.collapsed-drawer[data-collapse-group="${collapseKey}"]`);
      if (drawerSel.empty()) return;

      const isOpen = drawerSel.attr('data-open') === 'true';

      if (!isOpen) {
        if (this.drawerTransitioning) return;
        this.closeCurrentDrawer();
        const anchorMarker = document.createComment('waterfall drawer anchor');
        const owner: DrawerOwner = {
          drawer: drawerSel, body: drawerSel.select('.drawer-body'), container: this.container,
          anchor, anchorMarker, key: collapseKey, active: true, closing: false, timers: new Set()
        };
        operationOwner = owner;
        const ownsDrawer = () => this.ownsDrawer(owner);
        this.drawerOwner = owner;
        this.currentOpenCollapseId = collapseKey;
        this.currentOpenDrawerSel = drawerSel;
        this.drawerTransitioning = true;
        // Register before any open animation so outside clicks can also cancel pending opens.
        this.bindDocumentClickToClose();

        // Keep the original card above the backdrop in the same coordinate system.
        anchor.before(anchorMarker);
        this.moveDrawerAnchor(anchor, () => drawerSel.node().appendChild(anchor));
        drawerSel.attr('data-open', 'true');

        const body = owner.body;
        const bg = body.select('.drawer-bg');
        const itemNodes: SVGGElement[] = body.selectAll('.drawer-item').nodes();

        if (itemNodes.length > 0) {
          const slots = collapsedGroup.nodes.length;
          const slotHeight = this.SWIMLANE_HEIGHT;
          const preferredTop = collapsedGroup.swimlaneY;
          const drawerFullHeight = Math.min(slots, 6) * slotHeight;
          const availableDownSpace = this.verticalScrollOffset + this.height - this.TIME_AXIS_HEIGHT - preferredTop;
          const availableUpSpace = preferredTop - this.verticalScrollOffset + slotHeight;
          const expandUp = availableDownSpace < drawerFullHeight && availableUpSpace > availableDownSpace;
          const actualDrawerHeight = Math.min(drawerFullHeight, expandUp ? availableUpSpace : availableDownSpace);
          const drawerTop = expandUp ? preferredTop + slotHeight - actualDrawerHeight : preferredTop;
          const maxScroll = Math.max(0, slots * slotHeight - actualDrawerHeight);
          let drawerScrollOffset = 0;

          // Clip only the scrolling records, leaving the anchor's slot fixed.
          const clipTop = expandUp ? drawerTop : nodeY + nodeHeight;
          const clipBottom = expandUp ? nodeY : drawerTop + actualDrawerHeight;
          const clipId = `drawer-clip-${collapseKey}`;
          this.svg.select('defs').append('clipPath')
            .attr('id', clipId)
            .append('rect')
            .attr('x', nodeX)
            .attr('y', clipTop)
            .attr('width', nodeWidth)
            .attr('height', Math.max(0, clipBottom - clipTop));
          body.select('.drawer-viewport').attr('clip-path', `url(#${clipId})`);
          body.attr('opacity', 1).style('pointer-events', 'all');
          bg.transition().duration(animationDuration(200)).attr('y', drawerTop).attr('height', actualDrawerHeight);

          const fullSlotYs = Array.from({ length: slots }, (_, index) => drawerTop + (index + 0.5) * slotHeight);
          const firstChildSlot = expandUp ? 0 : 1;
          const maxVisibleChildren = Math.min(itemNodes.length, Math.ceil((actualDrawerHeight - slotHeight) / slotHeight));
          const labelY = expandUp ? (slotHeight + nodeHeight) / 2 : (nodeHeight - slotHeight) / 2;
          const itemDuration = 180;
          const stagger = 40;

          itemNodes.forEach((element, index) => {
            const item = d3.select(element);
            const record = collapsedGroup.nodes[index + 1];
            this.renderTimeDiffLabel(item, 0, labelY, nodeWidth, Math.abs(record.timestamp - collapsedGroup.displayNode.timestamp));
            item.on('click.drawerItem', (event: MouseEvent) => event.stopPropagation());
            const target = `translate(${nodeX}, ${fullSlotYs[index + firstChildSlot] - nodeHeight / 2})`;
            if (index < maxVisibleChildren) {
              item.transition()
                .delay(animationDuration(index * stagger))
                .duration(animationDuration(itemDuration))
                .attr('transform', target)
                .attr('opacity', 1)
                .on('end', () => { if (ownsDrawer()) item.style('pointer-events', 'all'); });
            } else {
              item.attr('transform', target);
            }
          });

          const totalAnim = 220 + maxVisibleChildren * stagger + itemDuration;
          this.schedule(() => {
            // Show the close affordance once the drawer is open.
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
                  try { badgeSel.attr('aria-expanded', 'true').select('text').text('−'); } catch(e) {}
                } catch(e) {}
              }
            } catch(e) {}
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
                  if (!this.ownsDrawer(owner) || owner.closing) return;
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
                          const visibleTop = clipTop + drawerScrollOffset;
                          const visibleBottom = clipBottom + drawerScrollOffset;
                          itemsSel.each(function(this: any, d: any, i: number) {
                            try {
                              const originalCenter = fullSlotYs[i + firstChildSlot];
                              const originalTop = originalCenter - nodeHeight / 2;
                              const originalBottom = originalTop + nodeHeight;
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
                          if (!this.ownsDrawer(owner) || owner.closing) return;
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
                            const step = animationsEnabled() ? Math.sign(proportional) * Math.min(Math.abs(proportional), MAX_STEP) : diff;
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
                  if (!this.ownsDrawer(owner) || owner.closing) return;
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
                          if (!this.ownsDrawer(owner) || owner.closing) return;
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
                            owner.containerWheel = onWheelContainer as EventListener;
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
                              owner.debugDocument = debugDocHandler as EventListener;
                            }
                          } catch(e) {}
                        } catch(e) {}
                      }
                    } catch(e) {}
                } catch(e) {}
              }
            } catch(e) {}

            this.drawerTransitioning = false;
          }, totalAnim, owner);
        }
      } else {
        // close: reverse animation - collapse items to base position then shrink bg and hide
    if (this.drawerTransitioning) return; // ignore close while transitioning
    const owner = this.drawerOwner;
    if (!owner || owner.drawer.node() !== drawerSel.node() || !this.ownsDrawer(owner)) return;
    operationOwner = owner;
    owner.closing = true;
    this.drawerTransitioning = true;
        const body = drawerSel.select('.drawer-body');
        const bg = body.select('.drawer-bg');
  const items = body.selectAll('.drawer-item');
        const visibleItems = items.filter(function(this: Element) {
          return Number(this.getAttribute('opacity')) > 0;
        });

        // compute base pos from first item's current transform (or bg y)
  // compute base pos: use provided nodeX/nodeY
  const baseX = nodeX;
  const baseY = nodeY;

        const itemDuration = 140;
        const stagger = 30;
        // animate items back to baseY and fade out
        visibleItems.each(function(this: any, d: any, i: number) {
          d3.select(this)
            .style('pointer-events', 'none')
            .transition()
            .delay(animationDuration(i * stagger))
            .duration(animationDuration(itemDuration))
            .attr('transform', `translate(${baseX}, ${baseY})`)
            .attr('opacity', 0);
        });

        // after items collapsed, shrink bg and hide body
        const totalAnim = visibleItems.size() * stagger + itemDuration + 40;
        this.schedule(() => {
          try {
            bg.transition().duration(animationDuration(160)).attr('height', 0).on('end', () => {
              if (this.ownsDrawer(owner)) this.releaseDrawer(owner);
            });
          } catch (e) {
            if (this.ownsDrawer(owner)) this.releaseDrawer(owner);
          }
        }, totalAnim, owner);
      }
    } catch (e) {
      if (operationOwner) this.releaseDrawer(operationOwner);
    }
  }

  initialize(svg: any, container: HTMLElement, width: number, height: number): void {
    // badge styles are provided by main.css (merged at build time)
    this.disposed = false;
    this.svg = svg;
    this.container = container;
    this.width = width;
    this.height = height;
    this.viewportWidth = width;
  }

  private timers = new Set<ReturnType<typeof setTimeout>>();
  private schedule(callback: () => void, delay: number, owner: DrawerOwner): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      owner.timers.delete(timer);
      if (this.ownsDrawer(owner)) callback();
    }, animationDuration(delay));
    this.timers.add(timer);
    owner.timers.add(timer);
    return timer;
  }
  cleanup(): void {
    this.disposed = true;
    this.closeCurrentDrawer();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    const svgNode = this.svg?.node();
    if (svgNode && this.svgWheelHandler) svgNode.removeEventListener('wheel', this.svgWheelHandler, true);
    this.svg?.on('.zoom', null).on('.drag', null).classed('waterfall-panning', false).attr('viewBox', null);
    this.svg?.selectAll('*').interrupt();
    this.currentLayout = null;
    this.svg = null;
    this.container = null;
  }

  /**
   * 获取当前观察窗口的时间范围信息
   * @returns 时间范围字符串，格式为 "HH:MM - HH:MM"，如果无法获取则返回 null
   */
  getObservationWindowTimeRange(): string | null {
    const segments = this.densityOnly ? this.allSegments : this.currentLayout?.normalDisplaySegments;
    if (!segments?.length) return null;
    const start = new Date(segments[segments.length - 1].startTime);
    const end = new Date(segments[0].endTime);
    const format = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit',
      ...(start.toDateString() !== end.toDateString() ? { month: 'short', day: 'numeric' } : {}),
    });
    return `${format.format(start)} – ${format.format(end)}`;
  }

  render(nodes: NavNode[], _edges: NavLink[], options: GraphRenderOptions = {}): void {
    if (!nodes.length) return;

    const tabId = this.visualizer.tabId || '';
    if (options.restoreTransform) {
      this.observationStartIndex = this.visualizer.waterfallObservationIndex
        ?? getViewState(tabId, 'waterfall')?.waterfallObservationIndex ?? 0;
    }

    const { swimlanes, closureMarkers } = this.allocateSwimlanesWithReuse(nodes);
    this.swimlanes = swimlanes;
    this.closureMarkers = closureMarkers;

    if (options.fitToView) {
      const contentHeight = this.TIME_AXIS_HEIGHT + this.swimlaneContentHeight();
      const availableHeight = Math.max(1, this.height - (options.viewportBottomInset ?? 0));
      const scale = Math.min(1, availableHeight / contentHeight);
      // Below half size the 50 px lanes become a density overview.
      this.densityOnly = scale < 0.5;
      if (scale < 1 && !this.densityOnly) {
        this.width /= scale;
        this.height /= scale;
        this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
      }
    }

    this.allSegments = this.buildTimeSegments(nodes);
    this.drawLayout();
    if (!this.densityOnly) {
      this.setupWheelScroll();
      this.setupCanvasDrag();
    }
  }

  private drawLayout(): void {
    this.closeCurrentDrawer();
    this.svg.selectAll('*').interrupt().remove();
    this.addSVGDefinitions();
    const layout = this.allocateSegmentLayout(this.allSegments, this.width, this.observationStartIndex);
    this.currentLayout = layout;
    this.observationStartIndex = layout.normalDisplaySegments[0].originalIndex;
    this.visualizer.waterfallObservationIndex = this.observationStartIndex;
    this.visibleLaneStart = -1;
    this.visibleLaneEnd = -1;
    this.calculateMaxVerticalScroll();
    this.verticalScrollOffset = Math.min(this.verticalScrollOffset, this.maxVerticalScroll);
    const groups = this.createSVGGroups(this.svg, layout);
    this.renderTimeAxis(groups.timeAxisGroup, layout);
    this.renderTimeDensity(groups.timeAxisGroup, this.densityOnly ? this.allSegments : layout.compressedSegments);

    if (this.densityOnly) {
      groups.timeAxisGroup.append('text')
        .attr('x', layout.timeAxisData.startX)
        .attr('y', this.TIME_AXIS_HEIGHT + 22)
        .attr('fill', 'currentColor')
        .text(_('waterfall_density_overview', '会话活动概览。切换到实际大小可查看各泳道。'));
      return;
    }

    this.renderTimeStrips(groups.timeStripsGroup, groups.nodesGroup, layout);
    this.renderVisibleLanes();
    this.renderObservationWindow(groups.focusOverlayGroup, layout);
  }

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
      .attr('stop-color', 'var(--waterfall-strip-even-top, #fafafa)')
      .attr('stop-opacity', 1);
    stripGradientEven.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--waterfall-strip-even-bottom, #f0f0f0)')
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
      .attr('stop-color', 'var(--waterfall-strip-odd-top, #f8f8f8)')
      .attr('stop-opacity', 1);
    stripGradientOdd.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--waterfall-strip-odd-bottom, #e8e8e8)')
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
    const { swimlanes, closureMarkers } = this.assignLanesWithReuse(sortedLifecycles);
    
    // 4. 分配Y坐标
    this.assignSwimlanePositions(swimlanes);
    
    
    return {
      swimlanes,
      closureMarkers
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
      const tabId = String(node.tabId ?? 'unknown');
      
      if (!lifecycles.has(tabId)) {
        lifecycles.set(tabId, {
          tabId,
          startTime: node.timestamp,
          endTime: node.timestamp,
          isClosed: false
        });
      }
      
      const lifecycle = lifecycles.get(tabId)!;
      lifecycle.endTime = node.timestamp;
      lifecycle.isClosed = node.isClosed || false;
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
  private assignLanesWithReuse(lifecycles: TabLifecycle[]): LaneAllocation {
    const swimlanes: Swimlane[] = [];
    const closureMarkers: ClosureMarker[] = [];

    // The leftmost available index preserves the existing first-lane reuse order.
    const leafStart = 2 ** Math.ceil(Math.log2(Math.max(1, lifecycles.length)));
    const reusableAt = new Float64Array(2 * leafStart).fill(Infinity);
    this.lanesByTab.clear();
    lifecycles.forEach(lifecycle => {
      let assignedLaneIndex = -1;
      if (reusableAt[1] <= lifecycle.startTime) {
        let index = 1;
        while (index < leafStart) {
          index *= 2;
          if (reusableAt[index] > lifecycle.startTime) index++;
        }
        assignedLaneIndex = index - leafStart;
      }

      // 如果没有可复用的泳道，创建新泳道
      if (assignedLaneIndex === -1) {
        assignedLaneIndex = swimlanes.length;
        swimlanes.push({
          laneIndex: assignedLaneIndex,
          y: 0, // 稍后分配
          height: this.SWIMLANE_HEIGHT
        });
      }

      // 分配标签页到泳道
      const lane = swimlanes[assignedLaneIndex];
      this.lanesByTab.set(lifecycle.tabId, lane);
      let leaf = leafStart + assignedLaneIndex;
      reusableAt[leaf] = lifecycle.closureMarkerTime === undefined
        ? Infinity : lifecycle.closureMarkerTime + this.TIME_SEGMENT_DURATION;
      while (leaf > 1) {
        leaf = Math.floor(leaf / 2);
        reusableAt[leaf] = Math.min(reusableAt[2 * leaf], reusableAt[2 * leaf + 1]);
      }

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

    return { swimlanes, closureMarkers };
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

  private buildTimeSegments(nodes: NavNode[]): TimeSegment[] {
    const occupied = new Map<number, TimeSegment>();
    for (const node of nodes) {
      const start = Math.floor(node.timestamp / this.SEGMENT_DURATION) * this.SEGMENT_DURATION;
      let segment = occupied.get(start);
      if (!segment) {
        segment = {
          startTime: start, endTime: start + this.SEGMENT_DURATION, nodes: [], nodesByLane: new Map(),
          displayMode: 'full', allocatedWidth: 0, startX: 0, originalIndex: 0
        };
        occupied.set(start, segment);
      }
      segment.nodes.push(node);
      const lane = this.getSwimlaneForNode(node)!.laneIndex;
      const laneNodes = segment.nodesByLane!.get(lane);
      if (laneNodes) laneNodes.push(node);
      else segment.nodesByLane!.set(lane, [node]);
    }
    const ordered = [...occupied.values()].sort((a, b) => b.startTime - a.startTime);
    const segments: TimeSegment[] = [];
    const compactGaps = ordered[0].startTime - ordered[ordered.length - 1].startTime >= 1000 * this.SEGMENT_DURATION;
    let previousStart = ordered[0].endTime;
    for (const segment of ordered) {
      // A long idle span takes one strip rather than dropping records beyond the old time limit.
      while (previousStart > segment.endTime) {
        const start = compactGaps ? segment.endTime : previousStart - this.SEGMENT_DURATION;
        segments.push({
          startTime: start, endTime: previousStart, nodes: [], displayMode: 'full',
          allocatedWidth: 0, startX: 0, originalIndex: segments.length
        });
        previousStart = start;
      }
      segment.originalIndex = segments.length;
      segment.nodesByLane!.forEach(laneNodes => laneNodes.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)));
      segments.push(segment);
      previousStart = segment.startTime;
    }
    return segments;
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
    const availableWidth = Math.max(1, containerWidth - 100); // 留出边距
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
      // Zooming out expands SVG units without adding blank time strips.
      const remainingWidth = this.viewportWidth - 100 - contentWidth;
      if (remainingWidth > 0) {
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
      const maxNormalSegments = Math.max(1, Math.floor(normalDisplayWidth / this.NODE_WIDTHS.full));
      
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
  private createSVGGroups(container: any, layout: LayoutResult) {
    const timeAxisHeight = this.TIME_AXIS_HEIGHT;
    const canMoveWindow = !this.densityOnly && layout.compressedSegments.length > 0;
    const canScrollLanes = !this.densityOnly && this.maxVerticalScroll > 0;
    
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
    viewportGroup.attr('clip-path', 'url(#viewport-clip)')
      .classed('waterfall-pannable', canMoveWindow || canScrollLanes)
      .classed('waterfall-window-movable', canMoveWindow);

    if (canScrollLanes) {
      // Keep vertical scrolling available in the gaps between cards.
      viewportGroup.classed('waterfall-lane-scroll', true);
      viewportGroup.append('rect')
        .attr('width', this.width)
        .attr('height', viewportHeight)
        .attr('fill', 'transparent');
    }
    
    // 在viewport内创建内容容器（这个容器会滚动）
    const contentGroup = viewportGroup.append('g').attr('class', 'content-group')
      .attr('transform', `translate(0, ${-this.verticalScrollOffset})`);
    
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
  private renderSwimlaneSeparators(group: any, layout: LayoutResult, lanes: Swimlane[]): void {
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
    lanes.forEach(lane => {
      const index = lane.laneIndex;
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
          .attr('stroke', 'var(--waterfall-separator, #333333)')
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
  private getSwimlaneForNode(node: NavNode): Swimlane | undefined {
    return this.lanesByTab.get(String(node.tabId ?? 'unknown'));
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
      .attr('stroke', 'var(--waterfall-axis, #666)')
      .attr('stroke-width', 2)
      .attr('class', 'time-axis-main-line');
    
    // 时间方向箭头（在最右端 - 指向新时间方向）
    // 因为时间从右到左（最新在左），时间轴从旧到新，所以箭头在右端指向右
    const arrowSize = 8;
    axisLineGroup.append('polygon')
      .attr('points', `${lineEndX},${timeAxisY} ${lineEndX - arrowSize},${timeAxisY - arrowSize/2} ${lineEndX - arrowSize},${timeAxisY + arrowSize/2}`)
      .attr('fill', 'var(--waterfall-axis, #666)')
      .attr('class', 'time-axis-arrow');

    const labels = this.densityOnly
      ? new Set([this.allSegments[0], this.allSegments[this.allSegments.length - 1]])
      : layout.normalDisplaySegments;
    for (const segment of labels) this.addTimeLabelToTimeAxis(labelGroup, segment, timeAxisY);
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
      .attr('stroke', 'var(--waterfall-axis, #666)')
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
  private renderTimeStrips(background: any, cards: any, layout: LayoutResult): void {
    for (const segment of layout.normalDisplaySegments) {
      background.append('rect')
        .attr('class', `strip-background strip-${segment.originalIndex}`)
        .attr('data-segment-index', segment.originalIndex)
        .attr('x', segment.startX)
        .attr('y', 0)
        .attr('width', segment.allocatedWidth)
        .attr('height', this.swimlaneContentHeight())
        .attr('fill', segment.originalIndex % 2 === 0 ? 'url(#stripGradientEven)' : 'url(#stripGradientOdd)')
        .attr('opacity', 0.6);
      cards.append('g')
        .attr('class', 'time-strip')
        .attr('data-time', new Date(segment.endTime).toISOString())
        .attr('data-segment-index', segment.originalIndex)
        .append('g').attr('class', 'node-group');
    }
  }

  private renderTimeDensity(group: any, segments: TimeSegment[]): void {
    const binWidth = 5 * this.width / this.viewportWidth;
    const bins = new Map<number, { count: number; start: number; end: number }>();
    let max = 1;
    for (const segment of segments) {
      if (!segment.nodes.length) continue;
      const index = Math.floor((segment.startX + segment.allocatedWidth / 2) / binWidth);
      const bin = bins.get(index) ?? { count: 0, start: segment.startTime, end: segment.endTime };
      bin.count += segment.nodes.length;
      bin.start = Math.min(bin.start, segment.startTime);
      max = Math.max(max, bin.count);
      bins.set(index, bin);
    }
    const overview = group.append('g').attr('class', 'waterfall-density');
    const bottom = this.densityOnly ? 190 : this.TIME_AXIS_HEIGHT - 1;
    const height = this.densityOnly ? 50 : 9;
    const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    for (const [index, bin] of bins) {
      const barHeight = Math.max(2, height * Math.sqrt(bin.count / max));
      overview.append('rect')
        .attr('x', index * binWidth)
        .attr('y', bottom - barHeight)
        .attr('width', binWidth * 0.8)
        .attr('height', barHeight)
        .attr('fill', 'var(--waterfall-accent, var(--color-accent, #4285f4))')
        .attr('data-record-count', bin.count)
        .append('title')
        .text(`${format.format(bin.start)} – ${format.format(bin.end)} · ${_('waterfall_record_count', '{0} 条记录', bin.count.toLocaleString())}`);
    }
  }

  private renderVisibleLanes(): void {
    const layout = this.currentLayout;
    if (!layout || this.densityOnly) return;
    const laneHeight = this.SWIMLANE_HEIGHT;
    const start = Math.max(0, Math.floor((this.verticalScrollOffset - 20) / laneHeight) - 2);
    const end = Math.min(this.swimlanes.length, Math.ceil(
      (this.verticalScrollOffset + this.height - this.TIME_AXIS_HEIGHT - 20) / laneHeight
    ) + 2);
    if (start === this.visibleLaneStart && end === this.visibleLaneEnd) return;
    this.closeCurrentDrawer();
    this.visibleLaneStart = start;
    this.visibleLaneEnd = end;

    const lanes = this.swimlanes.slice(start, end);
    const separators = this.scrollableGroup.select('.swimlane-separators-group');
    const markers = this.scrollableGroup.select('.closure-markers-group');
    separators.selectAll('*').remove();
    markers.selectAll('*').remove();
    this.renderSwimlaneSeparators(separators, layout, lanes);
    this.renderClosureMarkers(markers, layout, start, end);

    const cards: WaterfallCard[] = [];
    for (const segment of layout.normalDisplaySegments) {
      const parent = this.scrollableGroup
        .select(`.time-strip[data-segment-index="${segment.originalIndex}"] .node-group`);
      parent.selectAll('*').interrupt().remove();
      for (const lane of lanes) {
        const records = segment.nodesByLane?.get(lane.laneIndex);
        if (!records?.length) continue;
        const node = records[0];
        const width = Math.min(this.NODE_WIDTHS.full, segment.allocatedWidth);
        const height = this.NODE_HEIGHTS.full;
        const x = segment.startX + (segment.allocatedWidth - width) / 2;
        const y = lane.y + (laneHeight - height) / 2;
        const group = parent.append('g')
          .attr('class', 'navigation-node')
          .attr('data-node-id', node.id)
          .attr('data-lane-index', lane.laneIndex)
          .attr('transform', `translate(${x}, ${y})`);
        cards.push(this.renderCard(group, node, width, height));
        if (records.length >= this.COLLAPSE_THRESHOLD) {
          const collapsed: CollapsedNodeGroup = {
            tabId: String(node.tabId ?? 'unknown'), nodes: records, displayNode: node,
            swimlaneY: lane.y, count: records.length
          };
          this.renderCollapseBadge(group, collapsed, x, y, width, height, lane.laneIndex);
        }
      }
    }
    this.hydrateCards(cards);
  }

  private renderCard(group: any, node: NavNode, width: number, height: number): WaterfallCard {
    const body = group.append('g').attr('class', 'waterfall-card');
    this.renderFullNode(body, this.nodeDetails.get(node.id) ?? node, width, height);
    return { node, body, width, height };
  }

  private async loadNodeDetails(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !this.nodeDetails.has(id) && !this.detailRequests.has(id));
    for (let i = 0; i < missing.length; i += TREE_NODE_BATCH) {
      const batch = missing.slice(i, i + TREE_NODE_BATCH);
      const request = sendMessage('getTreeNodes', { ids: batch }).then(response => {
        if (!response.success) throw new Error(response.error || 'Node details unavailable');
        if (this.disposed) return;
        for (const node of response.nodes) this.nodeDetails.set(node.id, node);
      }).finally(() => {
        for (const id of batch) this.detailRequests.delete(id);
      });
      for (const id of batch) this.detailRequests.set(id, request);
    }
    await Promise.all(new Set(ids.map(id => this.detailRequests.get(id))));
  }

  private hydrateCards(cards: WaterfallCard[]): void {
    const missing = cards.filter(({ node }) => !this.nodeDetails.has(node.id));
    if (!missing.length) return;
    void this.loadNodeDetails(missing.map(card => card.node.id)).then(() => {
      if (this.disposed) return;
      for (const { node, body, width, height } of missing) {
        const detail = this.nodeDetails.get(node.id);
        if (!detail || !body.node()?.isConnected) continue;
        body.selectAll('*').interrupt().remove();
        this.renderFullNode(body, detail, width, height);
      }
    }).catch(error => logger.warn(String(error)));
  }

  private renderClosureMarkers(group: any, layout: LayoutResult, start: number, end: number): void {
    if (!this.closureMarkers || this.closureMarkers.length === 0) {
      return;
    }

    //logger.log(_('waterfall_render_closure_markers', '🔴 渲染 {0} 个关闭标记'), this.closureMarkers.length);

    // 创建关闭标记分组
    const markerGroup = group.append('g').attr('class', 'closure-markers');

    this.closureMarkers.forEach(marker => {
      if (marker.swimlaneIndex < start || marker.swimlaneIndex >= end) return;
      const segment = layout.normalDisplaySegments.find(section =>
        !section.isFiller && marker.timestamp >= section.startTime && marker.timestamp < section.endTime
      );
      if (!segment) return;
      const swimlane = this.swimlanes[marker.swimlaneIndex];

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

  private renderCollapseBadge(
    group: any,
    collapsed: CollapsedNodeGroup,
    x: number,
    y: number,
    width: number,
    height: number,
    lane: number
  ): void {
    const badgeHeight = Math.max(12, Math.floor(height / 2));
    const badge = this.appendBadge(group, width - 22, height - badgeHeight, `+${collapsed.count - 1}`, {
      corner: 'bottom', fixedWidth: 22, minHeight: badgeHeight, fontSize: 7
    });
    const id = collapsed.displayNode.id;
    const anchor = group.node() as SVGGElement;
    const activate = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.currentOpenCollapseId === id) {
        this.toggleDrawer(anchor, collapsed, x, y, width, height);
      } else {
        this.openDrawerPage(anchor, collapsed, x, y, width, height, lane, 0);
      }
    };
    badge.attr('class', 'group-badge')
      .attr('data-collapse-group', id)
      .attr('role', 'button')
      .attr('tabindex', 0)
      .attr('aria-expanded', 'false')
      .attr('aria-label', _('tree_day_expand', '展开 {0} 条记录', String(collapsed.count - 1)))
      .style('cursor', 'pointer')
      .style('pointer-events', 'all')
      .on('click', activate)
      .on('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      });
  }

  private openDrawerPage(
    anchor: SVGGElement, group: CollapsedNodeGroup, x: number, y: number,
    width: number, height: number, lane: number, page: number
  ): void {
    this.closeCurrentDrawer();
    const pageSize = Math.max(1, Math.min(500, Math.floor(window.navigraphSettings?.maxNodes ?? 100)));
    const pageCount = Math.ceil((group.count - 1) / pageSize);
    const first = 1 + page * pageSize;
    const pageNodes = group.nodes.slice(first, first + pageSize);
    const drawer = this.scrollableGroup.select('.drag-layer-group').append('g')
      .attr('class', 'collapsed-drawer')
      .attr('data-collapse-group', group.displayNode.id)
      .attr('data-lane-index', lane)
      .attr('data-open', 'false');
    const body = drawer.append('g').attr('class', 'drawer-body')
      .attr('opacity', 0).style('pointer-events', 'none');
    body.append('rect').attr('class', 'drawer-bg')
      .attr('x', x).attr('y', y).attr('width', width).attr('height', height)
      .attr('fill', 'var(--waterfall-control-surface, #e6f2ff)')
      .attr('stroke', 'var(--waterfall-accent, rgba(74, 144, 226, 0.6))');
    const items = body.append('g').attr('class', 'drawer-viewport')
      .append('g').attr('class', 'drawer-scroll').append('g').attr('class', 'drawer-items');
    const cards = pageNodes.map((node, index) => {
      const item = items.append('g').attr('class', 'drawer-item').attr('data-node-id', node.id)
        .attr('transform', `translate(${x}, ${y})`).attr('opacity', 0).style('pointer-events', 'none');
      const card = this.renderCard(item, node, width, height);
      const badgeHeight = Math.max(12, Math.floor(height / 2));
      this.appendBadge(item, width - 22, height - badgeHeight, String(first + index), {
        corner: 'bottom', fixedWidth: 22, minHeight: badgeHeight, fontSize: 7
      }).attr('class', 'drawer-item-index-badge');
      return card;
    });
    this.toggleDrawer(anchor, { ...group, nodes: [group.displayNode, ...pageNodes] }, x, y, width, height);
    this.hydrateCards(cards);
    const owner = this.drawerOwner;
    if (!owner || pageCount <= 1 || !this.container) return;

    const pager = document.createElement('div');
    pager.className = 'waterfall-drawer-pager';
    const go = (index: number) => {
      if (!Number.isInteger(index) || index < 0 || index >= pageCount || index === page) {
        field.value = String(page + 1);
        return;
      }
      this.openDrawerPage(anchor, group, x, y, width, height, lane, index);
      this.drawerOwner?.pager?.querySelector('input')?.focus();
    };
    const field = document.createElement('input');
    field.type = 'number';
    field.min = '1';
    field.max = String(pageCount);
    field.value = String(page + 1);
    field.setAttribute('aria-label', _('waterfall_drawer_page', '抽屉页码'));
    field.addEventListener('change', () => go(field.valueAsNumber - 1));
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = '‹';
    previous.setAttribute('aria-label', _('waterfall_drawer_previous', '上一页'));
    previous.disabled = page === 0;
    previous.addEventListener('click', () => go(page - 1));
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = '›';
    next.setAttribute('aria-label', _('waterfall_drawer_next', '下一页'));
    next.disabled = page === pageCount - 1;
    next.addEventListener('click', () => go(page + 1));
    pager.append(previous, field, ` / ${pageCount.toLocaleString()} `, next);
    this.container.append(pager);
    owner.pager = pager;
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
      .attr('class', 'drawer-time-label')
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
    
    const nodeColor = this.getNodeColor(node);
    group.append('rect')
      .attr('class', 'waterfall-card-background')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', 4)
      .style('--waterfall-type-color', nodeColor)
      .style('--waterfall-type-stroke', this.adjustBrightness(nodeColor, -30))
      .style('--waterfall-type-hover', this.adjustBrightness(nodeColor, -20));

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
      .attr('class', 'node-title-label')
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
    group.on('click', () => {
      void this.loadNodeDetails([node.id]).then(() => {
        const detail = this.nodeDetails.get(node.id);
        if (!this.disposed && detail && group.node()?.isConnected) this.visualizer.showNodeDetails(detail);
      }).catch(error => {
        if (!this.disposed) this.visualizer.showError(String(error));
      });
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
  private getObservationWindowBounds(layout: LayoutResult): ObservationWindowBounds {
    const segments = layout.normalDisplaySegments;
    const x = segments[0].startX;
    const last = segments[segments.length - 1];
    const width = last.startX + last.allocatedWidth - x;
    return {
      x, width,
      minX: layout.timeAxisData.startX,
      maxX: layout.timeAxisData.endX - width,
      maxIndex: layout.compressedSegments.length,
    };
  }

  private renderObservationWindow(group: any, layout: LayoutResult): void {
    const bounds = this.getObservationWindowBounds(layout);
    const laneHeight = Math.min(this.height - this.TIME_AXIS_HEIGHT, this.swimlaneContentHeight());
    group.append('rect')
      .attr('class', 'waterfall-observation-frame')
      .classed('is-movable', bounds.maxIndex > 0)
      .attr('aria-hidden', 'true')
      .attr('x', bounds.x)
      .attr('y', this.TIME_AXIS_HEIGHT + 0.5)
      .attr('width', bounds.width)
      .attr('height', Math.max(0, laneHeight - 1))
      .attr('rx', 6);

    const timeAxisY = 80; // 时间轴横线的Y坐标（与renderTimeAxis保持一致）
    const sliderHeight = 16; // 滑块高度（更扁平，适合在线上）
    const sliderY = timeAxisY - sliderHeight / 2; // 居中在时间轴线上

    if (bounds.maxIndex === 0) {
      // 观察窗口滑块 - 虚线边框表示全覆盖
      group.append('rect')
        .attr('class', 'observation-slider-full')
        .attr('x', bounds.x)
        .attr('y', sliderY)
        .attr('width', bounds.width)
        .attr('height', sliderHeight)
        .attr('rx', sliderHeight / 2)
        .attr('ry', sliderHeight / 2)
        .attr('fill', 'var(--waterfall-control-surface, rgba(0, 123, 255, 0.1))')
        .attr('stroke', 'var(--waterfall-accent, #007bff)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .style('cursor', 'default');
      return;
    }

    // 可拖动的观察窗口滑块 - 现代化设计
    const observationRect = group.append('rect')
      .attr('class', 'observation-slider')
      .attr('x', bounds.x)
      .attr('y', sliderY)
      .attr('width', bounds.width)
      .attr('height', sliderHeight)
      .attr('rx', sliderHeight / 2)
      .attr('ry', sliderHeight / 2)
      .attr('fill', 'url(#observationGradient)')
      .attr('stroke', 'var(--waterfall-accent, #4A90E2)')
      .attr('stroke-width', 1)
      .attr('filter', 'url(#observationShadow)')
      .style('cursor', 'grab');

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
      .attr('stop-color', 'var(--waterfall-control-surface, #E3F2FD)')
      .attr('stop-opacity', 0.4);
    
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--waterfall-accent, #BBDEFB)')
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

    this.setupObservationCapsuleDrag(observationRect, bounds);
  }

  private selectObservationIndicators(): any {
    return this.svg.select('.focus-overlay-group')
      .selectAll('.waterfall-observation-frame, .observation-slider');
  }

  private setupObservationCapsuleDrag(rect: any, bounds: ObservationWindowBounds): void {
    const indicators = this.selectObservationIndicators();
    let x = bounds.x;

    const drag = d3.drag()
      .on('start', () => {
        x = bounds.x;
        this.isDraggingObservationWindow = true;
        rect.style('cursor', 'grabbing');
      })
      .on('drag', (event: { dx: number }) => {
        x = Math.max(bounds.minX, Math.min(bounds.maxX, x + event.dx));
        indicators.attr('x', x);
      })
      .on('end', () => {
        this.isDraggingObservationWindow = false;
        rect.style('cursor', 'grab');
        if (this.disposed) return;
        this.dropObservationWindow(indicators, bounds, x);
      });
    rect.call(drag);
  }

  private dropObservationWindow(indicators: any, bounds: ObservationWindowBounds, x: number): void {
    const fraction = (x - bounds.minX) / (bounds.maxX - bounds.minX);
    const index = Math.round(fraction * bounds.maxIndex);
    if (index !== this.observationStartIndex) this.reRenderWithObservationWindow(index);
    else indicators.attr('x', bounds.x);
  }

  private reRenderWithObservationWindow(index: number): void {
    this.observationStartIndex = index;
    this.drawLayout();
    saveViewState(this.visualizer.tabId || '', { viewType: 'waterfall', waterfallObservationIndex: this.observationStartIndex });
    this.visualizer.updateStatusBar();
  }

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
          // Ignore wheel scrolling while either drag is in progress.
          if (self.isDraggingObservationWindow || self.isDraggingCanvas) {
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
    this.maxVerticalScroll = Math.max(0, this.swimlaneContentHeight() - (this.height - this.TIME_AXIS_HEIGHT));
  }

  private swimlaneContentHeight(): number {
    const lastLane = this.swimlanes[this.swimlanes.length - 1];
    return lastLane ? lastLane.y + lastLane.height : 0;
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
      if (this.scrollFrame === null) {
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = null;
          this.renderVisibleLanes();
        });
      }
    }
    
  
  }

  private setupCanvasDrag(): void {
    const svg = this.svg;
    const dragThreshold = 4;
    const unitsPerPixel = this.width / this.viewportWidth;
    const drag = d3.drag()
      .touchable(() => false)
      .clickDistance(dragThreshold)
      .filter((event: MouseEvent) => {
        const target = event.target as Element;
        return event.button === 0 && !event.ctrlKey
          && target.closest('.waterfall-pannable, .waterfall-observation-frame.is-movable') !== null
          && target.closest('.group-badge, .collapsed-drawer') === null;
      })
      .on('start', (start: D3DragEvent<SVGSVGElement, unknown, unknown>) => {
        const bounds = this.getObservationWindowBounds(this.currentLayout!);
        const initialOffset = this.verticalScrollOffset;
        const indicators = this.selectObservationIndicators();
        const frame = indicators.filter('.waterfall-observation-frame').node() as SVGRectElement;
        const frameRect = frame.getBoundingClientRect();
        const pointer = start.sourceEvent as MouseEvent;
        const fromWindow = pointer.target === frame
          || (pointer.clientX >= frameRect.left && pointer.clientX <= frameRect.right
            && pointer.clientY >= frameRect.top && pointer.clientY <= frameRect.bottom);
        let axis: 'horizontal' | 'vertical' | null = null;
        let previewX = bounds.x;

        start.on('drag', (event: D3DragEvent<SVGSVGElement, unknown, unknown>) => {
          if (this.disposed) return;
          const dx = event.x - start.x;
          const dy = event.y - start.y;
          if (axis === null) {
            if (Math.hypot(dx, dy) <= dragThreshold) return;
            const horizontal = Math.abs(dx) >= Math.abs(dy);
            if (horizontal ? !fromWindow || bounds.maxIndex === 0 : this.maxVerticalScroll === 0) return;
            axis = horizontal ? 'horizontal' : 'vertical';
            this.isDraggingCanvas = true;
            svg.classed('waterfall-panning', true);
            if (axis === 'vertical') this.closeCurrentDrawer();
          }

          if (axis === 'vertical') {
            this.setVerticalScrollOffset(initialOffset - dy * unitsPerPixel);
            return;
          }

          previewX = Math.max(bounds.minX, Math.min(bounds.maxX, bounds.x + dx * unitsPerPixel));
          indicators.attr('x', previewX);
        });

        start.on('end', () => {
          if (this.disposed || axis === null) return;
          this.isDraggingCanvas = false;
          svg.classed('waterfall-panning', false);
          if (axis === 'horizontal') this.dropObservationWindow(indicators, bounds, previewX);
        });
      });
    svg.call(drag);
  }

  /**
   * 处理水平滚动（时间轴方向）
   */
  public moveObservationWindow(direction: 'left' | 'right'): void {
    const layout = this.currentLayout;
    if (!layout || this.densityOnly || !layout.compressedSegments.length) return;
    const last = this.allSegments.length - layout.normalDisplaySegments.length;
    const step = direction === 'left' ? -1 : 1;
    const index = Math.max(0, Math.min(last, this.observationStartIndex + step));
    if (index !== this.observationStartIndex) this.reRenderWithObservationWindow(index);
  }
}
