import { Logger } from '../../../lib/utils/logger.js';
import { BrowsingSession, SessionCreationOptions } from '../../../types/session-types.js';
import { SessionManager } from '../session-manager.js';
import { SessionStrategy } from './session-strategy.js';
import { _, _Error } from '../../../lib/utils/i18n.js';

const logger = new Logger('DailySessionStrategy');

/**
 * 每日会话策略
 * 根据工作日边界创建新会话
 */
export class DailySessionStrategy implements SessionStrategy {
  private manager: SessionManager;
  
  constructor(manager: SessionManager) {
    this.manager = manager;
  }
  
  /**
   * 获取策略类型
   */
  public getType(): string {
    return 'daily';
  }
  
  /**
   * 检查是否应该创建新会话
   */
  public async shouldCreateNewSession(
    lastActivityTime: number,
    currentTime: number,
    currentSession: BrowsingSession | null
  ): Promise<boolean> {
    if (!currentSession) {
      logger.log(_('daily_session_no_active', '没有活跃会话，应创建新会话'));
      return true;
    }
    
    // 获取会话的日期和当前日期
    const sessionDate = new Date(currentSession.startTime);
    const nowDate = new Date();
    
    // 计算工作日标识
    const sessionWorkDay = this.getWorkDayIdentifier(sessionDate);
    const currentWorkDay = this.getWorkDayIdentifier(nowDate);
    
    // 计算空闲时间
    const idleTime = currentTime - lastActivityTime;
    
    // 从活动监视器获取空闲超时阈值
    const idleThreshold = this.manager.getIdleTimeoutMs();
    
    // 如果工作日不同且空闲时间足够，创建新会话
    if (sessionWorkDay !== currentWorkDay && idleTime > idleThreshold) {
      const idleHours = Math.round(idleTime / (60 * 60 * 1000)).toString();
      logger.log(_('daily_session_new_day_idle_enough', '检测到新工作日且空闲时间足够({0}小时)，应创建新会话'), idleHours);
      return true;
    } 
    
    if (sessionWorkDay !== currentWorkDay) {
      const idleMinutes = Math.round(idleTime / (60 * 1000)).toString();
      logger.log(_('daily_session_new_day_idle_not_enough', '检测到新工作日，但空闲时间不足({0}分钟)，不创建新会话'), idleMinutes);
    }
    
    return false;
  }
  
  /**
   * 创建每日会话
   */
  public async createSession(): Promise<BrowsingSession> {
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();
    
    logger.log(_('daily_session_creating', '创建新的每日会话: {0}'), dateStr);
    
    const options: SessionCreationOptions = {
      title: _('daily_session_title', '{0} 浏览会话', dateStr),
      description: _('daily_session_description', '自动创建的 {0} {1} 会话', dateStr, timeStr),
      metadata: {
        type: "daily",
        date: now.getTime()
      }
    };
    
    return await this.manager.createSession(options);
  }
  
  /**
   * 获取工作日标识符
   */
  private getWorkDayIdentifier(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}