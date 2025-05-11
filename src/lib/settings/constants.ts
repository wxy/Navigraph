import { NavigraphSettings } from './types.js';

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: NavigraphSettings = {
  // 界面设置
  theme: 'system',
  defaultView: 'tree',
  
  // 会话管理
  // 会话设置默认值
  sessionMode: 'daily',   // 默认使用工作日模式
  idleTimeout: 6,        // 默认 6 小时空闲结束会话
  
  // 数据设置
  dataRetention: 30,
  trackAnonymous: false,
  
  // 性能设置
  animationEnabled: true,
  showLabels: true,
  maxNodes: 100
};

/**
 * 设置存储键
 */
export const SETTINGS_STORAGE_KEY = 'navigraph_settings';

/**
 * 本地存储缓存键
 */
export const SETTINGS_CACHE_KEY = 'navigraph_settings_cache';