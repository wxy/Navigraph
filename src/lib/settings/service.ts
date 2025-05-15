import { Logger } from '../../lib/utils/logger.js';
import { _, _Error } from '../utils/i18n.js';  // 添加 i18n 导入
import { NavigraphSettings, SettingsChangeListener } from './types.js';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, SETTINGS_CACHE_KEY } from './constants.js';

const logger = new Logger('SettingsService');

/**
 * 设置服务类 - 单例模式
 * 管理 Navigraph 扩展的设置
 */
export class SettingsService {
  private static instance: SettingsService;
  private currentSettings: NavigraphSettings = { ...DEFAULT_SETTINGS };
  private listeners: SettingsChangeListener[] = [];
  private initialized: boolean = false;
  
  /**
   * 私有构造函数（单例模式）
   */
  private constructor() {

  }
  
  /**
   * 获取设置服务实例
   */
  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }
  
  /**
   * 初始化设置服务
   */
  public async initialize(): Promise<void> {
    try {
      // 尝试从缓存加载设置（快速响应）
      this.loadFromCache();
      
      // 从存储加载设置（最新状态）
      await this.loadFromStorage();
      
      // 设置初始化完成
      this.initialized = true;
      
      logger.log(_('settings_service_init_complete', '设置服务初始化完成'));
    } catch (error) {
      logger.error(_('settings_service_init_failed', '设置服务初始化失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }
  
  /**
   * 从本地存储缓存加载设置
   */
  private loadFromCache(): void {
    if (!this.canUseLocalStorage()) return;
  
    try {
      const cachedSettings = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (cachedSettings) {
        const settings = JSON.parse(cachedSettings);
        this.updateSettingsInternal(settings);
      }
    } catch (error) {
      logger.warn(_('settings_cache_load_failed', '从本地缓存加载设置失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }
  
  /**
   * 从 Chrome 存储加载设置
   */
  private async loadFromStorage(): Promise<void> {
    try {
      const items = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
      
      if (items && items[SETTINGS_STORAGE_KEY]) {
        const settings = items[SETTINGS_STORAGE_KEY] as NavigraphSettings;
        this.updateSettingsInternal(settings);
        // 更新本地缓存
        this.updateCache(settings);
        logger.log(_('settings_loaded_from_storage', '已从存储中加载设置'));
      } else {
        logger.log(_('settings_not_found_using_defaults', '存储中未找到设置，使用默认值'));
        // 如果存储中没有设置，保存默认设置
        if (this.initialized) {
          // 如果已经初始化，只更新内部状态，不保存到存储
          // 避免重复存储操作
          this.updateSettingsInternal(DEFAULT_SETTINGS);
        } else {
          // 首次初始化，保存默认设置到存储
          await this.saveToStorage(DEFAULT_SETTINGS);
        }
      }
    } catch (error) {
      logger.error(_('settings_storage_load_failed', '从存储加载设置失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('settings_storage_load_failed', '从存储加载设置失败: {0}', error instanceof Error ? error.message : String(error));
    }
  }
  
  /**
   * 保存设置到 Chrome 存储
   */
  private async saveToStorage(settings: NavigraphSettings): Promise<void> {
    try {
      // 使用单一键存储所有设置，减少碎片化
      await chrome.storage.sync.set({ [SETTINGS_STORAGE_KEY]: settings });
      
      // 同时更新本地缓存
      this.updateCache(settings);
    } catch (error) {
      logger.error(_('settings_storage_save_failed', '保存设置到存储失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('settings_storage_save_failed', '保存设置到存储失败: {0}', error instanceof Error ? error.message : String(error));
    }
  }
  
  /**
   * 更新本地缓存
   */
  private updateCache(settings: NavigraphSettings): void {
    if (!this.canUseLocalStorage()) return;
    
    try {
      const cacheData = {
        version: "1.0", // 缓存格式版本
        timestamp: Date.now(),
        data: settings
      };
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      logger.warn(_('settings_cache_update_failed', '更新设置缓存失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }
  
  /**
   * 检查是否可以使用本地存储
   */
  private canUseLocalStorage(): boolean {
    try {
      return typeof window !== 'undefined' && 
             typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }
  
  /**
   * 更新设置内部状态（不保存到存储）
   */
  private updateSettingsInternal(settings: Partial<NavigraphSettings>): void {
    // 合并设置
    this.currentSettings = {
      ...this.currentSettings,
      ...settings
    };
    
    // 通知监听器
    this.notifyListeners();
  }
  
  /**
   * 检查是否已初始化
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * 获取当前设置
   */
  public getSettings(): NavigraphSettings {
    return { ...this.currentSettings };
  }
  
  /**
   * 获取特定设置项
   */
  public getSetting<K extends keyof NavigraphSettings>(key: K): NavigraphSettings[K] {
    return this.currentSettings[key];
  }
  
  /**
   * 更新设置
   */
  public async updateSettings(settings: Partial<NavigraphSettings>): Promise<void> {
    try {
      // 合并新旧设置
      const newSettings = { ...this.currentSettings, ...settings };
      
      // 保存到存储
      await this.saveToStorage(newSettings);
      
      // 更新内部状态
      this.updateSettingsInternal(newSettings);
      
      // 不再广播设置变更，改为显示用户提示
    } catch (error) {
      logger.error(_('settings_update_failed', '更新设置失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('settings_update_failed', '更新设置失败: {0}', error instanceof Error ? error.message : String(error));
    }
  }
  
  /**
   * 重置为默认设置
   */
  public async resetSettings(): Promise<void> {
    try {
      // 保存默认设置
      await this.saveToStorage(DEFAULT_SETTINGS);
      
      // 更新内部状态
      this.updateSettingsInternal(DEFAULT_SETTINGS);
      
      // 不再广播设置变更，改为显示用户提示
    } catch (error) {
      logger.error(_('settings_reset_failed', '重置设置失败: {0}'), error instanceof Error ? error.message : String(error));
      throw new _Error('settings_reset_failed', '重置设置失败: {0}', error instanceof Error ? error.message : String(error));
    }
  }
  
  /**
   * 刷新设置
   * 从存储中重新加载最新设置
   */
  public async refreshSettings(): Promise<NavigraphSettings> {
    try {
      // 重新从存储加载设置
      await this.loadFromStorage();
      
      // 返回最新的设置
      return this.getSettings();
    } catch (error) {
      logger.error(_('settings_refresh_failed', '刷新设置失败: {0}'), error instanceof Error ? error.message : String(error));
      return this.getSettings(); // 即使出错也返回当前设置
    }
  }
  
  /**
   * 添加设置变更监听器
   */
  public addChangeListener(listener: SettingsChangeListener): () => void {
    this.listeners.push(listener);
    
    // 如果已初始化，立即调用监听器
    if (this.initialized) {
      try {
        listener(this.getSettings());
      } catch (error) {
        logger.error(_('settings_listener_call_failed', '调用设置变更监听器失败: {0}'), error instanceof Error ? error.message : String(error));
      }
    }
    
    // 返回移除监听器的函数
    return () => this.removeChangeListener(listener);
  }
  
  /**
   * 移除设置变更监听器
   */
  public removeChangeListener(listener: SettingsChangeListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }
  
  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    const settings = this.getSettings();
    for (const listener of this.listeners) {
      try {
        listener(settings);
      } catch (error) {
        logger.error(_('settings_listener_notify_failed', '通知设置变更监听器失败: {0}'), error instanceof Error ? error.message : String(error));
      }
    }
  }
}

// 导出单例实例访问器
export const getSettingsService = (): SettingsService => SettingsService.getInstance();

// 以下是便捷的快捷函数，可以直接使用
export const getSettings = (): NavigraphSettings => getSettingsService().getSettings();
export const getSetting = <K extends keyof NavigraphSettings>(key: K): NavigraphSettings[K] => 
  getSettingsService().getSetting(key);
export const refreshSettings = (): Promise<NavigraphSettings> => 
  getSettingsService().refreshSettings();
export const updateSettings = (settings: Partial<NavigraphSettings>): Promise<void> => 
  getSettingsService().updateSettings(settings);
export const resetSettings = (): Promise<void> => 
  getSettingsService().resetSettings();