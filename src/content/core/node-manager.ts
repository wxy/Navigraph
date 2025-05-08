/**
 * 节点管理器
 * 负责管理导航节点和边的数据模型，处理节点间关系，并提供统一的访问接口
 */
import { Logger } from '../../lib/utils/logger.js';
import { i18n } from '../../lib/utils/i18n-utils.js'; // 保留i18n导入用于UI文本
import type { BrowsingSession, NavNode, NavLink } from '../../types/session-types.js';
import type { NodeMetadata } from '../types/navigation.js';
import { UrlUtils } from '../../lib/utils/url-utils.js';

// 为方便代码迁移，定义类型别名
type SessionDetails = BrowsingSession;

const logger = new Logger('NodeManager');

export class NodeManager {
  private static instance: NodeManager | null = null;
  // ===== 数据存储 =====
  private nodes: NavNode[] = [];
  private edges: NavLink[] = [];
  private nodeMap: Map<string, NavNode> = new Map();

  private constructor() {
    // 私有构造函数，防止外部实例化
  }
  public static getInstance(): NodeManager {
    if (!NodeManager.instance) {
      NodeManager.instance = new NodeManager();
    }
    return NodeManager.instance;
  }

  // ===== 数据处理方法 =====
  
  /**
   * 处理会话数据，构建节点和边
   * @param session 会话数据
   */
  processSessionData(session: SessionDetails): void {
    if (!session) return;

    // 检查是否有实际数据需要处理
    const hasRecords = session.records && Object.keys(session.records).length > 0;
    const hasEdges = session.edges && Object.keys(session.edges).length > 0;
    
    if (!hasRecords && !hasEdges) {
      logger.log(i18n('session_no_data_skip_processing', '会话不包含节点或边数据，跳过处理'));
      this.resetData();
      return;
    }
    
    logger.groupCollapsed(i18n('session_data_processing_start', '开始处理会话数据...'));
    
    try {
      this.processRecordsToNodes(session);
      this.processRelationships();
      this.processEdges(session);
      
      logger.log(i18n('session_data_processing_complete', '会话数据处理完成，节点: {0}, 边: {1}'), this.nodes.length, this.edges.length);
    } catch (error) {
      logger.error(i18n('session_data_processing_failed', '处理会话数据失败: {0}'), error);
      this.resetData();
    }
    logger.groupEnd();
  }
  
  /**
   * 将会话记录转换为节点
   */
  private processRecordsToNodes(session: SessionDetails): void {
    // 记录存储
    const records = session.records || {};
    const recordIds = Object.keys(records);
    
    logger.log(i18n('processing_records', '处理{0}条记录'), recordIds.length);
    
    // 转换为节点数组
    this.nodes = recordIds.map(id => this.processNavNode(records[id]));
  }
  
  /**
   * 处理导航节点，添加前端所需属性
   */
  private processNavNode(record: NavNode): NavNode {
    // 处理必要字段默认值
    if (!record.title) {
      record.title = UrlUtils.extractTitle(record.url);
    }
    
    if (!record.type) {
      record.type = 'unknown';
    }
    
    // 修正自引用问题
    if (record.parentId === record.id) {
      record.parentId = '';
    }
    
    // 添加前端特定属性
    (record as any).children = [];
    (record as any).depth = 0;
    
    return record;
  }
  
  /**
   * 处理节点关系
   */
  private processRelationships(): void {
    this.rebuildParentChildRelationships();
    this.calculateNodeDepths();
    this.buildNodeMap();
  }
  
  /**
   * 处理边数据
   */
  private processEdges(session: SessionDetails): void {
    // 获取所有边
    const edgeMap = session.edges || {};
    const edgeIds = Object.keys(edgeMap);
    
    logger.log(i18n('processing_edges', '处理{0}条边'), edgeIds.length);
    
    // 转换为边数组
    this.edges = edgeIds.map(id => ({
      ...edgeMap[id],
      type: edgeMap[id].type || 'unknown',
      sessionId: edgeMap[id].sessionId || ''
    }));
    
    // 添加基于重构的父子关系创建附加边
    this.enhanceEdgesFromParentChildRelationships();
  }
  
  /**
   * 重置数据
   */
  private resetData(): void {
    this.nodes = [];
    this.edges = [];
    this.nodeMap.clear();
  }
  
  // ===== 节点关系管理 =====
  
  /**
   * 重建父子关系
   */
  private rebuildParentChildRelationships(): void {
    logger.log(i18n('rebuild_parent_child_relationships_start', '开始重建父子关系...'));
    
    // 创建节点ID映射，便于快速查找
    const nodesById = this.createNodeIdMap();
    
    // 按标签页组织节点
    const nodesByTabId = this.organizeNodesByTab();
    
    // 分配父节点
    const assignedCount = this.assignParentNodes(nodesById, nodesByTabId);
    
    // 重新构建子节点引用
    this.buildChildReferences(nodesById);
    
    logger.log(i18n('parent_child_relationships_rebuilt', '父子关系重建完成: {0}/{1} 节点有父节点'), assignedCount, this.nodes.length);
  }
  
  /**
   * 创建节点ID到节点的映射
   */
  private createNodeIdMap(): {[key: string]: NavNode} {
    const nodesById: {[key: string]: NavNode} = {};
    this.nodes.forEach(node => {
      nodesById[node.id] = node;
    });
    return nodesById;
  }
  
  /**
   * 按标签页组织节点
   */
  private organizeNodesByTab(): {[key: string]: NavNode[]} {
    const nodesByTabId: {[key: string]: NavNode[]} = {};
    
    this.nodes.forEach(node => {
      const tabId = String(node.tabId || '');
      if (!tabId) return;
      
      if (!nodesByTabId[tabId]) {
        nodesByTabId[tabId] = [];
      }
      nodesByTabId[tabId].push(node);
    });
    
    // 对每个标签页的节点按时间排序
    Object.keys(nodesByTabId).forEach(tabId => {
      nodesByTabId[tabId].sort((a, b) => a.timestamp - b.timestamp);
    });
    
    return nodesByTabId;
  }
  
  /**
   * 分配父节点
   */
  private assignParentNodes(
    nodesById: {[key: string]: NavNode}, 
    nodesByTabId: {[key: string]: NavNode[]}
  ): number {
    let assignedCount = 0;
    
    // 按时间顺序处理节点
    const sortedNodes = [...this.nodes].sort((a, b) => a.timestamp - b.timestamp);
    
    // 跟踪每个标签页当前活跃的节点
    const activeNodesByTabId: {[key: string]: NavNode} = {};
    
    // 遍历所有节点，按时间顺序模拟导航过程
    sortedNodes.forEach(node => {
      // 如果已有有效的父节点引用，保留它
      const parentId = node.parentId as string | null | undefined;
      if (parentId && nodesById[parentId] && parentId !== node.id) {
        assignedCount++;
        return;
      }
      
      // 自循环检测 - 将自引用修正为根节点
      if (node.parentId === node.id) {
        logger.log(i18n('node_self_reference_fixed', '节点 {0} 是自循环，修正为根节点'), node.id);
        node.parentId = '';
        return;
      }
      
      // 根据导航类型确定父节点
      if (this.assignParentByNodeType(node, nodesByTabId, activeNodesByTabId, nodesById)) {
        assignedCount++;
      }
      
      // 更新当前标签页的活跃节点
      const nodeTabId = String(node.tabId || '');
      if (nodeTabId) {
        activeNodesByTabId[nodeTabId] = node;
      }
    });
    
    return assignedCount;
  }
  
  /**
   * 根据节点类型分配父节点
   */
  private assignParentByNodeType(
    node: NavNode, 
    nodesByTabId: {[key: string]: NavNode[]},
    activeNodesByTabId: {[key: string]: NavNode},
    nodesById: {[key: string]: NavNode}
  ): boolean {
    const tabId = String(node.tabId || '');
    
    switch(node.type) {
      case 'link_click':
        // 链接点击通常来自同一标签页的前一个节点
        if (!tabId) return false;
        
        const sameTabNodes = nodesByTabId[tabId] || [];
        const nodeIndex = sameTabNodes.findIndex(n => n.id === node.id);
        
        // 如果在同一标签页中有前一个节点，将其设为父节点
        if (nodeIndex > 0) {
          node.parentId = sameTabNodes[nodeIndex - 1].id;
          return true;
        }
        break;
        
      case 'address_bar':
        // 地址栏输入通常是新的导航序列，可能没有父节点
        // 但如果是在现有标签页中输入，可能与前一页有关
        if (tabId && activeNodesByTabId[tabId]) {
          node.parentId = activeNodesByTabId[tabId].id;
          return true;
        } else {
          node.parentId = ''; // 新标签页的第一次导航
        }
        break;
        
      case 'form_submit':
        // 表单提交通常来自同一标签页的前一个节点
        if (tabId && activeNodesByTabId[tabId]) {
          node.parentId = activeNodesByTabId[tabId].id;
          return true;
        }
        break;
        
      case 'history_back':
      case 'history_forward':
        // 历史导航指向同一标签页中的某个节点
        // 这种情况较复杂，暂时保持当前处理方式
        break;
        
      case 'reload':
        // 刷新操作应该保持当前节点，不改变父子关系
        // 已在上面处理了自循环情况
        break;
        
      default:
        // 对于其他类型，查找直接的导航关系
        // 用边信息补充 - 这是原始记录的实际导航关系
        if (this.edges) {
          const directEdges = this.edges.filter(e => 
            (e.target === node.id)
          );
          
          if (directEdges.length > 0) {
            // 优先使用最近的边
            directEdges.sort((a, b) => {
              const aTime = a.timestamp || 0;
              const bTime = b.timestamp || 0;
              return bTime - aTime;
            });
            node.parentId = directEdges[0].source;
            return true;
          }
        }
        break;
    }
    
    return false;
  }
  
  /**
   * 建立子节点引用
   */
  private buildChildReferences(nodesById: {[key: string]: NavNode}): void {
    // 重置所有节点的子节点数组
    this.nodes.forEach(node => {
      node.children = [];
    });
    
    // 填充子节点数组
    this.nodes.forEach(node => {
      const parentId = node.parentId as string | undefined;
      if (parentId && nodesById[parentId]) {
        nodesById[parentId].children!.push(node);
      }
    });
  }
  
  /**
   * 计算节点深度
   */
  private calculateNodeDepths(): void {
    try {
      // 首先找出所有根节点
      const rootNodes = this.findRootNodes();
      
      if (rootNodes.length === 0) {
        this.setDefaultDepths();
        return;
      }
      
      // 为每个根节点及其子节点计算深度
      rootNodes.forEach(rootNode => {
        rootNode.depth = 0;
        this.calculateChildDepths(rootNode, 1);
      });
    } catch (error) {
      logger.error(i18n('content_calculate_node_depth_failed', '计算节点深度失败'), error);
      this.setDefaultDepths();
    }
  }
  
  /**
   * 查找所有根节点
   */
  private findRootNodes(): NavNode[] {
    return this.nodes.filter(node => !node.parentId);
  }
  
  /**
   * 设置默认深度值
   */
  private setDefaultDepths(): void {
    logger.log(i18n('content_no_root_nodes_found', '没有找到根节点，设置所有节点深度为0'));
    this.nodes.forEach(node => {
      node.depth = 0;
    });
  }
  
  /**
   * 递归计算子节点深度
   */
  private calculateChildDepths(parentNode: NavNode, depth: number): void {
    if (!parentNode || !parentNode.id) return;
    
    // 找出父节点的所有直接子节点
    const childNodes = this.findChildNodesById(parentNode.id);
    
    // 设置子节点深度并递归处理
    childNodes.forEach(childNode => {
      childNode.depth = depth;
      // 防止循环引用导致栈溢出
      if (childNode.id !== parentNode.id) {
        this.calculateChildDepths(childNode, depth + 1);
      }
    });
  }
  
  /**
   * 根据父节点ID查找子节点
   */
  private findChildNodesById(parentId: string): NavNode[] {
    return this.nodes.filter(node => 
      node.parentId === parentId && node.id !== parentId
    );
  }
  
  /**
   * 构建节点ID到节点对象的映射表
   */
  private buildNodeMap(): void {
    this.nodeMap.clear();
    if (this.nodes && this.nodes.length) {
      this.nodes.forEach(node => {
        this.nodeMap.set(node.id, node);
      });
    }
    logger.log(i18n('node_map_built', '已建立{0}个节点的索引'), this.nodeMap.size);
  }
  
  /**
   * 根据重构的父子关系增强边集合
   */
  private enhanceEdgesFromParentChildRelationships(): void {
    // 创建现有边的映射
    const existingEdgeMap = this.createEdgeMap();
    
    // 为缺失的父子关系创建新边
    const newEdges = this.createMissingEdges(existingEdgeMap);
    
    if (newEdges.length > 0) {
      logger.log(i18n('generated_edges_added', '添加了{0}条生成的边'), newEdges.length);
      this.edges = [...this.edges, ...newEdges];
    }
  }
  
  /**
   * 创建边的映射
   */
  private createEdgeMap(): {[key: string]: boolean} {
    const existingEdgeMap: {[key: string]: boolean} = {};
    this.edges.forEach(edge => {
      const source = edge.source;
      const target = edge.target;
      const key = `${source}#${target}`;
      existingEdgeMap[key] = true;
    });
    return existingEdgeMap;
  }
  
  /**
   * 创建缺失的边
   */
  private createMissingEdges(existingEdgeMap: {[key: string]: boolean}): NavLink[] {
    const newEdges: NavLink[] = [];
    
    this.nodes.forEach(node => {
      const parentId = node.parentId as string | undefined;
      if (parentId) {
        const source = parentId;
        const target = node.id;
        const key = `${source}#${target}`;
        
        // 如果这个关系的边不存在，添加一个新的
        if (!existingEdgeMap[key] && this.nodeMap.has(source)) {
          newEdges.push({
            id: `generated-${key}`,
            source: source,
            target: target,
            type: node.type || 'unknown',
            sequence: 0,
            timestamp: node.timestamp,
            sessionId: node.sessionId || ''
          });
        }
      }
    });
    
    return newEdges;
  }
  
  // ===== 节点操作方法 =====
  
  /**
   * 更新节点元数据
   * @param nodeId 节点ID
   * @param metadata 要更新的元数据对象，可包含title、favicon等
   * @returns 是否成功更新
   */
  updateNodeMetadata(nodeId: string, metadata: NodeMetadata): boolean {
    if (!nodeId || !metadata) return false;
    
    const node = this.nodeMap.get(nodeId);
    if (!node) return false;
    
    let updated = false;
    
    // 遍历所有元数据属性
    Object.keys(metadata).forEach(key => {
      const value = metadata[key];
      if (value !== undefined) {
        // 使用类型断言告诉TypeScript这是安全的
        (node as any)[key] = value;
        updated = true;
      }
    });
    
    return updated;
  }
  
  /**
   * 查找或创建节点ID
   * @param url 节点URL
   * @returns 节点ID
   */
  getOrCreateNodeId(url: string): string {
    // 首先查找是否有匹配URL的现有节点
    const existingNode = this.nodes.find(node => node.url === url);
    if (existingNode) {
      return existingNode.id;
    }
    
    // 如果没有找到，创建一个新的ID
    return `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
  
  /**
   * 查询节点
   * @param property 属性名
   * @param value 属性值
   * @returns 匹配的节点数组
   */
  findNodesByProperty(property: string, value: any): NavNode[] {
    return this.nodes.filter(node => (node as any)[property] === value);
  }
  
  /**
   * 查找节点的子节点
   * @param nodeId 节点ID
   * @returns 子节点数组
   */
  findChildNodes(nodeId: string): NavNode[] {
    return this.nodes.filter(node => node.parentId === nodeId);
  }
  
  /**
   * 查找节点的父节点
   * @param nodeId 节点ID
   * @returns 父节点，如果不存在则返回undefined
   */
  findParentNode(nodeId: string): NavNode | undefined {
    const node = this.nodeMap.get(nodeId);
    if (!node || !node.parentId) return undefined;
    
    return this.nodeMap.get(node.parentId as string);
  }
  
  /**
   * 过滤节点
   * @param predicate 过滤函数
   * @returns 符合条件的节点数组
   */
  filterNodes(predicate: (node: NavNode) => boolean): NavNode[] {
    return this.nodes.filter(predicate);
  }
  
  // ===== 辅助方法 =====
  
  // ===== 数据访问方法 =====
  
  /**
   * 获取所有节点
   * @returns 所有节点的数组
   */
  getNodes(): NavNode[] {
    return this.nodes;
  }
  
  /**
   * 获取所有边
   * @returns 所有边的数组
   */
  getEdges(): NavLink[] {
    return this.edges;
  }
  
  /**
   * 获取节点映射表
   * @returns 节点ID到节点对象的映射
   */
  getNodeMap(): Map<string, NavNode> {
    return this.nodeMap;
  }

  /**
   * 根据ID获取节点
   * @param id 节点ID
   * @returns 对应的节点对象，如果不存在则返回undefined
   */
  getNodeById(id: string): NavNode | undefined {
    return this.nodeMap.get(id);
  }
}
/**
 * 提供单例访问方式
 * @returns NodeManager实例
 */
// 通过单例模式确保只有一个NodeManager实例
// 适用于全局访问和数据共享
export const nodeManager = NodeManager.getInstance();