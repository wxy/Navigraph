import { 
  NavigationRecord, 
  NavigationNode, 
  TabGroup, 
  DayGroup, 
  SerializedNavigationTree 
} from '../types/webext';

export class SecureStorage {
  private dbName: string = 'navigraph';
  private dbVersion: number = 1;
  private storeName: string = 'navigation_records';
  private db: IDBDatabase | null = null;

  /**
   * 初始化IndexedDB数据库
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(new Error('无法打开数据库'));
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          
          // 创建索引方便查询
          store.createIndex('tabId', 'tabId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('date', 'date', { unique: false });
        }
      };
      
      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        console.log('数据库初始化成功');
        resolve(this.db);
      };
    });
  }

  /**
   * 保存导航记录
   */
  public async saveRecord(record: NavigationRecord): Promise<number> {
    try {
      // 添加日期字段，用于按日期分组
      const recordWithDate = {
        ...record,
        date: new Date(record.timestamp).toISOString().split('T')[0]
      };
      
      const db = await this.initDB();
      
      return new Promise<number>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const request = store.add(recordWithDate);
        
        request.onsuccess = () => {
          const id = request.result as number;
          console.log('保存导航记录成功，ID:', id);
          resolve(id);
        };
        
        request.onerror = () => {
          console.error('保存导航记录失败:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('保存记录时出错:', error);
      throw error;
    }
  }

  /**
   * 获取所有记录
   */
  public async getAllRecords(): Promise<NavigationRecord[]> {
    try {
      const db = await this.initDB();
      
      return new Promise<NavigationRecord[]>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const request = store.getAll();
        
        request.onsuccess = () => {
          const records = request.result || [];
          console.log(`获取到 ${records.length} 条记录`);
          resolve(records);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('获取所有记录失败:', error);
      return [];
    }
  }

  /**
   * 清空所有记录
   */
  public async clearAllRecords(): Promise<boolean> {
    try {
      const db = await this.initDB();
      
      return new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const request = store.clear();
        
        request.onsuccess = () => {
          console.log('所有导航记录已清除');
          resolve(true);
        };
        
        request.onerror = (e) => {
          console.error('清除记录失败:', e);
          reject(e);
        };
      });
    } catch (error) {
      console.error('清除所有记录失败:', error);
      return false;
    }
  }

  /**
   * 清理旧记录
   * @param timestamp 指定时间戳之前的记录将被清除
   */
  public async cleanupOldRecords(timestamp: number): Promise<number> {
    try {
      const db = await this.initDB();
      
      return new Promise<number>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const index = store.index('timestamp');
        
        // 使用IDBKeyRange查询旧记录
        const range = IDBKeyRange.upperBound(timestamp);
        const request = index.openCursor(range);
        
        let deletedCount = 0;
        
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
          
          if (cursor) {
            // 删除当前记录
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            // 完成删除
            console.log(`清理了 ${deletedCount} 条旧记录`);
            resolve(deletedCount);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('清理旧记录失败:', error);
      return 0;
    }
  }

  /**
   * 获取导航树形结构
   */
  public async getNavigationTree(): Promise<SerializedNavigationTree> {
    try {
      const tree = await this.buildNavigationTree();
      
      // 在控制台输出树结构，便于调试
      console.log('导航树构建完成:', {
        dayCount: Object.keys(tree.days).length,
        firstDay: Object.keys(tree.days)[0] || '无数据',
        structure: '简化为两层：日期 -> 节点'
      });
      
      return tree;
    } catch (error) {
      console.error('获取导航树时出错:', error);
      return { days: {} };
    }
  }

  /**
   * 获取指定日期的导航树
   */
  public async getDayTree(date: string): Promise<DayGroup | null> {
    try {
      const dayRecords = await this.getRecordsByDate(date);
      if (!dayRecords || dayRecords.length === 0) {
        return null;
      }
      
      // 获取父子关系
      const parentChildRelations = await this.getParentChildRelations();
      console.log(`获取到 ${date} 的父子关系: ${Object.keys(parentChildRelations).length} 条`);
      
      // 创建树结构
      const nodes: Record<string, NavigationNode> = {};
      const childNodeIds = new Set<string>();
      
      // 构建树结构 - 确保传递父子关系参数
      this.buildDayTree(dayRecords, nodes, parentChildRelations, childNodeIds);
      
      // 找出根节点
      const rootNodeIds = Object.keys(nodes).filter(id => !childNodeIds.has(id));
      console.log(`${date} 的根节点数: ${rootNodeIds.length}`);
      
      return { nodes, rootNodeIds };
    } catch (error) {
      console.error(`获取日期树失败: ${date}`, error);
      return null;
    }
  }

  /**
   * 获取指定日期的记录
   */
  public async getRecordsForDay(dateStr: string): Promise<{
    records: NavigationRecord[];
    rootRecords: NavigationRecord[];
  }> {
    try {
      const records = await this.getRecordsByDate(dateStr);
      if (!records || records.length === 0) {
        return { records: [], rootRecords: [] };
      }
      
      // 使用新的判断标准确定根记录
      const rootRecords = records.filter((r: NavigationRecord) => this.isRootRecord(r));
      
      return { records, rootRecords };
    } catch (error) {
      console.error(`获取日期记录失败: ${dateStr}`, error);
      return { records: [], rootRecords: [] };
    }
  }

  /**
   * 按日期分组记录
   */
  private groupRecordsByDate(records: NavigationRecord[]): Record<string, NavigationRecord[]> {
    const recordsByDate: Record<string, NavigationRecord[]> = {};
    
    records.forEach(record => {
      const date = new Date(record.timestamp).toISOString().split('T')[0];
      if (!recordsByDate[date]) {
        recordsByDate[date] = [];
      }
      recordsByDate[date].push(record);
    });
    
    return recordsByDate;
  }

  /**
   * 按标签页分组记录
   */
  private groupRecordsByTab(records: NavigationRecord[]): Record<string, NavigationRecord[]> {
    const recordsByTab: Record<string, NavigationRecord[]> = {};
    
    records.forEach(record => {
      if (typeof record.tabId !== 'number') return;
      
      const tabIdStr = record.tabId.toString();
      if (!recordsByTab[tabIdStr]) {
        recordsByTab[tabIdStr] = [];
      }
      recordsByTab[tabIdStr].push(record);
    });
    
    return recordsByTab;
  }

  /**
   * 构建日期内的树结构
   */
  private buildDayTree(
    records: NavigationRecord[], 
    nodes: Record<string, NavigationNode>,
    parentChildRelations?: Record<string, string>,
    childNodeIds?: Set<string>
  ): void {
    try {
      // 按时间排序
      records.sort((a, b) => a.timestamp - b.timestamp);
      
      const explicitParentChildRelations = new Map<string, string>();
      
      // 提取明确的父子关系
      if (parentChildRelations) {
        console.log(`应用父子关系映射 - 共 ${Object.keys(parentChildRelations).length} 个关系`);
        
        Object.entries(parentChildRelations).forEach(([childId, parentId]) => {
          if (childId && parentId) {
            explicitParentChildRelations.set(childId, parentId);
            console.log(`映射父子关系: ${childId} <- ${parentId}`);
          }
        });
      }
      
      // 先创建所有节点，但不设置关系
      for (const record of records) {
        const nodeId = `${record.tabId}-${record.timestamp}`;
        if (!nodes[nodeId]) {
          nodes[nodeId] = {
            id: nodeId,
            record,
            children: [],
            depth: 0
          };
        }
      }
      
      // 收集的子节点ID，用于后面确定根节点
      const allChildIds = new Set<string>();
      
      // 构建父子关系映射 - 从子节点到父节点
      const childToParent = new Map<string, string>();
      
      // 父节点到子节点列表的映射
      const parentToChildren = new Map<string, string[]>();
      
      // 第一步：建立父子关系映射
      for (const [childId, parentId] of explicitParentChildRelations.entries()) {
        if (nodes[childId] && nodes[parentId]) {
          childToParent.set(childId, parentId);
          allChildIds.add(childId);
          
          if (!parentToChildren.has(parentId)) {
            parentToChildren.set(parentId, []);
          }
          parentToChildren.get(parentId)!.push(childId);
        }
      }
      
      // 传递收集的子节点ID
      if (childNodeIds) {
        allChildIds.forEach(id => childNodeIds.add(id));
      }
      
      // 确定根节点 - 不是任何节点的子节点
      const rootNodeIds = Object.keys(nodes).filter(id => !allChildIds.has(id));
      
      // 使用BFS计算深度，从所有根节点开始
      const queue: {id: string, depth: number}[] = [];
      rootNodeIds.forEach(id => queue.push({id, depth: 0}));
      
      // 记录已处理的节点，防止循环
      const processed = new Set<string>();
      
      // BFS算法处理所有可达节点
      while (queue.length > 0) {
        const {id, depth} = queue.shift()!;
        
        if (processed.has(id)) continue;
        
        // 获取当前节点
        const node = nodes[id];
        if (!node) continue;
        
        // 设置节点深度
        node.depth = depth;
        processed.add(id);
        
        // 获取此节点的所有子节点ID
        const children = parentToChildren.get(id) || [];
        
        // 将子节点引用存储到当前节点
        node.children = children;
        
        // 把所有子节点加入队列，深度+1
        for (const childId of children) {
          const child = nodes[childId];
          if (child) {
            queue.push({id: childId, depth: depth + 1});
          }
        }
      }
      
      // 验证深度计算的正确性
      console.log(`处理了 ${processed.size} 个节点，其中根节点 ${rootNodeIds.length} 个`);
      
      // 计算最大深度，用于调试
      let maxDepth = 0;
      for (const id in nodes) {
        if (nodes[id].depth > maxDepth) {
          maxDepth = nodes[id].depth;
        }
      }
      
      console.log(`树的最大深度: ${maxDepth}`);
      
      // 检查有无三级以上节点
      const deepNodeCount = Object.values(nodes).filter(n => n.depth > 1).length;
      console.log(`深度大于1的节点数量: ${deepNodeCount}`);
      
    } catch (error) {
      console.error('构建树结构时出错:', error);
    }
  }

  /**
   * 判断记录是否应该作为根节点
   * @param record 导航记录
   */
  private isRootRecord(record: NavigationRecord): boolean {
    // 1. 地址栏输入的页面是根节点
    if (record.navigationType === 'address_bar') {
      return true;
    }
    
    // 2. 初始页面加载是根节点
    if (record.navigationType === 'initial') {
      return true;
    }
    
    // 3. 新标签页或新窗口是根节点
    if (record.openTarget === 'new_tab' || record.openTarget === 'new_window') {
      return true;
    }
    
    // 4. 没有referrer的页面可能是根节点
    if (!record.referrer) {
      return true;
    }
    
    return false;
  }

  /**
   * 根据条件查找记录
   */
  public async findRecords(criteria: {
    url?: string;
    tabId?: number;
    timeRange?: [number, number];
  }): Promise<NavigationRecord[]> {
    try {
      const records = await this.getAllRecords();
      
      return records.filter(record => {
        // 匹配URL
        if (criteria.url && !record.url.includes(criteria.url)) {
          return false;
        }
        
        // 匹配标签页ID
        if (criteria.tabId !== undefined && record.tabId !== criteria.tabId) {
          return false;
        }
        
        // 匹配时间范围
        if (criteria.timeRange) {
          const [start, end] = criteria.timeRange;
          if (record.timestamp < start || record.timestamp > end) {
            return false;
          }
        }  // 添加缺失的闭合花括号
        
        return true;
      });
    } catch (error) {
      console.error('查找记录失败:', error);
      return [];
    }
  }

  /**
   * 设置父子关系
   */
  public async setParentChildRelation(childNodeId: string, parentNodeId: string): Promise<void> {
    try {
      if (childNodeId === parentNodeId) {
        console.error('不能将节点设为自己的父节点:', childNodeId);
        return;
      }
      
      // 检查是否会形成循环
      if (await this.wouldCreateCycle(childNodeId, parentNodeId)) {
        console.error('不能设置此父子关系，会形成循环:', childNodeId, parentNodeId);
        return;
      }
      
      // 添加明确的类型注解
      const relations: Record<string, string> = await this.get('navigation_relations') || {};
      relations[childNodeId] = parentNodeId;
      await this.set('navigation_relations', relations);
      console.log(`存储父子关系成功: 子节点=${childNodeId}, 父节点=${parentNodeId}`);
      
      // 添加验证步骤
      const updatedRelations = await this.get('navigation_relations') as Record<string, string>;
      if (updatedRelations[childNodeId] === parentNodeId) {
        console.log('父子关系验证成功');
      } else {
        console.warn('父子关系存储验证失败');
      }
    } catch (error) {
      console.error('保存父子关系失败:', error);
    }
  }

  /**
   * 检查设置父子关系是否会形成循环
   */
  private async wouldCreateCycle(childId: string, newParentId: string): Promise<boolean> {
    // 获取所有父子关系
    const relations = await this.getParentChildRelations();
    
    // 从新的父节点开始，向上遍历
    let currentId = newParentId;
    const visited = new Set<string>();
    
    while (currentId) {
      // 如果遇到了子节点，说明会形成循环
      if (currentId === childId) {
        return true;
      }
      
      // 如果已访问过此节点，说明有其他循环，也不应该添加新关系
      if (visited.has(currentId)) {
        return true;
      }
      
      visited.add(currentId);
      
      // 向上层继续检查
      currentId = relations[currentId];
      
      // 如果没有父节点了，则停止检查
      if (!currentId) break;
    }
    
    return false;
  }

  /**
   * 获取所有父子关系
   */
  public async getParentChildRelations(): Promise<Record<string, string>> {
    try {
      // 添加类型断言
      return (await this.get('navigation_relations') || {}) as Record<string, string>;
    } catch (error) {
      console.error('获取父子关系失败:', error);
      return {};
    }
  }

  /**
   * 获取存储项
   */
  private async get<T>(key: string): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      chrome.storage.local.get(key, (items) => {
        resolve(key in items ? items[key] : null);
      });
    });
  }

  /**
   * 设置存储项
   */
  private async set(key: string, value: any): Promise<void> {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    });
  }

  /**
   * 根据标签页ID获取记录
   */
  public async getRecordsByTabId(tabId: number): Promise<NavigationRecord[]> {
    try {
      const records = await this.getAllRecords();
      return records.filter(record => record.tabId === tabId);
    } catch (error) {
      console.error(`获取标签页 ${tabId} 的记录失败:`, error);
      return [];
    }
  }

  /**
   * 构建导航树 - 完整实现
   */
  private async buildNavigationTree(): Promise<SerializedNavigationTree> {
    try {
      // 获取所有记录 - 添加此行
      const records = await this.getAllRecords();
      
      // 根据日期分组记录
      const dayRecords = this.groupRecordsByDate(records);
      
      // 创建树结构
      const dayGroups: Record<string, DayGroup> = {};
      const childNodeIds = new Set<string>(); // 追踪哪些节点是子节点
      
      // 获取父子关系
      const parentChildRelations = await this.getParentChildRelations();
      console.log('获取到的父子关系数量:', Object.keys(parentChildRelations).length);
      
      // 转为日期树
      for (const date in dayRecords) {
        const nodes: Record<string, NavigationNode> = {};
        
        // 为每条记录创建节点
        dayRecords[date].forEach(record => {
          const nodeId = `${record.tabId}-${record.timestamp}`;
          
          nodes[nodeId] = {
            id: nodeId,
            record,
            children: [],
            depth: 0
          };
        });
        
        // 构建日期树 - 添加父子关系参数
        this.buildDayTree(dayRecords[date], nodes, parentChildRelations, childNodeIds);
        
        // 找出根节点 - 通过排除法：所有节点中去掉那些是子节点的
        const candidateRootIds = Object.keys(nodes).filter(id => !childNodeIds.has(id));
        
        // 可选：进一步应用根节点判定逻辑
        const rootNodeIds = candidateRootIds.filter(id => {
          const record = nodes[id].record;
          // 如果明确不是子节点，再用isRootRecord进行二次过滤
          return this.isRootRecord(record);
        });
        
        dayGroups[date] = { nodes, rootNodeIds };
      }
      
      return { days: dayGroups };
    } catch (error) {
      console.error('构建导航树失败:', error);
      return { days: {} };
    }
  }

  /**
   * 获取特定日期的记录
   * @param date 日期字符串，格式为 YYYY-MM-DD
   */
  public async getRecordsByDate(date: string): Promise<NavigationRecord[]> {
    try {
      const allRecords = await this.getAllRecords();
      
      // 过滤特定日期的记录
      const dateRecords = allRecords.filter(record => {
        const recordDate = record.date || this.getDateFromTimestamp(record.timestamp);
        return recordDate === date;
      });
      
      return dateRecords;
    } catch (error) {
      console.error(`获取日期记录失败: ${date}`, error);
      return [];
    }
  }

  /**
   * 从时间戳获取日期字符串
   */
  private getDateFromTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  }
}