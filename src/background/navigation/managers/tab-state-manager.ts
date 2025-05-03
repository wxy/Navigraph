import { Logger } from '../../../lib/utils/logger.js';
import { TabState, TabEventType, TabEventListener } from '../types/tab.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';

const logger = new Logger('TabStateManager');

/**
 * 标签页状态管理器
 * 负责管理和维护所有标签页的状态信息，包括：
 * - 标签页状态（URL、标题等）
 * - 标签页导航历史
 * - 标签页激活时间记录
 * - 标签页生命周期管理
 */
export class TabStateManager {
  // 标签页状态集合
  private tabStates = new Map<number, TabState>();
  
  // 标签页导航历史（标签页ID -> 节点ID数组）
  private tabNavigationHistory = new Map<number, string[]>();
  
  // 已移除的标签页集合
  private removedTabs = new Set<number>();
  
  // 标签页激活时间记录
  private tabActiveTimes = new Map<number, number>();
  
  // 历史记录长度限制
  private historyLimit: number;
  
  // 事件监听器
  private eventListeners: TabEventListener[] = [];
  
  /**
   * 构造函数
   * @param historyLimit 每个标签页保留的历史记录条数上限
   */
  constructor(historyLimit: number = 50) {
    this.historyLimit = historyLimit;
    logger.log('tab_state_manager_initialized');
  }
  
  /**
   * 添加标签页状态
   * @param tabId 标签页ID
   * @param state 状态对象
   */
  addTabState(tabId: number, state: Partial<TabState>): void {
    const existingState = this.tabStates.get(tabId) || { id: tabId, url: "" };
    const newState = { ...existingState, ...state };
    this.tabStates.set(tabId, newState);
    
    logger.log('tab_state_manager_state_added', tabId.toString());
    
    // 触发事件
    this.notifyListeners(tabId, TabEventType.STATE_CHANGED, newState);
  }
  
  /**
   * 更新标签页状态
   * @param tabId 标签页ID
   * @param updates 更新对象
   */
  updateTabState(tabId: number, updates: Partial<TabState>): void {
    const state = this.tabStates.get(tabId);
    if (state) {
      Object.assign(state, updates);
      
      logger.log('tab_state_manager_state_changed', tabId.toString());
      
      // 触发事件
      this.notifyListeners(tabId, TabEventType.STATE_CHANGED, state);
      
    } else {
      this.addTabState(tabId, { id: tabId, url: "", ...updates });
    }
  }
  
  /**
   * 添加到标签页导航历史
   * @param tabId 标签页ID
   * @param nodeId 节点ID
   */
  addToNavigationHistory(tabId: number, nodeId: string): void {
    if (!this.tabNavigationHistory.has(tabId)) {
      this.tabNavigationHistory.set(tabId, []);
    }

    const history = this.tabNavigationHistory.get(tabId)!;
    
    // 如果已经存在相同的节点ID，不添加
    if (history.includes(nodeId)) {
      return;
    }
    
    history.push(nodeId);
    
    logger.log('tab_state_manager_node_added', tabId.toString(), nodeId);

    // 限制历史记录长度
    if (history.length > this.historyLimit) {
      history.shift();
    }
    
    // 触发事件
    this.notifyListeners(tabId, TabEventType.HISTORY_UPDATED, { nodeId, historyLength: history.length });
  }
  
  /**
   * 标记标签页已移除
   * @param tabId 标签页ID
   */
  markTabRemoved(tabId: number): void {
    this.removedTabs.add(tabId);
    
    logger.log('tab_state_manager_tab_removed', tabId.toString());
    
    // 清理相关数据
    this.tabStates.delete(tabId);
    this.tabNavigationHistory.delete(tabId);
    this.tabActiveTimes.delete(tabId);
    
    // 触发事件
    this.notifyListeners(tabId, TabEventType.REMOVED);
  }
  
  /**
   * 设置标签页激活时间
   * @param tabId 标签页ID
   * @param time 时间戳
   */
  setTabActiveTime(tabId: number, time: number): void {
    this.tabActiveTimes.set(tabId, time);
    logger.log('tab_state_manager_tab_active_time_set', tabId.toString(), time.toString());
  }
  
  /**
   * 获取标签页激活时长
   * @param tabId 标签页ID
   * @returns 激活时长(毫秒)，如果没有记录则返回0
   */
  getTabActiveElapsed(tabId: number): number {
    const activeTime = this.tabActiveTimes.get(tabId);
    if (!activeTime) return 0;
    
    return Date.now() - activeTime;
  }
  
  /**
   * 获取标签页状态
   * @param tabId 标签页ID
   * @returns 标签页状态，如果不存在则返回undefined
   */
  getTabState(tabId: number): TabState | undefined {
    const state = this.tabStates.get(tabId);
    if (!state) {
      logger.warn('tab_state_manager_tab_not_found', tabId.toString());
    }
    return state;
  }
  
  /**
   * 获取所有标签页状态
   * @returns 标签页状态数组
   */
  getAllTabStates(): TabState[] {
    return Array.from(this.tabStates.values());
  }
  
  /**
   * 获取标签页导航历史
   * @param tabId 标签页ID
   * @returns 节点ID数组，如果不存在则返回空数组
   */
  getTabHistory(tabId: number): string[] {
    const history = this.tabNavigationHistory.get(tabId) || [];
    if (history.length === 0) {
      logger.debug('tab_state_manager_no_history', tabId.toString());
    }
    return history;
  }
  
  /**
   * 获取标签页的最后一个节点ID
   * @param tabId 标签页ID
   * @returns 最后一个节点ID，如果没有则返回null
   */
  getLastNodeId(tabId: number): string | null {
    const history = this.getTabHistory(tabId);
    if (history.length > 0) {
      return history[history.length - 1];
    }

    const tabState = this.getTabState(tabId);
    if (tabState && tabState.lastNodeId) {
      return tabState.lastNodeId;
    }

    return null;
  }
  
  /**
   * 检查标签页是否已移除
   * @param tabId 标签页ID
   * @returns 是否已移除
   */
  isTabRemoved(tabId: number): boolean {
    return this.removedTabs.has(tabId);
  }

  /**
   * 获取所有标签页状态的映射
   * @returns 标签页状态映射
   */
  getAllTabStatesMap(): Map<number, TabState> {
    return this.tabStates;
  }
  
  /**
   * 重置所有状态
   * 用于会话切换或清理时
   */
  reset(): void {
    this.tabStates.clear();
    this.tabNavigationHistory.clear();
    this.removedTabs.clear();
    this.tabActiveTimes.clear();
    
    logger.log('tab_state_manager_reset');
  }
  
  /**
   * 添加事件监听器
   * @param listener 监听器函数
   */
  addEventListener(listener: TabEventListener): void {
    this.eventListeners.push(listener);
    logger.log('tab_state_manager_event_listener_added');
  }
  
  /**
   * 移除事件监听器
   * @param listener 监听器函数
   */
  removeEventListener(listener: TabEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
      logger.log('tab_state_manager_event_listener_removed');
    }
  }
  
  /**
   * 通知所有监听器
   * @param tabId 标签页ID
   * @param eventType 事件类型
   * @param data 事件数据
   */
  private notifyListeners(tabId: number, eventType: TabEventType, data?: any): void {
    for (const listener of this.eventListeners) {
      try {
        listener(tabId, eventType, data);
      } catch (error) {
        logger.error('tab_state_manager_event_listener_error', error instanceof Error ? error.message : String(error));
      }
    }
  }
}