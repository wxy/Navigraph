import { Logger } from '../../../lib/utils/logger.js';
import type { Visualizer, NavNode, NavLink } from '../../types/navigation.js';
import * as d3 from 'd3';

const logger = new Logger('BaseRenderer');

/**
 * 渲染选项接口
 */
export interface RenderOptions {
  restoreTransform?: boolean; // 是否恢复之前的变换
  animate?: boolean;          // 是否使用动画
  duration?: number;          // 动画持续时间（毫秒）
}

/**
 * 渲染器抽象基类
 * 定义所有渲染器共有的方法和属性
 */
export abstract class BaseRenderer {
  protected visualizer: Visualizer;
  protected svg!: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>;
  protected container!: HTMLElement;
  protected width: number = 0;
  protected height: number = 0;
  protected zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }
  
  /**
   * 初始化渲染器
   * @param svg SVG元素
   * @param container 容器元素
   * @param width 宽度
   * @param height 高度
   */
  public initialize(
    svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>,
    container: HTMLElement,
    width: number,
    height: number
  ): void {
    logger.log('初始化渲染器...');
    
    this.svg = svg;
    this.container = container;
    this.width = width;
    this.height = height;
    
    // 初始化SVG基本结构
    this.initializeSvgStructure();
    
    // 初始化缩放行为
    this.initializeZoom();
    
    // 子类特定初始化
    this.initializeRenderer();
    
    logger.log('渲染器初始化完成');
  }
  
  /**
   * 初始化SVG基本结构
   * 创建必要的图层和分组
   */
  protected initializeSvgStructure(): void {
    // 清除已有内容
    this.svg.selectAll('*').remove();
    
    // 创建主要分组
    this.svg.append('g')
      .attr('class', 'zoom-layer');
    
    // 在缩放层内创建绘图层
    const zoomLayer = this.svg.select('.zoom-layer');
    
    // 添加连线组
    zoomLayer.append('g')
      .attr('class', 'links');
    
    // 添加节点组
    zoomLayer.append('g')
      .attr('class', 'nodes');
    
    // 添加标签组（在节点之上）
    zoomLayer.append('g')
      .attr('class', 'labels');
    
    logger.log('SVG结构初始化完成');
  }
  
  /**
   * 初始化缩放行为
   */
  protected initializeZoom(): void {
    // 创建缩放行为
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 4]) // 设置缩放范围
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        // 更新缩放层
        this.svg.select('.zoom-layer')
          .attr('transform', event.transform.toString());
        
        // 记住当前变换
        if (this.visualizer.currentTransform) {
          this.visualizer.currentTransform.x = event.transform.x;
          this.visualizer.currentTransform.y = event.transform.y;
          this.visualizer.currentTransform.k = event.transform.k;
        } else {
          this.visualizer.currentTransform = {
            x: event.transform.x,
            y: event.transform.y,
            k: event.transform.k
          };
        }
      });
    
    // 应用缩放行为到SVG
    if (this.zoom) {
      this.svg.call(this.zoom);
    }
    
    logger.log('缩放行为初始化完成');
  }
  
  /**
   * 渲染可视化图
   * @param nodes 节点列表
   * @param edges 连接列表
   * @param options 渲染选项
   */
  public render(
    nodes: NavNode[],
    edges: NavLink[],
    options: RenderOptions = {}
  ): void {
    logger.log(`开始渲染，节点数:${nodes.length}, 连接数:${edges.length}`);
    
    // 检查数据是否为空
    if (nodes.length === 0) {
      logger.warn('没有节点数据可渲染');
      return;
    }
    
    // 保存数据副本，避免修改原始数据
    const renderNodes = [...nodes];
    const renderEdges = [...edges];
    
    // 尝试恢复之前的变换
    if (options.restoreTransform && this.zoom && this.visualizer.currentTransform) {
      const { x, y, k } = this.visualizer.currentTransform;
      
      // 创建变换对象
      const transform = d3.zoomIdentity
        .translate(x, y)
        .scale(k);
      
      // 应用变换
      this.svg.call(this.zoom.transform, transform);
    }
    
    // 调用子类的渲染实现
    this.renderVisualization(renderNodes, renderEdges, options);
    
    logger.log('渲染完成');
  }
  
  /**
   * 调整渲染器尺寸
   * @param width 新宽度
   * @param height 新高度
   */
  public resize(width: number, height: number): void {
    logger.log(`调整渲染器尺寸: ${width}x${height}`);
    
    this.width = width;
    this.height = height;
    
    // 更新SVG尺寸
    this.svg
      .attr('width', width)
      .attr('height', height);
    
    // 调用子类的尺寸调整实现
    this.onResize(width, height);
  }
  
  /**
   * 清除所有渲染内容
   */
  public clear(): void {
    logger.log('清除渲染内容');
    
    // 移除所有图形元素
    if (this.svg) {
      this.svg.selectAll('.nodes > *').remove();
      this.svg.selectAll('.links > *').remove();
      this.svg.selectAll('.labels > *').remove();
    }
  }
  
  /**
   * 重置缩放状态
   */
  public resetZoom(): void {
    if (this.svg && this.zoom) {
      this.svg.transition()
        .duration(750)
        .call(this.zoom.transform, d3.zoomIdentity);
      
      // 清除保存的变换
      if (this.visualizer.currentTransform) {
        this.visualizer.currentTransform.x = 0;
        this.visualizer.currentTransform.y = 0;
        this.visualizer.currentTransform.k = 1;
      }
    }
  }
  
  /**
   * 获取节点颜色
   * 根据节点类型和状态返回不同颜色
   */
  protected getNodeColor(node: NavNode): string {
    // 如果节点已关闭，使用灰色
    if (node.isClosed) {
      return '#bbbbbb';
    }
    
    // 根据节点类型着色
    switch (node.type) {
      case 'link_click':
        return '#4285F4'; // 蓝色
      case 'address_bar':
        return '#34A853'; // 绿色
      case 'form_submit':
        return '#FBBC05'; // 黄色
      case 'reload':
        return '#9334E6'; // 紫色
      case 'history_back':
      case 'history_forward':
        return '#FA7B17'; // 橙色
      case 'javascript':
        return '#EA4335'; // 红色
      case 'redirect':
        return '#00BCD4'; // 青色
      default:
        return '#90A4AE'; // 默认灰蓝色
    }
  }
  
  /**
   * 获取节点半径
   * 可以根据节点重要性或其他属性调整大小
   */
  protected getNodeRadius(node: NavNode): number {
    // 根据是否为跟踪页面调整大小
    if (this.visualizer.isTrackingPage(node)) {
      return 5; // 跟踪页面较小
    }
    
    // 根据节点类型调整大小
    switch (node.type) {
      case 'link_click':
      case 'address_bar':
        return 8; // 主要导航略大
      case 'reload':
        return 6; // 刷新稍小
      default:
        return 7; // 默认大小
    }
  }
  
  /**
   * 处理节点点击事件
   * @param node 被点击的节点
   */
  public handleNodeClick(node: NavNode): void {
    logger.log(`节点点击: ${node.id}`);
    this.visualizer.showNodeDetails(node);
  }
  
  /**
   * 子类特定初始化
   * 由子类实现，用于设置特定的渲染参数和结构
   */
  protected abstract initializeRenderer(): void;
  
  /**
   * 渲染可视化图的具体实现
   * 由子类实现，包含特定的渲染逻辑
   */
  protected abstract renderVisualization(
    nodes: NavNode[],
    edges: NavLink[],
    options: RenderOptions
  ): void;
  
  /**
   * 子类尺寸调整实现
   * 由子类实现，处理特定的尺寸调整逻辑
   */
  protected abstract onResize(width: number, height: number): void;
}