/**
 * 树形图视图渲染器
 * 负责绘制层次化的导航树结构
 */
import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { 
  NavNode, 
  NavLink, 
  ExtendedNavNode,
  D3TreeNode,
  D3TreeLink,
  Visualizer 
} from '../../types/navigation.js';

import { 
  getNodeColor, 
  getEdgeColor, 
  isTrackingPage,    
  renderEmptyTreeMessage 
} from '../../utils/visualization-utils.js';

import { 
  saveViewState, 
  getViewState
} from '../../utils/state-manager.js';

import { BaseRenderer } from './BaseRenderer.js';

const d3 = window.d3;
const logger = new Logger('TreeRenderer');

export class TreeRenderer implements BaseRenderer {
  private visualizer: Visualizer;
  private svg: any = null;
  private container: HTMLElement | null = null;
  private width: number = 0;
  private height: number = 0;
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }
  
  /**
   * 初始化渲染器
   */
  initialize(svg: any, container: HTMLElement, width: number, height: number): void {
    this.svg = svg;
    this.container = container;
    this.width = width;
    this.height = height;
    
    logger.log(_('tree_renderer_initialized', '树形图渲染器已初始化'), { width, height });
  }
  
  /**
   * 渲染可视化视图
   */
  render(nodes: NavNode[], edges: NavLink[], options: { restoreTransform?: boolean } = {}): void {
    if (!this.svg || !this.container) {
      logger.error(_('renderer_cannot_render_no_container', '无法渲染：SVG或容器未初始化'));
      return;
    }
    
    // 调用原有的渲染函数
    renderTreeLayout(
      this.container,
      this.svg,
      nodes,
      edges,
      this.width,
      this.height,
      this.visualizer
    );
  }
  
  /**
   * 清理资源
   */
  cleanup(): void {
    // 清理任何需要释放的资源
    this.svg = null;
    this.container = null;
    logger.log(_('tree_renderer_cleaned_up', '树形图渲染器已清理'));
  }
}

// 保留原有的renderTreeLayout函数，但改为文件内部函数
function renderTreeLayout(
  container: HTMLElement, 
  svg: any, 
  nodes: NavNode[], 
  links: any[], 
  width: number, 
  height: number, 
  visualizer: Visualizer
): void {
  logger.log(_('using_modular_tree_renderer', '使用模块化树形图渲染器'));
  
  try {
    // 声明并初始化saveStateTimeout变量
    let saveStateTimeout: ReturnType<typeof setTimeout> | null = null;
    // 清除常见错误源
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    
    // 获取特定视图类型的状态
    const tabId = visualizer.tabId || '';
    const savedState = getViewState(tabId, 'tree');
    let shouldRestoreTransform = false;
    let transformToRestore = null;
    
    if (savedState && savedState.transform) {
      const { x, y, k } = savedState.transform;
      if (isFinite(x) && isFinite(y) && isFinite(k) && k > 0) {
        logger.log(_('tree_state_detected', '检测到保存的树形图状态: {0}'), savedState.transform);
        shouldRestoreTransform = true;
        transformToRestore = savedState.transform;
      }
    }

    // 规范化输入的链接数据
    const normalizedInputLinks = normalizeLinks(links);
    
    // 检查是否有链接需要规范化
    const needsNormalization = links.some(link => 
      typeof link.source === 'object' || typeof link.target === 'object'
    );
    
    if (needsNormalization) {
      logger.warn(_('links_normalized_to_string_ids', '链接已规范化为字符串ID'));
    }
    
    // 1. 确保基本DOM结构存在
    if (!svg.select('.main-group').node()) {
      logger.log(_('creating_main_view_group', '创建主视图组'));
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
      logger.log(_('tree_view_zoom_setup_start', '为树形图视图设置缩放行为'));
      
      // 先清除旧的缩放事件
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
        // 实时更新状态栏显示缩放比例
        if (visualizer) {
          // 保存当前变换状态
          visualizer.currentTransform = event.transform;
          
          // 更新状态栏
          if (typeof visualizer.updateStatusBar === 'function') {
            visualizer.updateStatusBar();
          }
          
          // 添加防抖保存状态逻辑
          if (saveStateTimeout) clearTimeout(saveStateTimeout);
          saveStateTimeout = setTimeout(() => {
            // 安全检查
            if (Math.abs(event.transform.x) < width * 2 && 
                Math.abs(event.transform.y) < height * 2) {
              // 保存状态，明确指定为树形图视图
              saveViewState(visualizer.tabId || '', {
                viewType: 'tree',
                transform: {
                  x: event.transform.x,
                  y: event.transform.y,
                  k: event.transform.k
                }
              });
            }
          }, 300); // 延迟300毫秒保存，避免频繁保存
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
      
      logger.log(_('tree_view_zoom_setup_complete', '已设置树形图缩放行为'));
    } catch (error) {
      logger.error(_('tree_view_zoom_setup_failed', '设置树形图缩放失败: {0}'), error);
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
        _('session_date', '会话日期: {0}', new Date(visualizer.currentSession.startTime).toLocaleString()) : 
        _('current_session', '当前会话'),
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
        logger.log(_('detected_self_loop_node', '检测到自循环节点: {0}'), node.id);
        extNode.isSelfLoop = true;
        // 将自循环节点的parentId设为空字符串，使其成为根节点
        extNode.parentId = '';
        extNode.isRoot = true;
        selfLoopNodes.push(extNode);
      }
    });
    
    // 构建树结构
    const rootNodes: ExtendedNavNode[] = [];
    nodes.forEach(node => {
      const extNode = nodeById[node.id];
      // 判断是否为根节点或父节点不存在
      if (node.parentId === '' || !nodeById[node.parentId]) {
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
    
    logger.log(_('found_root_and_self_loop_nodes', '找到根节点和自循环节点: {0}, {1}'), String(rootNodes.length), String(selfLoopNodes.length));
    
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
      logger.warn(_('no_root_nodes_found', '未找到根节点'));
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
    const allLinks = [...sessionLinks, ...normalizedInputLinks];

    // 在调用d3.stratify之前应用循环检测及修复
    // 对所有链接进行预处理，确保格式一致
    const normalizedAllLinks = normalizeLinks(allLinks);

    // 检测并移除导致循环的链接
    const safeLinks = detectAndBreakCycles(allNodes, normalizedAllLinks);

    // 如果移除了链接，显示警告
    if (safeLinks.length < allLinks.length) {
      const removedCount = allLinks.length - safeLinks.length;
      logger.log(_('removed_cycle_links', '移除了 {0} 个导致循环的链接'), String(removedCount));
      
      // 添加视觉警告提示
      svg.append('text')
        .attr('x', width - 200)
        .attr('y', 20)
        .attr('class', 'cycle-message')
        .text(_('fixed_cycle_connections', '已移除 {0} 个循环连接', String(removedCount)));
    }

    // 在应用布局之前对根节点进行分组
    logger.log(_('balancing_root_nodes', '平衡根节点: {0}'), String(rootNodes.length));

    // 按时间戳排序根节点
    rootNodes.sort((a, b) => a.timestamp - b.timestamp);

    // 将根节点分为左右两组
    const mid = Math.ceil(rootNodes.length / 2);
    const leftRootNodes = rootNodes.slice(0, mid);
    const rightRootNodes = rootNodes.slice(mid);

    logger.log(_('root_nodes_distribution', '根节点分布: 左={0}，右={1}'), String(leftRootNodes.length), String(rightRootNodes.length));

    // 创建左右会话虚拟根节点
    const leftSessionNode: ExtendedNavNode = {
      ...sessionNode,
      id: 'left-session-root'
    };

    const rightSessionNode: ExtendedNavNode = {
      ...sessionNode,
      id: 'right-session-root'
    };

    // 为节点添加子树标识
    leftRootNodes.forEach(root => root.subtreeType = 'left');
    rightRootNodes.forEach(root => root.subtreeType = 'right');

    // 递归标记所有子节点的子树类型
    function markSubtreeNodes(node: ExtendedNavNode, subtreeType: string): void {
      node.subtreeType = subtreeType;
      if (node.children && node.children.length > 0) {
        node.children.forEach(child => markSubtreeNodes(child, subtreeType));
      }
    }

    // 标记左右子树的所有节点
    leftRootNodes.forEach(root => markSubtreeNodes(root, 'left'));
    rightRootNodes.forEach(root => markSubtreeNodes(root, 'right'));

    // 声明树布局结果变量
    let leftTreeData: any = null;
    let rightTreeData: any = null;
    let descendants: D3TreeNode[] = [];

    try {
      // 创建树形布局生成器
      const treeLayout = d3.tree()
        .nodeSize([30, 140])
        .separation((a: any, b: any) => {
          const depthFactor = Math.min(1.3, (a.depth + b.depth) * 0.08 + 1);
          return (a.parent === b.parent ? 3 : 4.5) * depthFactor;
        });
      
      // 辅助函数：从根节点获取所有后代节点
      function getDescendants(root: ExtendedNavNode): ExtendedNavNode[] {
        const result: ExtendedNavNode[] = [];
        
        function collect(node: ExtendedNavNode) {
          if (node.children && node.children.length > 0) {
            node.children.forEach(child => {
              const fullChild = nodeById[child.id];
              if (fullChild) {
                result.push(fullChild);
                collect(fullChild);
              }
            });
          }
        }
        
        collect(root);
        return result;
      }
      
      // 处理左侧子树
      if (leftRootNodes.length > 0) {
        // 准备左侧树节点数据
        const leftTreeNodes = [
          leftSessionNode,
          ...leftRootNodes,
          ...leftRootNodes.flatMap(root => getDescendants(root))
        ];
        
        // 创建左侧层次结构
        const leftHierarchy = d3.stratify()
          .id((d: any) => d.id)
          .parentId((d: any) => {
            if (d.id === 'left-session-root') return null;
            if (leftRootNodes.some(root => root.id === d.id)) return 'left-session-root';
            return d.parentId || 'left-session-root';
          })
          (leftTreeNodes);
        
        // 应用布局
        leftTreeData = treeLayout(leftHierarchy);
        
        // 水平镜像左侧子树坐标
        leftTreeData.descendants().forEach((d: any) => {
          d.y = -d.y; // 翻转Y坐标(在D3中，y是水平方向)
        });
      }
      
      // 处理右侧子树
      if (rightRootNodes.length > 0) {
        // 准备右侧树节点数据
        const rightTreeNodes = [
          rightSessionNode,
          ...rightRootNodes,
          ...rightRootNodes.flatMap(root => getDescendants(root))
        ];
        
        // 创建右侧层次结构
        const rightHierarchy = d3.stratify()
          .id((d: any) => d.id)
          .parentId((d: any) => {
            if (d.id === 'right-session-root') return null;
            if (rightRootNodes.some(root => root.id === d.id)) return 'right-session-root';
            return d.parentId || 'right-session-root';
          })
          (rightTreeNodes);
        
        // 应用布局
        rightTreeData = treeLayout(rightHierarchy);
      }
      
      // 创建实际的中心会话节点
      const sessionD3Node = {
        data: sessionNode,
        depth: 0,
        height: 1,
        parent: null,
        x: 0,
        y: 0,
        children: []
      } as D3TreeNode;
      
      // 合并所有节点
      descendants = [sessionD3Node];
      
      // 添加左侧树节点(排除左虚拟根节点)
      if (leftTreeData) {
        const leftNodes = leftTreeData.descendants().filter((d: any) => d.data.id !== 'left-session-root');
        descendants = descendants.concat(leftNodes);
      }
      
      // 添加右侧树节点(排除右虚拟根节点)
      if (rightTreeData) {
        const rightNodes = rightTreeData.descendants().filter((d: any) => d.data.id !== 'right-session-root');
        descendants = descendants.concat(rightNodes);
      }

    } catch (err) {
      logger.error(_('tree_layout_calculation_failed', '树形图布局计算失败: {0}'), err);
      
      // 更简洁的错误处理
      let errorMessage = _('tree_layout_calculation_failed_msg', '无法计算树形图布局');
      const errMsg = err instanceof Error ? err.message : String(err);
      
      // 检查是否包含循环依赖错误
      if (errMsg.includes('cycle')) {
        errorMessage = _('unresolvable_cyclic_dependency', '无法解决的循环依赖');
        
        // 尝试渲染可视化的错误信息，帮助用户理解
        svg.append('text')
          .attr('x', width / 2)
          .attr('y', height / 2 - 40)
          .text(_('cannot_render_tree_cyclic_dependency', '由于存在循环依赖，无法渲染树形图'));
          
        svg.append('text')
          .attr('x', width / 2)
          .attr('y', height / 2)
          .attr('class', 'empty-tree-message')
          .text(_('try_timeline_view_or_filter_nodes', '尝试使用时间线视图或筛选节点'));
          
        // 如果visualizer可用，建议切换视图
        if (visualizer && typeof visualizer.switchView === 'function') {
          svg.append('text')
            .attr('x', width / 2)
            .attr('y', height / 2 + 30)
            .attr('class', 'error-action')
            .text(_('click_to_switch_to_timeline', '点击切换到时间线视图'))
            .on('click', () => {
              visualizer.switchView('timeline');
            });
        }
      } else {
        errorMessage = String(err);
      }
      
      throw new Error(errorMessage);
    }
    
    // 计算树的边界
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    descendants.forEach((d: any) => {
      minX = Math.min(minX, d.y);
      maxX = Math.max(maxX, d.y);
      minY = Math.min(minY, d.x);
      maxY = Math.max(maxY, d.x);
    });

    // 计算树的尺寸
    const treeWidth = maxX - minX;
    const treeHeight = (maxY - minY) <= 0 ? 60 : (maxY - minY);

    // 水平和垂直中心化布局
    const centerX = width / 2;
    const centerY = height / 2;

    // 对所有节点进行位置调整
    descendants.forEach((d: any) => {
      if (d.data.id === 'session-root') {
        // 会话节点居中
        d.x = centerY;
        d.y = centerX;
      } else {
        // 其他节点保持相对位置，但整体居中
        d.x = d.x + centerY - (maxY + minY) / 2;
        d.y = d.y + centerX;
      }
    });

    // 创建连接数据
    const treeLinks: D3TreeLink[] = [];

    // 添加从会话节点到左侧根节点的链接
    leftRootNodes.forEach(root => {
      const target = descendants.find(d => d.data.id === root.id);
      if (target) {
        treeLinks.push({ 
          source: descendants[0], // 中心会话节点
          target 
        } as D3TreeLink);
      }
    });

    // 添加从会话节点到右侧根节点的链接
    rightRootNodes.forEach(root => {
      const target = descendants.find(d => d.data.id === root.id);
      if (target) {
        treeLinks.push({ 
          source: descendants[0], // 中心会话节点
          target 
        } as D3TreeLink);
      }
    });

    // 创建节点ID到descendants索引的映射以提高查找效率
    const nodeIdToDescendant = new Map<string, D3TreeNode>();
    descendants.forEach(node => {
      nodeIdToDescendant.set(node.data.id, node);
    });

    // 添加左侧子树内部链接
    if (leftTreeData) {
      let missingLinks = 0;
      leftTreeData.links()
        .filter((link: any) => link.source.data.id !== 'left-session-root')
        .forEach((link: any) => {
          const sourceId = link.source.data.id;
          const targetId = link.target.data.id;
          const source = nodeIdToDescendant.get(sourceId);
          const target = nodeIdToDescendant.get(targetId);
          
          if (source && target) {
            treeLinks.push({ source, target } as D3TreeLink);
          } else {
            missingLinks++;
            logger.log(_('left_tree_link_not_found', '左侧树链接未找到: {0} -> {1}'), sourceId, targetId);
          }
        });
      
      if (missingLinks > 0) {
        logger.warn(_('left_tree_missing_links', '左侧树缺失 {0} 个链接'), String(missingLinks));
      }
    }

    // 添加右侧子树内部链接
    if (rightTreeData) {
      let missingLinks = 0;
      rightTreeData.links()
        .filter((link: any) => link.source.data.id !== 'right-session-root')
        .forEach((link: any) => {
          const sourceId = link.source.data.id;
          const targetId = link.target.data.id;
          const source = nodeIdToDescendant.get(sourceId);
          const target = nodeIdToDescendant.get(targetId);
          
          if (source && target) {
            treeLinks.push({ source, target } as D3TreeLink);
          } else {
            missingLinks++;
            logger.log(_('right_tree_link_not_found', '右侧树链接未找到: {0} -> {1}'), sourceId, targetId);
          }
        });
      
      if (missingLinks > 0) {
        logger.warn(_('right_tree_missing_links', '右侧树缺失 {0} 个链接'), String(missingLinks));
      }
    }

    // 获取节点和链接分组
    const linksGroup = svg.select('.main-group .links-group');
    const nodesGroup = svg.select('.main-group .nodes-group');
    
    // 绘制连接线 - 使用曲线路径
    linksGroup.selectAll('path')
      .data(treeLinks)
      .join('path')
      .attr('class', (d: D3TreeLink) => `link ${d.target.data.type || ''}`)
      .attr('d', (d: D3TreeLink) => {
        // 提取并验证坐标
        const sourceX = d.source.y || 0;
        const sourceY = d.source.x || 0;
        const targetX = d.target.y || 0;
        const targetY = d.target.x || 0;
        
        // 检查坐标是否有效
        if (isNaN(sourceX) || isNaN(sourceY) || isNaN(targetX) || isNaN(targetY)) {
          logger.warn(_('invalid_link_coordinates', '链接坐标无效: {0} -> {1}'), {
            source: d.source.data.id,
            target: d.target.data.id,
            coords: {sourceX, sourceY, targetX, targetY}
          });
          return 'M0,0L0,0'; // 返回一个不可见的线段作为回退
        }
        
        // 如果连接涉及会话节点，使用特殊曲线
        if (d.source.data.id === 'session-root' || d.target.data.id === 'session-root') {
          const midX = (sourceX + targetX) / 2;
          return `M${sourceX},${sourceY} C${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`;
        } else {
          // 修复: 正确使用D3的linkHorizontal函数
          return d3.linkHorizontal()({
            source: [sourceX, sourceY],
            target: [targetX, targetY]
          });
        }
      });
    
    // 绘制节点
    const node = nodesGroup.selectAll('.node')
      .data(descendants)
      .join('g')
      .attr('class', (d: D3TreeNode) => {
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
        
        // 添加自循环节点标记
        if (d.data.isSelfLoop) {
          classes += ' self-loop';
        }
        return classes;
      })
      .attr('transform', (d: D3TreeNode) => `translate(${d.y},${d.x})`);
    
    // 会话节点特殊处理 — 使用圆形根节点并显示两行日期（年 / MMDD）
    node.filter((d: D3TreeNode) => d.data.id === 'session-root')
      .append('g')
      .attr('class', 'session-root-group')
      .each(function(this: SVGGElement, d: D3TreeNode) {
  const g = d3.select(this);
  const radius = 36; // 增大会话根圆以更醒目

        g.append('circle')
          .attr('r', radius)
          .attr('class', 'session-root-circle');

        // 计算日期文本内容
        let yearText = _('current_session', '当前会话');
        let mmddText = '';
        if (visualizer.currentSession) {
          const date = new Date(visualizer.currentSession.startTime);
          yearText = String(date.getFullYear());
          const mm = String(date.getMonth() + 1).padStart(2, '0');
          const dd = String(date.getDate()).padStart(2, '0');
          mmddText = `${mm}${dd}`;
        }

        // 年 (上行)
        g.append('text')
          .attr('class', 'session-year')
          .attr('text-anchor', 'middle')
          .attr('y', -12)
          .text(yearText);

        // 分隔线（位于两行文字之间）
        g.append('line')
          .attr('class', 'session-separator')
          .attr('x1', -radius * 0.7)
          .attr('x2', radius * 0.7)
          .attr('y1', 0)
          .attr('y2', 0)
          .attr('stroke-width', 1)
          .attr('stroke', '#999');

        // MMDD (下行)
        g.append('text')
          .attr('class', 'session-mmdd')
          .attr('text-anchor', 'middle')
          .attr('y', 10)
          .text(mmddText);
      });
    
    // 普通节点
    node.filter((d: D3TreeNode) => d.data.id !== 'session-root')
      .append('circle')
      .attr('r', 20);
    
    // 添加图标
    node.filter((d: D3TreeNode) => d.data.id !== 'session-root' && d.data.favicon)
      .append('image')
      .attr('xlink:href', (d: D3TreeNode) => d.data.favicon || chrome.runtime.getURL('images/logo-48.png'))
      .attr('x', -8)
      .attr('y', -8)
      .attr('width', 16)
      .attr('height', 16)
      .attr('class', (d: D3TreeNode) => d.data.favicon ? '' : 'default-icon')
      .on('error', function(this: SVGImageElement) {
        // 图像加载失败时替换为默认图标
        d3.select(this)
          .attr('xlink:href', chrome.runtime.getURL('images/logo-48.png'))
          .classed('default-icon', true);
      });
    
    // 添加节点标题
    node.append('title')
      .text((d: D3TreeNode) => d.data.title || d.data.url || _('unnamed_node', '未命名节点'));
    
    // （会话节点的详细文本由上方 session-root-group 处理）
    
    // 为普通节点添加简短标签
    node.filter((d: D3TreeNode) => d.data.id !== 'session-root')
      .append('text')
      .attr('dy', 35)
      .text((d: D3TreeNode) => {
        if (!d.data.title) return '';
        return d.data.title.length > 15 ? d.data.title.substring(0, 12) + '...' : d.data.title;
      });
    
    // 为有被过滤子节点的节点添加标记
    node.filter((d: D3TreeNode) => d.data.hasFilteredChildren)
      .append('circle')
      .attr('r', 6)
      .attr('cx', 18)
      .attr('cy', -18)
      .attr('class', 'filtered-indicator')
      .append('title')
      .text((d: D3TreeNode) => _('contains_filtered_nodes', '包含 {0} 个已过滤节点', String(d.data.filteredChildrenCount || 0)));

    // 为自循环节点添加特殊标记
    node.filter((d: D3TreeNode) => d.data.isSelfLoop)
      .append('circle')
      .attr('r', 6)
      .attr('cx', 18)
      .attr('cy', 18)
      .attr('class', 'self-loop-indicator')
      .append('title')
      .text(_('page_has_self_refresh', '页面存在自我刷新'));

    // 为普通节点添加 SPA 请求数角标（来源: d.data.spaRequestCount）
    // 角标基于节点半径计算位置与尺寸，避免与已有装饰（filtered/self-loop）重叠
    node.filter((d: D3TreeNode) => d.data.id !== 'session-root')
      .each(function(this: SVGGElement, d: D3TreeNode) {
        try {
          const badgeCount = Number((d.data as any).spaRequestCount || 0);
          if (!badgeCount || badgeCount <= 0) return;

          const gNode = d3.select(this);
          const hasFiltered = !!d.data.hasFilteredChildren;
          const isSelfLoop = !!d.data.isSelfLoop;

          // 尝试从节点本身读取半径（如果有），否则使用默认值
          let nodeRadius = 20;
          const ownCircle = gNode.select('circle');
          if (!ownCircle.empty()) {
            const rAttr = ownCircle.attr('r');
            if (rAttr) nodeRadius = Number(rAttr) || nodeRadius;
          }

          // 基于半径计算偏移：放在右上方，距离边缘有一定间距
          let bx = Math.ceil(nodeRadius + 6);
          let by = Math.ceil(-nodeRadius * 0.6);

          // 如果存在 filtered indicator（通常在右上），向上或向右避让
          if (hasFiltered) {
            by -= 8;
            bx += 6;
          }

          // 如果存在 self-loop indicator（通常在右下），把角标上移以避免重合
          if (isSelfLoop) {
            by -= 6;
          }

          const badgeRadius = Math.max(6, Math.min(10, Math.round(nodeRadius * 0.35)));

          const badge = gNode.append('g')
            .attr('class', 'tree-spa-badge')
            .attr('transform', `translate(${bx},${by})`);

          // 空心圆环（样式交由 CSS 控制）
          badge.append('circle')
            .attr('r', badgeRadius)
            .attr('class', 'spa-badge-ring');

          // 数字文本，垂直居中由 dominant-baseline 控制，视觉样式交由 CSS
          badge.append('text')
            .attr('class', 'spa-badge-text')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('dy', '0.25em') /* 再次微调垂直位置，防止数字偏高 */
            .text(String(badgeCount));

          badge.append('title')
            .text(_('content_spa_request_count', 'SPA 请求数: {0}', String(badgeCount)));
        } catch (e) {
          logger.warn(_('spa_badge_render_failed', '渲染 SPA 角标失败: {0}'), String(e));
        }
      });

    // 给自循环节点添加循环箭头图标
    node.filter((d: D3TreeNode) => d.data.isSelfLoop)
      .append("svg")
      .attr("width", 10)
      .attr("height", 10)
      .attr("x", 13)
      .attr("y", 13)
      .attr("viewBox", "0 0 512 512")
      .attr("class", "self-loop-icon")
      .append("path")
      .attr("d", "M370.72 133.28C339.458 104.008 298.888 87.962 255.848 88c-77.458.068-144.328 53.178-162.791 126.85-1.344 5.363-6.122 9.15-11.651 9.15H24.103c-7.498 0-13.194-6.807-11.807-14.176C33.933 94.924 134.813 8 256 8c66.448 0 126.791 26.136 171.315 68.685L463.03 40.97C478.149 25.851 504 36.559 504 57.941V192c0 13.255-10.745 24-24 24H345.941c-21.382 0-32.09-25.851-16.971-40.971l41.75-41.749zM32 296h134.059c21.382 0 32.09 25.851 16.971 40.971l-41.75 41.75c31.262 29.273 71.835 45.319 114.876 45.28 77.418-.07 144.315-53.144 162.787-126.849 1.344-5.363 6.122-9.15 11.651-9.15h57.304c7.498 0 13.194 6.807 11.807 14.176C478.067 417.076 377.187 504 256 504c-66.448 0-126.791-26.136-171.315-68.685L48.97 471.03C33.851 486.149 8 475.441 8 454.059V320c0-13.255 10.745-24 24-24z")
      .append('title')
      .text(_('page_has_self_refresh', '页面存在自我刷新'));

    // 在渲染树之前，处理重定向节点
    const redirectNodes = nodes.filter(node => node.type === 'redirect');
    if (redirectNodes.length > 0) {
      logger.log(_('detected_redirect_nodes', '检测到重定向节点: {0}'), String(redirectNodes.length));
      
      // 为重定向节点添加特殊样式
      redirectNodes.forEach(node => {
        // 添加样式标记，可在渲染时使用
        (node as any).isRedirect = true;
      });
    }

    // 添加交互
    node.on('click', function(event: MouseEvent, d: D3TreeNode) {
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

    // 在渲染节点时应用特殊样式
    node.each(function(this: SVGImageElement, d: D3TreeNode) {
      if (d.data && d.data.type === 'redirect') {
        d3.select(this).classed('redirect', true);
      }
    });

    // 应用初始变换以适应视图
    const scaleFactor = Math.min(
      (width - 200) / Math.max(treeWidth, 1), // 增加水平边距
      (height - 200) / Math.max(treeHeight, 1), // 增加垂直边距
      1.0 // 限制最大缩放
    );

    // 使用更保守的缩放值
    const finalScaleFactor = Math.max(0.6, Math.min(0.8, scaleFactor));

    // 创建初始变换 - 中心对齐，不需要额外偏移
    const initialTransform = d3.zoomIdentity
      .translate(
        width * (1 - finalScaleFactor) / 2, 
        height * (1 - finalScaleFactor) / 2
      )
      .scale(finalScaleFactor);

    // 5. 确保在所有渲染完成后才应用变换
    if (visualizer.zoom) {
      // 确保清除任何旧的变换
      svg.selectAll('.main-group').attr('transform', null);
      
      // 尝试应用保存的变换
      if (shouldRestoreTransform && transformToRestore) {
        logger.log(_('tree_restore_state', '恢复树形图状态: {0}'), transformToRestore);
        
        const transform = d3.zoomIdentity
          .translate(transformToRestore.x, transformToRestore.y)
          .scale(transformToRestore.k);
        
        svg.call(visualizer.zoom.transform, transform);
        return; // 跳过应用默认初始变换
      }
      
      // 否则应用默认初始变换
      logger.log(_('tree_transform_applying', '应用树形图变换: {0}'), {
        translate: [centerX - treeWidth / 2, centerY - treeHeight / 2],
        scale: finalScaleFactor
      });
      svg.call(visualizer.zoom.transform, initialTransform);
    }
    // 6. 更新状态栏
    visualizer.updateStatusBar();
    
    // 7. 添加调试信息
    logger.log(_('tree_rendering_complete', '树形图渲染完成，节点数: {0}, 链接数: {1}'), descendants.length.toString(), treeLinks.length.toString());
    // 验证变换是否被正确应用
    setTimeout(() => {
      try {
        const currentTransform = d3.zoomTransform(svg.node());
        } catch (e) {
        logger.error(_('tree_get_transform_failed', '获取变换信息失败: {0}'), e);
        }
    }, 10);
  } catch (err) {
    logger.error(_('tree_rendering_failed', '树形图渲染过程中出错: {0}'), err);
    
    // 添加错误信息显示
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'red')
      .text(_('tree_rendering_error', '渲染错误: {0}', err instanceof Error ? err.message : _('unknown_error', '未知错误')));
  }
}

/**
 * 规范化链接数据，确保source和target都是字符串ID
 * @param links 原始链接数据
 * @returns 规范化后的链接数据
 */
function normalizeLinks(links: any[]): NavLink[] {
  return links.map(link => ({
    id: link.id || `link-${Math.random().toString(36).substring(2, 9)}`,
    source: typeof link.source === 'object' ? link.source.id : link.source,
    target: typeof link.target === 'object' ? link.target.id : link.target,
    type: link.type || ''
  }));
}

/**
 * 检测并移除导致循环的连接，但只移除回边
 * @param nodes 节点列表
 * @param links 连接列表 (已规范化为NavLink)
 * @returns 安全连接列表（仅移除回边）
 */
function detectAndBreakCycles(nodes: ExtendedNavNode[], links: NavLink[]): NavLink[] {
  logger.log(_('tree_detect_break_cycles', '检测并打破循环...'));
  
  // 创建节点ID映射表
  const nodeById: Record<string, ExtendedNavNode> = {};
  nodes.forEach(node => {
    nodeById[node.id] = node;
  });
  
  // 首先过滤掉自循环连接，但保留自循环节点
  const nonSelfLoopLinks = links.filter(link => {
    // 检查是否为自循环连接
    const isSelfLoop = link.source === link.target;
    
    if (isSelfLoop) {
      logger.log(_('tree_skip_self_loop', '跳过自循环连接: {0} -> {1} (将作为根节点处理)'), link.source, link.target);
      return false;
    }
    return true;
  });
  
  // 构建图的邻接表表示
  const graph: Record<string, string[]> = {};
  nodes.forEach(node => {
    graph[node.id] = [];
  });
  
  // 填充图 - 直接使用NavLink的source和target
  nonSelfLoopLinks.forEach(link => {
    if (graph[link.source]) {
      graph[link.source].push(link.target);
    }
  });
  
  // 用来跟踪已发现的回边（只标记循环中的最后一条边）
  const backEdges: Set<string> = new Set();
  
  // 用DFS检测循环
  function detectCycle(nodeId: string, visited: Set<string>, path: Set<string>, pathList: string[]): boolean {
    // 当前节点已在路径中 -> 发现循环!
    if (path.has(nodeId)) {
      logger.log(_('tree_cycle_detected', '检测到循环: {0}'), [...pathList, nodeId].join(' -> '));
      
      // 标记循环中的回边（最后一条边）
      const cycleStart = pathList.indexOf(nodeId);
      if (cycleStart >= 0) {
        const cycle = pathList.slice(cycleStart);
        
        // 只标记回边 - 循环的最后一条边
        const lastNodeInCycle = pathList[pathList.length - 1];
        const backEdgeId = `${lastNodeInCycle}->${nodeId}`;
        
        backEdges.add(backEdgeId);
        logger.log(_('tree_back_edge_marked', '标记回边: {0} -> {1}'), lastNodeInCycle, nodeId);
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
      detectCycle(neighbor, visited, new Set(path), [...pathList]);
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
  
  // 过滤掉回边，但不过滤掉自循环节点
  const safeLinks = nonSelfLoopLinks.filter(link => {
    const linkId = `${link.source}->${link.target}`;
    const isSafe = !backEdges.has(linkId);
    
    if (!isSafe) {
      logger.log(_('tree_remove_back_edge', '移除回边: {0} -> {1}'), link.source, link.target);
    }
    
    return isSafe;
  });
  
  return safeLinks;
}