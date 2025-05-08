/**
 * IndexedDB数据库访问封装
 * 提供对IndexedDB的低级封装，增强类型安全
 */
import { Logger } from '../../lib/utils/logger.js';
import { DatabaseSchema, StoreDefinition } from '../../types/storage-types.js';
import { i18n, I18nError } from '../../lib/utils/i18n-utils.js';

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
      logger.debug(i18n('indexed_db_instance_created', '已创建IndexedDB存储实例: {0}'), key);
    }
    
    return this.instances.get(key)!;
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
          logger.error(i18n('background_db_open_failed', '打开数据库失败: {0}'), error);
          reject(new Error(i18n('background_db_open_failed', '打开数据库失败: {0}', error?.message || i18n('background_unknown_error', '发生未知错误'))
          ));
        };
        
        request.onupgradeneeded = (event) => {
          logger.log(i18n('indexed_db_upgrade', '正在升级数据库，从版本 {0} 到 {1}'), (event.oldVersion || 0), this.schema.version);
          const db = (event.target as IDBOpenDBRequest).result;
          
          // 升级数据库结构
          this.upgradeDatabase(db, event.oldVersion);
        };
        
        request.onsuccess = (event) => {
          this.db = request.result;
          
          // 只在第一次打开时输出日志，避免重复
          if (!this.isInitialized) {
            logger.log(i18n('indexed_db_opened', '已打开数据库 {0} (版本 {1})'), this.schema.name, this.schema.version);
          }
          
          resolve();
        };
        
        request.onerror = (event) => {
          const error = request.error;
          logger.error(i18n('background_db_open_failed', '打开数据库失败: {0}'), error);
          reject(new Error(i18n('background_db_open_failed', '打开数据库失败: {0}', error?.message || i18n('background_unknown_error', '发生未知错误'))
          ));
        };
      } catch (error) {
        logger.error(i18n('background_db_init_failed', '数据库初始化失败: {0}'), error);
        reject(new Error(i18n('background_db_init_failed', '数据库初始化失败: {0}', error instanceof Error ? error.message : i18n('background_unknown_error', '发生未知错误'))
        ));
      }
    });
  }
  
  /**
   * 关闭数据库连接
   * 同时从单例缓存中移除此实例
   */
  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      
      // 从单例缓存中移除
      const key = `${this.schema.name}_v${this.schema.version}`;
      IndexedDBStorage.instances.delete(key);
      
      logger.log(i18n('indexed_db_closed', '已关闭数据库 {0} (版本 {1})'), this.schema.name, this.schema.version);
    }
  }
  
  /**
   * 升级数据库结构
   * @param db 数据库连接
   * @param oldVersion 旧版本
   */
  private upgradeDatabase(db: IDBDatabase, oldVersion: number): void {
    // 创建所有存储对象
    for (const store of this.schema.stores) {
      this.createStore(db, store);
    }
    
    logger.log(i18n('indexed_db_upgrade_complete', '数据库升级完成'));
  }
  
  /**
   * 创建存储对象
   * @param db 数据库连接
   * @param storeDefinition 存储定义
   */
  private createStore(db: IDBDatabase, storeDefinition: StoreDefinition): void {
    // 如果存储已存在，先删除
    if (db.objectStoreNames.contains(storeDefinition.name)) {
      db.deleteObjectStore(storeDefinition.name);
      logger.log(i18n('indexed_db_store_deleted', '已删除存储对象: {0}'), storeDefinition.name);
    }
    
    // 创建存储
    const store = db.createObjectStore(storeDefinition.name, {
      keyPath: storeDefinition.keyPath,
      autoIncrement: storeDefinition.autoIncrement
    });
    
    logger.log(i18n('indexed_db_store_created', '已创建存储对象: {0}'), storeDefinition.name);
    
    // 创建索引
    if (storeDefinition.indices) {
      for (const index of storeDefinition.indices) {
        store.createIndex(index.name, index.keyPath, {
          unique: index.unique,
          multiEntry: index.multiEntry || false
        });
        
        logger.log(i18n('indexed_db_index_created', '已创建索引: {0}'), index.name);
      }
    }
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
          resolve(request.result);
        };
        
        request.onerror = () => {
          reject(new Error(i18n('background_db_add_failed', '向存储 {0} 添加数据失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          resolve(request.result);
        };
        
        request.onerror = () => {
          reject(new Error(i18n('background_db_put_failed', '更新存储 {0} 中的数据失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          reject(new Error(i18n('background_db_get_failed', '从存储 {0} 获取数据失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          reject(new Error(i18n('background_db_get_all_failed', '获取存储 {0} 的所有数据失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          reject(new Error(i18n('background_db_index_not_found', '存储 {0} 中未找到指定的索引', storeName)));
          return;
        }
        
        const index = store.index(indexName);
        const request = index.getAll(indexValue);
        
        request.onsuccess = () => {
          resolve(request.result as T[]);
        };
        
        request.onerror = () => {
          reject(new Error(i18n('background_db_get_by_index_failed', '通过索引获取存储 {0} 的数据失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          resolve();
        };
        
        request.onerror = () => {
          reject(new Error(i18n('background_db_delete_failed', '从存储 {0} 删除数据失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          resolve();
        };
        
        request.onerror = () => {
          reject(new Error(i18n('background_db_clear_failed', '清空存储 {0} 失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          reject(new Error(i18n('background_db_for_each_failed', '遍历存储 {0} 的数据失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          resolve(request.result);
        };
        
        request.onerror = () => {
          reject(new Error(i18n('background_db_count_failed', '获取存储 {0} 的记录数量失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
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
          reject(new Error(i18n('background_db_exists_failed', '检查数据在存储 {0} 中是否存在时失败', storeName)));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(i18n('background_db_transaction_error', '数据库事务错误: {0}', String(event))));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
}