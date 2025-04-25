/**
 * 环境检测
 * 基于manifest.json中的版本号格式判断环境
 */
export class Environment {
  private static _isDevelopment: boolean | null = null;
  
  /**
   * 判断当前是否为开发环境
   * - 开发版本：包含 -dev 后缀，如 "1.0.0-dev"
   * - 生产版本：纯数字格式，如 "1.0.0"
   */
  public static isDevelopment(): boolean {
    if (this._isDevelopment === null) {
      try {
        const manifest = chrome.runtime.getManifest();
        const version = manifest.version || '';
        
        // 检查版本号是否以0开头(开发版本)
        this._isDevelopment = version.startsWith('0.');
      } catch (error) {
        console.error('读取扩展版本信息失败:', error);
        this._isDevelopment = false; // 默认为生产环境
      }
    }
    return this._isDevelopment;
  }
  
  /**
   * 判断当前是否为生产环境
   */
  public static isProduction(): boolean {
    return !this.isDevelopment();
  }
}

// 导出便捷函数
export const isDev = (): boolean => Environment.isDevelopment();
export const isProd = (): boolean => Environment.isProduction();