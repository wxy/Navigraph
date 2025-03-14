/**
 * 树形图视图渲染模块
 * 负责绘制层次化的导航树结构
 */

declare const d3: any;

// 为d3的层次结构添加特定接口，避免类型错误
interface HierarchyNode<T> {
  data: T;
  depth: number;
  height: number;
  parent: HierarchyNode<T> | null;
  children?: HierarchyNode<T>[];
  x: number;
  y: number;
}

// 添加链接接口，用于d3.links()返回值
interface HierarchyLink<T> {
  source: HierarchyNode<T>;
  target: HierarchyNode<T>;
}

import { NavNode, NavLink, Visualizer } from '../types/navigation.js';
import { 
  getNodeColor, 
  getEdgeColor, 
  isTrackingPage,
  getNodeClass,    
  getLinkType,     
  renderEmptyTreeMessage 
} from '../utils/visualization-utils.js';

/**
 * 渲染树形图布局
 */
export function renderTreeLayout(
  container: any, 
  treeSvg: any, 
  nodes: NavNode[], 
  links: NavLink[], 
  width: number, 
  height: number, 
  visualizer: Visualizer
): void {
  console.log('使用模块化树形图渲染器');
  
  try {
    // 清除现有内容
    treeSvg.selectAll("*").remove();
    
    if (!nodes || nodes.length === 0) {
      renderEmptyTreeMessage(treeSvg, width, height);
      return;
    }
    
    // 创建层次数据结构
    const hierarchyData = createHierarchy(nodes, links);
    
    // 记录调试信息
    console.log('层次结构创建成功:', {
      rootId: hierarchyData.data.id,
      childrenCount: hierarchyData.children ? hierarchyData.children.length : 0
    });
    
    // 设置树布局
    const treeLayout = d3.tree()
      .size([width - 100, height - 100])
      .nodeSize([50, 100]);
    
    // 应用布局
    const treeData = treeLayout(hierarchyData);
    
    // 绘制连接线
    const linkElements = treeSvg.append('g')
      .attr('class', 'links')
      .selectAll('path')
      .data(treeData.links())
      .enter()
      .append('path')
      .attr('class', (d: HierarchyLink<NavNode>) => `link ${getLinkType(d, links)}`)
      .attr('d', (d: HierarchyLink<NavNode>) => {
        return `M${d.source.x},${d.source.y}
                C${d.source.x},${(d.source.y + d.target.y) / 2}
                 ${d.target.x},${(d.source.y + d.target.y) / 2}
                 ${d.target.x},${d.target.y}`;
      })
      .attr('stroke', (d: HierarchyLink<NavNode>) => getEdgeColor(getLinkType(d, links)))
      .attr('fill', 'none')
      .attr('stroke-width', 1.5);
    
    // 绘制节点
    const nodeElements = treeSvg.append('g')
      .attr('class', 'nodes')
      .selectAll('.node')
      .data(treeData.descendants())
      .enter()
      .append('g')
      .attr('class', (d: HierarchyNode<NavNode>) => getNodeClass(d.data, visualizer))
      .attr('transform', (d: HierarchyNode<NavNode>) => `translate(${d.x},${d.y})`)
      .on('click', function(event: MouseEvent, d: HierarchyNode<NavNode>) {
          if (visualizer && typeof visualizer.showNodeDetails === 'function') {
            visualizer.showNodeDetails(d.data);
          }
        
        treeSvg.selectAll('.node')
          .classed('highlighted', false);
        
        d3.select(event.currentTarget as Element)
          .classed('highlighted', true);
      });
    
    // 添加节点圆形
    nodeElements.append('circle')
      .attr('r', 20)
      .attr('fill', (d: HierarchyNode<NavNode>) => getNodeColor(d.data.type));
    
    // 添加图标
    nodeElements.filter((d: HierarchyNode<NavNode>) => !!d.data.favicon)
      .append('image')
      .attr('xlink:href', (d: HierarchyNode<NavNode>) => d.data.favicon || '')
      .attr('x', -8)
      .attr('y', -8)
      .attr('width', 16)
      .attr('height', 16)
      .on('error', function(this: SVGImageElement) {
        d3.select(this)
          .attr('xlink:href', chrome.runtime.getURL('images/logo-48.png'))
          .classed('default-icon', true);
      });
    
    // 添加标题
    nodeElements.append('text')
      .attr('dy', 35)
      .attr('text-anchor', 'middle')
      .attr('fill', '#fff')
      .style('font-size', '12px')
      .text((d: HierarchyNode<NavNode>) => d.data.title ? 
            (d.data.title.length > 15 ? d.data.title.substring(0, 15) + '...' : d.data.title) : '');
    
    // 应用初始变换以居中视图
    const initialTransform = d3.zoomIdentity
      .translate(width / 2, 60)
      .scale(0.8);
    
    if (visualizer.svg && visualizer.zoom) {
      visualizer.svg.call(visualizer.zoom.transform, initialTransform);
    }
  } catch (err : any) {
    console.error('树形图渲染过程中出错:', err);
    
    // 添加错误信息显示
    treeSvg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'red')
      .text(`渲染错误: ${err.message}`);
      
    // 继续抛出错误以便上层处理
    throw err;
  }
}

/**
 * 创建层次结构数据
 */
function createHierarchy(nodes: NavNode[], links: NavLink[]): HierarchyNode<NavNode> {
  if (!nodes.length) {
    // 创建一个默认节点作为根
    const defaultNode: NavNode = {
      id: 'default',
      type: 'default',
      title: '无数据',
      url: '',
      timestamp: Date.now()
    };
    return d3.hierarchy(defaultNode);
  }
  
  // 找出根节点（无入边的节点）
  const childIds = new Set<string>();
  links.forEach(link => {
    const targetId = link.target;
    childIds.add(targetId);
  });
  
  const rootCandidates = nodes.filter(node => !childIds.has(node.id));
  
  // 使用第一个节点作为根，如果没有合适的根节点
  const root = rootCandidates.length > 0 ? rootCandidates[0] : nodes[0];
  
  // 构建节点映射，便于查找
  const nodeMap = new Map<string, NavNode>(nodes.map(node => [node.id, node]));
  
  // 关键修改：创建符合d3.hierarchy()预期的嵌套结构
  // 而不是手动设置hierarchyNode.children
  function createNestedStructure(node: NavNode): NavNode & { children?: NavNode[] } {
    const nodeWithChildren = { ...node };
    
    // 找出所有以当前节点为源的链接
    const childLinks = links.filter(link => {
      const sourceId = link.source;
      return sourceId === node.id;
    });
    
    if (childLinks.length > 0) {
      // 添加children属性
      nodeWithChildren.children = [];
      
      // 为每个子链接找到对应节点并递归创建嵌套结构
      childLinks.forEach(link => {
        const targetId = link.target;
        const childNode = nodeMap.get(targetId);
        
        if (childNode) {
          // 避免循环引用
          if (childNode.id !== node.id) {
            nodeWithChildren.children!.push(createNestedStructure(childNode));
          } else {
            console.warn(`检测到自循环引用: ${node.id} -> ${node.id}`);
          }
        }
      });
    }
    
    return nodeWithChildren;
  }
  
  // 从根节点开始创建嵌套结构
  const nestedRoot = createNestedStructure(root);
  
  // 使用d3.hierarchy处理嵌套结构
  return d3.hierarchy(nestedRoot);
}