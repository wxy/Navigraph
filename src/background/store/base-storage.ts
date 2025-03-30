// src/background/lib/store/base-storage.ts
export abstract class BaseStorage {
  protected initialized = false;
  
  /**
   * 初始化存储
   */
  public abstract initialize(): Promise<void>;
  
  /**
   * 确保已初始化
   */
  protected async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}