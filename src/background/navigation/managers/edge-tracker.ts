import { Logger } from '../../../lib/utils/logger.js';
import { IdGenerator } from '../../lib/id-generator.js';
import { NavigationStorage } from '../../store/navigation-storage.js';
import { NavLink } from '../../../types/session-types.js';
import { EdgeCreationOptions, EdgeQueryOptions, EdgeStats } from '../types/edge.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';

const logger = new Logger('EdgeTracker');

/**
 * 边追踪器
 * 负责创建和管理导航节点间的关系（边）
 */
export class EdgeTracker {
  // 依赖组件
  private navigationStorage: NavigationStorage;
  
  // 当前会话ID
  private sessionId: string;

  // 导航序列号
  private navigationSequence = 0;
  
  /**
   * 构造函数
   * @param navigationStorage 导航存储实例
   * @param sessionId 当前会话ID
   */
  constructor(
    navigationStorage: NavigationStorage,
    sessionId: string
  ) {
    this.navigationStorage = navigationStorage;
    this.sessionId = sessionId;
    
    logger.log(i18n('edge_tracker_initialized', '边追踪器初始化完成'));
  }
  
  /**
   * 设置当前会话ID
   * @param sessionId 会话ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }
  
  /**
   * 创建导航边
   * @param options 边创建选项
   * @returns 创建的边对象
   */
  async createNavigationEdge(options: EdgeCreationOptions): Promise<NavLink> {
    const {
      sourceId,
      targetId,
      timestamp = Date.now(),
      navigationType = "link_click",
      sessionId = this.sessionId
    } = options;
    
    // 增加序列号
    this.navigationSequence++;

    // 创建边记录
    const edge: NavLink = {
      id: IdGenerator.generateEdgeId(sourceId, targetId, timestamp),
      source: sourceId,
      target: targetId,
      timestamp,
      type: navigationType,
      sequence: this.navigationSequence,
      sessionId: sessionId,
    };

    // 保存边
    await this.navigationStorage.saveEdge(edge);

    return edge;
  }
  
  /**
   * 获取导航序列号
   * @returns 当前序列号
   */
  getNavigationSequence(): number {
    return this.navigationSequence;
  }
  
  /**
   * 设置导航序列号
   * @param sequence 新序列号
   */
  setNavigationSequence(sequence: number): void {
    this.navigationSequence = sequence;
  }
  
  /**
   * 判断添加父子关系是否会导致循环
   * @param parentId 父节点ID
   * @param childId 子节点ID
   * @returns 是否会导致循环
   */
  async wouldCreateCycle(parentId: string, childId: string): Promise<boolean> {
    if (parentId === childId) return true;

    // 检查从childId向上查找是否能找到parentId
    let currentId = parentId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) {
        // 检测到循环
        return true;
      }

      visited.add(currentId);

      const record = await this.navigationStorage.getNode(currentId);
      if (!record || !record.parentId) {
        break;
      }

      if (record.parentId === childId) {
        return true;
      }

      currentId = record.parentId;
    }

    return false;
  }
  
  /**
   * 查询满足条件的边
   * @param options 查询选项
   * @returns 边数组
   */
  async queryEdges(options: EdgeQueryOptions = {}): Promise<NavLink[]> {
    const { sessionId = this.sessionId, source, target } = options;
    
    try {
      // 使用存储接口查询边
      const edges = await this.navigationStorage.queryEdges({
        ...options,
        sessionId,
        source,
        target
        });
      
      return edges;
    } catch (error) {
      logger.error(i18n('edge_tracker_query_failed', '查询边失败: {0}'), error instanceof Error ? error.message : String(error));
      return [];
    }
  }
  
  /**
   * 获取边数量
   * @param sessionId 会话ID，默认为当前会话
   * @returns 边数量
   */
  async getEdgeCount(sessionId: string = this.sessionId): Promise<number> {
    try {
      const edges = await this.navigationStorage.queryEdges({ sessionId });
      return edges.length;
    } catch (error) {
      logger.error(i18n('edge_tracker_count_failed', '获取边数量失败: {0}'), error instanceof Error ? error.message : String(error));
      return 0;
    }
  }
  
  /**
   * 获取源节点的所有出边
   * @param sourceId 源节点ID
   * @returns 边数组
   */
  async getOutgoingEdges(sourceId: string): Promise<NavLink[]> {
    try {
      return this.navigationStorage.queryEdges({
        sessionId: this.sessionId,
        source: sourceId
      });
    } catch (error) {
      logger.error(i18n('edge_tracker_outgoing_failed', '获取节点[{0}]出边失败: {1}'), sourceId, error instanceof Error ? error.message : String(error));
      return [];
    }
  }
  
  /**
   * 获取目标节点的所有入边
   * @param targetId 目标节点ID
   * @returns 边数组
   */
  async getIncomingEdges(targetId: string): Promise<NavLink[]> {
    try {
      return this.navigationStorage.queryEdges({
        sessionId: this.sessionId,
        target: targetId
      });
    } catch (error) {
      logger.error(i18n('edge_tracker_incoming_failed', '获取节点[{0}]入边失败: {1}'), targetId, error instanceof Error ? error.message : String(error));
      return [];
    }
  }
  
  /**
   * 计算边统计信息
   * @param sessionId 会话ID，默认为当前会话
   * @returns 边统计信息
   */
  async calculateEdgeStats(sessionId: string = this.sessionId): Promise<EdgeStats> {
    try {
      // 获取所有边
      const edges = await this.navigationStorage.queryEdges({ sessionId });
      
      // 初始化统计信息
      const stats: EdgeStats = {
        total: edges.length,
        byType: {} as Record<string, number>,
        connections: {
          maxOutDegree: 0,
          maxInDegree: 0,
          avgOutDegree: 0,
          avgInDegree: 0
        }
      };
      
      // 按类型统计
      for (const edge of edges) {
        if (!stats.byType[edge.type]) {
          stats.byType[edge.type] = 0;
        }
        stats.byType[edge.type]++;
      }
      
      // 计算节点连接度
      const outDegree = new Map<string, number>();
      const inDegree = new Map<string, number>();
      
      // 统计每个节点的出度和入度
      for (const edge of edges) {
        outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      }
      
      // 计算最大出度和入度
      for (const [_, degree] of outDegree.entries()) {
        if (degree > stats.connections.maxOutDegree) {
          stats.connections.maxOutDegree = degree;
        }
      }
      
      for (const [_, degree] of inDegree.entries()) {
        if (degree > stats.connections.maxInDegree) {
          stats.connections.maxInDegree = degree;
        }
      }
      
      // 计算平均出度和入度
      const uniqueSourceNodes = outDegree.size;
      const uniqueTargetNodes = inDegree.size;
      
      if (uniqueSourceNodes > 0) {
        stats.connections.avgOutDegree = edges.length / uniqueSourceNodes;
      }
      
      if (uniqueTargetNodes > 0) {
        stats.connections.avgInDegree = edges.length / uniqueTargetNodes;
      }
      
      return stats;
    } catch (error) {
      logger.error(i18n('edge_tracker_stats_failed', '计算边统计信息失败: {0}'), error instanceof Error ? error.message : String(error));
      return {
        total: 0,
        byType: {} as Record<string, number>,
        connections: {
          maxOutDegree: 0,
          maxInDegree: 0,
          avgOutDegree: 0,
          avgInDegree: 0
        }
      };
    }
  }
  /**
   * 获取会话的所有边
   * @param sessionId 会话ID
   */
  public async getEdgesForSession(sessionId: string): Promise<NavLink[]> {
    try {
      return await this.navigationStorage.queryEdges({ sessionId });
    } catch (error) {
      logger.error(i18n('edge_tracker_session_failed', '获取会话 {0} 的边失败: {1}'), sessionId, error instanceof Error ? error.message : String(error));
      return [];
    }
  }
  /**
   * 重置状态
   */
  reset(): void {
    // 重置序列号
    this.navigationSequence = 0;
    
    logger.log(i18n('edge_tracker_reset', '边追踪器状态已重置'));
  }
}