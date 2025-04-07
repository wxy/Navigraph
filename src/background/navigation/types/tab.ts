/**
 * 标签页状态接口
 * 包含与标签页相关的所有状态信息
 */
export interface TabState {
  /** 标签页ID */
  id: number;
  
  /** 当前URL */
  url: string;
  
  /** 页面标题 */
  title?: string;
  
  /** 页面图标 */
  favicon?: string;
  
  /** 标签页创建时间戳 */
  created?: number;
  
  /** 标签页被激活的时间戳 */
  activated?: number;
  
  /** 最后一次导航的时间戳 */
  lastNavigation?: number;
  
  /** 最后一次活跃的时间戳 */
  lastActiveTime?: number;
  
  /** 最后一个节点ID */
  lastNodeId?: string;
}

/**
 * 标签页事件类型
 * 用于标识标签页状态变化的事件类型
 */
export enum TabEventType {
  CREATED = 'created',
  UPDATED = 'updated',
  ACTIVATED = 'activated',
  REMOVED = 'removed',
  STATE_CHANGED = 'state_changed',
  HISTORY_UPDATED = 'history_updated'
}

/**
 * 标签页事件监听器
 */
export type TabEventListener = (tabId: number, eventType: TabEventType, data?: any) => void;