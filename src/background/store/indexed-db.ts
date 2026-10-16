import { indexedNode, indexedEdge } from './graph-index.js';
import { sessionMetadata } from '../../lib/graph/query.js';
/**
 * IndexedDB数据库访问封装
 * 提供对IndexedDB的低级封装，增强类型安全
 */
import { Logger } from '../../lib/utils/logger.js';
import { DatabaseSchema, StoreDefinition } from '../../types/storage-types.js';
import { _, _Error } from '../../lib/utils/i18n.js';

const logger = new Logger('IndexedDBStorage');

/**
 * IndexedDB存储类
 * 提供对IndexedDB的低级访问
 */
export class IndexedDBStorage {
  private db: IDBDatabase | null = null;
  private schema: DatabaseSchema;
  private initializationPromise: Promise<void> | null = null;
  private isInitialized = false;
  
  // 单例存储 - 按数据库名称缓存实例
  private static instances: Map<string, IndexedDBStorage> = new Map();
  
  /**
   * 获取数据库实例（单例模式）
   * 这是获取IndexedDBStorage实例的唯一方法
   * @param schema 数据库架构
   * @returns IndexedDBStorage实例
   */
  public static getInstance(schema: DatabaseSchema): IndexedDBStorage {
    const key = `${schema.name}_v${schema.version}`;
    
    if (!this.instances.has(key)) {
      this.instances.set(key, new IndexedDBStorage(schema));
      logger.debug(_('indexed_db_instance_created', '已创建IndexedDB存储实例: {0}'), key);
    }
    
    return this.instances.get(key)!;
  }

  /**
   * 在给定存储上创建一个事务并执行回调，回调可以在事务上下文中发起请求（readwrite/read）
   * 回调中的请求会随着事务的完成而完成，本方法返回在事务完成时解析的 Promise
   * @param storeName 存储名
   * @param mode 事务模式
   * @param callback 接收 (store, transaction) 的同步回调，用于发起请求
   */
  private graphRevision = 0;
  private pendingGraphWrites = 0;

  /** A revision is reusable only when no graph write is pending or executing. */
  public getGraphRevision(): number | null {
    return this.pendingGraphWrites ? null : this.graphRevision;
  }

  private trackGraphWrite(transaction: IDBTransaction): void {
    if (transaction.mode !== 'readwrite' || !Array.from(transaction.objectStoreNames).some(name => name === 'nodes' || name === 'edges')) return;
    this.graphRevision++;
    this.pendingGraphWrites++;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      this.pendingGraphWrites--;
      this.graphRevision++;
    };
    transaction.addEventListener('complete', finish);
    transaction.addEventListener('abort', finish);
  }

  public async transact(
    storeName: string,
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore, transaction: IDBTransaction) => void
  ): Promise<void> {
    const db = await this.getDB();

    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = db.transaction(storeName, mode);
        this.trackGraphWrite(transaction);
        const store = transaction.objectStore(storeName);

        // 执行用户回调（应在同步上下文中发起 request）
        try {
          callback(store, transaction);
        } catch (cbErr) {
          // 回调同步抛错时中止事务
          try {
            transaction.abort();
          } catch (_) {}
          reject(cbErr);
          return;
        }

        transaction.oncomplete = () => resolve();
        transaction.onerror = (ev) => {
          const err = (ev.target as IDBRequest).error;
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(err)));
        };
        transaction.onabort = (ev) => {
          const err = (ev.target as IDBRequest).error;
          reject(new _Error('background_db_transaction_aborted', '数据库事务中止: {0}', String(err)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 私有构造函数
   * 确保只能通过getInstance方法获取实例
   * @param schema 数据库架构
   */
  private constructor(schema: DatabaseSchema) {
    this.schema = schema;
  }
  
  /**
   * 初始化数据库
   * 如果已经初始化，则直接返回
   * @returns Promise，完成时数据库已初始化
   */
  public async initialize(): Promise<void> {
    // 如果已经初始化完成，直接返回
    if (this.isInitialized && this.db) {
      return;
    }
    
    // 如果正在初始化，等待初始化完成
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    // 开始初始化
    this.initializationPromise = this.openDatabase();
    
    try {
      await this.initializationPromise;
      this.isInitialized = true;
    } finally {
      this.initializationPromise = null;
    }
  }
  
  /**
   * 打开数据库连接
   */
  private async openDatabase(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        // 如果已经有打开的连接，直接返回
        if (this.db) {
          resolve();
          return;
        }
        
        const request = indexedDB.open(this.schema.name, this.schema.version);
        
        request.onerror = (event) => {
          const error = (event.target as IDBRequest).error;
          logger.error(_('background_db_open_failed', '打开数据库失败: {0}'), error);
          reject(new _Error('background_db_open_failed', '打开数据库失败: {0}', error?.message || _('background_unknown_error', '发生未知错误')
          ));
        };
        
        request.onupgradeneeded = (event) => {
          logger.log(_('indexed_db_upgrade', '正在升级数据库，从版本 {0} 到 {1}'), (event.oldVersion || 0), this.schema.version);
          const db = (event.target as IDBOpenDBRequest).result;
          
          // 升级数据库结构
          this.upgradeDatabase(db, request.transaction!);
        };
        
        request.onsuccess = (event) => {
          this.db = request.result;
          this.db.onversionchange = () => this.close();
          
          // 只在第一次打开时输出日志，避免重复
          if (!this.isInitialized) {
            logger.log(_('indexed_db_opened', '已打开数据库 {0} (版本 {1})'), this.schema.name, this.schema.version);
          }
          
          resolve();
        };
        
        request.onerror = (event) => {
          const error = request.error;
          logger.error(_('background_db_open_failed', '打开数据库失败: {0}'), error);
          reject(new _Error('background_db_open_failed', '打开数据库失败: {0}', error?.message || _('background_unknown_error', '发生未知错误')
          ));
        };
      } catch (error) {
        logger.error(_('background_db_init_failed', '数据库初始化失败: {0}'), error);
        reject(new _Error('background_db_init_failed', '数据库初始化失败: {0}', error instanceof Error ? error.message : _('background_unknown_error', '发生未知错误')
        ));
      }
    });
  }
  
  /**
   * 关闭数据库连接
   * 同时从单例缓存中移除此实例
   */
  public close(): void {
    this.graphRevision++;
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      
      // 从单例缓存中移除
      const key = `${this.schema.name}_v${this.schema.version}`;
      IndexedDBStorage.instances.delete(key);
      
      logger.log(_('indexed_db_closed', '已关闭数据库 {0} (版本 {1})'), this.schema.name, this.schema.version);
    }
  }
  
  /**
   * 升级数据库结构
   * @param db 数据库连接
   * @param oldVersion 旧版本
   */
  private upgradeDatabase(db: IDBDatabase, transaction: IDBTransaction): void {
    // 创建所有存储对象
    for (const store of this.schema.stores) {
      this.createStore(db, store, transaction);
    }
    
    if (this.schema.name === 'NavigraphDB' && this.schema.version >= 3) {
      for (const name of ['nodes', 'edges']) {
        const request = transaction.objectStore(name).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) { cursor.update(name === 'nodes' ? indexedNode(cursor.value) : indexedEdge(cursor.value)); cursor.continue(); }
        };
      }
      // Old metadata envelopes may embed graph maps. Preserve missing records before removing the envelopes.
      const sessions = transaction.objectStore('sessions').openCursor();
      sessions.onsuccess = () => {
        const cursor = sessions.result;
        if (!cursor) return;
        const sessionId = cursor.value.id;
        for (const [name, map] of [['nodes', cursor.value.records], ['edges', cursor.value.edges]] as const) {
          for (const [recordId, record] of Object.entries(map || {})) {
            if (!record || typeof record !== 'object') continue;
            const value = { ...record, id: typeof (record as { id?: unknown }).id === 'string' ? (record as { id: string }).id : recordId };
            const store = transaction.objectStore(name);
            const existing = store.getKey(value.id);
            existing.onsuccess = () => {
              if (existing.result === undefined) store.put(name === 'nodes'
                ? indexedNode({ ...value, sessionId } as any)
                : indexedEdge({ ...value, sessionId } as any));
            };
          }
        }
        cursor.update(sessionMetadata(cursor.value));
        cursor.continue();
      };
    }
    logger.log(_('indexed_db_upgrade_complete', '数据库升级完成'));
  }
  
  /**
   * 创建存储对象
   * @param db 数据库连接
   * @param storeDefinition 存储定义
   */
  private createStore(db: IDBDatabase, definition: StoreDefinition, transaction: IDBTransaction): void {
    // Upgrades only add missing stores/indexes. Existing keys and edges stay intact.
    const store = db.objectStoreNames.contains(definition.name)
      ? transaction.objectStore(definition.name)
      : db.createObjectStore(definition.name, { keyPath: definition.keyPath, autoIncrement: definition.autoIncrement });
    for (const index of definition.indices || []) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry || false });
      }
    }
  }

  public async readTransaction<T>(stores: string[], callback: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await this.getDB();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, 'readonly');
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Read aborted'));
      try { callback(tx, result => { value = result; }); } catch (error) { tx.abort(); reject(error); }
    });
  }

  /** Run a multi-store mutation, resolving only once the transaction commits. */
  public async mutate(stores: string[], callback: (transaction: IDBTransaction) => void): Promise<void> {
    const db = await this.getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      this.trackGraphWrite(tx);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Transaction aborted'));
      try { callback(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }

  /**
   * 获取数据库连接
   */
  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.initialize();
    }
    
    return this.db as IDBDatabase;
  }
  
  /**
   * 开始事务
   * @param storeName 存储名称
   * @param mode 事务模式
   * @returns 事务和存储对象
   */
  private async startTransaction(
    storeName: string, 
    mode: IDBTransactionMode = 'readonly'
  ): Promise<{ transaction: IDBTransaction; store: IDBObjectStore }> {
    const db = await this.getDB();
    const transaction = db.transaction(storeName, mode);
    this.trackGraphWrite(transaction);
    const store = transaction.objectStore(storeName);
    
    return { transaction, store };
  }
  
  /**
   * 添加数据
   * @param storeName 存储名称
   * @param data 要添加的数据
   * @returns 添加的主键
   */
  public async add<T>(storeName: string, data: T): Promise<IDBValidKey> {
    return new Promise<IDBValidKey>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName, 'readwrite');
        
        const request = store.add(data);
        
        request.onsuccess = () => {
          transaction.oncomplete = () => resolve(request.result);
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_add_failed', '向存储 {0} 添加数据失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 更新数据，如果不存在则添加
   * @param storeName 存储名称
   * @param data 要更新的数据
   * @returns 更新的主键
   */
  public async put<T>(storeName: string, data: T): Promise<IDBValidKey> {
    return new Promise<IDBValidKey>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName, 'readwrite');
        
        const request = store.put(data);
        
        request.onsuccess = () => {
          transaction.oncomplete = () => resolve(request.result);
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_put_failed', '更新存储 {0} 中的数据失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 根据ID获取数据
   * @param storeName 存储名称
   * @param key 主键
   * @returns 查询结果
   */
  public async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise<T | undefined>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName);
        
        const request = store.get(key);
        
        request.onsuccess = () => {
          resolve(request.result as T | undefined);
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_get_failed', '从存储 {0} 获取数据失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 获取存储中的所有数据
   * @param storeName 存储名称
   * @returns 所有数据的数组
   */
  public async getAll<T>(storeName: string): Promise<T[]> {
    return new Promise<T[]>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName);
        
        const request = store.getAll();
        
        request.onsuccess = () => {
          resolve(request.result as T[]);
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_get_all_failed', '获取存储 {0} 的所有数据失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 使用索引查询数据
   * @param storeName 存储名称
   * @param indexName 索引名称
   * @param indexValue 索引值
   * @returns 查询结果数组
   */
  public async getByIndex<T>(
    storeName: string, 
    indexName: string, 
    indexValue: IDBValidKey
  ): Promise<T[]> {
    return new Promise<T[]>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName);
        
        if (!store.indexNames.contains(indexName)) {
          reject(new _Error('background_db_index_not_found', '存储 {0} 中未找到指定的索引 {1}', storeName, indexName));
          return;
        }
        
        const index = store.index(indexName);
        const request = index.getAll(indexValue);
        
        request.onsuccess = () => {
          resolve(request.result as T[]);
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_get_by_index_failed', '通过索引获取存储 {0} 的数据失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 删除数据
   * @param storeName 存储名称
   * @param key 主键
   */
  public async delete(storeName: string, key: IDBValidKey): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName, 'readwrite');
        
        const request = store.delete(key);
        
        request.onsuccess = () => {
          transaction.oncomplete = () => resolve();
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_delete_failed', '从存储 {0} 删除数据失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 清空存储
   * @param storeName 存储名称
   */
  public async clear(storeName: string): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName, 'readwrite');
        
        const request = store.clear();
        
        request.onsuccess = () => {
          transaction.oncomplete = () => resolve();
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_clear_failed', '清空存储 {0} 失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 使用游标遍历数据
   * @param storeName 存储名称
   * @param callback 处理每个结果的回调函数
   */
  public async forEachRecord<T>(
    storeName: string, 
    callback: (item: T) => void
  ): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName);
        
        const request = store.openCursor();
        
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
          if (cursor) {
            callback(cursor.value as T);
            cursor.continue();
          } else {
            resolve();
          }
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_for_each_failed', '遍历存储 {0} 的数据失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 高级查询
   * @param storeName 存储名称
   * @param queryFn 查询函数
   * @returns 符合条件的结果
   */
  public async query<T>(
    storeName: string, 
    queryFn: (item: T) => boolean
  ): Promise<T[]> {
    return new Promise<T[]>(async (resolve, reject) => {
      try {
        const results: T[] = [];
        
        await this.forEachRecord<T>(storeName, (item) => {
          if (queryFn(item)) {
            results.push(item);
          }
        });
        
        resolve(results);
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 获取存储中的记录数量
   * @param storeName 存储名称
   * @returns 记录数量
   */
  public async count(storeName: string): Promise<number> {
    return new Promise<number>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName);
        
        const request = store.count();
        
        request.onsuccess = () => {
          transaction.oncomplete = () => resolve(request.result);
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_count_failed', '获取存储 {0} 的记录数量失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 检查数据是否存在
   * @param storeName 存储名称
   * @param key 主键
   * @returns 是否存在
   */
  public async exists(storeName: string, key: IDBValidKey): Promise<boolean> {
    return new Promise<boolean>(async (resolve, reject) => {
      try {
        const { transaction, store } = await this.startTransaction(storeName);
        
        const request = store.count(key);
        
        request.onsuccess = () => {
          resolve(request.result > 0);
        };
        
        request.onerror = () => {
          reject(new _Error('background_db_exists_failed', '检查数据在存储 {0} 中是否存在时失败', storeName));
        };
        
        transaction.onabort = transaction.onerror = (event) => {
          reject(new _Error('background_db_transaction_error', '数据库事务错误: {0}', String(event)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
}