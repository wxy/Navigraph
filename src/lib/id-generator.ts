/**
 * 统一的ID生成器
 */
export class IdGenerator {
  /**
   * 生成标准化的节点ID
   * @param tabId 标签页ID
   * @param url URL
   * @returns 基于标签ID和URL生成的节点ID
   */
  static generateNodeId(tabId: number, url: string): string {
    // 规范化URL
    const normalizedUrl = this.normalizeUrl(url);
    
    // 从URL中提取域名作为可读部分
    let domain = '';
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname.replace(/^www\./, '');
    } catch {
      domain = 'unknown';
    }
    
    // 创建URL的哈希
    const urlHash = this.hashString(normalizedUrl);
    
    // 返回格式: tabId-domain-urlHash
    return `${tabId}-${domain}-${urlHash}`;
  }
  
  /**
   * 规范化URL
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
   * 创建字符串的简短哈希值
   */
  static hashString(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString(36);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32bit整数
    }
    // 转换为更短的Base36字符串
    return Math.abs(hash).toString(36);
  }
}