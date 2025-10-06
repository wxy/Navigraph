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
    
    // 添加背景
    mainGroup.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', '#f8f9fa')
      .attr('class', 'waterfall-background');
    
    // Phase 1: 基础实现 - 占位符内容
    const placeholderGroup = mainGroup.append('g').attr('class', 'waterfall-placeholder-group');
    
    // 主标题
    placeholderGroup.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2 - 40)
      .attr('text-anchor', 'middle')
      .attr('class', 'waterfall-title')
      .style('font-size', '24px')
      .style('font-weight', 'bold')
      .style('fill', '#2c3e50')
      .text(_('waterfall_view_title', '🌊 瀑布视图'));
    
    // 副标题
    placeholderGroup.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('class', 'waterfall-subtitle')
      .style('font-size', '16px')
      .style('fill', '#7f8c8d')
      .text(_('waterfall_view_description', '从右到左的时间流瀑布式导航视图'));
    
    // 数据信息
    placeholderGroup.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2 + 30)
      .attr('text-anchor', 'middle')
      .attr('class', 'waterfall-data-info')
      .style('font-size', '14px')
      .style('fill', '#95a5a6')
      .text(_('waterfall_view_data_info', '当前数据：{0} 个节点，{1} 条连接'), nodes.length, edges.length);
    
    // Beta 标识
    placeholderGroup.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2 + 60)
      .attr('text-anchor', 'middle')
      .attr('class', 'waterfall-beta')
      .style('font-size', '12px')
      .style('fill', '#e74c3c')
      .style('font-style', 'italic')
      .text(_('waterfall_view_beta', 'Beta 版本 - 功能开发中'));
    
    // 添加一些装饰性元素
    const decorGroup = placeholderGroup.append('g').attr('class', 'waterfall-decoration');
    
    // 简单的时间轴示意
    const timelineY = height / 2 + 120;
    const timelineStartX = width * 0.2;
    const timelineEndX = width * 0.8;
    
    // 时间轴线
    decorGroup.append('line')
      .attr('x1', timelineStartX)
      .attr('y1', timelineY)
      .attr('x2', timelineEndX)
      .attr('y2', timelineY)
      .style('stroke', '#bdc3c7')
      .style('stroke-width', 2);
    
    // 时间轴箭头
    decorGroup.append('polygon')
      .attr('points', `${timelineStartX-10},${timelineY-5} ${timelineStartX-10},${timelineY+5} ${timelineStartX-20},${timelineY}`)
      .style('fill', '#bdc3c7');
    
    // 时间轴标签
    decorGroup.append('text')
      .attr('x', timelineStartX - 30)
      .attr('y', timelineY - 15)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('fill', '#7f8c8d')
      .text(_('waterfall_timeline_now', '现在'));
    
    decorGroup.append('text')
      .attr('x', timelineEndX)
      .attr('y', timelineY - 15)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('fill', '#7f8c8d')
      .text(_('waterfall_timeline_past', '过去'));
    
    // 示意节点
    const sampleNodes = [
      { x: timelineStartX + 20, y: timelineY - 30, label: _('waterfall_sample_tab1', '标签页1') },
      { x: timelineStartX + 20, y: timelineY + 30, label: _('waterfall_sample_tab2', '标签页2') },
      { x: timelineStartX + 120, y: timelineY - 15, label: _('waterfall_sample_tab3', '标签页3') }
    ];
    
    sampleNodes.forEach(node => {
      decorGroup.append('circle')
        .attr('cx', node.x)
        .attr('cy', node.y)
        .attr('r', 8)
        .style('fill', '#3498db')
        .style('stroke', '#2980b9')
        .style('stroke-width', 2);
      
      decorGroup.append('text')
        .attr('x', node.x + 15)
        .attr('y', node.y + 4)
        .style('font-size', '10px')
        .style('fill', '#7f8c8d')
        .text(node.label);
    });
    
    logger.log(_('waterfall_layout_complete', '瀑布布局渲染完成'));
  } catch (error) {
    logger.error(_('waterfall_layout_error', '瀑布布局渲染失败: {0}'), error);
    throw new _Error('waterfall_layout_render_failed', '瀑布布局渲染失败', error);
  }
}