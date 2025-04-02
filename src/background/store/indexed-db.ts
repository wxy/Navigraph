/**
 * IndexedDB数据库访问封装
 * 提供对IndexedDB的低级封装，增强类型安全
 */
import { Logger } from '../../lib/utils/logger.js';
import { DatabaseSchema, StoreDefinition } from '../../types/storage-types.js';
const logger = new Logger('IndexedDBStorage');
/**
 * IndexedDB存储类
 * 提供对IndexedDB的低级访问
 */
export class IndexedDBStorage {
  private db: IDBDatabase | null = null;
  private schema: DatabaseSchema;
  
  /**
   * 创建IndexedDB存储实例
   * @param schema 数据库架构
   */
  constructor(schema: DatabaseSchema) {
    this.schema = schema;
  }
  
  /**
   * 初始化数据库
   * @returns Promise，完成时数据库已初始化
   */
  public async initialize(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }
    
    return new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const request = indexedDB.open(this.schema.name, this.schema.version);
        
        request.onerror = (event) => {
          logger.error('打开数据库失败:', event);
          reject(new Error('打开数据库失败'));
        };
        
        request.onupgradeneeded = (event) => {
          logger.log(`数据库升级: ${(event.oldVersion || 0)} -> ${this.schema.version}`);
          const db = (event.target as IDBOpenDBRequest).result;
          
          // 升级数据库结构
          this.upgradeDatabase(db, event.oldVersion);
        };
        
        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          logger.log(`数据库 ${this.schema.name} v${this.schema.version} 已打开`);
          
          this.db.onerror = (event) => {
            logger.error('数据库错误:', event);
          };
          
          resolve(this.db);
        };
      } catch (error) {
        logger.error('初始化数据库失败:', error);
        reject(error);
      }
    });
  }
  
  /**
   * 关闭数据库连接
   */
  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.log('数据库连接已关闭');
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
    
    logger.log('数据库结构升级完成');
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
      logger.log(`删除已存在的存储: ${storeDefinition.name}`);
    }
    
    // 创建存储
    const store = db.createObjectStore(storeDefinition.name, {
      keyPath: storeDefinition.keyPath,
      autoIncrement: storeDefinition.autoIncrement
    });
    
    logger.log(`创建存储: ${storeDefinition.name}`);
    
    // 创建索引
    if (storeDefinition.indices) {
      for (const index of storeDefinition.indices) {
        store.createIndex(index.name, index.keyPath, {
          unique: index.unique,
          multiEntry: index.multiEntry || false
        });
        
        logger.log(`  创建索引: ${index.name}`);
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
          reject(new Error(`添加数据到 ${storeName} 失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`更新数据到 ${storeName} 失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`获取 ${storeName} 中的数据失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`获取 ${storeName} 中的所有数据失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`索引 ${indexName} 不存在于 ${storeName}`));
          return;
        }
        
        const index = store.index(indexName);
        const request = index.getAll(indexValue);
        
        request.onsuccess = () => {
          resolve(request.result as T[]);
        };
        
        request.onerror = () => {
          reject(new Error(`通过索引 ${indexName} 获取数据失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`删除 ${storeName} 中的数据失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`清空 ${storeName} 失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`遍历 ${storeName} 失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`获取 ${storeName} 记录数失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
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
          reject(new Error(`检查 ${storeName} 中的数据是否存在失败`));
        };
        
        transaction.onerror = (event) => {
          reject(new Error(`事务错误: ${event}`));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
}