import { Logger } from '../../lib/utils/logger.js';
import { NavNode, NavLink } from '../types/navigation.js';
import { FilterStates } from './ui/FilterConfig.js';

const logger = new Logger('DataProcessor');

/**
 * 过滤配置接口
 */
export interface FilterConfig {
  reload: boolean;      // 是否显示刷新
  history: boolean;     // 是否显示历史导航
  closed: boolean;      // 是否显示已关闭页面
  showTracking: boolean; // 是否显示跟踪页面
  typeLink: boolean;    // 是否显示链接点击
  typeAddress: boolean; // 是否显示地址栏输入
  typeForm: boolean;    // 是否显示表单提交
  typeJs: boolean;      // 是否显示JavaScript导航
}

/**
 * 数据处理器类
 * 负责节点和边的过滤、处理和分析
 */
export class DataProcessor {
  /**
   * 跟踪页面关键词列表
   * 用于判断页面是否为跟踪/分析页面
   */
  private trackingKeywords = [
    '/track/', '/pixel/', '/analytics/', '/beacon/', '/telemetry/', 
    '/stats/', '/log/', '/metrics/', '/collect/', '/monitor/', 
    'piwik.', 'matomo.', 'ga.js', 'gtm.js', 'fbevents', 
    'insight.', '/counter/', 'www.google-analytics.com'
  ];

  /**
   * 应用筛选器
   * @param nodes 所有节点
   * @param edges 所有边
   * @param filters 筛选器状态对象，使用明确的FilterStates类型
   */
  public applyFilters(
    nodes: NavNode[], 
    edges: NavLink[], 
    filters: FilterStates
  ): { nodes: NavNode[]; edges: NavLink[] } {
    logger.log('应用筛选器:', filters);
    
    // 筛选节点
    const filteredNodes = this.filterNodes(nodes, filters);
    
    // 获取所有符合条件的节点ID集合，用于边过滤
    const nodeIds = new Set(filteredNodes.map(node => node.id));
    
    // 过滤连接，只保留两端都在筛选后节点中的连接
    const filteredEdges = edges.filter(edge => {
      return nodeIds.has(edge.source) && nodeIds.has(edge.target);
    });
    
    logger.log(`过滤结果: 从${nodes.length}个节点中筛选出${filteredNodes.length}个符合条件的节点`);
    
    return { nodes: filteredNodes, edges: filteredEdges };
  }
  
  /**
   * 根据筛选条件过滤节点
   * @param nodes 要筛选的节点列表
   * @param filters 筛选器配置
   * @returns 筛选后的节点列表
   */
  private filterNodes(nodes: NavNode[], filters: FilterStates): NavNode[] {
    return nodes.filter(node => {
      // 类型筛选 - 只过滤明确禁用的已知类型
      if (node.type) {
        if (
          (node.type === 'link_click' && !filters.typeLink) ||
          (node.type === 'address_bar' && !filters.typeAddress) ||
          (node.type === 'form_submit' && !filters.typeForm) ||
          (node.type === 'javascript' && !filters.typeJs)
        ) {
          return false;
        }
      }
      
      // 刷新筛选
      if (!filters.reload && node.type === 'reload') {
        return false;
      }
      
      // 历史筛选
      if (!filters.history && (node.type === 'history_back' || node.type === 'history_forward')) {
        return false;
      }
      
      // 关闭页面筛选
      if (!filters.closed && node.isClosed) {
        return false;
      }
      
      // 跟踪页面筛选
      if (!filters.showTracking && this.isTrackingPage(node)) {
        return false;
      }
      
      // 通过所有筛选条件
      return true;
    });
  }

  /**
   * 判断页面是否为跟踪页面
   * @param node 要判断的导航节点
   * @returns 如果是跟踪页面返回true，否则返回false
   */
  public isTrackingPage(node: NavNode): boolean {
    if (!node || !node.url) return false;
    
    const url = node.url.toLowerCase();
    
    return this.trackingKeywords.some(keyword => url.includes(keyword));
  }
  
  /**
   * 构建节点映射表
   * @param nodes 节点列表
   * @returns 节点ID到节点对象的映射表
   */
  public buildNodeMap(nodes: NavNode[]): Map<string, NavNode> {
    const nodeMap = new Map<string, NavNode>();
    nodes.forEach(node => nodeMap.set(node.id, node));
    return nodeMap;
  }

  /**
   * 分析节点并标记根节点
   * 根节点是没有父节点的节点
   * @param nodes 节点列表
   * @returns 根节点ID列表
   */
  public identifyRootNodes(nodes: NavNode[]): string[] {
    const childNodes = new Set<string>();
    const allNodes = new Set<string>();
    
    // 收集所有节点和子节点信息
    nodes.forEach(node => {
      allNodes.add(node.id);
      if (node.parentId) {
        childNodes.add(node.id);
      }
    });
    
    // 根节点是所有节点中不是子节点的节点
    const rootNodeIds: string[] = [];
    allNodes.forEach(nodeId => {
      if (!childNodes.has(nodeId)) {
        rootNodeIds.push(nodeId);
      }
    });
    
    return rootNodeIds;
  }
}