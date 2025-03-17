import { 
  NavigationRecord, 
  NavigationEdge, 
  BrowsingSession,
  NavigationQueryCriteria
} from '../types/webext';
import { IdGenerator } from './id-generator.js';

/**
 * 导航数据存储管理器
 * 负责处理所有导航记录、导航边和会话的存储和检索
 */
export class NavigationStorage {
  private readonly DB_NAME = 'NavigraphDB';
  private readonly DB_VERSION = 1;
  private db: IDBDatabase | null = null;
  
  // 对象存储名称
  private readonly STORES = {
    RECORDS: 'navigationRecords',
    EDGES: 'navigationEdges',
    SESSIONS: 'sessions',
  };
  
  constructor() {}
  
  /**
   * 初始化数据库
   */
  public async initialize(): Promise<void> {
    try {
      this.db = await this.openDatabase();
      console.log('导航存储初始化成功');
    } catch (error) {
      console.error('初始化导航存储失败:', error);
      throw error;
    }
  }
  
  /**
   * 检查数据库是否已初始化
   */
  public isInitialized(): boolean {
    return !!this.db;
  }
  
  /**
   * 打开IndexedDB数据库
   */
  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      
      request.onerror = (event) => {
        reject(new Error(`打开数据库失败: ${(event.target as IDBRequest).error}`));
      };
      
      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // 创建导航记录存储
        if (!db.objectStoreNames.contains(this.STORES.RECORDS)) {
          const recordStore = db.createObjectStore(this.STORES.RECORDS, { keyPath: 'id' });
          recordStore.createIndex('tabId', 'tabId', { unique: false });
          recordStore.createIndex('url', 'url', { unique: false });
          recordStore.createIndex('timestamp', 'timestamp', { unique: false });
          recordStore.createIndex('sessionId', 'sessionId', { unique: false });
          recordStore.createIndex('parentId', 'parentId', { unique: false });
        }
        
        // 创建导航边存储
        if (!db.objectStoreNames.contains(this.STORES.EDGES)) {
          const edgeStore = db.createObjectStore(this.STORES.EDGES, { keyPath: 'id' });
          edgeStore.createIndex('sourceId', 'sourceId', { unique: false });
          edgeStore.createIndex('targetId', 'targetId', { unique: false });
          edgeStore.createIndex('timestamp', 'timestamp', { unique: false });
          edgeStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
        
        // 创建会话存储
        if (!db.objectStoreNames.contains(this.STORES.SESSIONS)) {
          const sessionStore = db.createObjectStore(this.STORES.SESSIONS, { keyPath: 'id' });
          sessionStore.createIndex('startTime', 'startTime', { unique: false });
          sessionStore.createIndex('endTime', 'endTime', { unique: false });
        }
        
        console.log('数据库架构已创建/更新');
      };
    });
  }

  /**
   * 生成节点ID
   */
  public generateNodeId(tabId: number, url: string): string {
    return IdGenerator.generateNodeId(tabId, url);
  }
  
  /**
   * 生成边ID - 使用#连接符区分
   */
  public generateEdgeId(sourceId: string, targetId: string, timestamp: number): string {
// 使用#连接符生成边ID
    return `${sourceId}#${targetId}#${timestamp}`;
  }
  
  /**
   * 生成会话ID
   */
  public generateSessionId(date: string, sequence: number = 1): string {
    return `${date}-${sequence}`;
  }
  
  /**
   * 从时间戳获取日期字符串 (YYYY-MM-DD)
   */
  public getDateFromTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  }
  
  // ===================== 记录管理 =====================
  
  /**
   * 保存导航记录
   */
  public async saveRecord(record: NavigationRecord): Promise<NavigationRecord> {
    if (!this.db) await this.initialize();
    
    try {
      // 如果记录已有ID，直接使用；否则才生成
      if (!record.id) {
        record.id = IdGenerator.generateNodeId(record.tabId, record.url);
      }
      
      // 确保有会话ID
      if (!record.sessionId) {
        const currentSession = await this.getCurrentSession();
        record.sessionId = currentSession.id;
      }
      
      const tx = this.db!.transaction(this.STORES.RECORDS, 'readwrite');
      const store = tx.objectStore(this.STORES.RECORDS);
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      return record;
    } catch (error) {
      console.error('保存导航记录失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取导航记录
   */
  public async getRecord(id: string): Promise<NavigationRecord | null> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.RECORDS, 'readonly');
      const store = tx.objectStore(this.STORES.RECORDS);
      
      return new Promise<NavigationRecord | null>((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('获取导航记录失败:', error);
      throw error;
    }
  }
  
  /**
   * 更新导航记录
   */
  public async updateRecord(id: string, updates: Partial<NavigationRecord>): Promise<NavigationRecord | null> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.RECORDS, 'readwrite');
      const store = tx.objectStore(this.STORES.RECORDS);
      
      const record = await new Promise<NavigationRecord | null>((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      if (!record) return null;
      console.log('更新导航记录:', id, updates);
      
      const updatedRecord = { ...record, ...updates };
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put(updatedRecord);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      // 更新包含此记录的会话
      if (record.sessionId) {
        try {
          // 获取会话
          const sessionTx = this.db!.transaction(this.STORES.SESSIONS, 'readwrite');
          const sessionStore = sessionTx.objectStore(this.STORES.SESSIONS);
          
          const session = await new Promise<BrowsingSession | null>((resolve, reject) => {
            const request = sessionStore.get(record.sessionId!);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
          });
          
          if (session && session.records) {
            // 更新会话中的记录
            console.log(`更新会话 ${session.id} 中的记录 ${id}`);
            session.records[id] = updatedRecord;
            
            // 保存更新的会话
            await new Promise<void>((resolve, reject) => {
              const request = sessionStore.put(session);
              request.onsuccess = () => {
                console.log(`会话 ${session.id} 中的记录已更新`);
                resolve();
              };
              request.onerror = () => reject(request.error);
            });
          }
        } catch (sessionError) {
          console.warn(`更新会话中的记录失败: ${sessionError}，但记录本身已更新`);
        }
      }
      console.log('导航记录更新成功:', updatedRecord);
      return updatedRecord;
    } catch (error) {
      console.error('更新导航记录失败:', error);
      throw error;
    }
  }
  
  /**
   * 查询导航记录
   */
  public async queryRecords(criteria: NavigationQueryCriteria): Promise<NavigationRecord[]> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.RECORDS, 'readonly');
      const store = tx.objectStore(this.STORES.RECORDS);
      
      let results: NavigationRecord[] = [];
      
      // 如果有会话ID，使用索引查询
      if (criteria.sessionId) {
        const index = store.index('sessionId');
        results = await new Promise<NavigationRecord[]>((resolve, reject) => {
          const request = index.getAll(criteria.sessionId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } else {
        // 否则获取全部并筛选
        results = await new Promise<NavigationRecord[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      
      // 应用其他过滤条件
      return results.filter(record => {
        if (criteria.url && !record.url.includes(criteria.url)) {
          return false;
        }
        
        if (criteria.tabId !== undefined && record.tabId !== criteria.tabId) {
          return false;
        }
        
        if (criteria.timeRange) {
          const [start, end] = criteria.timeRange;
          if (record.timestamp < start || record.timestamp > end) {
            return false;
          }
        }
        
        return true;
      });
    } catch (error) {
      console.error('查询导航记录失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取某标签页的最新导航记录
   */
  public async getLatestTabRecord(tabId: number): Promise<NavigationRecord | null> {
    const records = await this.queryRecords({ tabId });
    
    if (records.length === 0) return null;
    
    // 按时间戳排序并返回最新的
    return records.sort((a, b) => b.timestamp - a.timestamp)[0];
  }
  
  // ===================== 边管理 =====================
  
  /**
   * 保存导航边
   */
  public async saveEdge(edge: NavigationEdge): Promise<NavigationEdge> {
    if (!this.db) await this.initialize();
    
    try {
      // 为边生成ID (如果没有)
      if (!edge.id) {
        edge.id = this.generateEdgeId(edge.sourceId, edge.targetId, edge.timestamp);
      }
      
      // 确保有会话ID
      if (!edge.sessionId) {
        const currentSession = await this.getCurrentSession();
        edge.sessionId = currentSession.id;
      }
      
      const tx = this.db!.transaction(this.STORES.EDGES, 'readwrite');
      const store = tx.objectStore(this.STORES.EDGES);
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put(edge);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      return edge;
    } catch (error) {
      console.error('保存导航边失败:', error);
      throw error;
    }
  }
  
  /**
   * 查询导航边
   */
  public async queryEdges(criteria: NavigationQueryCriteria): Promise<NavigationEdge[]> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.EDGES, 'readonly');
      const store = tx.objectStore(this.STORES.EDGES);
      
      let results: NavigationEdge[] = [];
      
      // 如果有会话ID，使用索引查询
      if (criteria.sessionId) {
        const index = store.index('sessionId');
        results = await new Promise<NavigationEdge[]>((resolve, reject) => {
          const request = index.getAll(criteria.sessionId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } else {
        // 否则获取全部并筛选
        results = await new Promise<NavigationEdge[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      
      // 应用时间范围过滤
      if (criteria.timeRange) {
        const [start, end] = criteria.timeRange;
        results = results.filter(edge => 
          edge.timestamp >= start && edge.timestamp <= end
        );
      }
      
      return results;
    } catch (error) {
      console.error('查询导航边失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取节点的所有出边
   */
  public async getOutgoingEdges(nodeId: string): Promise<NavigationEdge[]> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.EDGES, 'readonly');
      const store = tx.objectStore(this.STORES.EDGES);
      const index = store.index('sourceId');
      
      return new Promise<NavigationEdge[]>((resolve, reject) => {
        const request = index.getAll(nodeId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('获取出边失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取节点的所有入边
   */
  public async getIncomingEdges(nodeId: string): Promise<NavigationEdge[]> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.EDGES, 'readonly');
      const store = tx.objectStore(this.STORES.EDGES);
      const index = store.index('targetId');
      
      return new Promise<NavigationEdge[]>((resolve, reject) => {
        const request = index.getAll(nodeId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('获取入边失败:', error);
      throw error;
    }
  }
  
  // ===================== 会话管理 =====================
  
  /**
   * 创建新会话
   */
  public async createSession(title?: string): Promise<BrowsingSession> {
    if (!this.db) await this.initialize();
    
    // 获取当前日期，用于会话ID生成
    const currentDate = this.getDateFromTimestamp(Date.now());
    
    const session: BrowsingSession = {
      id: this.generateSessionId(currentDate), // 传入日期参数
      title: title || currentDate,
      startTime: Date.now(),
      records: {}, // 初始化为空对象
      edges: {},   // 初始化为空对象
      rootIds: []  // 初始化为空数组
    };

    try {
      const tx = this.db!.transaction(this.STORES.SESSIONS, 'readwrite');
      const store = tx.objectStore(this.STORES.SESSIONS);
      
      await new Promise<void>((resolve, reject) => {
        const request = store.add(session);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      console.log(`已创建新会话: ${session.id}`);
      return session;
    } catch (error) {
      console.error('创建会话失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取当前活动会话
   */
  public async getCurrentSession(): Promise<BrowsingSession> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.SESSIONS, 'readonly');
      const store = tx.objectStore(this.STORES.SESSIONS);
      
      // 按开始时间降序获取所有会话
      const sessions = await new Promise<BrowsingSession[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      const sortedSessions = sessions.sort((a, b) => b.startTime - a.startTime);
      
      // 查找未结束的会话或最后一个会话
      let currentSession = sortedSessions.find(s => !s.endTime) || sortedSessions[0];
      
      // 如果没有会话或最后的会话已经结束超过4小时，创建新会话
      const FOUR_HOURS = 4 * 60 * 60 * 1000; // 4小时转毫秒
      const now = Date.now();
      
      if (!currentSession || (currentSession.endTime && (now - currentSession.endTime > FOUR_HOURS))) {
        return await this.createSession();
      }
      
      return currentSession;
    } catch (error) {
      console.error('获取当前会话失败:', error);
      return await this.createSession();
    }
  }
  
  /**
   * 更新会话结束时间
   */
  public async closeSession(sessionId: string): Promise<BrowsingSession | null> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.SESSIONS, 'readwrite');
      const store = tx.objectStore(this.STORES.SESSIONS);
      
      const session = await new Promise<BrowsingSession | null>((resolve, reject) => {
        const request = store.get(sessionId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      
      if (!session) return null;
      
      session.endTime = Date.now();
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put(session);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      return session;
    } catch (error) {
      console.error('关闭会话失败:', error);
      throw error;
    }
  }
  
  /**
   * 按日期查询会话
   */
  public async querySessionsByDate(date: string): Promise<BrowsingSession[]> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.SESSIONS, 'readonly');
      const store = tx.objectStore(this.STORES.SESSIONS);
      
      // 获取所有会话
      const sessions = await new Promise<BrowsingSession[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      // 过滤指定日期的会话
      return sessions.filter(session => {
        const sessionDate = this.getDateFromTimestamp(session.startTime);
        return sessionDate === date;
      });
    } catch (error) {
      console.error('按日期查询会话失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取会话详情
   */
  public async getSessionDetails(sessionId: string): Promise<BrowsingSession | null> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.SESSIONS, 'readonly');
      const sessionStore = tx.objectStore(this.STORES.SESSIONS);
      
      // 获取会话对象
      const session = await new Promise<BrowsingSession | null>((resolve, reject) => {
        const request = sessionStore.get(sessionId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      
      if (!session) return null;
      
      // 获取会话的所有记录和边
      const records = await this.queryRecords({ sessionId });
      const edges = await this.queryEdges({ sessionId });
      
      // 识别根节点
      const childIds = new Set<string>();
      records.forEach(record => {
        if (record.parentId) {
          childIds.add(record.id!);
        }
      });
      
      const rootIds = records
        .filter(record => !childIds.has(record.id!))
        .map(record => record.id!);
      
      // 更新会话对象
      const recordsMap: Record<string, NavigationRecord> = {};
      records.forEach(record => {
        recordsMap[record.id!] = record;
      });
      
      const edgesMap: Record<string, NavigationEdge> = {};
      edges.forEach(edge => {
        edgesMap[edge.id] = edge;
      });
      
      return {
        ...session,
        records: recordsMap,
        edges: edgesMap,
        rootIds
      };
    } catch (error) {
      console.error('获取会话详情失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取指定ID的会话
   */
  public async getSession(sessionId: string): Promise<BrowsingSession | null> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.SESSIONS, 'readonly');
      const store = tx.objectStore(this.STORES.SESSIONS);
      
      return new Promise<BrowsingSession | null>((resolve, reject) => {
        const request = store.get(sessionId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`获取会话失败: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * 添加根节点到会话
   */
  public async addRootToSession(sessionId: string, nodeId: string): Promise<void> {
    if (!this.db) await this.initialize();
    
    try {
      const session = await this.getSessionDetails(sessionId);
      if (!session) throw new Error(`会话不存在: ${sessionId}`);
      
      if (!session.rootIds) {
        session.rootIds = [];
      }
      if (!session.rootIds.includes(nodeId)) {
        session.rootIds.push(nodeId);
        
        const tx = this.db!.transaction(this.STORES.SESSIONS, 'readwrite');
        const store = tx.objectStore(this.STORES.SESSIONS);
        
        await new Promise<void>((resolve, reject) => {
          const request = store.put(session);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
    } catch (error) {
      console.error('添加根节点失败:', error);
      throw error;
    }
  }
  
  /**
   * 保存或更新会话
   */
  public async saveSession(session: BrowsingSession): Promise<void> {
    if (!this.db) await this.initialize();
    
    try {
      console.log(`保存会话: ${session.id}`);
      
      // 保存会话本身到会话存储
      const tx = this.db!.transaction(this.STORES.SESSIONS, 'readwrite');
      const store = tx.objectStore(this.STORES.SESSIONS);
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put(session);
        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.error('保存会话失败:', request.error);
          reject(request.error);
        };
      });
      
      console.log(`会话 ${session.id} 已更新`);
    } catch (error) {
      console.error('保存会话失败:', error);
      throw error;
    }
  }
  
  // ===================== 导航树构建 =====================
  
  /**
   * 构建会话的导航树
   */
  public async buildSessionNavigationTree(sessionId: string): Promise<BrowsingSession | null> {
    return await this.getSessionDetails(sessionId);
  }
  
  /**
   * 构建导航树时间范围
   */
  public async buildNavigationTreeForTimeRange(
    startTime: number, 
    endTime: number
  ): Promise<BrowsingSession[]> {
    try {
      // 查询时间范围内的所有会话
      const sessions = await this.querySessionsByTimeRange(startTime, endTime);
      
      // 获取每个会话的详情
      const sessionDetails = await Promise.all(
        sessions.map(session => this.getSessionDetails(session.id))
      );
      
      return sessionDetails.filter((s): s is BrowsingSession => s !== null);
    } catch (error) {
      console.error('构建时间范围导航树失败:', error);
      throw error;
    }
  }
  
  /**
   * 按时间范围查询会话
   */
  public async querySessionsByTimeRange(
    startTime: number, 
    endTime: number
  ): Promise<BrowsingSession[]> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.SESSIONS, 'readonly');
      const store = tx.objectStore(this.STORES.SESSIONS);
      const index = store.index('startTime');
      
      const sessions = await new Promise<BrowsingSession[]>((resolve, reject) => {
        const range = IDBKeyRange.bound(startTime, endTime);
        const request = index.getAll(range);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      return sessions;
    } catch (error) {
      console.error('查询会话列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取导航树结构
   * 返回包含节点和边的完整导航树数据
   */
  public async getNavigationTree(sessionId?: string): Promise<{
    nodes: NavigationRecord[];
    edges: NavigationEdge[];
  }> {
    try {
      // 获取当前会话或指定会话
      const session = sessionId 
        ? await this.getSession(sessionId)
        : await this.getCurrentSession();
      
      if (!session) {
        throw new Error('无法找到会话');
      }
      
      // 获取会话详情
      const sessionDetails = await this.getSessionDetails(session.id);
      
      // 添加null检查
      if (!sessionDetails) {
        throw new Error(`无法获取会话详情: ${session.id}`);
      }
      
      // 提取节点和边
      const nodes = Object.values(sessionDetails.records || {});
      const edges = Object.values(sessionDetails.edges || {});
      
      return { nodes, edges };
    } catch (error) {
      console.error('获取导航树失败:', error);
      throw error;
    }
  }

  /**
   * 清除所有导航记录
   * 谨慎使用，将删除所有导航历史数据
   */
  public async clearAllRecords(): Promise<boolean> {
    if (!this.db) await this.initialize();
    
    try {
      // 清除记录
      let tx = this.db!.transaction(this.STORES.RECORDS, 'readwrite');
      let store = tx.objectStore(this.STORES.RECORDS);
      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      // 清除边
      tx = this.db!.transaction(this.STORES.EDGES, 'readwrite');
      store = tx.objectStore(this.STORES.EDGES);
      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      // 清除会话
      tx = this.db!.transaction(this.STORES.SESSIONS, 'readwrite');
      store = tx.objectStore(this.STORES.SESSIONS);
      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      // 重新创建当前会话
      await this.createSession();
      
      return true;
    } catch (error) {
      console.error('清除所有记录失败:', error);
      return false;
    }
  }

  /**
   * 按条件查找导航记录
   * 支持更复杂的查询条件
   */
  public async findRecords(criteria: {
    url?: string;
    title?: string;
    timeRange?: [number, number]; // [startTime, endTime]
    tabIds?: number[];
    sessionIds?: string[];
    isActive?: boolean; // 是否仍处于活跃状态(未关闭)
    limit?: number;
  }): Promise<NavigationRecord[]> {
    try {
      let results: NavigationRecord[] = [];
      
      // 如果提供了会话IDs，则按会话ID过滤
      if (criteria.sessionIds && criteria.sessionIds.length > 0) {
        // 对每个会话ID执行查询
        for (const sessionId of criteria.sessionIds) {
          const sessionRecords = await this.queryRecords({ sessionId });
          results = [...results, ...sessionRecords];
        }
      } else {
        // 否则获取所有记录
        results = await this.getAllRecords();
      }
      
      // 应用过滤条件
      return results.filter(record => {
        // URL过滤
        if (criteria.url && !record.url.toLowerCase().includes(criteria.url.toLowerCase())) {
          return false;
        }
        
        // 标题过滤
        if (criteria.title && record.title && 
            !record.title.toLowerCase().includes(criteria.title.toLowerCase())) {
          return false;
        }
        
        // 时间范围过滤
        if (criteria.timeRange) {
          const [start, end] = criteria.timeRange;
          if (record.timestamp < start || record.timestamp > end) {
            return false;
          }
        }
        
        // 标签ID过滤
        if (criteria.tabIds && !criteria.tabIds.includes(record.tabId)) {
          return false;
        }
        
        // 活跃状态过滤
        if (criteria.isActive !== undefined && record.isClosed !== !criteria.isActive) {
          return false;
        }
        
        return true;
      }).slice(0, criteria.limit || Infinity);
    } catch (error) {
      console.error('查找记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有导航记录
   */
  public async getAllRecords(): Promise<NavigationRecord[]> {
    if (!this.db) await this.initialize();
    
    try {
      const tx = this.db!.transaction(this.STORES.RECORDS, 'readonly');
      const store = tx.objectStore(this.STORES.RECORDS);
      
      return new Promise<NavigationRecord[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('获取所有记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有会话列表
   */
  public async getSessions(): Promise<BrowsingSession[]> {
    try {      
      // 确保数据库已初始化
      if (!this.db) {
        console.log("getSessions: 数据库未初始化，尝试初始化");
        await this.initialize();
        
        // 再次检查
        if (!this.db) {
          console.error("getSessions: 数据库初始化失败");
          return []; // 返回空数组而不是抛出异常
        }
      }
      
      // 检查会话存储是否存在
      if (!this.db.objectStoreNames.contains(this.STORES.SESSIONS)) {
        console.error(`getSessions: 找不到会话存储 '${this.STORES.SESSIONS}'`);
        return [];
      }
      
      const tx = this.db.transaction(this.STORES.SESSIONS, 'readonly');
      const store = tx.objectStore(this.STORES.SESSIONS);
      
      // 获取所有会话记录
      const sessions = await new Promise<BrowsingSession[]>((resolve, reject) => {
        try {
          const request = store.getAll();
          
          request.onsuccess = () => {
            const result = request.result || [];
            resolve(result);
          };
          
          request.onerror = () => {
            console.error("getSessions: 查询失败", request.error);
            resolve([]); // 失败时返回空数组而不是拒绝Promise
          };
        } catch (innerError) {
          console.error("getSessions: 执行查询时出错", innerError);
          resolve([]); // 捕获任何异常并返回空数组
        }
      });
      
      // 如果没有会话，自动创建一个
      if (sessions.length === 0) {
        console.log("getSessions: 没有找到会话，创建新会话");
        try {
          const newSession = await this.createSession();
          return [newSession];
        } catch (createError) {
          console.error("getSessions: 创建新会话失败", createError);
          return [];
        }
      }
      
      // 按时间排序，最新的在前面
      const sortedSessions = sessions.sort((a, b) => b.startTime - a.startTime);
      
      return sortedSessions;
    } catch (error) {
      console.error('getSessions: 获取会话列表失败:', error);
      // 返回空数组而不是抛出异常
      return [];
    }
  }

  /**
   * 获取最近的导航记录
   * @param limit 要获取的记录数量
   * @returns 按时间戳排序的记录数组（最新优先）
   */
  public async getRecentRecords(limit: number = 10): Promise<NavigationRecord[]> {
    if (!this.db) await this.initialize();
    
    try {
      console.log(`获取最近${limit}条记录`);
      
      // 从当前会话中获取记录
      const session = await this.getCurrentSession();
      if (!session || !session.records) {
        console.log('当前会话不存在或没有记录');
        return [];
      }
      
      // 将记录转换为数组
      const records = Object.values(session.records) as NavigationRecord[];
      
      // 按时间戳排序（最新的记录优先）
      records.sort((a, b) => b.timestamp - a.timestamp);
      
      // 返回指定数量的记录
      const result = records.slice(0, limit);
      console.log(`返回${result.length}条最近记录`);
      
      return result;
    } catch (error) {
      console.error('获取最近记录失败:', error);
      return [];
    }
  }

}