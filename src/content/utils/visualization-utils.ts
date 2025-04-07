/**
 * 可视化工具函数
 * 为渲染器提供共享功能
 */
import { Logger } from '../../lib/utils/logger.js';
import { NavNode, NavLink, Visualizer } from '../types/navigation.js';

const logger = new Logger('VisualizationUtils');
/**
 * 获取节点颜色
 */
export function getNodeColor(type: string): string {
  switch (type) {
    case 'link_click':
      return '#7cb9e8';
    case 'address_bar':
      return '#c0e8a5';
    case 'form_submit':
      return '#f5d76e';
    case 'reload':
      return '#bcbcbc';
    case 'history_back':
    case 'history_forward':
      return '#d3a4f9';
    case 'redirect':
      return '#ff9966';
    case 'javascript':
      return '#66ccff';
    default:
      return '#aaaaaa';
  }
}

/**
 * 获取边颜色
 */
export function getEdgeColor(type: string): string {
  const colors: Record<string, string> = {
    'link_click': '#7cb9e8',
    'address_bar': '#c0e8a5',
    'form_submit': '#f5d76e',
    'reload': '#bcbcbc',
    'history_back': '#d3a4f9',
    'history_forward': '#d3a4f9',
    'redirect': '#ff9966',
    'javascript': '#66ccff',
    'generated': '#aaaaaa',
    'session_link': '#555555'
  };
  
  return colors[type] || '#999999';
}

/**
 * 判断是否为跟踪页面
 */
export function isTrackingPage(node: NavNode, visualizer: Visualizer): boolean {
  
  // 否则使用内置的模式匹配
  const trackingPatterns = [
    /google.*\/analytics/i,
    /tracker/i,
    /tracking/i,
    /facebook.*\/tr/i,
    /pixel/i
  ];
  
  if (!node.url) return false;
  
  return trackingPatterns.some(pattern => pattern.test(node.url as string));
}

/**
 * 格式化时间戳
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * 计算连接路径
 */
export function calculateLinkPath(
  source: { x: number, y: number },
  target: { x: number, y: number },
  linkType: string
): string {
  if (linkType === 'history_back' || linkType === 'history_forward') {
    return `M${source.x},${source.y} 
            C${source.x + (target.x - source.x) * 0.5},${source.y} 
              ${source.x + (target.x - source.x) * 0.5},${target.y} 
              ${target.x},${target.y}`;
  } else {
    return `M${source.x},${source.y} L${target.x},${target.y}`;
  }
}

/**
 * 获取节点的CSS类名
 * 从tree-renderer.ts移动而来
 */
export function getNodeClass(node: NavNode, visualizer: Visualizer): string {
  if (!node) return 'node default';
  
  let classes = `node ${node.type || 'default'}`;
  
  if (node.isClosed) {
    classes += ' closed';
  }
  
  if (isTrackingPage(node, visualizer)) {
    classes += ' tracking';
  }
  
  return classes;
}

/**
 * 获取连接类型
 * 从tree-renderer.ts移动而来
 */
export function getLinkType(d3Link: any, links: NavLink[]): string {
  try {
    // 添加安全检查
    if (!d3Link || !d3Link.source || !d3Link.target || 
        !d3Link.source.data || !d3Link.target.data) {
      return 'default';
    }
    
    // 查找原始连接类型
    const sourceId = d3Link.source.data.id;
    const targetId = d3Link.target.data.id;
    
    if (!sourceId || !targetId) {
      return 'default';
    }
    
    const originalLink = links.find(link => 
      link.source === sourceId && link.target === targetId);
    
    return originalLink ? originalLink.type : 'default';
  } catch (err) {
    logger.warn('获取链接类型时出错:', err);
    return 'default';
  }
}

/**
 * 渲染空树消息
 * 从tree-renderer.ts移动而来
 */
export function renderEmptyTreeMessage(svg: any, width: number, height: number): void {
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', '#999')
    .text('无导航数据可显示');
}