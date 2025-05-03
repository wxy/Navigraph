/**
 * 会话存储实现
 * 负责会话数据的持久化存储与检索
 */
import { Logger, LogLevel } from '../../lib/utils/logger.js';
import { BrowsingSession, SessionQueryOptions, SessionCreationOptions } from '../../types/session-types.js';
import { IndexedDBStorage } from './indexed-db.js';
import { NavigraphDBSchema } from './storage-schema.js';
import { IdGenerator } from '../lib/id-generator.js';
import { i18n, I18nError } from '../../lib/utils/i18n-utils.js';

const logger = new Logger('SessionStorage');

/**
 * 会话存储类
 * 提供会话数据的持久化存储和检索功能
 */
export class SessionStorage {
  // 添加单例实例
  private static instance: SessionStorage | null = null;
  
  /**
   * 获取SessionStorage单例
   * @param db 可选的数据库实例
   * @returns SessionStorage单例实例
   */
  public static getInstance(db?: IndexedDBStorage): SessionStorage {
    if (!this.instance) {
      this.instance = new SessionStorage(db);
    }
    return this.instance;
  }
  
  // 数据库引用
  private db: IndexedDBStorage;
  
  // 存储表名
  private readonly STORE_NAME = 'sessions';
  
  // 是否已初始化
  private initialized = false;
  
  /**
   * 创建会话存储实例
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
      logger.log('session_storage_init_complete');
    } catch (error) {
      logger.error(i18n('session_storage_init_failed', error instanceof Error ? error.message : String(error)), error);
      throw new I18nError(
        'session_storage_init_failed',
        error instanceof Error ? error.message : String(error)
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
   * 保存会话
   * @param session 要保存的会话
   */
  public async saveSession(session: BrowsingSession): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.db.put(this.STORE_NAME, session);
    } catch (error) {
      logger.error(i18n('session_storage_save_failed', error instanceof Error ? error.message : String(error)), error);
      throw new I18nError(
        'session_storage_save_failed',
        error instanceof Error ? error.message : String(error)
      );
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
      logger.error(i18n('session_storage_get_failed', error instanceof Error ? error.message : String(error)), error);
      throw new I18nError(
        'session_storage_get_failed',
        error instanceof Error ? error.message : String(error)
      );
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
        
        // 日期范围过滤
        if (options.fromDate !== undefined) {
          sessions = sessions.filter(s => s.startTime >= options.fromDate!);
        }
        
        if (options.toDate !== undefined) {
          sessions = sessions.filter(s => s.startTime <= options.toDate!);
        }
        
        // 搜索过滤
        if (options.search) {
          const searchLower = options.search.toLowerCase();
          sessions = sessions.filter(s => 
            s.title.toLowerCase().includes(searchLower) || 
            s.description?.toLowerCase().includes(searchLower)
          );
        }
        
        // 应用排序
        if (options.sortBy) {
          const sortField = options.sortBy;
          const direction = options.sortOrder === 'desc' ? -1 : 1;
          
          sessions.sort((a, b) => {
            let aValue = a[sortField as keyof BrowsingSession];
            let bValue = b[sortField as keyof BrowsingSession];
            
            // 特别处理日期字段，确保是数值
            if (sortField === 'startTime' || sortField === 'endTime' || sortField === 'lastActivity') {
              aValue = typeof aValue === 'number' ? aValue : 0;
              bValue = typeof bValue === 'number' ? bValue : 0;
            }
            
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
        
        // 应用分页
        if (options.offset !== undefined && options.offset > 0) {
          sessions = sessions.slice(options.offset);
        }
        
        // 应用限制
        if (options.limit !== undefined && options.limit > 0) {
          sessions = sessions.slice(0, options.limit);
        }
      }
      
      return sessions;
    } catch (error) {
      logger.error(i18n('session_storage_get_list_failed', error instanceof Error ? error.message : String(error)), error);
      throw new I18nError(
        'session_storage_get_list_failed',
        error instanceof Error ? error.message : String(error)
      );
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
        logger.warn('session_storage_delete_nonexistent', sessionId);
        return false;
      }
      
      await this.db.delete(this.STORE_NAME, sessionId);
      logger.log('session_storage_deleted', sessionId);
      return true;
    } catch (error) {
      logger.error(i18n('session_storage_delete_failed', error instanceof Error ? error.message : String(error)), error);
      throw new I18nError(
        'session_storage_delete_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 清除所有会话数据
   */
  public async clearAllSessions(): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.db.clear(this.STORE_NAME);
      logger.log('session_storage_cleared_all');
    } catch (error) {
      logger.error(i18n('session_storage_clear_failed', error instanceof Error ? error.message : String(error)), error);
      throw new I18nError(
        'session_storage_clear_failed',
        error instanceof Error ? error.message : String(error)
      );
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
      logger.error(i18n('session_storage_count_failed', error instanceof Error ? error.message : String(error)), error);
      throw new I18nError(
        'session_storage_count_failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 关闭存储连接
   */
  public close(): void {
    if (this.initialized) {
      this.db.close();
      this.initialized = false;
      logger.log('session_storage_connection_closed');
    }
  }

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
        logger.warn('session_storage_update_stats_nonexistent', sessionId);
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
      logger.log('session_storage_stats_updated', sessionId);
    } catch (error) {
      logger.error('session_storage_update_stats_failed', sessionId, error instanceof Error ? error.message : String(error));
      throw new I18nError(
        "session_storage_update_stats_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 获取当前活跃的会话
   * @returns 当前活跃会话，如果没有则返回null
   */
  public async getCurrentSession(): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      // 获取所有活跃会话
      const activeSessions = await this.getActiveSessions();
      
      // 如果有活跃会话，返回最近的一个
      if (activeSessions.length > 0) {
        // 按开始时间降序排序
        return activeSessions.sort((a, b) => b.startTime - a.startTime)[0];
      }
      
      return null;
    } catch (error) {
      logger.error('session_storage_get_current_failed', error instanceof Error ? error.message : String(error));
      throw new I18nError(
        "session_storage_get_current_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 获取当前会话ID
   * @returns 当前会话ID，如果没有活跃会话则返回空字符串
   */
  public async getCurrentSessionId(): Promise<string> {
    const session = await this.getCurrentSession();
    return session ? session.id : '';
  }
  
  /**
   * 创建新会话
   * @param options 会话创建选项
   * @returns 新创建的会话
   */
  public async createSession(options: SessionCreationOptions = {}): Promise<BrowsingSession> {
    await this.ensureInitialized();
    
    try {
      // 生成会话ID
      const sessionId = IdGenerator.generateSessionId();
      const now = Date.now();
      
      // 如果设置为活跃会话，先将其他活跃会话设为非活跃
      if (options.makeActive !== false) {
        await this.deactivateAllSessions();
      }
      
      // 创建新会话
      const newSession: BrowsingSession = {
        id: sessionId,
        title: options.title || i18n('session_storage_default_title', new Date(now).toLocaleString()),
        description: options.description || "",
        startTime: now,
        endTime: undefined,
        isActive: options.makeActive !== false,
        nodeCount: 0,
        metadata: options.metadata || {},
        records: {},
        edges: {},
        rootIds: []
      };
      
      // 保存会话
      await this.saveSession(newSession);
      
      logger.log('session_storage_created', sessionId);
      return newSession;
    } catch (error) {
      logger.error('session_storage_create_failed', error instanceof Error ? error.message : String(error));
      throw new I18nError(
        "session_storage_create_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 将所有会话设为非活跃状态
   */
  private async deactivateAllSessions(): Promise<void> {
    try {
      const activeSessions = await this.getActiveSessions();
      
      for (const session of activeSessions) {
        session.isActive = false;
        await this.saveSession(session);
      }
      
      if (activeSessions.length > 0) {
        logger.log('session_storage_deactivated_all', activeSessions.length.toString());
      }
    } catch (error) {
      logger.error('session_storage_deactivate_all_failed', error instanceof Error ? error.message : String(error));
      throw new I18nError(
        "session_storage_deactivate_all_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 结束会话
   * @param sessionId 要结束的会话ID
   */
  public async endSession(sessionId: string): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        logger.warn('session_storage_end_nonexistent', sessionId);
        return null;
      }
      
      // 设置结束时间和活跃状态
      session.endTime = Date.now();
      session.isActive = false;
      
      // 保存更新后的会话
      await this.saveSession(session);
      logger.log('session_storage_ended', sessionId);
      
      return session;
    } catch (error) {
      logger.error('session_storage_end_failed', sessionId, error instanceof Error ? error.message : String(error));
      throw new I18nError(
        "session_storage_end_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 激活会话
   * @param sessionId 要激活的会话ID
   */
  public async activateSession(sessionId: string): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      // 先将所有活跃会话设为非活跃
      await this.deactivateAllSessions();
      
      // 获取要激活的会话
      const session = await this.getSession(sessionId);
      if (!session) {
        logger.warn('session_storage_activate_nonexistent', sessionId);
        return null;
      }
      
      // 设置为活跃状态
      session.isActive = true;
      
      // 保存更新后的会话
      await this.saveSession(session);
      logger.log('session_storage_activated', sessionId);
      
      return session;
    } catch (error) {
      logger.error('session_storage_activate_failed', sessionId, error instanceof Error ? error.message : String(error));
      throw new I18nError(
        "session_storage_activate_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 清除指定会话的所有数据
   * @param sessionId 会话ID
   */
  public async clearSessionData(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // 获取会话
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new I18nError("session_storage_session_not_found", sessionId);
      }
      
      // 清空会话中的记录和边映射
      session.records = {};
      session.edges = {};
      session.rootIds = [];
      session.nodeCount = 0;
      
      // 更新会话
      await this.saveSession(session);
      
      // 调用导航存储清除相关数据
      // 注意：这里依赖于外部调用者同时清除导航存储中的数据
      
      logger.log('session_storage_data_cleared', sessionId);
    } catch (error) {
      if (error instanceof I18nError) {
        throw error; // 重新抛出已经本地化的错误
      }
      logger.error('session_storage_clear_data_failed', sessionId, error instanceof Error ? error.message : String(error));
      throw new I18nError(
        "session_storage_clear_data_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 更新会话属性
   * @param sessionId 会话ID
   * @param updates 要更新的属性
   */
  public async updateSession(sessionId: string, updates: Partial<BrowsingSession>): Promise<BrowsingSession> {
    await this.ensureInitialized();
    
    try {
      // 获取会话
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new I18nError("session_storage_session_not_found", sessionId);
      }
      
      // 应用更新
      const updateSession = {
        ...session,
        ...updates,
        // 如果提供了lastActivity，使用它
        lastActivity: updates.lastActivity !== undefined ? 
          updates.lastActivity : (session.lastActivity || session.startTime)
      };
      
      // 保存会话
      await this.saveSession(updateSession);
      
      logger.log('session_storage_updated', sessionId);
      return session;
    } catch (error) {
      if (error instanceof I18nError) {
        throw error; // 重新抛出已经本地化的错误
      }
      logger.error('session_storage_update_failed', sessionId, error instanceof Error ? error.message : String(error));
      throw new I18nError(
        "session_storage_update_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

/**
 * 获取会话存储单例的辅助函数
 */
export function getSessionStorage(db?: IndexedDBStorage): SessionStorage {
  return SessionStorage.getInstance(db);
}