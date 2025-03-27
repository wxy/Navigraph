/**
 * 导航存储类
 * 管理导航节点和边的存储与检索
 */

import { IndexedDBStorage } from './indexed-db.js';
import { StorageSchema } from './storage-schema.js';

/**
 * 导航节点接口
 */
export interface NavNode {
  id: string;                  // 节点ID
  url: string;                 // URL
  title: string;               // 页面标题
  tabId: number;               // 标签页ID
  timestamp: number;           // 创建时间戳
  sessionId: string;           // 所属会话ID
  type: string;                // 节点类型
  parentId?: string;           // 父节点ID
  favIconUrl?: string;         // 网站图标URL
  metadata?: NodeMetadata;     // 元数据
}

/**
 * 导航边接口
 */
export interface NavLink {
  id: string;                  // 边ID
  source: string;              // 源节点ID
  target: string;              // 目标节点ID
  timestamp: number;           // 创建时间戳
  sessionId: string;           // 所属会话ID
  type: string;                // 边类型，如 'link', 'history', 'form' 等
  metadata?: EdgeMetadata;     // 元数据
}

/**
 * 节点元数据接口
 */
export interface NodeMetadata {
  visitCount?: number;         // 访问次数
  lastVisited?: number;        // 最后访问时间
  keywords?: string[];         // 关键词
  description?: string;        // 描述
  [key: string]: any;          // 其他自定义元数据
}

/**
 * 边元数据接口
 */
export interface EdgeMetadata {
  navigationMethod?: string;   // 导航方法（点击、表单提交等）
  transitionType?: string;     // 过渡类型
  formData?: Record<string, string>; // 表单数据（如适用）
  [key: string]: any;          // 其他自定义元数据
}

/**
 * 导航数据查询选项
 */
export interface NavDataQueryOptions {
  sessionId?: string;          // 按会话ID过滤
  url?: string;                // 按URL过滤
  tabId?: number;              // 按标签页ID过滤
  type?: string;               // 按类型过滤
  startTime?: number;          // 开始时间
  endTime?: number;            // 结束时间
  limit?: number;              // 结果数量限制
}

/**
 * 导航存储类
 * 负责导航节点和边的存储与检索
 */
export class NavigationStorage {
  // 数据库引用
  private db: IndexedDBStorage;
  
  // 存储表名
  private readonly NODE_STORE = 'nodes';
  private readonly EDGE_STORE = 'edges';
  
  // 是否已初始化
  private initialized = false;
  
  /**
   * 创建导航存储实例
   * @param db 可选的数据库实例，用于依赖注入和测试
   */
  constructor(db?: IndexedDBStorage) {
    this.db = db || new IndexedDBStorage(StorageSchema);
  }
  
  /**
   * 初始化存储
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      await this.db.initialize();
      this.initialized = true;
      console.log('导航存储已初始化');
    } catch (error) {
      console.error('初始化导航存储失败:', error);
      throw new Error(`初始化导航存储失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 确保已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
  
  /**
   * 保存导航节点
   * @param node 要保存的节点
   */
  public async saveNode(node: NavNode): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.db.put(this.NODE_STORE, node);
      console.log(`节点已保存: ${node.id}`);
    } catch (error) {
      console.error('保存节点失败:', error);
      throw new Error(`保存节点失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 保存多个导航节点
   * @param nodes 要保存的节点数组
   */
  public async saveNodes(nodes: NavNode[]): Promise<void> {
    await this.ensureInitialized();
    
    try {
      for (const node of nodes) {
        await this.db.put(this.NODE_STORE, node);
      }
      console.log(`已保存 ${nodes.length} 个节点`);
    } catch (error) {
      console.error('保存多个节点失败:', error);
      throw new Error(`保存多个节点失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取指定ID的节点
   * @param nodeId 节点ID
   * @returns 节点对象，如果不存在则返回null
   */
  public async getNode(nodeId: string): Promise<NavNode | null> {
    await this.ensureInitialized();
    
    try {
      const node = await this.db.get<NavNode>(this.NODE_STORE, nodeId);
      return node || null;
    } catch (error) {
      console.error(`获取节点 ${nodeId} 失败:`, error);
      throw new Error(`获取节点失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 删除指定节点
   * @param nodeId 节点ID
   */
  public async deleteNode(nodeId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      const exists = await this.db.exists(this.NODE_STORE, nodeId);
      if (!exists) {
        console.warn(`尝试删除不存在的节点: ${nodeId}`);
        return false;
      }
      
      await this.db.delete(this.NODE_STORE, nodeId);
      console.log(`节点已删除: ${nodeId}`);
      return true;
    } catch (error) {
      console.error(`删除节点 ${nodeId} 失败:`, error);
      throw new Error(`删除节点失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 查询节点
   * @param options 查询选项
   * @returns 符合条件的节点数组
   */
  public async queryNodes(options: NavDataQueryOptions): Promise<NavNode[]> {
    await this.ensureInitialized();
    
    try {
      // 基于索引快速查询
      let nodes: NavNode[] = [];
      
      // 如果有会话ID，使用会话ID索引
      if (options.sessionId) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'sessionId', options.sessionId);
      } 
      // 如果有标签页ID，使用标签页ID索引
      else if (options.tabId !== undefined) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'tabId', options.tabId);
      }
      // 如果有URL，使用URL索引
      else if (options.url) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'url', options.url);
      }
      // 如果有类型，使用类型索引
      else if (options.type) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'type', options.type);
      }
      // 否则获取所有节点
      else {
        nodes = await this.db.getAll<NavNode>(this.NODE_STORE);
      }
      
      // 应用其他过滤条件
      if (options.startTime !== undefined) {
        nodes = nodes.filter(n => n.timestamp >= (options.startTime || 0));
      }
      
      if (options.endTime !== undefined) {
        nodes = nodes.filter(n => n.timestamp <= (options.endTime || Date.now()));
      }
      
      // 应用分页限制
      if (options.limit !== undefined && options.limit > 0) {
        nodes = nodes.slice(0, options.limit);
      }
      
      return nodes;
    } catch (error) {
      console.error('查询节点失败:', error);
      throw new Error(`查询节点失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取会话的所有节点
   * @param sessionId 会话ID
   * @returns 节点数组
   */
  public async getSessionNodes(sessionId: string): Promise<NavNode[]> {
    return this.queryNodes({ sessionId });
  }
  
  /**
   * 获取指定URL的节点
   * @param url URL
   * @returns 节点数组
   */
  public async getNodesByUrl(url: string): Promise<NavNode[]> {
    return this.queryNodes({ url });
  }
  
  /**
   * 获取指定标签页的节点
   * @param tabId 标签页ID
   * @returns 节点数组
   */
  public async getNodesByTabId(tabId: number): Promise<NavNode[]> {
    return this.queryNodes({ tabId });
  }
  
  /**
   * 保存导航边
   * @param edge 要保存的边
   */
  public async saveEdge(edge: NavLink): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.db.put(this.EDGE_STORE, edge);
      console.log(`边已保存: ${edge.id}`);
    } catch (error) {
      console.error('保存边失败:', error);
      throw new Error(`保存边失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 保存多个导航边
   * @param edges 要保存的边数组
   */
  public async saveEdges(edges: NavLink[]): Promise<void> {
    await this.ensureInitialized();
    
    try {
      for (const edge of edges) {
        await this.db.put(this.EDGE_STORE, edge);
      }
      console.log(`已保存 ${edges.length} 条边`);
    } catch (error) {
      console.error('保存多个边失败:', error);
      throw new Error(`保存多个边失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取指定ID的边
   * @param edgeId 边ID
   * @returns 边对象，如果不存在则返回null
   */
  public async getEdge(edgeId: string): Promise<NavLink | null> {
    await this.ensureInitialized();
    
    try {
      const edge = await this.db.get<NavLink>(this.EDGE_STORE, edgeId);
      return edge || null;
    } catch (error) {
      console.error(`获取边 ${edgeId} 失败:`, error);
      throw new Error(`获取边失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 删除指定边
   * @param edgeId 边ID
   */
  public async deleteEdge(edgeId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      const exists = await this.db.exists(this.EDGE_STORE, edgeId);
      if (!exists) {
        console.warn(`尝试删除不存在的边: ${edgeId}`);
        return false;
      }
      
      await this.db.delete(this.EDGE_STORE, edgeId);
      console.log(`边已删除: ${edgeId}`);
      return true;
    } catch (error) {
      console.error(`删除边 ${edgeId} 失败:`, error);
      throw new Error(`删除边失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 查询边
   * @param options 查询选项
   * @returns 符合条件的边数组
   */
  public async queryEdges(options: NavDataQueryOptions): Promise<NavLink[]> {
    await this.ensureInitialized();
    
    try {
      // 基于索引快速查询
      let edges: NavLink[] = [];
      
      // 如果有会话ID，使用会话ID索引
      if (options.sessionId) {
        edges = await this.db.getByIndex<NavLink>(this.EDGE_STORE, 'sessionId', options.sessionId);
      }
      // 如果有类型，使用类型索引
      else if (options.type) {
        edges = await this.db.getByIndex<NavLink>(this.EDGE_STORE, 'type', options.type);
      }
      // 否则获取所有边
      else {
        edges = await this.db.getAll<NavLink>(this.EDGE_STORE);
      }
      
      // 应用其他过滤条件
      if (options.startTime !== undefined) {
        edges = edges.filter(e => e.timestamp >= (options.startTime || 0));
      }
      
      if (options.endTime !== undefined) {
        edges = edges.filter(e => e.timestamp <= (options.endTime || Date.now()));
      }
      
      // 应用分页限制
      if (options.limit !== undefined && options.limit > 0) {
        edges = edges.slice(0, options.limit);
      }
      
      return edges;
    } catch (error) {
      console.error('查询边失败:', error);
      throw new Error(`查询边失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取会话的所有边
   * @param sessionId 会话ID
   * @returns 边数组
   */
  public async getSessionEdges(sessionId: string): Promise<NavLink[]> {
    return this.queryEdges({ sessionId });
  }
  
  /**
   * 获取指定源节点的所有出边
   * @param nodeId 源节点ID
   * @returns 边数组
   */
  public async getOutgoingEdges(nodeId: string): Promise<NavLink[]> {
    await this.ensureInitialized();
    
    try {
      return await this.db.getByIndex<NavLink>(this.EDGE_STORE, 'source', nodeId);
    } catch (error) {
      console.error(`获取节点 ${nodeId} 的出边失败:`, error);
      throw new Error(`获取出边失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取指定目标节点的所有入边
   * @param nodeId 目标节点ID
   * @returns 边数组
   */
  public async getIncomingEdges(nodeId: string): Promise<NavLink[]> {
    await this.ensureInitialized();
    
    try {
      return await this.db.getByIndex<NavLink>(this.EDGE_STORE, 'target', nodeId);
    } catch (error) {
      console.error(`获取节点 ${nodeId} 的入边失败:`, error);
      throw new Error(`获取入边失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取指定节点的所有相连边
   * @param nodeId 节点ID
   * @returns 边数组
   */
  public async getConnectedEdges(nodeId: string): Promise<NavLink[]> {
    await this.ensureInitialized();
    
    try {
      const outgoing = await this.getOutgoingEdges(nodeId);
      const incoming = await this.getIncomingEdges(nodeId);
      
      // 合并两个数组并去重
      const combined = [...outgoing];
      for (const edge of incoming) {
        if (!combined.some(e => e.id === edge.id)) {
          combined.push(edge);
        }
      }
      
      return combined;
    } catch (error) {
      console.error(`获取节点 ${nodeId} 的相连边失败:`, error);
      throw new Error(`获取相连边失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取会话的完整导航图
   * @param sessionId 会话ID
   * @returns 节点和边数组
   */
  public async getSessionGraph(sessionId: string): Promise<{ nodes: NavNode[]; edges: NavLink[] }> {
    await this.ensureInitialized();
    
    try {
      const nodes = await this.getSessionNodes(sessionId);
      const edges = await this.getSessionEdges(sessionId);
      
      return { nodes, edges };
    } catch (error) {
      console.error(`获取会话 ${sessionId} 的导航图失败:`, error);
      throw new Error(`获取会话导航图失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 删除会话的所有导航数据
   * @param sessionId 会话ID
   */
  public async clearSessionData(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // 获取会话的所有节点
      const nodes = await this.getSessionNodes(sessionId);
      
      // 获取会话的所有边
      const edges = await this.getSessionEdges(sessionId);
      
      // 删除所有边
      for (const edge of edges) {
        await this.db.delete(this.EDGE_STORE, edge.id);
      }
      
      // 删除所有节点
      for (const node of nodes) {
        await this.db.delete(this.NODE_STORE, node.id);
      }
      
      console.log(`已清除会话 ${sessionId} 的所有导航数据: ${nodes.length} 个节点, ${edges.length} 条边`);
    } catch (error) {
      console.error(`清除会话 ${sessionId} 数据失败:`, error);
      throw new Error(`清除会话数据失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取节点数量
   */
  public async getNodeCount(sessionId?: string): Promise<number> {
    await this.ensureInitialized();
    
    try {
      if (sessionId) {
        const nodes = await this.getSessionNodes(sessionId);
        return nodes.length;
      } else {
        return await this.db.count(this.NODE_STORE);
      }
    } catch (error) {
      console.error('获取节点数量失败:', error);
      throw new Error(`获取节点数量失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取边数量
   */
  public async getEdgeCount(sessionId?: string): Promise<number> {
    await this.ensureInitialized();
    
    try {
      if (sessionId) {
        const edges = await this.getSessionEdges(sessionId);
        return edges.length;
      } else {
        return await this.db.count(this.EDGE_STORE);
      }
    } catch (error) {
      console.error('获取边数量失败:', error);
      throw new Error(`获取边数量失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 关闭存储连接
   */
  public close(): void {
    if (this.initialized) {
      this.db.close();
      this.initialized = false;
      console.log('导航存储连接已关闭');
    }
  }
}