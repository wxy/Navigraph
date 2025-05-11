/**
 * 导航存储类
 * 替代旧版storage.ts的实现，使用新的IndexedDBStorage
 */
import { Logger } from '../../lib/utils/logger.js';
import { IndexedDBStorage } from './indexed-db.js';
import { NavigraphDBSchema } from './storage-schema.js';
import { NavNode, NavLink, NavDataQueryOptions } from '../../types/session-types.js';
import { i18n, I18nError } from '../../lib/utils/i18n-utils.js';

const logger = new Logger('NavigationStorage');

/**
 * 导航存储类
 * 提供导航数据的访问功能
 */
export class NavigationStorage {
  // 添加单例实例
  private static instance: NavigationStorage | null = null;
  
  /**
   * 获取NavigationStorage单例
   * @param db 可选的数据库实例
   * @returns NavigationStorage单例实例
   */
  public static getInstance(db?: IndexedDBStorage): NavigationStorage {
    if (!this.instance) {
      this.instance = new NavigationStorage(db);
    }
    return this.instance;
  }
  
  // 数据库引用
  private db: IndexedDBStorage;
  
  // 存储表名
  private readonly NODE_STORE = 'nodes';
  private readonly EDGE_STORE = 'edges';
  
  // 初始化标志
  private initialized = false;
  
  /**
   * 创建导航存储实例
   */
  private constructor(db?: IndexedDBStorage) {
    // 由于不能直接创建IndexedDBStorage实例，我们需要接受已创建的实例或使用getInstance
    this.db = db || IndexedDBStorage.getInstance(NavigraphDBSchema);
  }
  
  /**
   * 初始化存储
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      // 使用getInstance获取共享实例
      if (!this.db) {
        this.db = IndexedDBStorage.getInstance(NavigraphDBSchema);
      }
      
      // 确保数据库初始化
      await this.db.initialize();
      
      this.initialized = true;
      logger.log(i18n('nav_storage_initialized', '导航存储已初始化'));
    } catch (error) {
      logger.error(i18n('nav_storage_init_failed', '初始化导航存储失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_init_failed', '初始化存储失败: {0}', error instanceof Error ? error.message : String(error))
      );
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
   */
  public async saveNode(node: NavNode): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.db.put(this.NODE_STORE, node);
      logger.log(i18n('nav_storage_node_saved', '节点已保存: {0}'), node.id);
    } catch (error) {
      logger.error(i18n('nav_storage_save_node_failed', '保存节点失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_save_node_failed', '保存节点失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 查询节点
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
      else if (options.tabId !== undefined) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'tabId', options.tabId);
      }
      else if (options.url) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'url', options.url);
      }
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
      logger.error(i18n('nav_storage_query_nodes_failed', '查询节点失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_query_nodes_failed', '查询节点失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 获取节点
   * @param id 节点ID
   */
  public async getNode(id: string): Promise<NavNode | null> {
    await this.ensureInitialized();
    
    try {
      const node = await this.db.get<NavNode>(this.NODE_STORE, id);
      return node || null;
    } catch (error) {
      logger.error(i18n('nav_storage_get_node_failed', '获取节点失败: {0}, {1}'), id, error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_get_node_failed', '获取节点失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 更新节点
   * @param id 节点ID
   * @param updates 更新内容
   */
  public async updateNode(id: string, updates: Partial<NavNode>): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // 先获取现有节点
      const existingNode = await this.getNode(id);
      if (!existingNode) {
        throw new Error(i18n('background_storage_node_not_found', '节点不存在: {0}', id));
      }
      
      // 合并更新
      const updatedNode = { ...existingNode, ...updates };
      
      // 保存更新后的节点
      await this.db.put(this.NODE_STORE, updatedNode);
      logger.log(i18n('nav_storage_node_updated', '节点已更新: {0}，会话 {1}'), id, updatedNode.sessionId);
    } catch (error) {
      if (error instanceof I18nError) {
        throw error; // 重新抛出已经本地化的错误
      }
      logger.error(i18n('nav_storage_update_node_failed', '更新节点失败: {0}, {1}'), id, error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_update_node_failed', '更新节点失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 删除节点
   * @param id 节点ID
   */
  public async deleteNode(id: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      await this.db.delete(this.NODE_STORE, id);
      logger.log(i18n('nav_storage_node_deleted', '节点已删除: {0}'), id);
      return true;
    } catch (error) {
      logger.error(i18n('nav_storage_delete_node_failed', '删除节点失败: {0}, {1}'), id, error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  
  /**
   * 保存边
   * @param edge 边信息
   */
  public async saveEdge(edge: NavLink): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.db.put(this.EDGE_STORE, edge);
      logger.log(i18n('nav_storage_edge_saved', '边已保存: {0} ({1} -> {2})'), edge.id, edge.source, edge.target);
    } catch (error) {
      logger.error(i18n('nav_storage_save_edge_failed', '保存边失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_save_edge_failed', '保存边失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 查询边
   * @param options 查询选项
   */
  public async queryEdges(options: NavDataQueryOptions): Promise<NavLink[]> {
    await this.ensureInitialized();
    
    try {
      let edges: NavLink[] = [];
      
      // 基于索引查询
      if (options.sessionId) {
        edges = await this.db.getByIndex<NavLink>(this.EDGE_STORE, 'sessionId', options.sessionId);
      }
      else if (options.source) {
        edges = await this.db.getByIndex<NavLink>(this.EDGE_STORE, 'source', options.source);
      }
      else if (options.target) {
        edges = await this.db.getByIndex<NavLink>(this.EDGE_STORE, 'target', options.target);
      }
      else {
        edges = await this.db.getAll<NavLink>(this.EDGE_STORE);
      }
      
      // 应用时间过滤
      if (options.startTime !== undefined) {
        edges = edges.filter(e => e.timestamp >= (options.startTime || 0));
      }
      
      if (options.endTime !== undefined) {
        edges = edges.filter(e => e.timestamp <= (options.endTime || Date.now()));
      }
      
      // 应用分页
      if (options.limit !== undefined && options.limit > 0) {
        edges = edges.slice(0, options.limit);
      }
      
      return edges;
    } catch (error) {
      logger.error(i18n('nav_storage_query_edges_failed', '查询边失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_query_edges_failed', '查询边失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 获取边
   * @param id 边ID
   */
  public async getEdge(id: string): Promise<NavLink | null> {
    await this.ensureInitialized();
    
    try {
      const edge = await this.db.get<NavLink>(this.EDGE_STORE, id);
      return edge || null;
    } catch (error) {
      logger.error(i18n('nav_storage_get_edge_failed', '获取边失败: {0}, {1}'), id, error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_get_edge_failed', '获取边失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 批量保存节点
   * @param nodes 节点数组
   */
  public async saveNodes(nodes: NavNode[]): Promise<void> {
    await this.ensureInitialized();
    
    try {
      for (const node of nodes) {
        await this.db.put(this.NODE_STORE, node);
      }
      logger.log(i18n('nav_storage_nodes_batch_saved', '批量保存了 {0} 个节点'), nodes.length.toString());
    } catch (error) {
      logger.error(i18n('nav_storage_save_nodes_batch_failed', '批量保存节点失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_save_nodes_batch_failed', '批量保存节点失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 批量保存边
   * @param edges 边数组
   */
  public async saveEdges(edges: NavLink[]): Promise<void> {
    await this.ensureInitialized();
    
    try {
      for (const edge of edges) {
        await this.db.put(this.EDGE_STORE, edge);
      }
      logger.log(i18n('nav_storage_edges_batch_saved', '批量保存了 {0} 条边'), edges.length.toString());
    } catch (error) {
      logger.error(i18n('nav_storage_save_edges_batch_failed', '批量保存边失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_save_edges_batch_failed', '批量保存边失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 获取会话的完整导航图谱
   * 包含所有节点和连接边
   * @param sessionId 会话ID 
   * @returns 包含节点和边的会话图谱
   */
  public async getSessionGraph(sessionId: string): Promise<{
    nodes: NavNode[];
    edges: NavLink[];
  }> {
    await this.ensureInitialized();
    
    try {
      // 获取会话的所有节点
      const nodes = await this.queryNodes({ 
        sessionId: sessionId 
      });
      
      // 获取会话的所有边
      const edges = await this.queryEdges({
        sessionId: sessionId
      });
      
      // 补全可能缺失的父节点关系
      // 如果边定义了节点关系但节点没有记录父节点
      for (const edge of edges) {
        // 找到目标节点
        const targetNode = nodes.find(node => node.id === edge.target);
        if (targetNode && !targetNode.parentId) {
          // 设置父节点ID
          targetNode.parentId = edge.source;
        }
      }
      
      logger.log(i18n('nav_storage_session_graph_fetched', '已获取会话 {0} 的导航图谱: {1} 个节点, {2} 条边'), sessionId, nodes.length.toString(), edges.length.toString());
      
      return { 
        nodes,
        edges 
      };
    } catch (error) {
      logger.error(i18n('nav_storage_fetch_session_graph_failed', '获取会话 {0} 的导航图谱失败: {1}'), sessionId, error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_fetch_session_graph_failed', '获取会话图谱失败: {0}', error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * 清除指定时间之前的导航节点数据
   * @param timestamp 时间戳
   * @returns 清除的节点数量
   */
  public async clearNodesBeforeTime(timestamp: number): Promise<number> {
    await this.ensureInitialized();
    
    try {
      logger.log(i18n('nav_storage_clearing_nodes_before', '清除{0}之前的所有导航节点...'), new Date(timestamp).toLocaleString());
      
      // 查询需要清除的节点
      const nodesToDelete = await this.queryNodes({
        endTime: timestamp
      });
      
      // 计数器
      let deleteCount = 0;
      
      // 删除每个节点
      for (const node of nodesToDelete) {
        await this.db.delete(this.NODE_STORE, node.id);
        deleteCount++;
      }
      
      logger.log(i18n('nav_storage_cleared_nodes', '已清除{0}个导航节点'), deleteCount.toString());
      return deleteCount;
    } catch (error) {
      logger.error(i18n('nav_storage_clear_nodes_failed', '清除导航节点失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_clear_nodes_failed', '清除导航节点失败: {0}', error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 清除指定时间之前的导航边数据
   * @param timestamp 时间戳
   * @returns 清除的边数量
   */
  public async clearEdgesBeforeTime(timestamp: number): Promise<number> {
    await this.ensureInitialized();
    
    try {
      logger.log(i18n('nav_storage_clearing_edges_before', '清除{0}之前的所有导航边...'), new Date(timestamp).toLocaleString());
      
      // 查询需要清除的边
      const edgesToDelete = await this.queryEdges({
        endTime: timestamp
      });
      
      // 计数器
      let deleteCount = 0;
      
      // 删除每条边
      for (const edge of edgesToDelete) {
        await this.db.delete(this.EDGE_STORE, edge.id);
        deleteCount++;
      }
      
      logger.log(i18n('nav_storage_cleared_edges', '已清除{0}条导航边'), deleteCount.toString());
      return deleteCount;
    } catch (error) {
      logger.error(i18n('nav_storage_clear_edges_failed', '清除导航边失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_clear_edges_failed', '清除导航边失败: {0}', error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 清除指定会话的所有导航数据
   * @param sessionId 会话ID
   */
  public async clearSessionData(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    
    try {
      logger.log(i18n('nav_storage_clearing_session', '正在清除会话 {0} 的导航数据...'), sessionId);
      
      // 获取会话的所有节点
      const nodes = await this.queryNodes({ sessionId });
      
      // 删除所有节点
      for (const node of nodes) {
        await this.db.delete(this.NODE_STORE, node.id);
      }
      
      // 获取会话的所有边
      const edges = await this.queryEdges({ sessionId });
      
      // 删除所有边
      for (const edge of edges) {
        await this.db.delete(this.EDGE_STORE, edge.id);
      }
      
      logger.log(i18n('nav_storage_cleared_session', '已清除会话 {0} 的导航数据: {1}个节点和{2}条边'), 
                sessionId, nodes.length.toString(), edges.length.toString());
    } catch (error) {
      logger.error(i18n('nav_storage_clear_session_failed', '清除会话 {0} 的导航数据失败: {1}'), 
                  sessionId, error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_clear_session_failed', 
                          '清除会话导航数据失败: {0}', error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 清除所有导航数据
   */
  public async clearAllData(): Promise<void> {
    await this.ensureInitialized();
    
    try {
      logger.log(i18n('nav_storage_clearing_all', '正在清除所有导航数据...'));
      
      // 清除所有节点
      await this.db.clear(this.NODE_STORE);
      
      // 清除所有边
      await this.db.clear(this.EDGE_STORE);
      
      logger.log(i18n('nav_storage_cleared_all', '已清除所有导航数据'));
    } catch (error) {
      logger.error(i18n('nav_storage_clear_failed', '清除导航数据失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new Error(i18n('background_storage_clear_failed', '清除导航数据失败: {0}', error instanceof Error ? error.message : String(error)));
    }
  }
}

/**
 * 获取导航存储单例的辅助函数
 */
export function getNavigationStorage(db?: IndexedDBStorage): NavigationStorage {
  return NavigationStorage.getInstance(db);
}