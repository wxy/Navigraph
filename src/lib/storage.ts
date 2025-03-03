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
      // 获取所有记录
      const allRecords = await this.getAllRecords();
      
      // 获取所有父子关系
      const parentChildRelations = await this.getParentChildRelations();
      console.log('获取到父子关系数据:', Object.keys(parentChildRelations).length, '条');
      
      // 创建所有节点的索引，方便快速查找
      const globalNodeIndex: Record<string, { record: NavigationRecord }> = {};
      allRecords.forEach(record => {
        const nodeId = `${record.tabId}-${record.timestamp}`;
        globalNodeIndex[nodeId] = { record };
      });
      
      // 按日期分组
      const recordsByDate = this.groupRecordsByDate(allRecords);
      
      // 构建序列化导航树 - 新结构
      const tree: SerializedNavigationTree = { days: {} };
      
      // 处理每个日期分组
      Object.entries(recordsByDate).forEach(([date, dateRecords]) => {
        // 创建日期节点
        tree.days[date] = {
          rootNodeIds: [], // 初始为空，将在后面填充
          nodes: {}       // 所有节点
        };
        
        // 排序记录（按时间升序）
        dateRecords.sort((a, b) => a.timestamp - b.timestamp);
        
        // 先创建所有节点
        dateRecords.forEach(record => {
          const nodeId = `${record.tabId}-${record.timestamp}`;
          tree.days[date].nodes[nodeId] = {
            id: nodeId,
            depth: 0, // 初始深度为0，在构建树时更新
            record,
            children: [] // 这里类型应该是NavigationNode[]
          };
        });
        
        // 初步确定可能的根节点
        const potentialRootNodeIds: string[] = [];
        
        // 如果有明确的根节点（新标签页）
        const rootRecords = dateRecords.filter(r => r.isNewTab || !r.parentTabId);
        if (rootRecords.length > 0) {
          rootRecords.forEach(rootRecord => {
            const rootNodeId = `${rootRecord.tabId}-${rootRecord.timestamp}`;
            potentialRootNodeIds.push(rootNodeId);
          });
        } 
        // 否则使用每个标签页的第一条记录
        else {
          const recordsByTab = this.groupRecordsByTab(dateRecords);
          Object.entries(recordsByTab).forEach(([_, tabRecords]) => {
            if (tabRecords.length > 0) {
              tabRecords.sort((a, b) => a.timestamp - b.timestamp);
              const firstRecord = tabRecords[0];
              const rootNodeId = `${firstRecord.tabId}-${firstRecord.timestamp}`;
              potentialRootNodeIds.push(rootNodeId);
            }
          });
        }
        
        // 构建父子关系前，先追踪哪些节点会成为子节点
        const childNodeIds = new Set<string>();
        
        // 构建父子关系
        this.buildDayTree(
          dateRecords,
          tree.days[date].nodes,
          parentChildRelations,
          globalNodeIndex,
          childNodeIds // 新增参数，传入集合用于收集子节点ID
        );
        
        // 修改这部分代码，避免节点消失
        const filteredRootNodeIds = potentialRootNodeIds.filter(id => {
          // 如果节点是子节点，但在当前日期中找不到其父节点，则保留为根节点
          if (childNodeIds.has(id)) {
            // 检查是否有父节点在当前日期中
            const hasVisibleParentInCurrentDay = Object.values(tree.days[date].nodes).some(node => 
              node.children && node.children.includes(id)
            );
            
            // 如果在当前日期中找不到可见的父节点，则保留为根节点
            return !hasVisibleParentInCurrentDay;
          }
          // 其他情况（不是子节点或其他情况）保留为根节点
          return true;
        });
        
        // 简化孤立节点处理逻辑
        // 先获取所有节点ID
        const allNodeIds = Object.keys(tree.days[date].nodes);
        
        // 找出已经作为根节点或子节点处理过的节点ID
        const processedNodeIds = new Set([
          ...filteredRootNodeIds,
          ...Array.from(childNodeIds).filter(id => {
            return Object.values(tree.days[date].nodes).some(node => 
              node.children && node.children.includes(id)
            );
          })
        ]);
        
        // 找出未处理的节点（真正孤立的节点）
        const orphanNodeIds = allNodeIds.filter(id => !processedNodeIds.has(id));
        
        // 将孤立节点添加为根节点
        orphanNodeIds.forEach(id => {
          console.log(`日期 ${date}: 添加孤立节点 ${id} 到根节点列表`);
          tree.days[date].rootNodeIds.push(id);
        });
        
        tree.days[date].rootNodeIds = filteredRootNodeIds;
        
        console.log(`日期 ${date}: 潜在根节点 ${potentialRootNodeIds.length}个, ` + 
                    `过滤后根节点 ${filteredRootNodeIds.length}个, ` +
                    `孤立节点 ${orphanNodeIds.length}个, ` +
                    `最终根节点 ${tree.days[date].rootNodeIds.length}个`);
      });
      
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
    parentChildRelations?: Record<string, any>,
    globalNodeIndex?: Record<string, { record: NavigationRecord }>,
    childNodeIds?: Set<string> // 新增参数，用于收集子节点ID
  ): void {
    // 所有节点按时间排序
    records.sort((a, b) => a.timestamp - b.timestamp);
    
    // 构建父子关系
    records.forEach((record, index) => {
      if (index === 0) return; // 跳过第一条记录
      
      const nodeId = `${record.tabId}-${record.timestamp}`;
      const currentNode = nodes[nodeId];
      
      // 跳过不存在的节点
      if (!currentNode) return;
      
      // 寻找合适的父节点
      let parentNodeId: string | null = null;
      let parentNode: NavigationNode | null = null; // 新增变量保存父节点引用
      
      // 首先检查是否有明确设置的父子关系
      const tabIdStr = record.tabId.toString();
      if (parentChildRelations && parentChildRelations[tabIdStr]) {
        const relation = parentChildRelations[tabIdStr];
        parentNodeId = relation.parentNodeId;
        
        // 检查父节点是否存在
        if (parentNodeId && nodes[parentNodeId]) {
          parentNode = nodes[parentNodeId]; // 保存父节点引用
          console.log(`应用父子关系: ${parentNodeId} -> ${nodeId}`);
        } else {
          console.log(`找到父节点关系 ${parentNodeId}，但该节点不存在，尝试默认逻辑`);
          parentNodeId = null;
        }
      }
      
      // 如果没有明确的父子关系，使用默认逻辑
      if (!parentNodeId) {
        // 如果有parentTabId且不是自己，查找该父标签的最近一条记录
        if (record.parentTabId && record.parentTabId !== record.tabId) {
          const parentRecords = records.filter(
            r => r.tabId === record.parentTabId && r.timestamp < record.timestamp
          );
          
          if (parentRecords.length > 0) {
            // 找出时间上最近的父记录
            const parentRecord = parentRecords.sort(
              (a, b) => b.timestamp - a.timestamp
            )[0];
            
            parentNodeId = `${parentRecord.tabId}-${parentRecord.timestamp}`;
            parentNode = nodes[parentNodeId]; // 保存父节点引用
          }
        }
        
        // 如果没有找到父标签页记录，则尝试使用同一标签页的前一条记录
        if (!parentNodeId) {
          const prevRecords = records.filter(
            r => r.tabId === record.tabId && r.timestamp < record.timestamp
          );
          
          if (prevRecords.length > 0) {
            const prevRecord = prevRecords.sort(
              (a, b) => b.timestamp - a.timestamp
            )[0]; 
            
            parentNodeId = `${prevRecord.tabId}-${prevRecord.timestamp}`;
            parentNode = nodes[parentNodeId]; // 保存父节点引用
          }
        }
      }
      
      // 将当前节点添加为父节点的子节点
      if (parentNode) {
        // 添加子节点
        if (!parentNode.children.includes(nodeId)) { // 避免重复添加
          parentNode.children.push(nodeId);
        }
        
        // 记录此节点已成为子节点
        if (childNodeIds) {
          childNodeIds.add(nodeId);
        }
      } else {
        // 如果没有找到父节点，记录下来，便于调试
        console.log(`节点 ${nodeId} (${record.title || record.url}) 没有找到父节点`);
      }
      
      // 更新当前节点的深度
      currentNode.depth = parentNode ? parentNode.depth + 1 : 0;
    });
    
    // 检查是否有孤立节点（不是任何节点的子节点也不是根节点）
    if (childNodeIds) {
      let orphanCount = 0;
      Object.keys(nodes).forEach(nodeId => {
        if (!childNodeIds.has(nodeId)) {
          // 这是一个潜在的根节点或孤立节点
          orphanCount++;
        }
      });
      console.log(`潜在根节点/孤立节点数量: ${orphanCount}`);
    }
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
        
        return true;
      }});
    } catch (error) {
      console.error('查找记录失败:', error);
      return [];
    }
  }

  /**
   * 设置父子节点关系
   */
  public async setParentChildRelation(
    parentNodeId: string, 
    childTabId: string,
    parentUrl: string,
    parentTitle: string
  ): Promise<void> {
    try {
      // 保存映射关系，用于构建树
      const key = `relation:${childTabId}`;
      const relation = {
        parentNodeId,
        childTabId,
        parentUrl,
        parentTitle,
        timestamp: Date.now()
      };
      
      await chrome.storage.local.set({ [key]: relation });
      console.log(`已保存父子关系: ${parentNodeId} -> ${childTabId}`);
    } catch (error) {
      console.error('保存父子关系失败:', error);
    }
  }

  /**
   * 获取标签页的所有父节点关系
   */
  private async getParentChildRelations(): Promise<Record<string, any>> {
    try {
      // 获取所有以 "relation:" 开头的键
      const allData = await chrome.storage.local.get(null);
      const relations: Record<string, any> = {};
      
      for (const key in allData) {
        if (key.startsWith('relation:')) {
          relations[key.replace('relation:', '')] = allData[key];
        }
      }
      
      return relations;
    } catch (error) {
      console.error('获取父子关系失败:', error);
      return {};
    }
  }
}