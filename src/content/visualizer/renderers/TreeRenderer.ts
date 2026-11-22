import { Logger } from '../../../lib/utils/logger.js';
import { _ } from '../../../lib/utils/i18n.js';
import { UrlUtils } from '../../../lib/utils/url-utils.js';
import type { ExtendedNavNode, NavLink, NavNode, Visualizer } from '../../types/navigation.js';
import { animationDuration, labelsEnabled } from '../../utils/display-settings.js';
import { getViewState, saveViewState } from '../../utils/state-manager.js';
import { isTrackingPage } from '../../utils/visualization-utils.js';
import type { BaseRenderer } from './BaseRenderer.js';
import { layoutEllipticalTree } from './elliptical-tree-layout.js';
import type { EllipticalTreeLink, EllipticalTreeNode } from './elliptical-tree-layout.js';

const d3: typeof import('d3') = window.d3;
const logger = new Logger('TreeRenderer');
const SESSION_ROOT = 'session-root';
const VIEW_STATE = 'elliptical-tree';

interface FoldAnchor {
  id: string;
  x: number;
  y: number;
  transform: Pick<d3.ZoomTransform, 'x' | 'y' | 'k'>;
  focus: boolean;
}

export class TreeRenderer implements BaseRenderer {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private zoom?: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private width = 0;
  private height = 0;

  constructor(private visualizer: Visualizer, private expandedChains: Set<string>) {}

  initialize(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, _container: HTMLElement, width: number, height: number): void {
    this.svg = svg;
    this.width = width;
    this.height = height;
  }

  render(nodes: NavNode[], edges: NavLink[]): void {
    const svg = this.svg;
    if (!svg || !nodes.length) return;
    const { visualizer, width, height } = this;
    const currentSession = visualizer.currentSession;
    const sessionNode: ExtendedNavNode = {
      id: SESSION_ROOT,
      type: 'session',
      title: currentSession
        ? _('session_date', '会话日期: {0}', new Date(currentSession.startTime).toLocaleString())
        : _('current_session', '当前会话'),
      timestamp: currentSession?.startTime ?? 0,
    };
    const main = svg.select<SVGGElement>('.main-group');
    const rings = main.insert('g', ':first-child').attr('class', 'tree-levels').attr('aria-hidden', 'true');
    const links = main.select<SVGGElement>('.links-group');
    const pages = main.select<SVGGElement>('.nodes-group');
    const folds = main.append('g').attr('class', 'tree-chain-controls');
    let selectedNodeId: string | undefined;

    const tabId = visualizer.tabId || '';
    const layoutScope = `${currentSession?.id ?? ''}:${visualizer.pageInfo?.page ?? 0}:${width}x${height}`;
    const saved = getViewState(tabId, VIEW_STATE);
    const stored = saved?.layoutScope === layoutScope ? saved.transform : undefined;
    const restored = stored && Number.isFinite(stored.x) && Number.isFinite(stored.y) && Number.isFinite(stored.k) && stored.k > 0
      ? d3.zoomIdentity.translate(stored.x, stored.y).scale(stored.k)
      : undefined;
    const updateLabels = (scale: number) => {
      const display = scale >= 0.5 && labelsEnabled() ? null : 'none';
      pages.selectAll<SVGTextElement, EllipticalTreeNode>('.node-title-label')
        .style('display', () => display);
    };
    const zoom: d3.ZoomBehavior<SVGSVGElement, unknown> = d3.zoom();
    zoom.duration(animationDuration(250))
      .filter((event: MouseEvent) => {
        const onFold = (event.target as Element).closest('.tree-chain-toggle');
        return (!onFold || event.type === 'wheel') && (!event.ctrlKey || event.type === 'wheel') && !event.button;
      })
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        main.attr('transform', event.transform.toString());
        visualizer.currentTransform = event.transform;
        updateLabels(event.transform.k);
        visualizer.updateStatusBar();
      })
      .on('end', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (event.sourceEvent) saveViewState(tabId, { viewType: VIEW_STATE, layoutScope, transform: event.transform });
      });
    this.zoom = zoom;
    visualizer.zoom = zoom;
    svg.call(zoom).style('cursor', 'move');

    const updateSelection = (depth?: number) => {
      rings.selectAll<SVGEllipseElement, { depth: number }>('ellipse')
        .classed('selected-tree-level', ring => ring.depth === depth);
      pages.selectAll<SVGGElement, EllipticalTreeNode>('.node')
        .classed('highlighted', page => page.data.id === selectedNodeId);
    };

    const draw = (anchor?: FoldAnchor) => {
      const layout = layoutEllipticalTree(nodes, edges, sessionNode, this.expandedChains, width, height);
      rings.selectAll<SVGEllipseElement, typeof layout.rings[number]>('ellipse')
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

      drawNodes(pages, layout.nodes, currentSession?.startTime, visualizer, (node) => {
        selectedNodeId = node.data.id;
        visualizer.showNodeDetails?.(node.data);
        updateSelection(node.depth);
      });
      updateSelection(layout.nodes.find(node => node.data.id === selectedNodeId)?.depth);

      const foldedLinks = layout.links.filter(link => link.fold !== undefined);
      const controls = folds.selectAll<SVGForeignObjectElement, EllipticalTreeLink>('foreignObject')
        .data(foldedLinks, link => link.fold!.id)
        .join(enter => enter.append('foreignObject')
          .attr('width', 64)
          .attr('height', 36)
          .call(objects => objects.append('xhtml:button')
            .attr('type', 'button')
            .attr('class', 'tree-chain-toggle')))
        .attr('x', link => link.x - 32)
        .attr('y', link => link.y - 18);

      function actionText(link: EllipticalTreeLink): string {
        return link.fold!.expanded
          ? _('tree_chain_collapse', '收起 {0} 个中间页面', String(link.fold!.count))
          : _('tree_chain_expand', '展开 {0} 个中间页面', String(link.fold!.count));
      }

      const buttons = controls.select<HTMLButtonElement>('button')
        .attr('aria-expanded', link => String(link.fold!.expanded))
        .attr('title', actionText)
        .attr('aria-label', link => {
          const label = link.target.data.title || link.target.data.url;
          return `${link.fold!.expanded ? '−' : '+'}${link.fold!.count} ${actionText(link)}${label ? ` · ${label}` : ''}`;
        })
        .text(link => `${link.fold!.expanded ? '−' : '+'}${link.fold!.count}`)
        .on('click', (event: MouseEvent, link) => {
          const fold = link.fold!;
          const transform = d3.zoomTransform(svg.node()!);
          const focus = event.currentTarget === document.activeElement;
          if (fold.expanded) this.expandedChains.delete(fold.id);
          else this.expandedChains.add(fold.id);
          draw({ id: fold.id, x: link.x, y: link.y, transform, focus });
        });

      svg.selectAll<SVGTextElement, number>('text.cycle-message')
        .data(layout.brokenCycles ? [layout.brokenCycles] : [])
        .join('text')
        .attr('class', 'cycle-message')
        .attr('x', width - 22)
        .attr('y', 24)
        .attr('text-anchor', 'end')
        .text(count => _('fixed_cycle_connections', '已移除 {0} 个循环连接', String(count)));

      zoom.scaleExtent([Math.min(0.1, layout.fitScale), 8]);
      const scale = layout.fitScale;
      const initial = d3.zoomIdentity
        .translate(layout.centerX * (1 - scale), layout.centerY * (1 - scale))
        .scale(scale);
      const next = anchor && foldedLinks.find(link => link.fold!.id === anchor.id);
      if (anchor && next) {
        const { x, y, k } = anchor.transform;
        svg.call(zoom.transform, d3.zoomIdentity
          .translate(x + (anchor.x - next.x) * k, y + (anchor.y - next.y) * k).scale(k));
        if (anchor.focus) buttons.filter(link => link === next).node()?.focus({ preventScroll: true });
      } else {
        svg.call(zoom.transform, restored ?? initial);
      }
    };
    draw();
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
    .text(({ data }) => {
      const title = data.title || '';
      return title.length > 15 ? title.substring(0, 12) + '...' : title;
    });

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
