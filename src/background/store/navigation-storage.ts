import { indexedNode, indexedEdge } from './graph-index.js';
import { GraphPageQuery, GraphPageResult, matchesGraphFilters, sessionMetadata } from '../../lib/graph/query.js';
import type { SessionStatistics, BrowsingSession } from '../../types/session-types.js';
/**
 * 导航存储类
 * 替代旧版storage.ts的实现，使用新的IndexedDBStorage
 */
import { Logger } from '../../lib/utils/logger.js';
import { IndexedDBStorage } from './indexed-db.js';
import { NavigraphDBSchema } from './storage-schema.js';
import { NavNode, NavLink, NavDataQueryOptions } from '../../types/session-types.js';
import { UrlUtils } from '../../lib/utils/url-utils.js';
import { _, _Error } from '../../lib/utils/i18n.js';

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
      logger.log(_('nav_storage_initialized', '导航存储已初始化'));
    } catch (error) {
      logger.error(_('nav_storage_init_failed', '初始化导航存储失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_init_failed', '初始化存储失败: {0}', error instanceof Error ? error.message : String(error)
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
  private notifyChanged(): void {
    void chrome.runtime.sendMessage({ target: 'content', action: 'refreshVisualization' }).catch(() => {});
  }

  /** Ordinary UI queries scan only covering keys and materialize the selected window. */
  public async getSessionPage(query: GraphPageQuery): Promise<GraphPageResult> {
    await this.ensureInitialized();
    return this.db.readTransaction(['nodes', 'edges', 'sessions'], (tx, done) => {
      const nodes: NavNode[] = [], edges: NavLink[] = [];
      const pageInfo = { page: query.page, limit: query.limit, total: 0, matched: 0,
        edgePage: query.edgePage, edgeLimit: Math.min(2000, query.limit * 4), edgeTotal: 0 };
      const result: GraphPageResult = { session: null, nodes, edges, pageInfo };
      done(result);
      const metadata = tx.objectStore('sessions').get(query.sessionId);
      metadata.onsuccess = () => {
        if (!metadata.result) return;
        result.session = sessionMetadata(metadata.result);
        scanNodes(false);
      };
      const range = IDBKeyRange.bound([query.sessionId], [query.sessionId, []]);
      const nodeIndex = tx.objectStore('nodes').index('pageOrder');
      let selected: string[] = [];
      const scanNodes = (clamped: boolean) => {
        selected = [];
        let matched = 0, total = 0;
        const request = nodeIndex.openKeyCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            total++;
            const key = cursor.key as [string, number, string, string, number, number];
            if (matchesGraphFilters(key[3], key[4] === 1, key[5] === 1, query.filters)) {
              if (matched >= pageInfo.page * query.limit && selected.length < query.limit) selected.push(key[2]);
              matched++;
            }
            cursor.continue();
          } else {
            pageInfo.total = total; pageInfo.matched = matched;
            const lastPage = Math.max(0, Math.ceil(matched / query.limit) - 1);
            if (!clamped && pageInfo.page > lastPage) { pageInfo.page = lastPage; scanNodes(true); return; }
            if (result.session) result.session.nodeCount = total;
            for (const [position, id] of selected.entries()) {
              const record = tx.objectStore('nodes').get(id);
              record.onsuccess = () => { if (record.result) nodes[position] = record.result; };
            }
            scanEdges(false);
          }
        };
      };
      const scanEdges = (clamped: boolean) => {
        let count = 0, sourceIndex = 0;
        const ids = new Set(selected), sources = [...selected].sort();
        const selectedEdges: string[] = [];
        const nextSource = () => {
          if (sourceIndex >= sources.length) {
            pageInfo.edgeTotal = count;
            const lastPage = Math.max(0, Math.ceil(count / pageInfo.edgeLimit) - 1);
            if (!clamped && pageInfo.edgePage > lastPage) { pageInfo.edgePage = lastPage; scanEdges(true); return; }
            for (const [position, id] of selectedEdges.entries()) {
              const record = tx.objectStore('edges').get(id);
              record.onsuccess = () => { if (record.result) edges[position] = record.result; };
            }
            return;
          }
          const source = sources[sourceIndex++];
          const request = tx.objectStore('edges').index('pageRelations').openKeyCursor(
            IDBKeyRange.bound([query.sessionId, source], [query.sessionId, source, []]));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { nextSource(); return; }
            const key = cursor.key as [string, string, string, number, string];
            if (ids.has(key[2])) {
              if (count >= pageInfo.edgePage * pageInfo.edgeLimit && selectedEdges.length < pageInfo.edgeLimit) selectedEdges.push(key[4]);
              count++;
            }
            cursor.continue();
          };
        };
        nextSource();
      };
    });
  }

  public async countSessionNodes(sessionId: string): Promise<number> {
    await this.ensureInitialized();
    return this.db.readTransaction(['nodes'], (tx, done) => {
      const request = tx.objectStore('nodes').index('pageOrder').count(IDBKeyRange.bound([sessionId], [sessionId, []]));
      request.onsuccess = () => done(request.result);
    });
  }

  /** Run-length aggregation: retain 24 hour buckets and two top-10 lists, never all URLs. */
  public async getSessionStatistics(session: BrowsingSession): Promise<SessionStatistics> {
    await this.ensureInitialized();
    return this.db.readTransaction(['nodes'], (tx, done) => {
      const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
      const topDomains: Array<{ domain: string; count: number }> = [];
      const pages: Array<{ url: string; title: string; visits: number; id: string }> = [];
      let total = 0, uniqueDomains = 0, domain: string | undefined, url: string | undefined;
      let domainCount = 0, pageCount = 0, pageId = '';
      const top = <T>(list: T[], item: T, count: (entry: T) => number) => {
        list.push(item); list.sort((a, b) => count(b) - count(a)); if (list.length > 10) list.pop();
      };
      const finishUrl = () => { if (url !== undefined && domain) top(pages, { url, title: url, visits: pageCount, id: pageId }, page => page.visits); };
      const finishDomain = () => { if (domain) { uniqueDomains++; top(topDomains, { domain, count: domainCount }, entry => entry.count); } };
      const request = tx.objectStore('nodes').index('statisticsOrder').openKeyCursor(IDBKeyRange.bound([session.id], [session.id, []]));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const key = cursor.key as [string, string, string, number, string, number];
          total++;
          if (domain !== key[1] || url !== key[2]) {
            finishUrl(); pageCount = 0; pageId = key[4]; url = key[2];
            if (domain !== key[1]) { finishDomain(); domain = key[1]; domainCount = 0; }
          }
          pageCount++; domainCount++;
          if (domain && key[5] === 1) hours[new Date(key[3]).getHours()].count++;
          cursor.continue();
        } else {
          finishUrl(); finishDomain();
          for (const page of pages) {
            const record = tx.objectStore('nodes').get(page.id);
            record.onsuccess = () => { page.title = record.result?.title || page.url; };
          }
          done({ totalNodes: total, uniqueDomains,
            duration: (session.endTime || Date.now()) - session.startTime,
            topDomains, mostVisitedPages: pages, activityByHour: hours });
        }
      };
    });
  }

  public async saveNode(node: NavNode): Promise<string> {
    await this.ensureInitialized();
    // Each visit has its own ID; only explicit updates may overwrite a visit.
    await this.db.add(this.NODE_STORE, indexedNode(node));
    this.notifyChanged();
    return node.id;
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
      if (options.sessionId && options.tabId !== undefined && options.url) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'sessionTabUrl', [options.sessionId, options.tabId, options.url]);
      } else if (options.url) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'url', options.url);
      } else if (options.tabId !== undefined) {
        nodes = await this.db.getByIndex<NavNode>(this.NODE_STORE, 'tabId', options.tabId);
      } else if (options.sessionId) {
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
      
      nodes = nodes.filter(n => (!options.sessionId || n.sessionId === options.sessionId)
        && (options.tabId === undefined || n.tabId === options.tabId)
        && (!options.url || n.url === options.url)
        && (options.isClosed === undefined || (n.isClosed === true) === options.isClosed));
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
      logger.error(_('nav_storage_query_nodes_failed', '查询节点失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_query_nodes_failed', '查询节点失败: {0}', error instanceof Error ? error.message : String(error)
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
      logger.error(_('nav_storage_get_node_failed', '获取节点失败: {0}, {1}'), id, error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_get_node_failed', '获取节点失败: {0}', error instanceof Error ? error.message : String(error)
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
      await this.db.transact(this.NODE_STORE, 'readwrite', store => {
        const request = store.get(id);
        request.onsuccess = () => {
          if (!request.result) { store.transaction.abort(); return; }
          store.put(indexedNode({ ...request.result, ...updates, id, sessionId: request.result.sessionId }));
        };
      });
      const updatedNode = { sessionId: '' };
      this.notifyChanged();
      logger.log(_('nav_storage_node_updated', '节点已更新: {0}，会话 {1}'), id, updatedNode.sessionId);
    } catch (error) {
      logger.error(_('nav_storage_update_node_failed', '更新节点失败: {0}, {1}'), id, error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_update_node_failed', '更新节点失败: {0}', error instanceof Error ? error.message : String(error)
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
      logger.log(_('nav_storage_node_deleted', '节点已删除: {0}'), id);
      return true;
    } catch (error) {
      logger.error(_('nav_storage_delete_node_failed', '删除节点失败: {0}, {1}'), id, error instanceof Error ? error.message : String(error));
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
      await this.db.put(this.EDGE_STORE, indexedEdge(edge));
      this.notifyChanged();
      logger.log(_('nav_storage_edge_saved', '边已保存: {0} ({1} -> {2})'), edge.id, edge.source, edge.target);
    } catch (error) {
      logger.error(_('nav_storage_save_edge_failed', '保存边失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_save_edge_failed', '保存边失败: {0}', error instanceof Error ? error.message : String(error)
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
      logger.error(_('nav_storage_query_edges_failed', '查询边失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_query_edges_failed', '查询边失败: {0}', error instanceof Error ? error.message : String(error)
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
      logger.error(_('nav_storage_get_edge_failed', '获取边失败: {0}, {1}'), id, error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_get_edge_failed', '获取边失败: {0}', error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 批量保存节点
   * @param nodes 节点数组
   */
  public async saveNodes(nodes: NavNode[]): Promise<void> {
    await this.ensureInitialized();
    await this.db.mutate([this.NODE_STORE], tx => {
      for (const node of nodes) tx.objectStore(this.NODE_STORE).add(indexedNode(node));
    });
  }

  /**
   * 批量保存边
   * @param edges 边数组
   */
  public async saveEdges(edges: NavLink[]): Promise<void> {
    await this.ensureInitialized();
    
    try {
      for (const edge of edges) {
        await this.db.put(this.EDGE_STORE, indexedEdge(edge));
      }
      logger.log(_('nav_storage_edges_batch_saved', '批量保存了 {0} 条边'), edges.length.toString());
    } catch (error) {
      logger.error(_('nav_storage_save_edges_batch_failed', '批量保存边失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_save_edges_batch_failed', '批量保存边失败: {0}', error instanceof Error ? error.message : String(error)
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
      const nodeMap = new Map(nodes.map(node => [node.id, node]));
      for (const edge of edges) {
        const targetNode = nodeMap.get(edge.target);
        if (targetNode && !targetNode.parentId) {
          // 设置父节点ID
          targetNode.parentId = edge.source;
        }
      }
      
      logger.log(_('nav_storage_session_graph_fetched', '已获取会话 {0} 的导航图谱: {1} 个节点, {2} 条边'), sessionId, nodes.length.toString(), edges.length.toString());
      
      return { 
        nodes,
        edges 
      };
    } catch (error) {
      logger.error(_('nav_storage_fetch_session_graph_failed', '获取会话 {0} 的导航图谱失败: {1}'), sessionId, error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_fetch_session_graph_failed', '获取会话图谱失败: {0}', error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 清除指定时间之前的导航节点数据
   * @param timestamp 时间戳
   * @returns 清除的节点数量
   */
  /** Scan covering open-state keys; load/update only nodes selected for closure. */
  public async closeMatchingOpenNodes(sessionId: string, shouldCloseTab: (tabId: number) => boolean): Promise<number> {
    await this.ensureInitialized();
    let count = 0;
    const now = Date.now();
    await this.db.mutate(['nodes'], tx => {
      const store = tx.objectStore('nodes');
      const request = store.index('openTabState').openKeyCursor(IDBKeyRange.bound([sessionId, 0], [sessionId, 0, []]));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const tabId = (cursor.key as IDBValidKey[])[2] as number;
        if (tabId === -1 || !shouldCloseTab(tabId)) { cursor.continue(); return; }
        const get = store.get(cursor.primaryKey);
        get.onsuccess = () => {
          if (get.result) { store.put(indexedNode({ ...get.result, isClosed: true, closeTime: now })); count++; }
          cursor.continue();
        };
      };
    });
    if (count) this.notifyChanged();
    return count;
  }

  /** Restore one latest visit without loading all revisits of an open tab URL. */
  public async getLatestNodeForTabUrl(sessionId: string, tabId: number, url: string): Promise<NavNode | null> {
    await this.ensureInitialized();
    return this.db.readTransaction(['nodes'], (tx, resolve) => {
      const prefix = [sessionId, tabId, url];
      const request = tx.objectStore('nodes').index('latestTabUrl').openCursor(IDBKeyRange.bound(prefix, [...prefix, []]));
      request.onsuccess = () => resolve(request.result?.value || null);
    });
  }

  /** Delete expired visits and repair graph relationships in one transaction. */
  public async purgeBeforeTime(timestamp: number): Promise<{ nodes: number; edges: number }> {
    await this.ensureInitialized();
    let nodes = 0, edges = 0;
    await this.db.mutate(['nodes', 'edges'], tx => {
      const store = tx.objectStore('nodes'), links = tx.objectStore('edges');
      // Stream only expired keys; untouched graph values are never materialized.
      const deleteEdgeKeys = (index: string, range: IDBKeyRange, done: () => void) => {
        const request = links.index(index).openKeyCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { done(); return; }
          links.delete(cursor.primaryKey); edges++; cursor.continue();
        };
      };
      const expired = store.index('timestamp').openKeyCursor(IDBKeyRange.upperBound(timestamp, true));
      expired.onsuccess = () => {
        const cursor = expired.result;
        if (!cursor) {
          deleteEdgeKeys('timestamp', IDBKeyRange.upperBound(timestamp, true), () => {});
          return;
        }
        const id = cursor.primaryKey;
        const children = store.index('parentId').openCursor(IDBKeyRange.only(id));
        children.onsuccess = () => {
          const child = children.result;
          if (child) { child.update(indexedNode({ ...child.value, parentId: '' })); child.continue(); return; }
          // Sequential indexes prevent double counting a link touching both ends.
          deleteEdgeKeys('source', IDBKeyRange.only(id), () => {
            deleteEdgeKeys('target', IDBKeyRange.only(id), () => {
              store.delete(id); nodes++; cursor.continue();
            });
          });
        };
      };
    });
    if (nodes || edges) this.notifyChanged();
    return { nodes, edges };
  }

  public async clearNodesBeforeTime(timestamp: number): Promise<number> {
    await this.ensureInitialized();
    
    try {
      logger.log(_('nav_storage_clearing_nodes_before', '清除{0}之前的所有导航节点...'), new Date(timestamp).toLocaleString());
      
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
      
      logger.log(_('nav_storage_cleared_nodes', '已清除{0}个导航节点'), deleteCount.toString());
      return deleteCount;
    } catch (error) {
      logger.error(_('nav_storage_clear_nodes_failed', '清除导航节点失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_clear_nodes_failed', '清除导航节点失败: {0}', error instanceof Error ? error.message : String(error));
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
      logger.log(_('nav_storage_clearing_edges_before', '清除{0}之前的所有导航边...'), new Date(timestamp).toLocaleString());
      
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
      
      logger.log(_('nav_storage_cleared_edges', '已清除{0}条导航边'), deleteCount.toString());
      return deleteCount;
    } catch (error) {
      logger.error(_('nav_storage_clear_edges_failed', '清除导航边失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('background_storage_clear_edges_failed', '清除导航边失败: {0}', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 清除指定会话的所有导航数据
   * @param sessionId 会话ID
   */
  public async clearSessionData(sessionId: string, deleteSession = false): Promise<void> {
    await this.ensureInitialized();
    await this.db.mutate(['nodes', 'edges', 'sessions'], tx => {
      for (const name of ['nodes', 'edges']) {
        const request = tx.objectStore(name).index('sessionId').openCursor(IDBKeyRange.only(sessionId));
        request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
      }
      if (deleteSession) tx.objectStore('sessions').delete(sessionId);
    });
    this.notifyChanged();
  }

  /**
   * 清除所有导航数据
   */
  public async clearAllData(includeSessions = false): Promise<void> {
    await this.ensureInitialized();
    const stores = includeSessions ? ['nodes', 'edges', 'sessions'] : ['nodes', 'edges'];
    await this.db.mutate(stores, tx => { for (const name of stores) tx.objectStore(name).clear(); });
    this.notifyChanged();
  }

}

/**
 * 获取导航存储单例的辅助函数
 */
export function getNavigationStorage(db?: IndexedDBStorage): NavigationStorage {
  return NavigationStorage.getInstance(db);
}