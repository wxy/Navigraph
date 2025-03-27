/**
 * 后台会话管理器
 * 负责创建、管理和维护浏览会话
 */

import { IdGenerator } from './id-generator.js';
import { SessionStorage } from './session-storage.js';
import { NavigationStorage, NavNode, NavLink } from './navigation-storage.js';
import { sessionEvents } from './session-event-emitter.js';
import { BackgroundMessageService } from './bg-message-service.js';
import { 
  BrowsingSession, 
  SessionCreationOptions, 
  SessionQueryOptions, 
  SessionUpdateOptions, 
  SessionStatistics 
} from '../../types/session-types.js';
import {
  GetSessionsRequest,
  GetSessionsResponse,
  GetSessionDetailsRequest,
  GetSessionDetailsResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  UpdateSessionRequest,
  UpdateSessionResponse,
  EndSessionRequest,
  EndSessionResponse,
  SetCurrentSessionRequest,
  SetCurrentSessionResponse,
  GetCurrentSessionRequest,
  GetCurrentSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
  GetSessionStatsRequest,
  GetSessionStatsResponse
} from '../../types/message-types.js';

/**
 * 后台会话管理器类
 * 负责会话的创建、更新、删除和查询等操作
 */
export class BackgroundSessionManager {
  // 存储引用
  private storage: SessionStorage;
  
  // ID生成器
  private idGenerator: IdGenerator;
  
  // 当前激活的会话ID
  private currentSessionId: string | null = null;
  
  // 会话缓存 - 提高性能
  private sessionCache: Map<string, BrowsingSession> = new Map();
  
  // 初始化状态
  private initialized = false;
  
  /**
   * 创建后台会话管理器实例
   * @param storage 会话存储实例，可选，用于依赖注入和测试
   * @param idGenerator ID生成器实例，可选，用于依赖注入和测试
   */
  constructor(storage?: SessionStorage, idGenerator?: IdGenerator) {
    this.storage = storage || new SessionStorage();
    this.idGenerator = idGenerator || new IdGenerator();
    
    console.log('后台会话管理器已创建');
  }
  
  /**
   * 初始化会话管理器
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('会话管理器已经初始化，跳过');
      return;
    }
    
    try {
      console.log('初始化会话管理器...');
      
      // 初始化存储
      await this.storage.initialize();
      
      // 加载会话并检查活跃会话
      await this.loadActiveSessions();
      
      this.initialized = true;
      console.log('会话管理器初始化完成');
    } catch (error) {
      console.error('会话管理器初始化失败:', error);
      throw new Error(`会话管理器初始化失败: ${error instanceof Error ? error.message : String(error)}`);
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
   * 加载活跃会话
   */
  private async loadActiveSessions(): Promise<void> {
    try {
      // 获取活跃会话
      const sessions = await this.storage.getSessions({ 
        includeInactive: false 
      });
      
      if (sessions.length > 0) {
        // 使用最近的活跃会话作为当前会话
        const mostRecent = sessions.sort((a, b) => b.startTime - a.startTime)[0];
        this.currentSessionId = mostRecent.id;
        this.sessionCache.set(mostRecent.id, mostRecent);
        
        console.log(`加载了活跃会话: ${mostRecent.id} - ${mostRecent.title}`);
      } else {
        console.log('未找到活跃会话，将创建新会话');
        // 创建新的默认会话
        await this.createSession({
          title: `会话 ${new Date().toLocaleString()}`,
          description: '自动创建的默认会话'
        });
      }
      
      // 加载其他会话到缓存
      sessions.forEach(session => {
        if (session.id !== this.currentSessionId) {
          this.sessionCache.set(session.id, session);
        }
      });
      
      console.log(`已加载 ${sessions.length} 个活跃会话，当前会话ID: ${this.currentSessionId}`);
    } catch (error) {
      console.error('加载活跃会话失败:', error);
      throw new Error(`加载活跃会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 创建新会话
   * @param options 会话创建选项
   * @returns 新创建的会话对象
   */
  public async createSession(options?: SessionCreationOptions): Promise<BrowsingSession> {
    await this.ensureInitialized();
    
    try {
      // 生成会话ID
      const sessionId = this.idGenerator.generateSessionId();
      
      // 构建新会话对象
      const newSession: BrowsingSession = {
        id: sessionId,
        title: options?.title || `会话 ${new Date().toLocaleString()}`,
        description: options?.description || '',
        startTime: Date.now(),
        isActive: true,
        nodeCount: 0,
        tabCount: 0,
        metadata: options?.metadata || {},
        records: {},
        edges: {},
        rootIds: []
      };
      
      // 如果设置为活跃会话或未指定（默认为true）
      const makeActive = options?.makeActive !== false;
      
      if (makeActive) {
        // 将当前活跃会话设为非活跃
        await this.deactivateCurrentSession();
        
        // 更新当前会话ID
        this.currentSessionId = sessionId;
      }
      
      // 保存到存储和缓存
      await this.storage.saveSession(newSession);
      this.sessionCache.set(sessionId, newSession);
      
      console.log(`已创建新会话: ${sessionId} - ${newSession.title}`);
      
      // 发出事件
      sessionEvents.emitSessionCreated(sessionId, { 
        title: newSession.title, 
        makeActive 
      });
      
      if (makeActive) {
        sessionEvents.emitSessionActivated(sessionId);
      }
      
      return newSession;
    } catch (error) {
      console.error('创建会话失败:', error);
      throw new Error(`创建会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 设置当前活跃会话
   * @param sessionId 要设置为当前会话的ID
   * @returns 设置的会话对象
   */
  public async setCurrentSession(sessionId: string | null): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      // 如果ID为null，清除当前会话
      if (sessionId === null) {
        const oldSessionId = this.currentSessionId;
        this.currentSessionId = null;
        
        if (oldSessionId) {
          sessionEvents.emitSessionDeactivated(oldSessionId);
        }
        
        return null;
      }
      
      // 如果会话ID与当前会话相同，无需操作
      if (sessionId === this.currentSessionId) {
        console.log(`会话 ${sessionId} 已经是当前活跃会话`);
        return this.getSessionById(sessionId);
      }
      
      // 检查会话是否存在
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }
      
      // 将当前会话设为非活跃
      await this.deactivateCurrentSession();
      
      // 更新当前会话ID
      this.currentSessionId = sessionId;
      
      // 更新会话为活跃状态
      session.isActive = true;
      await this.storage.saveSession(session);
      this.sessionCache.set(sessionId, session);
      
      console.log(`已将会话 ${sessionId} 设置为当前活跃会话`);
      
      // 发出事件
      sessionEvents.emitSessionActivated(sessionId);
      
      return session;
    } catch (error) {
      console.error(`设置当前会话 ${sessionId} 失败:`, error);
      throw new Error(`设置当前会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取当前会话
   * @returns 当前会话对象，如果没有则返回null
   */
  public async getCurrentSession(): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    if (!this.currentSessionId) {
      return null;
    }
    
    try {
      return await this.getSessionById(this.currentSessionId);
    } catch (error) {
      console.error('获取当前会话失败:', error);
      throw new Error(`获取当前会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取当前会话ID
   * @returns 当前会话ID，如果没有则返回null
   */
  public getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }
  
  /**
   * 根据ID获取会话
   * @param sessionId 会话ID
   * @returns 会话对象，如果不存在则返回null
   */
  public async getSessionById(sessionId: string): Promise<BrowsingSession | null> {
    await this.ensureInitialized();
    
    try {
      // 先尝试从缓存获取
      if (this.sessionCache.has(sessionId)) {
        const cachedSession = this.sessionCache.get(sessionId);
        // 如果缓存中已有完整数据（包含records和edges），直接返回
        if (cachedSession && cachedSession.records) {
          return cachedSession;
        }
      }
      
      // 从存储获取基本会话信息
      const session = await this.storage.getSession(sessionId);
      
      // 如果会话不存在，返回null
      if (!session) {
        return null;
      }
      
      // 获取会话的导航数据
      const navData = await this.getSessionNavigationData(sessionId);
      
      // 组装完整会话对象
      const fullSession: BrowsingSession = {
        ...session,
        records: navData.records,
        edges: navData.edges,
        rootIds: navData.rootIds
      };
      
      // 更新缓存
      this.sessionCache.set(sessionId, fullSession);
      
      return fullSession;
    } catch (error) {
      console.error(`获取会话 ${sessionId} 失败:`, error);
      throw new Error(`获取会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取会话的导航数据
   * @param sessionId 会话ID
   * @returns 导航节点和边的记录
   */
  private async getSessionNavigationData(sessionId: string): Promise<{
    records: Record<string, NavNode>;
    edges: Record<string, NavLink>;
    rootIds: string[];
  }> {
    // 创建导航存储实例
    const navStorage = new NavigationStorage();
    await navStorage.initialize();
    
    try {
      // 获取会话的所有节点和边
      const { nodes, edges } = await navStorage.getSessionGraph(sessionId);
      
      // 转换为前端期望的格式
      const records: Record<string, NavNode> = {};
      const edgesMap: Record<string, NavLink> = {};
      
      // 填充节点记录
      nodes.forEach(node => {
        records[node.id] = node;
      });
      
      // 填充边记录
      edges.forEach(edge => {
        edgesMap[edge.id] = edge;
      });
      
      // 查找根节点ID（没有父节点的节点）
      const rootIds = nodes
        .filter(node => !node.parentId)
        .map(node => node.id);
      
      return {
        records,
        edges: edgesMap,
        rootIds
      };
    } catch (error) {
      console.error(`获取会话 ${sessionId} 的导航数据失败:`, error);
      // 出错时返回空数据，而不是终止整个流程
      return {
        records: {},
        edges: {},
        rootIds: []
      };
    }
  }
  
  /**
   * 获取会话列表
   * @param options 会话查询选项
   * @returns 会话对象数组
   */
  public async getSessions(options?: SessionQueryOptions): Promise<BrowsingSession[]> {
    await this.ensureInitialized();
    
    try {
      return await this.storage.getSessions(options);
    } catch (error) {
      console.error('获取会话列表失败:', error);
      throw new Error(`获取会话列表失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 更新会话
   * @param sessionId 要更新的会话ID
   * @param updates 更新内容
   * @returns 更新后的会话对象
   */
  public async updateSession(sessionId: string, updates: SessionUpdateOptions): Promise<BrowsingSession> {
    await this.ensureInitialized();
    
    try {
      // 获取原会话
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }
      
      // 应用更新
      if (updates.title !== undefined) {
        session.title = updates.title;
      }
      
      if (updates.description !== undefined) {
        session.description = updates.description;
      }
      
      // 处理活跃状态变更
      if (updates.isActive !== undefined && updates.isActive !== session.isActive) {
        if (updates.isActive) {
          // 激活会话
          await this.setCurrentSession(sessionId);
        } else {
          // 停用会话
          if (sessionId === this.currentSessionId) {
            // 如果是当前会话，设置为null
            await this.setCurrentSession(null);
          } else {
            // 否则直接更新状态
            session.isActive = false;
          }
        }
      }
      
      // 更新元数据
      if (updates.metadata) {
        session.metadata = {
          ...session.metadata || {},
          ...updates.metadata
        };
      }
      
      // 保存更新
      await this.storage.saveSession(session);
      this.sessionCache.set(sessionId, session);
      
      console.log(`已更新会话 ${sessionId}`);
      
      // 发出事件
      sessionEvents.emitSessionUpdated(sessionId, { updates });
      
      return session;
    } catch (error) {
      console.error(`更新会话 ${sessionId} 失败:`, error);
      throw new Error(`更新会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 结束会话
   * @param sessionId 要结束的会话ID
   * @returns 结束后的会话对象
   */
  public async endSession(sessionId: string): Promise<BrowsingSession> {
    await this.ensureInitialized();
    
    try {
      // 获取会话
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }
      
      // 标记为已结束
      session.isActive = false;
      session.endTime = Date.now();
      
      // 如果是当前会话，清除当前会话ID
      if (sessionId === this.currentSessionId) {
        this.currentSessionId = null;
      }
      
      // 保存更新
      await this.storage.saveSession(session);
      this.sessionCache.set(sessionId, session);
      
      console.log(`已结束会话 ${sessionId}`);
      
      // 发出事件
      sessionEvents.emitSessionEnded(sessionId, { 
        endTime: session.endTime 
      });
      
      return session;
    } catch (error) {
      console.error(`结束会话 ${sessionId} 失败:`, error);
      throw new Error(`结束会话失败: ${error instanceof Error ? error.message : String(error)}`);
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
      // 如果是当前会话，清除当前会话ID
      if (sessionId === this.currentSessionId) {
        this.currentSessionId = null;
      }
      
      // 从缓存移除
      this.sessionCache.delete(sessionId);
      
      // 从存储删除
      const result = await this.storage.deleteSession(sessionId);
      
      console.log(`已删除会话 ${sessionId}`);
      
      // 发出事件
      sessionEvents.emitSessionDeleted(sessionId);
      
      return result;
    } catch (error) {
      console.error(`删除会话 ${sessionId} 失败:`, error);
      throw new Error(`删除会话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 获取会话统计信息
   * @param sessionId 会话ID
   * @returns 会话统计信息
   */
  public async getSessionStatistics(sessionId: string): Promise<SessionStatistics> {
    await this.ensureInitialized();
    
    try {
      // 获取会话
      const session = await this.getSessionById(sessionId);
      if (!session) {
        throw new Error(`会话 ${sessionId} 不存在`);
      }
      
      // TODO: 从存储中获取会话相关的导航节点数据
      // 这需要将来与导航管理器集成
      // 现在临时返回基本统计信息
      
      const stats: SessionStatistics = {
        totalNodes: session.nodeCount || 0,
        uniqueDomains: 0,
        duration: session.endTime 
          ? (session.endTime - session.startTime) 
          : (Date.now() - session.startTime),
        topDomains: [],
        mostVisitedPages: [],
        activityByHour: []
      };
      
      return stats;
    } catch (error) {
      console.error(`获取会话 ${sessionId} 统计信息失败:`, error);
      throw new Error(`获取会话统计信息失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 更新会话节点计数
   * @param sessionId 会话ID
   * @param count 新的节点计数，未提供则增加1
   */
  public async updateNodeCount(sessionId: string, count?: number): Promise<void> {
    await this.ensureInitialized();
    
    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        console.warn(`更新节点计数失败: 会话 ${sessionId} 不存在`);
        return;
      }
      
      if (count !== undefined) {
        session.nodeCount = count;
      } else {
        session.nodeCount = (session.nodeCount || 0) + 1;
      }
      
      // 更新缓存和存储
      this.sessionCache.set(sessionId, session);
      await this.storage.saveSession(session);
    } catch (error) {
      console.error(`更新会话 ${sessionId} 节点计数失败:`, error);
    }
  }
  
  /**
   * 更新会话标签页计数
   * @param sessionId 会话ID
   * @param count 新的标签页计数，未提供则增加1
   */
  public async updateTabCount(sessionId: string, count?: number): Promise<void> {
    await this.ensureInitialized();
    
    try {
      const session = await this.getSessionById(sessionId);
      if (!session) {
        console.warn(`更新标签页计数失败: 会话 ${sessionId} 不存在`);
        return;
      }
      
      if (count !== undefined) {
        session.tabCount = count;
      } else {
        session.tabCount = (session.tabCount || 0) + 1;
      }
      
      // 更新缓存和存储
      this.sessionCache.set(sessionId, session);
      await this.storage.saveSession(session);
    } catch (error) {
      console.error(`更新会话 ${sessionId} 标签页计数失败:`, error);
    }
  }
  
  /**
   * 将当前活跃会话设为非活跃
   */
  private async deactivateCurrentSession(): Promise<void> {
    if (!this.currentSessionId) {
      return;
    }
    
    try {
      // 获取当前会话
      const session = await this.getSessionById(this.currentSessionId);
      if (!session) {
        // 当前会话不存在，直接清空当前会话ID
        this.currentSessionId = null;
        return;
      }
      
      // 标记为非活跃
      session.isActive = false;
      
      // 保存更新
      await this.storage.saveSession(session);
      this.sessionCache.set(session.id, session);
      
      console.log(`将会话 ${session.id} 设置为非活跃状态`);
      
      // 发出事件
      sessionEvents.emitSessionDeactivated(session.id);
    } catch (error) {
      console.error('设置当前会话为非活跃状态失败:', error);
    }
  }

  /**
   * 注册消息处理程序
   * @param messageService 消息服务实例
   */
  public registerMessageHandlers(messageService: BackgroundMessageService): void {
    console.log('注册会话相关消息处理程序');
    
    // 获取会话列表
    messageService.registerHandler('getSessions', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as GetSessionsRequest, sender, sendResponse);
      
      this.getSessions(message.options)
        .then(sessions => {
          // 格式化为前端期望的格式
          const formattedSessions = sessions.map(s => ({
            id: s.id,
            title: s.title,
            startTime: s.startTime,
            endTime: s.endTime,
            isActive: s.isActive,
            nodeCount: s.nodeCount,
            recordCount: s.nodeCount // 兼容旧代码
          }));
          
          ctx.success({
            sessions: formattedSessions
          } as GetSessionsResponse);
        })
        .catch(error => {
          ctx.error(`获取会话列表失败: ${error.message}`);
        });
      
      return true;
    });

    // 获取会话详情
    messageService.registerHandler('getSessionDetails', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as GetSessionDetailsRequest, sender, sendResponse);
      const { sessionId } = message;
      
      this.getSessionById(sessionId)
        .then(session => {
          if (!session) {
            ctx.error(`会话 ${sessionId} 不存在`);
            return;
          }
          
          // 确保session具有前端期望的所有字段
          ctx.success({
            session: {
              ...session,
              // 如果records或edges为空，确保它们是空对象而不是undefined
              records: session.records || {},
              edges: session.edges || {},
              rootIds: session.rootIds || []
            }
          } as GetSessionDetailsResponse);
        })
        .catch(error => {
          ctx.error(`获取会话详情失败: ${error.message}`);
        });
      
      return true;
    });
    
    // 创建会话
    messageService.registerHandler('createSession', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as CreateSessionRequest, sender, sendResponse);
      
      this.createSession(message.options)
        .then(session => {
          ctx.success({
            session
          } as CreateSessionResponse);
        })
        .catch(error => {
          ctx.error(`创建会话失败: ${error.message}`);
        });
      
      return true;
    });
    
    // 更新会话
    messageService.registerHandler('updateSession', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as UpdateSessionRequest, sender, sendResponse);
      const { sessionId, updates } = message;
      
      this.updateSession(sessionId, updates)
        .then(session => {
          ctx.success({
            session
          } as UpdateSessionResponse);
        })
        .catch(error => {
          ctx.error(`更新会话失败: ${error.message}`);
        });
      
      return true;
    });
    
    // 结束会话
    messageService.registerHandler('endSession', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as EndSessionRequest, sender, sendResponse);
      const { sessionId } = message;
      
      this.endSession(sessionId)
        .then(session => {
          ctx.success({
            sessionId,
            session
          } as EndSessionResponse);
        })
        .catch(error => {
          ctx.error(`结束会话失败: ${error.message}`);
        });
      
      return true;
    });
    
    // 设置当前会话
    messageService.registerHandler('setCurrentSession', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as SetCurrentSessionRequest, sender, sendResponse);
      const { sessionId } = message;
      
      this.setCurrentSession(sessionId)
        .then(session => {
          ctx.success({
            sessionId,
            session
          } as SetCurrentSessionResponse);
        })
        .catch(error => {
          ctx.error(`设置当前会话失败: ${error.message}`);
        });
      
      return true;
    });
    
    // 获取当前会话
    messageService.registerHandler('getCurrentSession', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as GetCurrentSessionRequest, sender, sendResponse);
      
      this.getCurrentSession()
        .then(session => {
          ctx.success({
            session,
            sessionId: session ? session.id : null
          } as GetCurrentSessionResponse);
        })
        .catch(error => {
          ctx.error(`获取当前会话失败: ${error.message}`);
        });
      
      return true;
    });
    
    // 删除会话
    messageService.registerHandler('deleteSession', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as DeleteSessionRequest, sender, sendResponse);
      const { sessionId, confirm } = message;
      
      // 安全检查：必须明确确认删除
      if (!confirm) {
        ctx.error('删除会话操作需要明确确认');
        return false;
      }
      
      this.deleteSession(sessionId)
        .then(success => {
          if (success) {
            ctx.success({
              sessionId
            } as DeleteSessionResponse);
          } else {
            ctx.error(`删除会话 ${sessionId} 失败`);
          }
        })
        .catch(error => {
          ctx.error(`删除会话失败: ${error.message}`);
        });
      
      return true;
    });
    
    // 获取会话统计信息
    messageService.registerHandler('getSessionStats', (message, sender, sendResponse) => {
      const ctx = messageService.createMessageContext(message as GetSessionStatsRequest, sender, sendResponse);
      const { sessionId } = message;
      
      this.getSessionStatistics(sessionId)
        .then(statistics => {
          ctx.success({
            sessionId,
            statistics
          } as GetSessionStatsResponse);
        })
        .catch(error => {
          ctx.error(`获取会话统计信息失败: ${error.message}`);
        });
      
      return true;
    });
    
    console.log('会话相关消息处理程序注册完成');
  }
}

// 创建单例实例的工厂函数
let instance: BackgroundSessionManager | null = null;

/**
 * 获取后台会话管理器单例
 */
export function getBackgroundSessionManager(storage?: SessionStorage, idGenerator?: IdGenerator): BackgroundSessionManager {
  if (!instance) {
    instance = new BackgroundSessionManager(storage, idGenerator);
  }
  return instance;
}