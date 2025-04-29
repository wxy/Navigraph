import { Logger } from '../../../lib/utils/logger.js';
import { SessionManager } from '../session-manager.js';
import { NavigraphSettings } from '../../../lib/settings/types.js';

const logger = new Logger('ActivityMonitor');

/**
 * 会话活动监控器
 * 负责跟踪用户活动和空闲状态
 */
export class ActivityMonitor {
  private manager: SessionManager;
  
  // 空闲计时器
  private idleTimerId: number | null = null;
  
  // 空闲超时设置（分钟）
  private idleTimeoutMinutes: number = 30;
  
  // 最后活动时间
  private lastActivityTime: number = 0;

  constructor(manager: SessionManager) {
    this.manager = manager;
  }
  
  /**
   * 初始化活动监控器
   */
  public async initialize(): Promise<void> {
    // 恢复最后活动时间
    await this.restoreActivityTime();
    
    // 设置活动监听器
    this.setupActivityListeners();
  }
  
  /**
   * 应用设置
   */
  public applySettings(settings: NavigraphSettings): void {
    const oldTimeout = this.idleTimeoutMinutes;
    
    // 小时转换为分钟
    this.idleTimeoutMinutes = settings.idleTimeout * 60;
    
    // 如果超时值改变，重置计时器
    if (oldTimeout !== this.idleTimeoutMinutes) {
      this.resetIdleTimer();
    }
  }
  
  /**
   * 恢复最后活动时间
   */
  private async restoreActivityTime(): Promise<void> {
    try {
      const currentSession = await this.manager.getCurrentSession();
      if (currentSession) {
        this.lastActivityTime = currentSession.lastActivity || currentSession.startTime;
        logger.log(`恢复会话活动时间: ${new Date(this.lastActivityTime).toLocaleString()}`);
      } else {
        this.lastActivityTime = Date.now();
      }
    } catch (error) {
      logger.error("恢复活动时间失败:", error);
      this.lastActivityTime = Date.now();
    }
  }
  
  /**
   * 设置活动监听器
   */
  private setupActivityListeners(): void {
    logger.log('设置会话活动监听器');
    
    // 浏览器启动时
    chrome.runtime.onStartup.addListener(() => {
      logger.log('浏览器启动');
      this.manager.checkDayTransition();
    });
    
    // 标签页激活时
    chrome.tabs.onActivated.addListener(() => {
      this.markActivity();
    });
    
    // 导航完成时
    chrome.webNavigation.onCompleted.addListener(() => {
      this.markActivity();
    });
    
    // 标签页更新时
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete') {
        this.markActivity();
      }
    });

    // 标签页关闭监听
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      this.handleTabClosed(tabId, removeInfo);
    });
  }
  
  /**
   * 标记活动
   */
  public async markActivity(): Promise<void> {
    const now = Date.now();
    const previousActivityTime = this.lastActivityTime;
    
    // 更新最后活动时间
    this.lastActivityTime = now;
    
    // 重置空闲计时器
    this.resetIdleTimer();
    
    // 通知会话管理器活动发生
    await this.manager.markSessionActivity(now, previousActivityTime);
  }
  
  /**
   * 重置空闲计时器
   */
  private resetIdleTimer(): void {
    // 清除现有计时器
    if (this.idleTimerId) {
      clearTimeout(this.idleTimerId);
      this.idleTimerId = null;
    }
    
    // 如果空闲超时为0，不设置计时器
    if (this.idleTimeoutMinutes <= 0) {
      return;
    }
    
    // 设置新的计时器
    const timeoutMs = this.idleTimeoutMinutes * 60 * 1000;
    this.idleTimerId = setTimeout(() => {
      this.handleUserIdle();
    }, timeoutMs) as unknown as number;
  }
  
  /**
   * 处理用户空闲
   */
  private async handleUserIdle(): Promise<void> {
    logger.log(`检测到用户空闲超过${this.idleTimeoutMinutes / 60}小时`);
    await this.manager.handleUserIdle();
  }
  
  /**
   * 处理标签页关闭
   */
  private async handleTabClosed(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo): Promise<void> {
    await this.manager.handleTabClosed(tabId, removeInfo);
  }
  
  /**
   * 获取最后活动时间
   */
  public getLastActivityTime(): number {
    return this.lastActivityTime;
  }
  
  /**
   * 获取空闲超时时间(毫秒)
   */
  public getIdleTimeoutMs(): number {
    return this.idleTimeoutMinutes * 60 * 1000;
  }
}