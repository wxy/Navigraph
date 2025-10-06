/**
 * 导航图谱公共类型定义
 */

import { FilterStates } from '../visualizer/ui/FilterConfig.js';
import { SessionDetails } from './session.js';

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

// 扩展基本节点类型，包含D3树特有属性
export interface ExtendedNavNode extends NavNode {
  children?: ExtendedNavNode[];
  parentId?: string;
  isRoot?: boolean;
  isSelfLoop?: boolean;
  isClosed?: boolean;
  depth?: number;
  hasFilteredChildren?: boolean;
  filteredChildrenCount?: number;
}

/**
 * 节点元数据接口
 * 用于更新节点的各种元数据属性
 */
export interface NodeMetadata {
  /** 节点标题 */
  title?: string;
  /** 节点图标URL */
  favicon?: string;
  /** 节点URL */
  url?: string;
  // 其他可能的元数据属性
  [key: string]: string | undefined;
}

/**
 * D3树节点接口
 * 对应树布局后的节点结构
 */
export interface D3TreeNode {
  x: number;          // 布局计算的x坐标 
  y: number;          // 布局计算的y坐标
  data: ExtendedNavNode; // 节点数据
  children?: D3TreeNode[]; // 子节点
  parent?: D3TreeNode | null; // 父节点引用
  depth: number;      // 节点深度（从根节点开始）
}

/**
 * D3树布局后的链接接口
 */
export interface D3TreeLink {
  source: D3TreeNode;  // 源节点对象
  target: D3TreeNode;  // 目标节点对象
}

/**
 * 导航可视化器接口
 */
export interface Visualizer {
  // 原有的基本属性和方法
  
  // 状态栏相关
  statusBar?: HTMLElement;
  
  // 视图相关
  currentView: string;
  currentTransform?: {x: number, y: number, k: number};
  svg?: any;
  zoom?: any;
  container?: HTMLElement | any;

  // 会话相关
  currentSession?: SessionDetails
  
  // 节点和边数据
  nodes: NavNode[];
  edges: NavLink[];

  // 其他必要属性
  tabId?: string;
  width?: number;
  height?: number;
  filters: FilterStates;
  
  // 常用方法
  refreshVisualization(): void;
  showNodeDetails(data: any): void;
  switchView(viewName: "tree" | "timeline" | "waterfall"): void;
  updateStatusBar(): void;
  isTrackingPage(node: NavNode): boolean;

  // 添加筛选器相关方法
  updateFilter(filterId: string, value: boolean): void;
  applyFilters(): void;
  updateData(data: any): void;
  getFilterUrlParam(): string;
}
