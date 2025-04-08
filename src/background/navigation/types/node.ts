import { NavigationType, OpenTarget, NavNode } from '../../../types/session-types.js';

/**
 * 节点创建选项
 */
export interface NodeCreationOptions {
  /** 标签页ID */
  tabId: number;
  
  /** 节点URL */
  url: string;
  
  /** 父节点ID (可选) */
  parentId?: string;
  
  /** 导航类型 (可选) */
  navigationType?: NavigationType;
  
  /** 打开目标 (可选) */
  openTarget?: OpenTarget;
  
  /** 来源 (可选) */
  source?: string;
  
  /** 引用页面 (可选) */
  referrer?: string;
  
  /** 时间戳 (可选，默认为当前时间) */
  timestamp?: number;
  
  /** 框架ID (可选) */
  frameId?: number;
  
  /** 父框架ID (可选) */
  parentFrameId?: number;
}

/**
 * 节点元数据选项
 */
export interface NodeMetadataOptions {
  /** 页面标题 */
  title?: string;
  
  /** 页面图标 */
  favicon?: string;
  
  /** 引用页面 */
  referrer?: string;
  
  /** 加载时间 (毫秒) */
  loadTime?: number;
  
  /** 页面描述 */
  description?: string;
  
  /** 页面关键词 */
  keywords?: string;
}

/**
 * 元数据来源
 */
export type MetadataSource = 'chrome_api' | 'content_script' | 'navigation_event';

/**
 * 更新源节点结果
 */
export interface UpdateNodeResult {
  /** 成功更新 */
  success: boolean;
  
  /** 更新的字段 */
  updatedFields?: string[];
  
  /** 错误信息 */
  error?: string;
}