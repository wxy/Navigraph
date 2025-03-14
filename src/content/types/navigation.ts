/**
 * 导航图谱公共类型定义
 */

// 定义节点接口
export interface NavNode {
  id: string;
  timestamp: number;
  type: string;
  title?: string;
  url?: string;
  favicon?: string;
  isClosed?: boolean;
  renderX?: number;
  renderY?: number;
  [key: string]: any; // 允许其他属性
}

// 定义连线接口
export interface NavLink {
  source: string;
  target: string;
  type: string;
  [key: string]: any; // 允许其他属性
}

// 定义可视化器接口
export interface Visualizer {
  nodeMap?: Map<string, NavNode>;
  svg?: any; 
  zoom?: any;
  showNodeDetails?: (node: NavNode) => void;
  isTrackingPage?: (node: NavNode) => boolean;
  _isRestoringTransform?: boolean;
  [key: string]: any; // 允许其他属性
}