/**
 * 可视化工具函数库
 * 提供与导航可视化相关的通用工具函数
 */

import { NavNode, Visualizer } from '../types/navigation';

/**
 * 获取节点颜色
 * @param type 节点类型
 * @returns 颜色代码
 */
export function getNodeColor(type: string): string {
  switch(type) {
    case 'link_click': return '#7cb9e8';
    case 'address_bar': return '#c0e8a5';
    case 'form_submit': return '#f5d76e';
    case 'reload': return '#bcbcbc';
    case 'history_back':
    case 'history_forward': return '#d3a4f9';
    case 'redirect': return '#ff9966';
    case 'javascript': return '#66ccff';
    default: return '#aaaaaa';
  }
}

/**
 * 获取边的颜色
 * @param type 边的类型
 * @returns 颜色代码
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
 * 检查页面是否为跟踪类型
 * @param node 节点对象
 * @param visualizer 可视化器实例
 * @returns 是否为跟踪类型页面
 */
export function isTrackingPage(node: NavNode, visualizer: Visualizer): boolean {
  // 如果visualizer有实现此方法，则使用它
  if (visualizer && typeof visualizer.isTrackingPage === 'function') {
    return visualizer.isTrackingPage(node);
  }
  
  // 否则使用简单的后备实现
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
 * 格式化时间戳为可读字符串
 * @param timestamp 时间戳
 * @returns 格式化后的日期时间字符串
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * 计算两个节点之间的连线路径
 * @param source 源节点坐标
 * @param target 目标节点坐标
 * @param linkType 连线类型
 * @returns SVG路径字符串
 */
export function calculateLinkPath(
  source: {x: number, y: number}, 
  target: {x: number, y: number}, 
  linkType: string
): string {
  if (linkType === 'history_back' || linkType === 'history_forward') {
    // 弯曲的线条
    return `M${source.x},${source.y} 
            C${source.x + (target.x - source.x) * 0.5},${source.y} 
              ${source.x + (target.x - source.x) * 0.5},${target.y} 
              ${target.x},${target.y}`;
  } else {
    // 直线
    return `M${source.x},${source.y} L${target.x},${target.y}`;
  }
}