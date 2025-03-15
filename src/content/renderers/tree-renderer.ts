/**
 * 树形图视图渲染模块
 * 负责绘制层次化的导航树结构
 */

const d3 = window.d3;

// 为d3的层次结构添加特定接口，避免类型错误
interface HierarchyNode<T> {
  data: T;
  depth: number;
  height: number;
  parent: HierarchyNode<T> | null;
  children?: HierarchyNode<T>[];
  x: number;
  y: number;
  descendants(): HierarchyNode<T>[];
  links(): { source: HierarchyNode<T>; target: HierarchyNode<T> }[];
}

// 添加链接接口，用于d3.links()返回值
interface HierarchyLink<T> {
  source: HierarchyNode<T>;
  target: HierarchyNode<T>;
}

// 扩展NavNode类型
interface ExtendedNavNode extends NavNode {
  children?: ExtendedNavNode[];
  isRoot?: boolean;
  isSelfLoop?: boolean;
  isClosed?: boolean;
  depth?: number;
  hasFilteredChildren?: boolean;
  filteredChildrenCount?: number;
}

// 添加D3特定的接口
interface D3TreeNode {
  x: number;
  y: number;
  data: ExtendedNavNode;
  children?: D3TreeNode[];
  parent?: D3TreeNode | null;
  depth: number;
}

interface D3TreeLink {
  source: D3TreeNode;
  target: D3TreeNode;
}

import { NavNode, NavLink, Visualizer } from '../types/navigation.js';
import { 
  getNodeColor, 
  getEdgeColor, 
  isTrackingPage,    
  renderEmptyTreeMessage 
} from '../utils/visualization-utils.js';

// 导入状态管理功能
import { 
  setupZoomHandling, 
  updateStatusBar
} from '../utils/state-manager.js';

// 声明要使用的d3函数类型
type D3LinkHorizontal = (data: { source: any; target: any }) => string;

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
    
    // 创建虚拟的会话根节点 - 从原始代码中移植
    const sessionNode: ExtendedNavNode = {
      id: 'session-root',
      type: 'session',
      title: visualizer.currentSession ? 
        `会话 ${new Date(visualizer.currentSession.startTime).toLocaleString()}` : 
        '当前会话',
      timestamp: Date.now(),
      url: '',
      depth: 0
    };
    
    // 构建节点映射表，便于快速查找
    const nodeById: Record<string, ExtendedNavNode> = {};
    nodes.forEach(node => {
      const extNode = node as ExtendedNavNode;
      nodeById[node.id] = extNode;
      extNode.children = [];
      extNode.depth = 0;
    });
    
    // 识别自循环节点
    const selfLoopNodes: ExtendedNavNode[] = [];
    nodes.forEach(node => {
      const extNode = nodeById[node.id];
      if (node.parentId === node.id) {
        console.log(`检测到节点 ${node.id} 自循环，标记为刷新节点`);
        extNode.isSelfLoop = true;
        selfLoopNodes.push(extNode);
      }
    });
    
    // 构建树结构
    const rootNodes: ExtendedNavNode[] = [];
    nodes.forEach(node => {
      const extNode = nodeById[node.id];
      // 判断是否为根节点或父节点不存在
      if (node.parentId === null || !nodeById[node.parentId]) {
        // 明确作为根节点处理
        extNode.isRoot = true;
        rootNodes.push(extNode);
      } 
      // 正常父子关系处理
      else if (nodeById[node.parentId]) {
        // 获取父节点引用
        const parentNode = nodeById[node.parentId];
        // 添加到父节点的子节点列表
        if (!parentNode.children) {
          parentNode.children = [];
        }
        parentNode.children.push(extNode);
      }
    });
    
    console.log(`找到${rootNodes.length}个根节点，${selfLoopNodes.length}个自循环节点`);
    
    // 计算层级
    function assignLevels(node: ExtendedNavNode, level: number): void {
      node.depth = level;
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(child => assignLevels(child, level + 1));
      }
    }
    
    if (rootNodes.length > 0) {
      rootNodes.forEach(root => assignLevels(root, 1));
    } else {
      console.warn('没有找到根节点，可能导致树形视图不完整');
      // 创建一个虚拟根节点连接所有孤立节点
      nodes.forEach(node => {
        if (!node.parentId) {
          node.parentId = 'session-root';
        }
      });
    }
    
    // 将虚拟根节点添加到节点列表
    const allNodes = [sessionNode, ...nodes] as ExtendedNavNode[];
    
    // 创建连接会话节点到根节点的链接
    const sessionLinks = rootNodes.length > 0 ? 
      rootNodes.map(root => ({
        id: `session-${root.id}`,
        source: sessionNode.id,
        target: root.id,
        type: 'session_link'
      } as NavLink)) : 
      // 如果没有根节点，创建连接到所有节点的链接
      nodes.map(node => ({
        id: `session-${node.id}`,
        source: sessionNode.id,
        target: node.id,
        type: 'session_link'
      } as NavLink));
    
    // 合并所有链接
    const allLinks = [...sessionLinks, ...links];
    
    // 声明接收d3.stratify结果的变量类型
    let hierarchy: any;
    let treeData: any;
    let descendants: any[];
    
    try {
      // 创建层次化树形布局
      const treeLayout = d3.tree()
        .nodeSize([30, 140])
        .separation((a: any, b: any) => {
          // 更细致的间距控制
          const depthFactor = Math.min(1.3, (a.depth + b.depth) * 0.08 + 1);
          return (a.parent === b.parent ? 3 : 4.5) * depthFactor;
        });
      
      // 创建层次结构
      hierarchy = d3.stratify()
        .id((d: any) => d.id)
        .parentId((d: any) => {
          // 如果是会话根节点，则没有父节点
          if (d.id === 'session-root') return null;
          
          // 如果有父ID并且父节点存在，使用此父ID
          if (d.parentId && nodeById[d.parentId]) {
            return d.parentId;
          }
          
          // 默认情况：连接到会话根节点
          return 'session-root';
        })
        (allNodes);
      
      // 应用布局
      treeData = treeLayout(hierarchy);
      
      // 获取所有节点
      descendants = treeData.descendants();
      
    } catch (err) {
      console.error('树布局计算失败:', err);
      throw new Error(`树布局计算失败: ${err}`);
    }
    
    // 立即计算树的边界
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    descendants.forEach((d: any) => {
      minX = Math.min(minX, d.y);
      maxX = Math.max(maxX, d.y);
      minY = Math.min(minY, d.x);
      maxY = Math.max(maxY, d.x);
    });
    
    // 固定水平偏移量，确保根节点在左侧而不是居中
    const leftMargin = width * 0.2; // 左侧预留20%的空间
    const xOffset = leftMargin;
    
    // 垂直方向居中
    const contentHeight = maxY - minY;
    const yOffset = (height - contentHeight) / 2 - minY + 50; // 增加50像素的顶部间距
    
    // 计算合适的缩放因子
    const contentWidth = maxX - minX;
    // 限制最大缩放，确保保持节点间距
    const scaleFactor = Math.min(
      (width - leftMargin - 100) / Math.max(contentWidth, 1), // 增加边距
      (height - 120) / Math.max(contentHeight, 1), 
      0.9 // 更低的最大缩放限制，保证更多空间
    );
    
    // 创建箭头标记
    treeSvg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#999');
    
    // 创建连接线分组 - 应用初始变换
    const linkGroup = treeSvg.append('g')
      .attr('class', 'links')
      .attr('transform', `translate(${xOffset}, ${yOffset})`);
    
    // 节点分组 - 应用初始变换
    const nodeGroup = treeSvg.append('g')
      .attr('class', 'nodes')
      .attr('transform', `translate(${xOffset}, ${yOffset})`);
    
    // 绘制连接线 - 使用曲线路径
    linkGroup.selectAll('path')
      .data(treeData.links())
      .join('path')
      .attr('class', (d: any) => `link ${d.target.data.type || ''}`)
      .attr('d', (d: any) => {
        // 创建平滑曲线，从源节点到目标节点
        const linkHorizontal = d3.linkHorizontal()
          .x((node: any) => node.y)
          .y((node: any) => node.x);
          
        return linkHorizontal({
          source: d.source,
          target: d.target
        });
      })
      .attr('stroke', (d: any) => d.target.data.type === 'session' ? 
        '#555' : getEdgeColor(d.target.data.type || ''))
      .attr('stroke-width', 1.5)
      .attr('fill', 'none')
      .attr('marker-end', 'url(#arrow)');
    
    // 绘制节点
    const node = nodeGroup.selectAll('.node')
      .data(descendants)
      .join('g')
      .attr('class', (d: any) => {
        // 合并多个类名
        let classes = `node ${d.data.type || ''}`;
        
        // 添加关闭状态
        if (d.data.isClosed) {
          classes += ' closed';
        }
        
        // 添加根节点标记
        if (d.data.isRoot) {
          classes += ' root';
        }
        
        // 添加跟踪页面标记
        if (typeof isTrackingPage === 'function' && isTrackingPage(d.data, visualizer)) {
          classes += ' tracking';
        }
        
        return classes;
      })
      .attr('transform', (d: any) => `translate(${d.y},${d.x})`);
    
    // 会话节点特殊处理
    node.filter((d: any) => d.data.id === 'session-root')
      .append('rect')
      .attr('width', 120)
      .attr('height', 40)
      .attr('x', -60)
      .attr('y', -20)
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('fill', '#444')
      .attr('stroke', '#222');
    
    // 普通节点
    node.filter((d: any) => d.data.id !== 'session-root')
      .append('circle')
      .attr('r', 20)
      .attr('fill', (d: any) => getNodeColor(d.data.type || ''))
      .attr('stroke', '#333')
      .attr('stroke-width', 1.5);
    
    // 添加图标
    node.filter((d: any) => d.data.id !== 'session-root' && d.data.favicon)
      .append('image')
      .attr('xlink:href', (d: any) => d.data.favicon || chrome.runtime.getURL('images/logo-48.png'))
      .attr('x', -8)
      .attr('y', -8)
      .attr('width', 16)
      .attr('height', 16)
      .attr('class', (d: any) => d.data.favicon ? '' : 'default-icon')
      .on('error', function(this: SVGImageElement) {
        // 图像加载失败时替换为默认图标
        d3.select(this)
          .attr('xlink:href', chrome.runtime.getURL('images/logo-48.png'))
          .classed('default-icon', true);
      });
    
    // 添加节点标题
    node.append('title')
      .text((d: any) => d.data.title || d.data.url || '未命名节点');
    
    // 为会话节点添加文字标签
    node.filter((d: any) => d.data.id === 'session-root')
      .append('text')
      .attr('dy', '.35em')
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .text((d: any) => {
        if (visualizer.currentSession) {
          const date = new Date(visualizer.currentSession.startTime);
          return date.toLocaleDateString();
        }
        return '当前会话';
      });
    
    // 为普通节点添加简短标签
    node.filter((d: any) => d.data.id !== 'session-root')
      .append('text')
      .attr('dy', 35)
      .attr('text-anchor', 'middle')
      .attr('fill', '#333')
      .style('font-size', '12px')
      .text((d: any) => {
        if (!d.data.title) return '';
        return d.data.title.length > 15 ? d.data.title.substring(0, 12) + '...' : d.data.title;
      });
    
    // 为有被过滤子节点的节点添加标记
    node.filter((d: any) => d.data.hasFilteredChildren)
      .append('circle')
      .attr('r', 6)
      .attr('cx', 18)
      .attr('cy', -18)
      .attr('fill', '#ff5722')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .attr('class', 'filtered-indicator')
      .append('title')
      .text((d: any) => `包含${d.data.filteredChildrenCount || 0}个被过滤的子节点`);
    
    // 添加交互
    node.on('click', function(event: MouseEvent, d: any) {
      if (d.data.id === 'session-root') return;
      
      // 显示节点详情
      if (visualizer && typeof visualizer.showNodeDetails === 'function') {
        visualizer.showNodeDetails(d.data);
      }
      
      // 高亮节点
      treeSvg.selectAll('.node')
        .classed('highlighted', false);
      
      d3.select(event.currentTarget as Element)
        .classed('highlighted', true);
    });
    
    // 应用初始变换以居中视图
    const initialTransform = d3.zoomIdentity
      .translate(width / 2, 60)
      .scale(0.8);
    
    if (visualizer.svg && visualizer.zoom) {
      visualizer.svg.call(visualizer.zoom.transform, initialTransform);
    }
    
    // 设置缩放和状态管理
    if (!visualizer.zoom) {
      setupZoomHandling(visualizer, treeSvg, container, width, height);
    }

    // 更新状态栏
    updateStatusBar(visualizer);

  } catch (err) {
    console.error('树形图渲染过程中出错:', err);
    
    // 添加错误信息显示
    treeSvg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'red')
      .text(`渲染错误: ${err instanceof Error ? err.message : '未知错误'}`);
      
    // 继续抛出错误以便上层处理
    throw err;
  }
}