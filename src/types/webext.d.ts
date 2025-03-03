// 导航记录
export interface NavigationRecord {
  id?: number;
  url: string;
  title?: string;
  timestamp: number;
  tabId: number;
  windowId?: number;
  parentTabId?: number;
  referrer?: string;
  favicon?: string;
  openMethod?: NavigationMethod;
  isNewTab?: boolean;
  loadTime?: number;
  date?: string;
}

// 导航方法
export type NavigationMethod = 
  'link' | 'address_bar' | 'history_back' | 'history_forward' | 
  'new_tab' | 'new_window' | 'popup' | 'form_submit' | 'reload' | 'same_tab';

// 日期组
export interface DayGroup {
  rootNodeIds: string[];
  nodes: Record<string, NavigationNode>;
}

// 标签组
export interface TabGroup {
  tabId: number;
  windowId?: number;
  nodes: NavigationNode[];
  rootNodeId?: string;
}

// 导航节点
export interface NavigationNode {
  id: string;
  depth: number;
  record: NavigationRecord;
  children: string[]; // 修改为字符串数组，存储节点ID而非节点对象
}

// 序列化的导航树
export interface SerializedNavigationTree {
  days: Record<string, DayGroup>;
}

// 声明Chrome API扩展
declare global {
  namespace chrome {
    namespace webNavigation {
      interface WebNavigationFramedCallbackDetails {
        transitionType?: string;
        transitionQualifiers?: string[];
      }
    }
  }
}