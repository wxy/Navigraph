import { Logger } from '../../../lib/utils/logger.js';
import { SessionManager } from '../session-manager.js';
import { NavigraphSettings } from '../../../lib/settings/types.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { UrlUtils } from '../../../lib/utils/url-utils.js';

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
    logger.log(_('activity_monitor_initialized', '活动监控器初始化完成'));
    
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
      logger.log(_('activity_monitor_timeout_changed', '活动超时设置已更改为{0}分钟'), this.idleTimeoutMinutes.toString());
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
        logger.log(_('activity_monitor_restore_time_success', '活动监控器：成功恢复上次活动时间：{0}'), 
          new Date(this.lastActivityTime).toLocaleString());
      } else {
        logger.log(_('activity_monitor_session_null', '活动监控器：未找到当前会话，使用当前时间'));
        this.lastActivityTime = Date.now();
      }
    } catch (error) {
      logger.error(_('activity_monitor_restore_time_failed', '恢复活动时间失败: {0}'), 
        error instanceof Error ? error.message : String(error));
      this.lastActivityTime = Date.now();
    }
  }
  
  /**
   * 设置活动监听器
   */
  private setupActivityListeners(): void {
    logger.log(_('activity_monitor_setup_listeners', '活动监控器：设置活动监听器'));
    
    // 浏览器启动时
    chrome.runtime.onStartup.addListener(() => {
      logger.log(_('activity_monitor_browser_startup', '活动监控器：检测到浏览器启动'));
      this.manager.checkDayTransition();
    });
    
    // 标签页激活时
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url && !UrlUtils.isSystemPage(tab.url)) {
          logger.debug(_('activity_monitor_real_page_activated', '活动监控器：实际页面被激活：{0}'), tab.url);
          this.markActivity();
        } else if (tab && tab.url) {
          logger.debug(_('activity_monitor_system_page_ignored', '活动监控器：忽略系统页面激活：{0}'), tab.url);
        }
      } catch (error) {
        logger.debug(_('activity_monitor_tab_get_failed', '活动监控器：无法获取标签页信息：{0}'), 
          error instanceof Error ? error.message : String(error));
      }
    });
    
    // 导航完成时
    chrome.webNavigation.onCompleted.addListener((details) => {
      if (!UrlUtils.isSystemPage(details.url)) {
        logger.debug(_('activity_monitor_navigation_completed', '活动监控器：实际页面导航完成：{0}'), details.url);
        this.markActivity();
      } else {
        logger.debug(_('activity_monitor_system_navigation_ignored', '活动监控器：忽略系统页面导航：{0}'), details.url);
      }
    });
    
    
    // 标签页更新时
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab?.url) {
        if (!UrlUtils.isSystemPage(tab.url)) {
          logger.debug(_('activity_monitor_page_updated', '活动监控器：实际页面更新完成：{0}'), tab.url);
          this.markActivity();
        } else {
          logger.debug(_('activity_monitor_system_update_ignored', '活动监控器：忽略系统页面更新：{0}'), tab.url);
        }
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
  
    // 使用防抖，避免短时间内重复处理
    if (now - this.lastActivityTime < 2000) {
      return;
    }
  
    // 先检查是否需要创建新会话
    await this.manager.markSessionActivity(now, previousActivityTime);
    
    // 重置空闲计时器
    this.resetIdleTimer();
    
    // 检查完成后再更新最后活动时间
    this.lastActivityTime = now;
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
      logger.debug(_('activity_monitor_idle_timer_disabled', '空闲计时器已禁用'));
      return;
    }
    
    // 设置新的计时器
    const timeoutMs = this.idleTimeoutMinutes * 60 * 1000;
    logger.debug(_('activity_monitor_idle_timer_reset', '重置空闲计时器，超时时间: {0}分钟'), this.idleTimeoutMinutes.toString());
    
    this.idleTimerId = setTimeout(() => {
      this.handleUserIdle();
    }, timeoutMs) as unknown as number;
  }
  
  /**
   * 处理用户空闲
   */
  private async handleUserIdle(): Promise<void> {
    const idleHours = this.idleTimeoutMinutes / 60;
    logger.log(_('activity_monitor_idle_detected', '检测到用户空闲超过{0}小时'), idleHours.toString());
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