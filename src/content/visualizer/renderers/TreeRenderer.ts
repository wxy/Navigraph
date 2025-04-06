import { Logger } from '../../../lib/utils/logger.js';
import type { NavNode, NavLink } from '../../types/navigation.js';
import { BaseRenderer, RenderOptions } from './BaseRenderer.js';
import * as d3 from 'd3';

const logger = new Logger('TreeRenderer');

// 添加类成员变量，用于跟踪节点在左侧还是右侧
interface ExtendedNavNode extends NavNode {
  subtreeType?: 'left' | 'right' | 'center';
}

/**
 * 树形视图渲染器
 * 使用力导向布局渲染导航树
 */
export class TreeRenderer extends BaseRenderer {
  // 力模拟相关属性
  private simulation: d3.Simulation<d3.SimulationNodeDatum, undefined> | null = null;
  private nodeElements: d3.Selection<SVGCircleElement, any, SVGGElement, unknown> | null = null;
  private linkElements: d3.Selection<SVGLineElement, any, SVGGElement, unknown> | null = null;
  private labelElements: d3.Selection<SVGTextElement, any, SVGGElement, unknown> | null = null;
  
  /**
   * 渲染器特定初始化
   */
  protected initializeRenderer(): void {
    logger.log('初始化树形视图渲染器');
    
    // 创建力模拟
    this.simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3.forceCollide().radius(30))
      // 添加自定义力，用于左右平衡布局
      .force('balanced', this.createBalancedForce());
    
    // 初始停止模拟，只在需要时启动
    this.simulation.stop();
  }
  
  /**
   * 创建用于平衡布局的力函数
   */
  private createBalancedForce(): d3.Force<d3.SimulationNodeDatum, undefined> {
    // 创建自定义力函数用于平衡布局
    return (alpha: number) => {
      // 力强度，越大效果越明显
      const strength = 0.1 * alpha;
      
      return (d: any) => {
        // 获取节点位置
        const node = d as ExtendedNavNode;
        
        // 中心X坐标
        const centerX = this.width / 2;
        
        // 根据节点的subtreeType施加不同的力
        if (node.subtreeType === 'left') {
          // 左侧节点受到向左的力
          d.vx = d.vx || 0;
          d.vx -= (d.x - (centerX * 0.5)) * strength;
        } else if (node.subtreeType === 'right') {
          // 右侧节点受到向右的力
          d.vx = d.vx || 0;
          d.vx -= (d.x - (centerX * 1.5)) * strength;
        }
        
        // 对所有节点施加轻微垂直居中力
        d.vy = d.vy || 0;
        d.vy -= (d.y - (this.height / 2)) * 0.03 * alpha;
      };
    };
  }
  
  /**
   * 渲染树形视图
   */
  protected renderVisualization(
    nodes: NavNode[],
    edges: NavLink[],
    options: RenderOptions
  ): void {
    logger.log('渲染树形视图...');
    
    // 准备数据
    const nodeData = nodes.map(node => ({...node})) as ExtendedNavNode[]; // 创建副本
    
    // 检测并处理循环引用，使用安全的链接数据
    const safeLinks = this.detectAndBreakCycles(nodeData, edges);
    const linkData = safeLinks.map(edge => ({...edge})); // 创建副本
    
    // 创建平衡布局
    this.createBalancedLayout(nodeData);
    
    // 获取组元素
    const linksGroup = this.svg.select('.links');
    const nodesGroup = this.svg.select('.nodes');
    const labelsGroup = this.svg.select('.labels');
    
    // 清除现有内容
    this.clear();
    
    // 创建连线元素
    this.linkElements = linksGroup.selectAll('line')
      .data(linkData)
      .enter()
      .append('line')
      .attr('class', 'link')
      .attr('stroke', '#999999')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', (d) => d.value || 1);
    
    // 创建节点元素
    this.nodeElements = nodesGroup.selectAll('circle')
      .data(nodeData)
      .enter()
      .append('circle')
      .attr('class', d => {
        const node = d as ExtendedNavNode;
        return `node ${node.subtreeType || ''}`;
      })
      .attr('r', (d) => this.getNodeRadius(d))
      .attr('fill', (d) => this.getNodeColor(d))
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5)
      .on('click', (event, d) => this.handleNodeClick(d));
    
    // 添加节点拖拽行为
    this.nodeElements.call(this.dragBehavior());
    
    // 添加节点悬停提示
    this.nodeElements.append('title')
      .text(d => d.title || d.url || 'Unknown');
    
    // 创建标签元素
    this.labelElements = labelsGroup.selectAll('text')
      .data(nodeData.filter(d => !this.visualizer.isTrackingPage(d))) // 不显示跟踪页面的标签
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .attr('font-size', '9px')
      .attr('dy', '-10px')
      .text(d => this.getNodeLabel(d));
    
    // 配置力模拟
    if (this.simulation) {
      this.simulation
        .nodes(nodeData as d3.SimulationNodeDatum[])
        .on('tick', () => this.onSimulationTick());
      
      // 配置连接力
      const linkForce = this.simulation.force('link') as d3.ForceLink<d3.SimulationNodeDatum, d3.SimulationLinkDatum<d3.SimulationNodeDatum>>;
      if (linkForce) {
        linkForce.links(linkData as d3.SimulationLinkDatum<d3.SimulationNodeDatum>[]);
      }
      
      // 重启模拟
      this.simulation.alpha(1).restart();
    }
    
    logger.log('树形视图渲染完成');
  }
  
  /**
   * 力模拟计算更新时的回调
   * 更新节点和连线位置
   */
  private onSimulationTick(): void {
    if (this.linkElements) {
      this.linkElements
        .attr('x1', d => (d as any).source.x)
        .attr('y1', d => (d as any).source.y)
        .attr('x2', d => (d as any).target.x)
        .attr('y2', d => (d as any).target.y);
    }
    
    if (this.nodeElements) {
      this.nodeElements
        .attr('cx', d => (d as any).x)
        .attr('cy', d => (d as any).y);
    }
    
    if (this.labelElements) {
      this.labelElements
        .attr('x', d => (d as any).x)
        .attr('y', d => (d as any).y);
    }
  }
  
  /**
   * 创建节点拖拽行为
   */
  private dragBehavior(): d3.DragBehavior<SVGCircleElement, any, any> {
    return d3.drag<SVGCircleElement, any>()
      .on('start', (event, d) => {
        if (!event.active && this.simulation) {
          this.simulation.alphaTarget(0.3).restart();
        }
        (d as any).fx = (d as any).x;
        (d as any).fy = (d as any).y;
      })
      .on('drag', (event, d) => {
        (d as any).fx = event.x;
        (d as any).fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active && this.simulation) {
          this.simulation.alphaTarget(0);
        }
        (d as any).fx = null;
        (d as any).fy = null;
      });
  }
  
  /**
   * 获取节点标签
   */
  private getNodeLabel(node: NavNode): string {
    // 如果有标题，使用它
    if (node.title) {
      // 截断长标题
      return node.title.length > 20 
        ? node.title.substring(0, 18) + '...' 
        : node.title;
    }
    
    // 否则使用URL的一部分
    if (node.url) {
      try {
        const url = new URL(node.url);
        return url.hostname + url.pathname.substring(0, 10);
      } catch (e) {
        // URL解析失败时，使用原始URL的一部分
        return node.url.substring(0, 20);
      }
    }
    
    // 最后的选择
    return '无标题';
  }
  
  /**
   * 处理尺寸调整
   */
  protected onResize(width: number, height: number): void {
    // 更新力模拟中心力
    if (this.simulation) {
      const centerForce = this.simulation.force('center') as d3.ForceCenter<d3.SimulationNodeDatum>;
      if (centerForce) {
        centerForce.x(width / 2).y(height / 2);
      }
      
      const xForce = this.simulation.force('x') as d3.ForceX<d3.SimulationNodeDatum>;
      if (xForce) {
        xForce.x(width / 2);
      }
      
      const yForce = this.simulation.force('y') as d3.ForceY<d3.SimulationNodeDatum>;
      if (yForce) {
        yForce.y(height / 2);
      }
      
      // 重启模拟
      this.simulation.alpha(0.3).restart();
    }
  }

  /**
   * 检测并处理导航图中的循环
   * @param nodes 节点列表
   * @param links 连接列表
   * @returns 处理后不包含循环的连接列表
   */
  private detectAndBreakCycles(nodes: NavNode[], links: NavLink[]): NavLink[] {
    logger.log('检测并处理循环引用...');
    
    // 创建节点 ID 到节点的映射，提高查找效率
    const nodeMap = new Map<string, NavNode>();
    nodes.forEach(node => nodeMap.set(node.id, node));
    
    // 保存已访问节点路径的映射，用于检测循环
    const result: NavLink[] = [];
    const removedLinks: NavLink[] = [];
    
    // 对每个链接进行遍历，检查是否会导致循环
    links.forEach(link => {
      // 如果会导致循环，跳过这个链接；否则添加到结果中
      if (this.wouldFormCycle(link.source, link.target, nodeMap, new Set())) {
        logger.warn(`检测到循环: ${link.source} -> ${link.target}`);
        removedLinks.push(link);
      } else {
        result.push(link);
      }
    });
    
    if (removedLinks.length > 0) {
      logger.log(`移除了 ${removedLinks.length} 个导致循环的连接`);
    } else {
      logger.log('未检测到循环');
    }
    
    return result;
  }

  /**
   * 检查添加连接是否会导致循环
   * @param source 源节点ID
   * @param target 目标节点ID
   * @param nodeMap 节点映射
   * @param visited 已访问节点集合
   * @returns 是否会形成循环
   */
  private wouldFormCycle(
    source: string,
    target: string, 
    nodeMap: Map<string, NavNode>,
    visited: Set<string>
  ): boolean {
    // 如果目标节点就是源节点，则形成循环
    if (source === target) return true;
    
    // 如果这个节点已经访问过，形成循环
    if (visited.has(target)) return true;
    
    // 标记当前节点为已访问
    visited.add(target);
    
    // 获取目标节点的所有子节点
    const targetNode = nodeMap.get(target);
    if (!targetNode) return false;
    
    // 递归检查所有子节点
    for (const link of this.getOutgoingLinks(targetNode.id, nodeMap)) {
      if (this.wouldFormCycle(source, link.target, nodeMap, new Set([...visited]))) {
        return true;
      }
    }
    
    // 没有检测到循环
    return false;
  }

  /**
   * 获取从指定节点出发的所有连接
   * @param nodeId 节点ID
   * @param nodeMap 节点映射
   * @returns 该节点的所有出边
   */
  private getOutgoingLinks(nodeId: string, nodeMap: Map<string, NavNode>): NavLink[] {
    const result: NavLink[] = [];
    
    // 遍历所有节点，查找parentId等于当前节点ID的节点
    nodeMap.forEach(node => {
      if (node.parentId === nodeId) {
        result.push({
          source: nodeId,
          target: node.id
        });
      }
    });
    
    return result;
  }

  /**
   * 创建左右平衡布局
   * 将节点分为左右两组，创建更平衡的视觉分布
   * @param nodes 节点列表
   */
  private createBalancedLayout(nodes: NavNode[]): void {
    logger.log('创建左右平衡布局...');
    
    // 将正常节点转换为扩展节点
    const extendedNodes = nodes as ExtendedNavNode[];
    
    // 查找所有根节点（没有父节点的节点）
    const rootNodes = extendedNodes.filter(node => !node.parentId || !extendedNodes.some(n => n.id === node.parentId));
    
    if (rootNodes.length === 0) {
      logger.warn('没有找到根节点，无法创建平衡布局');
      return;
    }
    
    logger.log(`找到 ${rootNodes.length} 个根节点`);
    
    // 如果只有一个根节点，将其设为中心
    if (rootNodes.length === 1) {
      rootNodes[0].subtreeType = 'center';
      this.assignSubtreeTypes(rootNodes[0], extendedNodes, 'center');
      return;
    }
    
    // 将根节点分为左右两组
    // 根据时间戳或其他特性进行排序
    rootNodes.sort((a, b) => a.timestamp - b.timestamp);
    
    // 将前半部分放在左侧，后半部分放在右侧
    const midpoint = Math.floor(rootNodes.length / 2);
    const leftRootNodes = rootNodes.slice(0, midpoint);
    const rightRootNodes = rootNodes.slice(midpoint);
    
    // 标记左右子树节点
    leftRootNodes.forEach(root => {
      root.subtreeType = 'left';
      this.assignSubtreeTypes(root, extendedNodes, 'left');
    });
    
    rightRootNodes.forEach(root => {
      root.subtreeType = 'right';
      this.assignSubtreeTypes(root, extendedNodes, 'right');
    });
    
    logger.log(`左侧根节点: ${leftRootNodes.length}, 右侧根节点: ${rightRootNodes.length}`);
  }

  /**
   * 递归地为子树中的所有节点分配类型
   * @param node 当前节点
   * @param nodes 所有节点列表
   * @param type 要分配的类型
   */
  private assignSubtreeTypes(node: ExtendedNavNode, nodes: ExtendedNavNode[], type: 'left' | 'right' | 'center'): void {
    // 找到当前节点的所有子节点
    const children = nodes.filter(n => n.parentId === node.id);
    
    // 为每个子节点分配相同的类型
    children.forEach(child => {
      child.subtreeType = type;
      // 递归处理子节点的子节点
      this.assignSubtreeTypes(child, nodes, type);
    });
  }
}