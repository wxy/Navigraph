/**
 * 会话存储实现
 * 负责会话数据的持久化存储与检索
 */

import { BrowsingSession, SessionQueryOptions } from '../../types/session-types';
import { IndexedDBStorage } from './indexed-db.js';
import { StorageSchema } from './storage-schema.js';

/**
 * 会话存储类
 * 提供会话数据的持久化存储和检索功能
 */
export class SessionStorage {
  // 数据库引用
  private db: IndexedDBStorage;
  
  // 存储表名
  private readonly STORE_NAME = 'sessions';
  
  // 是否已初始化
  private initialized = false;
  
  /**
   * 创建会话存储实例
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
      console.log('会话存储已初始化');
    } catch (error) {
      console.error('初始化会话存储失败:', error);
      throw new Error(`初始化会话存储失败: ${error instanceof Error ? error.message : String(error)}`);
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
   * 保存会话
   * @param session 要保存的会话
   */
  public async saveSession(session: BrowsingSession): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.db.put(this.STORE_NAME, session);
      console.log(`会话已保存: ${session.id}`);
    } catch (error) {
      console.error('保存会话失败:', error);
      throw new Error(`保存会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取指定ID的会话
   * @param sessionId 会话ID
   * @returns 会话对象，如果不存在则返回null
   */
  public async getSession(sessionId: string): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      const session = await this.db.get<BrowsingSession>(this.STORE_NAME, sessionId);
      return session || null;
    } catch (error) {
      console.error(`获取会话 ${sessionId} 失败:`, error);
      throw new Error(`获取会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取所有会话
   * @param options 查询选项
   * @returns 会话数组
   */
  public async getSessions(options?: SessionQueryOptions): Promise<BrowsingSession[]> {
    await this.ensureInitialized();
    
    try {
      // 获取所有会话
      let sessions = await this.db.getAll<BrowsingSession>(this.STORE_NAME);
      
      // 应用过滤器
      if (options) {
        // 是否包含非活跃会话
        if (options.includeInactive === false) {
          sessions = sessions.filter(session => session.isActive);
        }
        
        // 应用其他过滤条件
        if (options.filter) {
          const filter = options.filter;
          
          if (filter.startAfter !== undefined) {
            sessions = sessions.filter(s => s.startTime >= (filter.startAfter || 0));
          }
          
          if (filter.startBefore !== undefined) {
            sessions = sessions.filter(s => s.startTime <= (filter.startBefore || Date.now()));
          }
          
          if (filter.endAfter !== undefined) {
            sessions = sessions.filter(s => !s.endTime || s.endTime >= (filter.endAfter || 0));
          }
          
          if (filter.endBefore !== undefined) {
            sessions = sessions.filter(s => s.endTime && s.endTime <= (filter.endBefore || Date.now()));
          }
          
          if (filter.title) {
            const titleLower = filter.title.toLowerCase();
            sessions = sessions.filter(s => s.title.toLowerCase().includes(titleLower));
          }
          
          if (filter.tags && filter.tags.length > 0) {
            sessions = sessions.filter(s => {
              const sessionTags = s.metadata?.tags || [];
              return filter.tags!.some(tag => sessionTags.includes(tag));
            });
          }
          
          if (filter.category) {
            sessions = sessions.filter(s => s.metadata?.category === filter.category);
          }
        }
        
        // 应用排序
        if (options.sortBy) {
          const sortField = options.sortBy;
          const direction = options.sortDirection === 'desc' ? -1 : 1;
          
          sessions.sort((a, b) => {
            const aValue = a[sortField];
            const bValue = b[sortField];
            
            // 处理可能的undefined值
            if (aValue === undefined && bValue === undefined) return 0;
            if (aValue === undefined) return direction;
            if (bValue === undefined) return -direction;
            
            if (aValue < bValue) return -1 * direction;
            if (aValue > bValue) return 1 * direction;
            return 0;
          });
        } else {
          // 默认按开始时间降序排列（最新的排在前面）
          sessions.sort((a, b) => b.startTime - a.startTime);
        }
        
        // 应用限制
        if (options.limit && options.limit > 0) {
          sessions = sessions.slice(0, options.limit);
        }
      }
      
      return sessions;
    } catch (error) {
      console.error('获取会话列表失败:', error);
      throw new Error(`获取会话列表失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 删除会话
   * @param sessionId 要删除的会话ID
   * @returns 是否成功删除
   */
  public async deleteSession(sessionId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      // 检查会话是否存在
      const exists = await this.db.exists(this.STORE_NAME, sessionId);
      if (!exists) {
        console.warn(`尝试删除不存在的会话: ${sessionId}`);
        return false;
      }
      
      await this.db.delete(this.STORE_NAME, sessionId);
      console.log(`会话已删除: ${sessionId}`);
      return true;
    } catch (error) {
      console.error(`删除会话 ${sessionId} 失败:`, error);
      throw new Error(`删除会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 清除所有会话数据
   */
  public async clearAllSessions(): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.db.clear(this.STORE_NAME);
      console.log('所有会话数据已清除');
    } catch (error) {
      console.error('清除会话数据失败:', error);
      throw new Error(`清除会话数据失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取活跃会话
   * @returns 活跃会话数组
   */
  public async getActiveSessions(): Promise<BrowsingSession[]> {
    return this.getSessions({ includeInactive: false });
  }
  
  /**
   * 获取会话总数
   * @returns 会话数量
   */
  public async getSessionCount(): Promise<number> {
    await this.ensureInitialized();
    
    try {
      return await this.db.count(this.STORE_NAME);
    } catch (error) {
      console.error('获取会话数量失败:', error);
      throw new Error(`获取会话数量失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 关闭存储连接
   */
  public close(): void {
    if (this.initialized) {
      this.db.close();
      this.initialized = false;
      console.log('会话存储连接已关闭');
    }
  }

  // 添加新方法
  /**
   * 更新会话统计信息
   * @param sessionId 会话ID
   * @param stats 统计数据
   */
  public async updateSessionStats(sessionId: string, stats: {
    nodeCount?: number;
    recordCount?: number;
  }): Promise<void> {
    await this.ensureInitialized();
    
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        console.warn(`更新统计信息失败: 会话 ${sessionId} 不存在`);
        return;
      }
      
      // 更新统计字段
      if (stats.nodeCount !== undefined) {
        session.nodeCount = stats.nodeCount;
      }
      
      // 兼容旧字段
      if (stats.recordCount !== undefined) {
        (session as any).recordCount = stats.recordCount;
      }
      
      await this.saveSession(session);
      console.log(`会话 ${sessionId} 统计信息已更新`);
    } catch (error) {
      console.error(`更新会话 ${sessionId} 统计信息失败:`, error);
      throw new Error(`更新会话统计信息失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}