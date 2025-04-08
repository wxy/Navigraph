import { NavigationType } from '../../../types/session-types.js';

/**
 * 待处理导航记录
 * 表示用户操作触发的导航意图，等待实际导航事件发生
 */
export interface PendingNavigation {
  /** 导航类型 */
  type: NavigationType;
  
  /** 源节点ID */
  sourceNodeId: string;
  
  /** 源URL */
  sourceUrl: string;
  
  /** 目标URL */
  targetUrl: string;
  
  /** 附加数据，如链接文本、表单数据等 */
  data?: any;
  
  /** 创建时间戳 */
  timestamp: number;
  
  /** 过期时间戳 */
  expiresAt: number;
  
  /** 源标签页ID */
  sourceTabId?: number;
  
  /** 目标标签页ID */
  targetTabId?: number;
  
  /** 是否在新标签页打开 */
  isNewTab?: boolean;
}

/**
 * JavaScript导航记录
 * 跟踪JavaScript触发的页面导航
 */
export interface JsNavigationRecord {
  /** 导航源URL */
  from: string;
  
  /** 导航目标URL */
  to: string;
  
  /** 创建时间戳 */
  timestamp?: number;
}

/**
 * 链接点击信息
 */
export interface LinkClickInfo {
  /** 源页面节点ID */
  sourcePageId: string;
  
  /** 源页面URL */
  sourceUrl: string;
  
  /** 目标URL */
  targetUrl: string;
  
  /** 链接锚点文本 */
  anchorText: string;
  
  /** 是否在新标签页打开 */
  isNewTab: boolean;
  
  /** 创建时间戳 */
  timestamp: number;
}

/**
 * 表单提交信息
 */
export interface FormSubmitInfo {
  /** 源页面节点ID */
  sourcePageId: string;
  
  /** 源页面URL */
  sourceUrl: string;
  
  /** 表单提交目标URL */
  formAction: string;
  
  /** 表单元素信息 */
  formElements?: string[];
  
  /** 创建时间戳 */
  timestamp: number;
}