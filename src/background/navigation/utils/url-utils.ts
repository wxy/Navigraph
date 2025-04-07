/**
 * URL 处理工具类
 * 提供 URL 标准化和分类的工具函数
 */
export class UrlUtils {
  /**
   * 标准化 URL (移除片段标识符、末尾斜杠等)
   * @param url 需要标准化的 URL
   * @returns 标准化后的 URL
   */
  static normalizeUrl(url: string): string {
    try {
      // 移除 URL 末尾的斜杠和片段标识符
      return url.replace(/\/$/, "").split("#")[0];
    } catch (e) {
      return url;
    }
  }

  /**
   * 判断两个 URL 是否匹配 (忽略尾斜杠和锚点)
   * @param url1 第一个 URL
   * @param url2 第二个 URL
   * @returns 两个 URL 是否匹配
   */
  static isSameUrl(url1: string, url2: string): boolean {
    try {
      return UrlUtils.normalizeUrl(url1) === UrlUtils.normalizeUrl(url2);
    } catch (e) {
      return url1 === url2;
    }
  }
  
  /**
   * 判断是否为系统页面
   * @param url 要检查的 URL
   * @returns 是否为系统页面
   */
  static isSystemPage(url: string): boolean {
    if (!url) return false;

    // 检查常见的系统页面 URL 模式
    return (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("devtools://") ||
      url.startsWith("about:") ||
      url.startsWith("edge://") ||
      url.startsWith("brave://") ||
      url.startsWith("opera://") ||
      url.startsWith("vivaldi://") ||
      url.startsWith("view-source:") ||
      url.startsWith("file://") ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    );
  }

  /**
   * 判断是否为空白页或新标签页
   * @param url 要检查的 URL
   * @returns 是否为空白页或新标签页
   */
  static isEmptyTabUrl(url: string): boolean {
    return (
      !url ||
      url === "about:blank" ||
      url === "chrome://newtab/" ||
      url.startsWith("chrome://newtab") ||
      url === "edge://newtab/" ||
      url === "brave://newtab/"
    );
  }

  /**
   * 判断是否为错误页面
   * @param url 要检查的 URL
   * @returns 是否为错误页面
   */
  static isErrorPage(url: string): boolean {
    return (
      url.startsWith("chrome-error://") ||
      url.startsWith("chrome://crash") ||
      url.startsWith("chrome://kill")
    );
  }

  /**
   * 从 URL 中提取域名部分
   * @param url 要处理的 URL
   * @returns 提取的域名，如果解析失败则返回空字符串
   */
  static extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      return '';
    }
  }

  /**
   * 检查 URL 是否是有效的 HTTP(S) URL
   * @param url 要检查的 URL
   * @returns 是否是有效的 HTTP(S) URL
   */
  static isValidHttpUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }
}