/**
 * 主题设置类型
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * 视图类型
 */
export type ViewType = 'tree' | 'timeline';

/**
 * 会话模式
 */
export type SessionMode = 'auto' | 'manual' | 'smart' | 'daily' | 'activity';

/**
 * Navigraph 设置接口
 * 定义用户可配置的所有设置项
 */
export interface NavigraphSettings {
  // 界面设置
  theme: Theme;
  defaultView: ViewType;
  defaultZoom: number;
  
  // 会话管理
  sessionMode: SessionMode;
  sessionTimeout: number;
  
  // 数据设置
  dataRetention: number;
  trackAnonymous: boolean;
  
  // 性能设置
  animationEnabled: boolean;
  showLabels: boolean;
  maxNodes: number;
  
  // 其他设置
  [key: string]: any;
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