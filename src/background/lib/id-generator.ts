/**
 * 统一的ID生成器
 */
import { Logger } from '../../lib/utils/logger.js';
const logger = new Logger('IdGenerator');

export class IdGenerator {
  /**
   * 生成标准化的节点ID
   * @param tabId 标签页ID
   * @param url URL
   * @returns 基于标签ID和URL生成的节点ID
   */
  public static generateNodeId(tabId: number, url: string): string {
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
   * 生成边ID
   */
  public static generateEdgeId(sourceId: string, targetId: string, timestamp: number): string {
    return `edge-${sourceId}-${targetId}-${timestamp}`;
  }
  
  /**
   * 生成会话ID
   * 使用更直观的日期格式，便于识别会话创建日期
   * @returns 格式为 session-YYYYMMDD-HHMMSS-XXX 的会话ID
   */
  static generateSessionId(): string {
    const now = new Date();
    
    // 格式化日期部分: YYYYMMDD
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // 格式化时间部分: HHMMSS
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}${minutes}${seconds}`;
    
    // 添加随机后缀以确保唯一性
    const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    return `session-${dateStr}-${timeStr}-${randomSuffix}`;
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