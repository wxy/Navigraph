import { NavigraphSettings } from './types.js';

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: NavigraphSettings = {
  theme: 'system',
  defaultView: 'tree',
  defaultZoom: 1.0,
  sessionMode: 'smart',
  dataRetention: 30
};

/**
 * 设置存储键
 */
export const SETTINGS_STORAGE_KEY = 'navigraph_settings';

/**
 * 本地存储缓存键
 */
export const SETTINGS_CACHE_KEY = 'navigraph_settings_cache';