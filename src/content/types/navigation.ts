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

// 定义可视化器接口
export interface Visualizer {
  nodeMap?: Map<string, NavNode>;
  svg?: any; 
  zoom?: any;
  showNodeDetails?: (node: NavNode) => void;
  isTrackingPage?: (node: NavNode) => boolean;
  _isRestoringTransform?: boolean;
  container?: HTMLElement | any;
  tabId?: string;
  currentView?: string;
  currentSession?: any;
  _savedTransform?: {x: number, y: number, k: number};
  switchToTimelineView?: () => void;
  [key: string]: any; // 允许其他属性
}
