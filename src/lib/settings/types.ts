/**
 * Navigraph 设置接口
 */
export interface NavigraphSettings {
  // 基本设置
  theme: 'light' | 'dark' | 'system';
  defaultView: 'tree' | 'timeline';
  defaultZoom: number;
  
  // 会话管理
  sessionMode: 'daily' | 'activity' | 'smart' | 'manual';
  
  // 数据保留
  dataRetention: 7 | 14 | 30 | 90 | 180 | 365 | 0; // 0表示永久
}

/**
 * 设置变更监听器类型
 */
export type SettingsChangeListener = (settings: NavigraphSettings) => void;

/**
 * 设置变更事件类型
 */
export interface SettingsChangeEvent {
  action: 'settingsChanged';
  settings: NavigraphSettings;
}

/**
 * 设置更新事件类型
 */
export interface SettingsUpdateEvent {
  action: 'settingsUpdated';
  settings?: Partial<NavigraphSettings>;
}