import { _, _Error } from './i18n.js';  // 新增本地化导入

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
      // 移除片段标识符
      url = url.split('#')[0];
      
      // 规范化URL
      const urlObj = new URL(url);
      
      // 移除末尾斜线
      let path = urlObj.pathname;
      if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
      }
      
      // 重建URL (省略某些参数如UTM等)
      return `${urlObj.protocol}//${urlObj.host}${path}${urlObj.search}`;
    } catch {
      return url; // 如果解析失败，返回原始URL
    }
  }

    /**
     * 为存储级别的 SPA 聚合返回归一化 URL（仅 origin + pathname，移除查询参数）
     * 这样可以把仅修改查询参数的页面内部请求合并到同一页面节点（例如 translate.google.com）
     */
    static normalizeUrlForAggregation(url: string): string {
      try {
        url = url.split('#')[0];
        const urlObj = new URL(url);
        let path = urlObj.pathname;
        if (path.length > 1 && path.endsWith('/')) {
          path = path.slice(0, -1);
        }
        return `${urlObj.protocol}//${urlObj.host}${path}`;
      } catch {
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
  /**
   * 从URL中提取标题
   * 当节点没有原始标题时，尝试从URL中提取有意义的信息作为标题
   * @param url URL字符串
   * @returns 提取的标题
   */
  static extractTitle(url: string): string {
    try {
      if (!url) return _('url_utils_unknown_page', '未知页面');
      
      // 解析URL
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (e) {
        // 处理无效URL
        return url.substring(0, 30) || _('url_utils_unknown_page', '未知页面');
      }
      
      // 获取不带www的主机名
      const hostname = parsedUrl.hostname.replace(/^www\./, '');
      
      // 如果URL只有域名，直接返回
      if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
        return hostname;
      }
      
      // 尝试从路径中提取有意义的信息
      const pathSegments = parsedUrl.pathname.split('/').filter(segment => segment);
      
      // 如果路径为空，返回域名
      if (pathSegments.length === 0) {
        return hostname;
      }
      
      // 获取最后一个路径段，通常包含页面名称
      let lastSegment = pathSegments[pathSegments.length - 1];
      
      // 清理最后一个段中的文件扩展名和其他内容
      lastSegment = lastSegment
        .replace(/\.(html|htm|php|aspx|jsp|asp)$/, '')  // 移除文件扩展名
        .replace(/[-_]/g, ' ')  // 将连字符和下划线替换为空格
        .replace(/\b\w/g, c => c.toUpperCase());  // 首字母大写
      
      // 如果段为空或只有数字，使用上一级路径
      if (lastSegment.length === 0 || /^\d+$/.test(lastSegment)) {
        if (pathSegments.length > 1) {
          lastSegment = pathSegments[pathSegments.length - 2]
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        }
      }
      
      // 组合域名和路径段以创建描述性标题
      if (lastSegment && lastSegment.length > 0 && lastSegment !== 'Index') {
        return `${hostname} › ${lastSegment}`;
      } else {
        return hostname;
      }
    } catch (error) {
      return url.substring(0, 30) || _('url_utils_unknown_page', '未知页面');
    }
  }

  /// 格式化URL为简短版本
  static formatUrl(url: string, maxLength: number = 50): string {
    if (!url) return '';
    
    try {
      const urlObj = new URL(url);
      
      // 如果URL很短，直接返回
      if (url.length <= maxLength) return url;
      
      // 显示简化版本
      let formatted = urlObj.hostname;
      
      // 添加路径但智能截断
      if (urlObj.pathname && urlObj.pathname !== '/') {
        const pathDisplay = urlObj.pathname.length > 20 
          ? urlObj.pathname.substring(0, 17) + '...' 
          : urlObj.pathname;
        formatted += pathDisplay;
      }
      
      // 如果有查询参数，添加简化表示
      if (urlObj.search) {
        formatted += '?...';
      }
      
      return formatted;
    } catch {
      // URL无效，简单截断
      return url.length > maxLength 
        ? url.substring(0, maxLength - 3) + '...' 
        : url;
    }
  }

  /**
   * 获取favicon URL
   * @param url 页面URL
   * @param fallbackUrl 备选URL
   * @returns favicon URL
   */
  static getFaviconUrl(url: string, fallbackUrl?: string): string {
    // 如果有回退URL且不是空字符串，直接使用
    if (fallbackUrl && fallbackUrl.trim().length > 0) {
      return fallbackUrl;
    }

    // 使用Google的favicon服务
    try {
      const urlObj = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=128`;
    } catch (e) {
      // 如果URL解析失败，返回一个默认图标
      return "chrome://favicon/";
    }
  }
}