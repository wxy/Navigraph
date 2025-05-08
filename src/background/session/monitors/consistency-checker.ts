import { Logger } from '../../../lib/utils/logger.js';
import { SessionManager } from '../session-manager.js';
import { getNavigationManager } from '../../navigation/navigation-manager.js';
import { UrlUtils } from '../../../lib/utils/url-utils.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';

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
  }
  
  /**
   * 开始定期检查
   */
  public startChecking(): void {
    if (this.checkIntervalId) return;
    
    this.checkIntervalId = setInterval(() => {
      this.checkNodeStateConsistency()
        .catch(err => logger.error(i18n('consistency_checker_check_failed', '节点状态一致性检查失败: {0}'), 
          err instanceof Error ? err.message : String(err)));
    }, this.checkIntervalMs) as unknown as number;
    
    const intervalMinutes = (this.checkIntervalMs / (60 * 1000)).toString();
    logger.log(i18n('consistency_checker_started', '启动节点状态一致性检查，间隔{0}分钟'), intervalMinutes);
  }
  
  /**
   * 停止检查
   */
  public stopChecking(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      logger.log(i18n('consistency_checker_stopped', '停止节点状态一致性检查'));
    }
  }
  
  /**
   * 检查节点状态一致性
   */
  public async checkNodeStateConsistency(): Promise<void> {
    const latestSessionId = this.manager.getLatestSessionId();
    if (!latestSessionId) return;
    
    try {
      logger.groupCollapsed(i18n('consistency_checker_executing', '执行节点状态一致性检查...'));
      
      // 获取所有活跃标签页
      const tabs = await this.getAllActiveTabs();
      const activeTabIds = new Set(
        tabs
          .filter(tab => tab.id !== undefined && tab.url && !UrlUtils.isSystemPage(tab.url))
          .map(tab => tab.id)
      );
      logger.log(i18n('consistency_checker_active_tabs', '当前有 {0} 个活跃标签页（不含系统页面）'), activeTabIds.size.toString());
      
      try {
        // 获取导航管理器实例
        const navManager = getNavigationManager();
        
        // 查询当前会话的节点
        const sessionNodes = await navManager.queryNodes({
          sessionId: latestSessionId
        });
        
        // 过滤出活跃(未关闭)节点
        const activeNodes = sessionNodes.filter(node => node.isClosed !== true);
        logger.log(i18n('consistency_checker_active_nodes', '当前会话有 {0} 个活跃节点'), activeNodes.length.toString());

        // 找出标签页已关闭但节点未标记为关闭的节点
        const orphanedNodes = activeNodes.filter(node => 
          node.tabId !== undefined && !activeTabIds.has(node.tabId)
        );
        
        if (orphanedNodes.length > 0) {
          logger.log(i18n('consistency_checker_orphaned_found', '发现 {0} 个孤立节点，标记为已关闭'), orphanedNodes.length.toString());
          
          const now = Date.now();
          
          // 更新这些节点状态
          for (const node of orphanedNodes) {
            logger.log(i18n('consistency_checker_marking_node', '标记节点 {0} (tabId={1}) 为已关闭'), 
              node.id, node.tabId ? node.tabId.toString() : 'undefined');
            
            await navManager.updateNode(node.id, {
              isClosed: true,
              closeTime: now
            });
          }
        } else {
          logger.log(i18n('consistency_checker_no_orphaned', '未发现需要更新状态的孤立节点'));
        }
      } catch (navError) {
        logger.error(i18n('consistency_checker_nav_manager_failed', '获取导航管理器失败: {0}'), 
          navError instanceof Error ? navError.message : String(navError));
      }
      
      logger.log(i18n('consistency_checker_completed', '节点状态一致性检查完成'));
      logger.groupEnd();
    } catch (error) {
      logger.error(i18n('consistency_checker_error', '节点状态一致性检查出错: {0}'), 
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