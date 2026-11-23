import { Logger } from '../../../lib/utils/logger.js';
import { _ } from '../../../lib/utils/i18n.js';
import { UrlUtils } from '../../../lib/utils/url-utils.js';
import type { ExtendedNavNode, NavLink, NavNode, Visualizer } from '../../types/navigation.js';
import { animationDuration, labelsEnabled } from '../../utils/display-settings.js';
import { getViewState, saveViewState } from '../../utils/state-manager.js';
import { sendMessage } from '../../messaging/content-message-service.js';
import type { BackgroundResponses } from '../../../types/messages/background.js';
import { indexTreeDay, projectTreeDay, type TreeDayFocus, type TreeDayFold } from './tree-day-projection.js';
import { isTrackingPage } from '../../utils/visualization-utils.js';
import type { BaseRenderer, GraphRenderOptions } from './BaseRenderer.js';
import { layoutEllipticalTree, treeNodeTitle } from './elliptical-tree-layout.js';
import type { EllipticalTreeLink, EllipticalTreeNode } from './elliptical-tree-layout.js';

const d3: typeof import('d3') = window.d3;
const logger = new Logger('TreeRenderer');
const SESSION_ROOT = 'session-root';
const VIEW_STATE = 'balanced-elliptical-tree';
const HALO_ID = 'tree-level-halo-gradient';
const FOLD_BUTTON_OFFSET = 26;

type TreeTransform = Pick<d3.ZoomTransform, 'x' | 'y' | 'k'>;
type FoldLink = EllipticalTreeLink & { fold: TreeDayFold };

interface TreeFrame {
  focus: TreeDayFocus;
  sourceId: string;
  scope: string;
  transform: TreeTransform;
}

export interface TreeExpansionState {
  frames: TreeFrame[];
}

export class TreeRenderer implements BaseRenderer {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private zoom?: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private width = 0;
  private height = 0;

  constructor(private visualizer: Visualizer, private expansion: TreeExpansionState) {}

  initialize(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, _container: HTMLElement, width: number, height: number): void {
    this.svg = svg;
    this.width = width;
    this.height = height;
  }

  render(_nodes: NavNode[], _edges: NavLink[], options: GraphRenderOptions = {}): void {
    const svg = this.svg;
    const day = this.visualizer.treeDay;
    if (!svg || !day?.nodes.length) return;
    const { visualizer, width, height } = this;
    const tree = indexTreeDay(day.nodes);
    const sessionNode: ExtendedNavNode = {
      id: SESSION_ROOT,
      type: 'session',
      title: new Date(day.start).toLocaleDateString(),
      timestamp: day.start,
    };
    const main = svg.select<SVGGElement>('.main-group');
    const rings = main.insert('g', ':first-child').attr('class', 'tree-levels').attr('aria-hidden', 'true');
    const halo = rings.append('ellipse').attr('class', 'tree-level-halo').attr('fill', `url(#${HALO_ID})`);
    const gradient = svg.append('defs').append('radialGradient').attr('id', HALO_ID).attr('class', 'tree-level-gradient');
    const links = main.select<SVGGElement>('.links-group');
    const pages = main.select<SVGGElement>('.nodes-group');
    const folds = main.append('g').attr('class', 'tree-chain-controls');
    const back = svg.append('foreignObject')
      .attr('x', (width - 168) / 2).attr('y', 12).attr('width', 168).attr('height', 36)
      .append<HTMLButtonElement>('xhtml:button')
      .attr('type', 'button').attr('class', 'tree-chain-toggle tree-day-back')
      .style('display', 'none')
      .attr('aria-expanded', 'true')
      .text(_('tree_day_collapse', '收起分支'));
    let selectedNodeId: string | undefined;
    let pending = false;
    let groups = new Map<string, TreeDayFold>();
    const metadata = new Map<string, NavNode>();

    const tabId = visualizer.tabId || '';
    const layoutScope = `day:${day.start}:${width}x${height}`;
    const saved = options.fitToView ? undefined : getViewState(tabId, VIEW_STATE);
    const restored = saved?.layoutScope === layoutScope ? saved.transform : undefined;
    const applyViewport = (transform: d3.ZoomTransform) => {
      main.attr('transform', transform.toString());
      visualizer.currentTransform = transform;
      const scale = transform.k;
      pages.selectAll<SVGTextElement, EllipticalTreeNode>('.node-title-label')
        .style('display', page => labelsEnabled() && (scale >= 0.5 || (scale >= 0.35 && groups.has(page.data.id))) ? null : 'none');
      const factor = Math.max(1, 0.75 / scale);
      folds.selectAll<SVGForeignObjectElement, FoldLink>('foreignObject').attr('transform', link => {
        const y = link.y - FOLD_BUTTON_OFFSET * factor;
        return `translate(${link.x},${y}) scale(${factor}) translate(${-link.x},${-link.y})`;
      });
      folds.selectAll<SVGLineElement, FoldLink>('line')
        .attr('y2', link => link.y - (FOLD_BUTTON_OFFSET - 15) * factor);
      visualizer.updateStatusBar();
    };
    const zoom: d3.ZoomBehavior<SVGSVGElement, unknown> = d3.zoom();
    zoom.duration(animationDuration(250))
      .filter((event: MouseEvent) => {
        const onFold = (event.target as Element).closest('.tree-chain-toggle');
        return (!onFold || event.type === 'wheel') && (!event.ctrlKey || event.type === 'wheel') && !event.button;
      })
      .on('zoom', event => applyViewport(event.transform))
      .on('end', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (event.sourceEvent && !this.expansion.frames.length) {
          saveViewState(tabId, { viewType: VIEW_STATE, layoutScope, transform: event.transform });
        }
      });
    this.zoom = zoom;
    visualizer.zoom = zoom;
    svg.call(zoom).style('cursor', 'move');

    const updateSelection = (depth?: number) => {
      rings.selectAll<SVGEllipseElement, { depth: number }>('ellipse.tree-level')
        .classed('selected-tree-level', ring => ring.depth === depth);
      pages.selectAll<SVGGElement, EllipticalTreeNode>('.node')
        .classed('highlighted', page => page.data.id === selectedNodeId);
    };

    const draw = async (frames: TreeFrame[], camera?: TreeTransform, focusId?: string) => {
      if (pending) return;
      pending = true;
      try {
        let projection = projectTreeDay(tree, frames[frames.length - 1]?.focus);
        while (!projection.nodes.length && frames.length) {
          frames = frames.slice(0, -1);
          projection = projectTreeDay(tree, frames[frames.length - 1]?.focus);
        }
        const ids = projection.nodes.filter(node => !projection.folds.has(node.id)).map(node => node.id);
        const missing = ids.filter(id => !metadata.has(id));
        if (missing.length) {
          const response: BackgroundResponses.GetTreeNodesResponse = await sendMessage('getTreeNodes', { ids: missing });
          if (this.svg !== svg) return;
          for (const node of response.nodes) metadata.set(node.id, node);
        }
        const positioned = projection.nodes.map(node => {
          const details = projection.folds.has(node.id) ? undefined : metadata.get(node.id);
          return details ? { ...node, ...details, parentId: node.parentId } : node;
        });
        const layout = layoutEllipticalTree(positioned, sessionNode, width, height);
        this.expansion.frames = frames;
        groups = projection.folds;
        back.style('display', () => frames.length ? null : 'none');
        back.attr('tabindex', frames.length ? null : -1);
        const outer = layout.rings[layout.rings.length - 1];
        halo.attr('cx', layout.centerX).attr('cy', layout.centerY).attr('rx', outer.rx).attr('ry', outer.ry);
        const stops = layout.rings.flatMap((ring, index) => {
          const progress = index / Math.max(1, layout.rings.length - 1);
          const strength = 1 - 0.6 * progress;
          const innerRadius = index === 0 ? 0 : layout.rings[index - 1].rx;
          return [innerRadius, ring.rx].map(radius => ({ offset: radius / outer.rx, strength }));
        });
        gradient.selectAll<SVGStopElement, typeof stops[number]>('stop')
          .data(stops)
          .join('stop')
          .attr('offset', stop => stop.offset)
          .style('--tree-level-strength', stop => String(stop.strength));
        rings.selectAll<SVGEllipseElement, typeof layout.rings[number]>('ellipse.tree-level')
          .data(layout.rings, ring => ring.depth)
          .join('ellipse')
          .attr('class', 'tree-level')
          .attr('data-depth', ring => ring.depth)
          .attr('cx', layout.centerX)
          .attr('cy', layout.centerY)
          .attr('rx', ring => ring.rx)
          .attr('ry', ring => ring.ry);
        links.selectAll<SVGPathElement, EllipticalTreeLink>('path')
          .data(layout.links, link => link.target.data.id)
          .join('path')
          .attr('class', link => `link ${link.target.data.type}`)
          .classed('tree-link-continuation', link => link.target.continuesOutsidePage)
          .attr('d', link => link.path);

        const open = (id: string, fold: TreeDayFold, focused: boolean) => {
          void draw([...this.expansion.frames, { focus: fold.focus, sourceId: id,
            scope: layoutScope, transform: d3.zoomTransform(svg.node()!) }], undefined, focused ? 'back' : undefined);
        };
        drawNodes(pages, layout.nodes, day.start, visualizer, (node) => {
          const fold = groups.get(node.data.id);
          if (fold) open(node.data.id, fold, false);
          else {
            selectedNodeId = node.data.id;
            const details = metadata.get(node.data.id);
            if (details) visualizer.showNodeDetails(details);
            updateSelection(node.depth);
          }
        });
        updateSelection(layout.nodes.find(node => node.data.id === selectedNodeId)?.depth);

        const foldedLinks = layout.links.flatMap(link => {
          const fold = groups.get(link.target.data.id);
          return fold ? [{ ...link, fold }] : [];
        });
        folds.selectAll<SVGLineElement, FoldLink>('line')
          .data(foldedLinks, link => link.target.data.id)
          .join(enter => enter.insert('line', ':first-child').attr('class', 'tree-chain-guide'))
          .attr('x1', link => link.x)
          .attr('x2', link => link.x)
          .attr('y1', link => link.y);
        const controls = folds.selectAll<SVGForeignObjectElement, FoldLink>('foreignObject')
          .data(foldedLinks, link => link.target.data.id)
          .join(enter => enter.append('foreignObject')
            .attr('width', 64)
            .attr('height', 36)
            .call(objects => objects.append('xhtml:button')
              .attr('type', 'button')
              .attr('class', 'tree-chain-toggle')))
          .attr('x', link => link.x - 32)
          .attr('y', link => link.y - 18);

        const label = (link: FoldLink) => {
          const reloads = link.fold.reloads
            ? ' · ' + _('tree_day_reload_count', '刷新 {0} 次', String(link.fold.reloads)) : '';
          return `${link.target.data.title || ''} · ${_('tree_day_expand', '展开 {0} 条记录', String(link.fold.count))}${reloads}`;
        };
        const buttons = controls.select<HTMLButtonElement>('button')
          .attr('aria-expanded', 'false')
          .attr('title', label)
          .attr('aria-label', label)
          .text(link => `+${link.fold.count}`)
          .on('click', (event: MouseEvent, link) => {
            open(link.target.data.id, link.fold, event.currentTarget === document.activeElement);
          });
        svg.selectAll<SVGTextElement, number>('text.cycle-message')
          .data(tree.brokenCycles ? [tree.brokenCycles] : [])
          .join('text')
          .attr('class', 'cycle-message')
          .attr('x', width - 22)
          .attr('y', 24)
          .attr('text-anchor', 'end')
          .text(count => _('fixed_cycle_connections', '已移除 {0} 个循环连接', String(count)));

        const viewportHeight = Math.max(1, height - (options.viewportBottomInset ?? 0));
        const scale = Math.min(layout.fitScale, viewportHeight / (2 * outer.ry));
        const initial = d3.zoomIdentity
          .translate(layout.centerX * (1 - scale), viewportHeight / 2 - layout.centerY * scale)
          .scale(scale);
        const transform = camera && Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.k) && camera.k > 0
          ? d3.zoomIdentity.translate(camera.x, camera.y).scale(camera.k) : initial;
        if (options.fitToView && !frames.length && !camera) {
          saveViewState(tabId, { viewType: VIEW_STATE, layoutScope, transform });
        }
        zoom.scaleExtent([Math.min(0.1, scale, transform.k), 8]);
        svg.call(zoom.transform, transform);
        if (visualizer.currentTransform !== transform) applyViewport(transform);
        if (focusId === 'back') back.node()?.focus({ preventScroll: true });
        else if (focusId) buttons.filter(link => link.target.data.id === focusId).node()?.focus({ preventScroll: true });
      } catch (error) {
        if (this.svg === svg) visualizer.showError(String(error));
      } finally {
        pending = false;
      }
    };
    back.on('click', (event: MouseEvent) => {
      const frames = this.expansion.frames;
      const frame = frames[frames.length - 1];
      if (!frame) return;
      void draw(frames.slice(0, -1), frame.scope === layoutScope ? frame.transform : undefined,
        event.currentTarget === document.activeElement ? frame.sourceId : undefined);
    });
    void draw(this.expansion.frames, this.expansion.frames.length ? undefined : restored);
  }

  cleanup(): void {
    this.zoom?.on('zoom end', null);
    this.svg?.on('.zoom', null);
    this.svg?.selectAll('*').interrupt();
    this.zoom = undefined;
    this.svg = null;
  }
}

function drawNodes(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  nodes: EllipticalTreeNode[],
  sessionStart: number | undefined,
  visualizer: Visualizer,
  onSelect: (node: EllipticalTreeNode) => void,
): void {
  group.selectAll('*').remove();
  const selection = group.selectAll<SVGGElement, EllipticalTreeNode>('.node')
    .data(nodes, node => node.data.id)
    .join('g')
    .attr('class', ({ data }) => `node ${data.type}`)
    .classed('root', node => !!node.data.isRoot)
    .classed('closed', node => !!node.data.isClosed)
    .classed('tracking', node => isTrackingPage(node.data, visualizer))
    .classed('self-loop', node => !!node.data.isSelfLoop)
    .attr('data-node-id', node => node.data.id)
    .attr('data-depth', node => node.depth)
    .attr('transform', node => `translate(${node.x},${node.y})`);

  const root = selection.filter(node => node.depth === 0).append('g').attr('class', 'session-root-group');
  root.append('circle').attr('r', 36).attr('class', 'session-root-circle');
  const date = sessionStart === undefined ? undefined : new Date(sessionStart);
  root.append('text').attr('class', 'session-year').attr('y', -8)
    .text(date ? String(date.getFullYear()) : _('current_session', '当前会话'));
  root.append('line').attr('class', 'session-separator').attr('x1', -29).attr('x2', 29);
  root.append('text').attr('class', 'session-mmdd').attr('y', 10)
    .text(date ? String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0') : '');

  selection.append('title').text(node => {
    const title = node.data.title || node.data.url || _('unnamed_node', '未命名节点');
    if (node.depth === 0) return title;
    const level = _('tree_visible_level', '可见第 {0} 层', String(node.depth));
    const original = node.originalDepth === node.depth ? '' : ' · ' +
      _('tree_original_level', '折叠前第 {0} 层', String(node.originalDepth));
    const continuation = node.continuesOutsidePage ? '\n' + _('tree_continues_outside_page', '上游页面不在当前范围') : '';
    return title + '\n' + level + original + continuation;
  });

  const pages = selection.filter(node => node.depth > 0).on('click', (_event, node) => onSelect(node));
  pages.append('circle').attr('r', 20);
  pages.filter(node => !!node.data.favicon)
    .append('image')
    .attr('href', node => UrlUtils.getFaviconUrl(node.data.url))
    .attr('x', -8).attr('y', -8).attr('width', 16).attr('height', 16)
    .on('error', function () {
      d3.select(this).attr('href', chrome.runtime.getURL('images/logo-48.png')).classed('default-icon', true);
    });

  pages.append('text').attr('class', 'node-title-label').attr('dy', 35)
    .text(({ data }) => treeNodeTitle(data));

  pages.filter(node => !!node.data.hasFilteredChildren)
    .append('circle').attr('r', 6).attr('cx', 18).attr('cy', -18).attr('class', 'filtered-indicator')
    .append('title')
    .text(({ data }) => _('contains_filtered_nodes', '包含 {0} 个已过滤节点', String(data.filteredChildrenCount || 0)));
  const selfLoops = pages.filter(node => !!node.data.isSelfLoop);
  selfLoops.append('circle').attr('r', 6).attr('cx', 18).attr('cy', 18).attr('class', 'self-loop-indicator')
    .append('title').text(_('page_has_self_refresh', '页面存在自我刷新'));
  selfLoops.append('svg').attr('width', 10).attr('height', 10).attr('x', 13).attr('y', 13)
    .attr('viewBox', '0 0 512 512').attr('class', 'self-loop-icon').append('path')
    .attr('d', 'M370.72 133.28C339.458 104.008 298.888 87.962 255.848 88c-75.8.13-140.39 50.42-161.42 119.4l-44.04-10.5C76.39 110.38 159.12 48 256 48c51.89 0 99.28 19.33 135.37 51.14L440 48v144H296l74.72-58.72zM141.28 378.72C172.542 407.992 213.112 424.038 256.152 424c75.8-.13 140.39-50.42 161.42-119.4l44.04 10.5C435.61 401.62 352.88 464 256 464c-51.89 0-99.28-19.33-135.37-51.14L72 464V320h144l-74.72 58.72z');

  const spa = pages.filter(node => Number(node.data.spaRequestCount) > 0)
    .append('g').attr('class', 'tree-spa-badge')
    .attr('transform', ({ data }) => {
      const x = data.hasFilteredChildren ? 32 : 26;
      const y = -12 - (data.hasFilteredChildren ? 8 : 0) - (data.isSelfLoop ? 6 : 0);
      return `translate(${x},${y})`;
    });
  spa.append('circle').attr('r', 7).attr('class', 'spa-badge-ring');
  spa.append('text').attr('class', 'spa-badge-text').text(node => String(node.data.spaRequestCount));
  spa.append('title').text(node => _('content_spa_badge_count', 'SPA 请求数: {0}', String(node.data.spaRequestCount)));

  logger.log(_('tree_rendering_complete', '树形图渲染完成，节点数: {0}, 链接数: {1}'), String(nodes.length), String(nodes.length - 1));
}
