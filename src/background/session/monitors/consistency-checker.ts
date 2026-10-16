import { enqueue } from '../../lib/task-queue.js';
import { Logger } from '../../../lib/utils/logger.js';
import { SessionManager } from '../session-manager.js';
import { getNavigationManager } from '../../navigation/navigation-manager.js';
import { UrlUtils } from '../../../lib/utils/url-utils.js';
import { _, _Error } from '../../../lib/utils/i18n.js';

const logger = new Logger('ConsistencyChecker');

/**
 * 会话一致性检查器
 * 负责定期检查节点状态与实际标签页状态的一致性
 */
export class ConsistencyChecker {
  private manager: SessionManager;
  private checkIntervalId: number | null = null;
  private checkIntervalMs: number = 5 * 60 * 1000; // 5分钟
  
  constructor(manager: SessionManager) {
    this.manager = manager;
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === 'navigraph-consistency') void enqueue(() => this.checkNodeStateConsistency());
    });
  }
  
  /**
   * 开始定期检查
   */
  public startChecking(): void {
    void chrome.alarms.create('navigraph-consistency', { periodInMinutes: 5 });
  }

  public stopChecking(): void { void chrome.alarms.clear('navigraph-consistency'); }

  /**
   * 检查节点状态一致性
   */
  public async checkNodeStateConsistency(): Promise<void> {
    const latestSessionId = this.manager.getLatestSessionId();
    if (!latestSessionId) return;
    
    try {
      logger.groupCollapsed(_('consistency_checker_executing', '执行节点状态一致性检查...'));
      
      // 获取所有活跃标签页
      const tabs = await this.getAllActiveTabs();
      const activeTabIds = new Set(
        tabs
          .filter(tab => tab.id !== undefined && tab.url && !UrlUtils.isSystemPage(tab.url))
          .map(tab => tab.id)
      );
      logger.log(_('consistency_checker_active_tabs', '当前有 {0} 个活跃标签页（不含系统页面）'), activeTabIds.size.toString());
      
      try {
        // 获取导航管理器实例
        const navManager = getNavigationManager();
        
        const count = await navManager.getNavigationStorage().closeMatchingOpenNodes(
          latestSessionId, tabId => !activeTabIds.has(tabId)
        );
        logger.log(_('consistency_checker_orphaned_found', '发现 {0} 个孤立节点，标记为已关闭'), count.toString());
      } catch (navError) {
        logger.error(_('consistency_checker_nav_manager_failed', '获取导航管理器失败: {0}'), 
          navError instanceof Error ? navError.message : String(navError));
      }
      
      logger.log(_('consistency_checker_completed', '节点状态一致性检查完成'));
      logger.groupEnd();
    } catch (error) {
      logger.error(_('consistency_checker_error', '节点状态一致性检查出错: {0}'), 
        error instanceof Error ? error.message : String(error));
    }
  }
  
  /**
   * 获取所有活跃标签页
   */
  private async getAllActiveTabs(): Promise<chrome.tabs.Tab[]> {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        resolve(tabs);
      });
    });
  }
}