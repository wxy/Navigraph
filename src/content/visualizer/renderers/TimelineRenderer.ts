import { Logger } from '../../../lib/utils/logger.js';
import type { NavNode, NavLink } from '../../types/navigation.js';
import { BaseRenderer, RenderOptions } from './BaseRenderer.js';
import * as d3 from 'd3';

const logger = new Logger('TimelineRenderer');

/**
 * 时间线视图渲染器
 * 根据时间顺序水平排列节点
 */
export class TimelineRenderer extends BaseRenderer {
  private timeScale: d3.ScaleTime<number, number> | null = null;
  private yScale: d3.ScalePoint<string> | null = null;
  private lanes: Map<string, number> = new Map(); // 用于存储节点分配的泳道
  
  /**
   * 渲染器特定初始化
   */
  protected initializeRenderer(): void {
    logger.log('初始化时间线视图渲染器');
    
    // 初始化时间刻度
    this.timeScale = d3.scaleTime()
      .range([50, this.width - 50]);
    
    // 初始化Y轴刻度（用于分配泳道）
    this.yScale = d3.scalePoint()
      .range([50, this.height - 50])
      .padding(0.5);
  }
  
  /**
   * 渲染时间线视图
   */
  protected renderVisualization(
    nodes: NavNode[],
    edges: NavLink[],
    options: RenderOptions
  ): void {
    logger.log('渲染时间线视图...');
    
    // 按时间戳排序节点
    const sortedNodes = [...nodes].sort((a, b) => a.timestamp - b.timestamp);
    
    // 计算时间范围，添加前后 5% 的边距
    const timeExtent = d3.extent(sortedNodes, d => d.timestamp) as [number, number];
    const timeRange = timeExtent[1] - timeExtent[0];
    const paddedStart = timeExtent[0] - (timeRange * 0.05);
    const paddedEnd = timeExtent[1] + (timeRange * 0.05);
    
    // 更新时间刻度
    this.timeScale?.domain([paddedStart, paddedEnd]);
    
    // 计算泳道
    this.calculateLanes(sortedNodes);
    
    // 获取组元素
    const linksGroup = this.svg.select('.links');
    const nodesGroup = this.svg.select('.nodes');
    const labelsGroup = this.svg.select('.labels');
    
    // 清除现有内容
    this.clear();
    
    // 添加时间轴
    this.renderTimeAxis();
    
    // 创建连线元素
    const linkElements = linksGroup.selectAll('path')
      .data(edges)
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('d', d => this.calculateLinkPath(d, sortedNodes))
      .attr('fill', 'none')
      .attr('stroke', '#999999')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => d.value || 1);
    
    // 创建节点元素
    const nodeElements = nodesGroup.selectAll('circle')
      .data(sortedNodes)
      .enter()
      .append('circle')
      .attr('class', 'node')
      .attr('cx', d => this.getNodeX(d))
      .attr('cy', d => this.getNodeY(d))
      .attr('r', d => this.getNodeRadius(d))
      .attr('fill', d => this.getNodeColor(d))
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5)
      .on('click', (event, d) => this.handleNodeClick(d));
    
    // 添加节点悬停提示
    nodeElements.append('title')
      .text(d => d.title || d.url || 'Unknown');
    
    // 创建标签元素
    const labelElements = labelsGroup.selectAll('text')
      .data(sortedNodes)
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .attr('x', d => this.getNodeX(d))
      .attr('y', d => this.getNodeY(d) - 10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .text(d => this.getNodeLabel(d));
    
    logger.log('时间线视图渲染完成');
  }
  
  /**
   * 渲染时间轴
   */
  private renderTimeAxis(): void {
    // 只有当时间刻度存在时才渲染
    if (!this.timeScale) return;
    
    // 创建时间轴
    const timeAxis: d3.Axis<Date | number> = d3.axisBottom(this.timeScale)
        .tickFormat((d: Date | number): string => {
            const date = new Date(d as number);
            return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
        })
        .ticks(7);
    
    // 添加轴
    this.svg.select('.zoom-layer')
      .append('g')
      .attr('class', 'time-axis')
      .attr('transform', `translate(0,${this.height - 30})`)
      .call(timeAxis);
  }
  
  /**
   * 计算节点的泳道分配
   * 目标是避免节点重叠
   */
  private calculateLanes(nodes: NavNode[]): void {
    this.lanes.clear();
    
    // 将节点按标签分组
    const tabGroups = new Map<string, NavNode[]>();
    nodes.forEach(node => {
      const tabId = node.tabId?.toString() || 'unknown';
      if (!tabGroups.has(tabId)) {
        tabGroups.set(tabId, []);
      }
      tabGroups.get(tabId)?.push(node);
    });
    
    // 获取标签ID排序后的列表
    const tabIds = Array.from(tabGroups.keys()).sort();
    
    // 设置Y轴刻度域
    this.yScale?.domain(tabIds);
    
    // 分配泳道
    tabIds.forEach((tabId, index) => {
      const tabNodes = tabGroups.get(tabId) || [];
      tabNodes.forEach(node => {
        this.lanes.set(node.id, index);
      });
    });
  }
  
  /**
   * 获取节点的X坐标（基于时间）
   */
  private getNodeX(node: NavNode): number {
    if (!this.timeScale) return 0;
    return this.timeScale(node.timestamp);
  }
  
  /**
   * 获取节点的Y坐标（基于泳道）
   */
  private getNodeY(node: NavNode): number {
    if (!this.yScale) return 0;
    
    // 获取节点所属的标签ID
    const tabId = node.tabId?.toString() || 'unknown';
    
    // 使用标签ID查找Y位置
    const y = this.yScale(tabId);
    return y !== undefined ? y : this.height / 2;
  }
  
  /**
   * 计算连接路径
   * 为连接创建平滑的贝塞尔曲线
   */
  private calculateLinkPath(link: NavLink, nodes: NavNode[]): string {
    // 查找源节点和目标节点
    const source = nodes.find(n => n.id === link.source);
    const target = nodes.find(n => n.id === link.target);
    
    if (!source || !target) {
      return '';
    }
    
    // 获取节点位置
    const x1 = this.getNodeX(source);
    const y1 = this.getNodeY(source);
    const x2 = this.getNodeX(target);
    const y2 = this.getNodeY(target);
    
    // 计算控制点
    const controlX = (x1 + x2) / 2;
    
    // 创建平滑的贝塞尔曲线路径
    return `M ${x1},${y1} C ${controlX},${y1} ${controlX},${y2} ${x2},${y2}`;
  }
  
  /**
   * 获取节点标签
   */
  private getNodeLabel(node: NavNode): string {
    // 对于时间线视图，使用简短标签
    if (node.title) {
      return node.title.length > 15 
        ? node.title.substring(0, 13) + '...' 
        : node.title;
    }
    
    if (node.url) {
      try {
        const url = new URL(node.url);
        return url.hostname;
      } catch (e) {
        return node.url.substring(0, 15);
      }
    }
    
    return '无标题';
  }
  
  /**
   * 处理尺寸调整
   */
  protected onResize(width: number, height: number): void {
    // 更新时间刻度范围
    this.timeScale?.range([50, width - 50]);
    
    // 更新Y轴刻度范围
    this.yScale?.range([50, height - 50]);
    
    // 重新渲染时间轴
    this.svg.select('.time-axis').remove();
    this.renderTimeAxis();
  }
}