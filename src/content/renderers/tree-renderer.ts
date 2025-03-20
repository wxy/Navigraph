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
  saveViewState, 
  updateStatusBar
} from '../utils/state-manager.js';

// 声明要使用的d3函数类型
type D3LinkHorizontal = (data: { source: any; target: any }) => string;

/**
 * 渲染树形图布局
 */
export function renderTreeLayout(
  container: HTMLElement, 
  svg: any, 
  nodes: any[], 
  links: any[], 
  width: number, 
  height: number, 
  visualizer: any
): void {
  console.log('使用模块化树形图渲染器');

  try {
    // 1. 确保基本DOM结构存在
    if (!svg.select('.main-group').node()) {
      console.log('创建主视图组');
      svg.append('g').attr('class', 'main-group');
    }
    
    // 获取主视图组引用
    const mainGroup = svg.select('.main-group');
    
    // 确保子组存在
    if (!mainGroup.select('.links-group').node()) {
      mainGroup.append('g').attr('class', 'links-group');
    }
    
    if (!mainGroup.select('.nodes-group').node()) {
      mainGroup.append('g').attr('class', 'nodes-group');
    }
    
    // 2. 首先配置和应用缩放行为
    // 始终创建新的缩放行为，确保每次渲染后缩放都能正常工作
    try {
      console.log('为树形图视图设置缩放行为');
      
      // 先清除旧的缩放事件
      svg.on('.zoom', null);
      
      // 获取DOM引用
      const mainGroup = svg.select('.main-group');
      const nodesGroup = mainGroup.select('.nodes-group');
      
      // 创建缩放处理函数，使用当前获取的DOM引用
      const zoomHandler = function(event: d3.ZoomEvent) {
        mainGroup.attr('transform', event.transform);
        
        // 缩放级别较低时隐藏文本
        if (event.transform.k < 0.5) {
          nodesGroup.selectAll('text').style('display', 'none');
        } else {
          nodesGroup.selectAll('text').style('display', null);
        }
      };
      
      // 创建新的缩放行为
      const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on('zoom', zoomHandler);
      
      // 保存并应用缩放行为
      visualizer.zoom = zoom;
      svg.call(zoom)
        .style('cursor', 'move'); // 添加鼠标指针样式，表明可拖动;
      
      console.log('已设置树形图缩放行为');
    } catch (error) {
      console.error('设置树形图缩放失败:', error);
    }
    
    // 3. 然后清除现有节点和链接，但保留基本结构
    mainGroup.select('.links-group').selectAll('*').remove();
    mainGroup.select('.nodes-group').selectAll('*').remove();
    
    // 4. 检查是否有数据可渲染
    if (!nodes || nodes.length === 0) {
      renderEmptyTreeMessage(svg, width, height);
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

    // 在调用d3.stratify之前应用循环检测及修复
    // 对所有链接进行预处理，确保格式一致
    const normalizedLinks = allLinks.map(link => ({
      id: link.id,
      source: typeof link.source === 'object' ? link.source.id : link.source,
      target: typeof link.target === 'object' ? link.target.id : link.target,
      type: link.type
    }));

    // 检测并移除导致循环的链接
    const safeLinks = detectAndBreakCycles(allNodes, normalizedLinks);

    // 如果移除了链接，显示警告
    if (safeLinks.length < normalizedLinks.length) {
      const removedCount = normalizedLinks.length - safeLinks.length;
      console.warn(`已移除 ${removedCount} 条导致循环的连接以确保树形图可以正常渲染`);
      
      // 添加视觉警告提示
      svg.append('text')
        .attr('x', width - 200)
        .attr('y', 20)
        .attr('text-anchor', 'end')
        .attr('fill', '#ff5722')
        .style('font-size', '12px')
        .text(`⚠️ 已修复 ${removedCount} 个循环连接`);
    }

    // 使用安全链接替换原来的链接列表
    const safeAllLinks = safeLinks.map(link => ({
      id: link.id,
      source: link.source,
      target: link.target,
      type: link.type
    }));

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
            // 检查此父子关系是否在安全链接列表中
            const parentLinkExists = safeLinks.some(link => 
              link.source === d.parentId && link.target === d.id);
              
            if (parentLinkExists) {
              return d.parentId;
            }
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
      
      // 更简洁的错误处理
      let errorMessage = '树布局计算失败';
      const errMsg = err instanceof Error ? err.message : String(err);
      
      // 检查是否包含循环依赖错误
      if (errMsg.includes('cycle')) {
        errorMessage = '数据中存在无法自动修复的循环依赖';
        
        // 尝试渲染可视化的错误信息，帮助用户理解
        svg.append('text')
          .attr('x', width / 2)
          .attr('y', height / 2 - 40)
          .attr('text-anchor', 'middle')
          .attr('fill', 'red')
          .style('font-size', '16px')
          .text('无法渲染树形视图：检测到循环依赖');
          
        svg.append('text')
          .attr('x', width / 2)
          .attr('y', height / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', '#333')
          .style('font-size', '14px')
          .text('请尝试使用时间线视图或筛选节点以解决问题');
          
        // 如果visualizer可用，建议切换视图
        if (visualizer && typeof visualizer.switchToTimelineView === 'function') {
          svg.append('text')
            .attr('x', width / 2)
            .attr('y', height / 2 + 30)
            .attr('text-anchor', 'middle')
            .attr('fill', '#0066cc')
            .style('font-size', '14px')
            .style('text-decoration', 'underline')
            .style('cursor', 'pointer')
            .text('点击此处切换到时间线视图')
            .on('click', () => {
              visualizer.switchToTimelineView();
            });
        }
      } else {
        errorMessage = String(err);
      }
      
      throw new Error(errorMessage);
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

    // 计算树的边界框和尺寸
    const treeWidth = maxX - minX;
    const treeHeight = (maxY - minY) <= 0 ? 60 : (maxY - minY);

    // 1. 调整水平方向，保持左侧对齐但留出足够边距
    const leftMargin = 100; // 增加会话节点左侧边距
    const xOffset = leftMargin - minX;

    // 2. 调整垂直居中计算，确保垂直居中
    const topMargin = 40; // 顶部保留的固定空间
    const yOffset = (height - treeHeight) / 2 - minY;

    // 打印布局信息
    console.log('树布局信息(修正的垂直居中):', {
        viewport: { width, height },
        tree: { 
          width: treeWidth, 
          height: treeHeight, 
          bounds: { minX, maxX, minY, maxY }
        },
        margins: { leftMargin, topMargin },
        offset: { x: xOffset, y: yOffset }
      });

    // 创建箭头标记
    svg.append('defs').append('marker')
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
    
    // 获取节点和链接分组
    const linksGroup = svg.select('.main-group .links-group');
    const nodesGroup = svg.select('.main-group .nodes-group');
    
    // 绘制连接线 - 使用曲线路径
    linksGroup.selectAll('path')
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
    const node = nodesGroup.selectAll('.node')
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
      svg.selectAll('.node')
        .classed('highlighted', false);
      
      d3.select(event.currentTarget as Element)
        .classed('highlighted', true);
    });

    // 应用初始变换以适应视图
    const scaleFactor = Math.min(
      (width - 200) / Math.max(treeWidth, 1), // 增加水平边距
      (height - 200) / Math.max(treeHeight, 1), // 增加垂直边距
      1.0 // 限制最大缩放
    );

    // 使用更保守的缩放值
    const finalScaleFactor = Math.max(0.65, Math.min(0.85, scaleFactor));

    // 创建初始变换
    const initialTransform = d3.zoomIdentity
      .translate(xOffset, yOffset)
      .scale(finalScaleFactor);
      
    // 5. 确保在所有渲染完成后才应用变换
    if (visualizer.zoom) {
      // 确保清除任何旧的变换
      svg.selectAll('.main-group').attr('transform', null);
        
      // 应用新变换
      console.log('应用树形图变换:', {
        translate: [xOffset, yOffset],
        scale: finalScaleFactor
      });
      svg.call(visualizer.zoom.transform, initialTransform);
    }
    // 6. 更新状态栏
    updateStatusBar(visualizer);
    
    // 7. 添加调试信息
    console.log('树形图渲染完成，节点数:', descendants.length, '链接数:', treeData.links().length);
    // 验证变换是否被正确应用
    setTimeout(() => {
      try {
        const currentTransform = d3.zoomTransform(svg.node());
        } catch (e) {
        console.error('获取变换信息失败:', e);
        }
    }, 10);
  } catch (err) {
    console.error('树形图渲染过程中出错:', err);
    
    // 添加错误信息显示
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'red')
      .text(`渲染错误: ${err instanceof Error ? err.message : '未知错误'}`);
  }
}

/**
   * 检测并移除导致循环的连接
   * @param nodes 节点列表
   * @param links 连接列表
   * @returns 安全连接列表（已移除循环连接）
   */
function detectAndBreakCycles(nodes: any[], links: any[]): any[] {
  console.log('检测并打破循环...');
  
  // 创建节点ID映射表
  const nodeById: Record<string, boolean> = {};
  nodes.forEach(node => {
    nodeById[node.id] = true;
  });
  
  // 构建图的邻接表表示
  const graph: Record<string, string[]> = {};
  nodes.forEach(node => {
    graph[node.id] = [];
  });
  
  // 填充图
  links.forEach(link => {
    // 确保source和target都是字符串ID
    const source = typeof link.source === 'object' ? link.source.id : link.source;
    const target = typeof link.target === 'object' ? link.target.id : link.target;
    
    if (graph[source]) {
      graph[source].push(target);
    }
  });
  
  // 用来跟踪已发现的循环
  const cyclicLinks: Set<string> = new Set();
  
  // 用DFS检测循环
  function detectCycle(nodeId: string, visited: Set<string>, path: Set<string>, pathList: string[]): boolean {
    // 当前节点已在路径中 -> 发现循环!
    if (path.has(nodeId)) {
      console.warn('检测到循环:', [...pathList, nodeId].join(' -> '));
      
      // 标记循环中的所有边
      const cycleStart = pathList.indexOf(nodeId);
      if (cycleStart >= 0) {
        const cycle = pathList.slice(cycleStart);
        cycle.push(nodeId);
        
        // 生成循环中的边
        for (let i = 0; i < cycle.length - 1; i++) {
          const linkId = `${cycle[i]}->${cycle[i+1]}`;
          cyclicLinks.add(linkId);
        }
      }
      
      return true;
    }
    
    // 已访问但不在当前路径中 -> 无循环
    if (visited.has(nodeId)) {
      return false;
    }
    
    // 标记为已访问并添加到当前路径
    visited.add(nodeId);
    path.add(nodeId);
    pathList.push(nodeId);
    
    // 检查所有邻居节点
    const neighbors = graph[nodeId] || [];
    for (const neighbor of neighbors) {
      if (detectCycle(neighbor, visited, path, pathList)) {
        return true;
      }
    }
    
    // 回溯时从路径中移除节点
    path.delete(nodeId);
    pathList.pop();
    
    return false;
  }
  
  // 对每个未访问节点开始DFS
  const visited = new Set<string>();
  for (const nodeId in graph) {
    if (!visited.has(nodeId)) {
      detectCycle(nodeId, visited, new Set<string>(), []);
    }
  }
  
  // 过滤掉导致循环的连接
  const safeLinks = links.filter(link => {
    // 确保source和target都是字符串ID
    const source = typeof link.source === 'object' ? link.source.id : link.source;
    const target = typeof link.target === 'object' ? link.target.id : link.target;
    
    const linkId = `${source}->${target}`;
    const isSafe = !cyclicLinks.has(linkId);
    
    if (!isSafe) {
      console.log(`跳过导致循环的连接: ${source} -> ${target}`);
    }
    
    return isSafe;
  });
  
  console.log(`检测出 ${cyclicLinks.size} 条导致循环的连接，剩余 ${safeLinks.length} 条安全连接`);
  
  return safeLinks;
}