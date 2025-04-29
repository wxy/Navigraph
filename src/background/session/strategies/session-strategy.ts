import { BrowsingSession } from '../../../types/session-types.js';

/**
 * 会话策略接口
 * 定义会话创建和管理的不同策略
 */
export interface SessionStrategy {
  /**
   * 获取策略类型
   */
  getType(): string;
  
  /**
   * 检查是否需要创建新会话
   * @param lastActivityTime 上次活动时间
   * @param currentTime 当前时间
   * @param currentSession 当前活跃会话
   * @returns 是否需要创建新会话
   */
  shouldCreateNewSession(
    lastActivityTime: number,
    currentTime: number,
    currentSession: BrowsingSession | null
  ): Promise<boolean>;
  
  /**
   * 创建新会话
   * @returns 创建的会话
   */
  createSession(): Promise<BrowsingSession>;
}