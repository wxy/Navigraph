// 导航类型 - 描述如何发起导航
export type NavigationType = 
  'link_click' |    // 链接点击
  'address_bar' |   // 地址栏输入/粘贴
  'form_submit' |   // 表单提交
  'history_back' |  // 历史后退
  'history_forward' | // 历史前进
  'reload' |        // 页面重新加载
  'javascript' |    // JavaScript导航
  'initial';        // 初始页面加载

// 打开位置 - 描述导航的目标位置
export type OpenTarget = 
  'same_tab' |      // 当前标签页
  'new_tab' |       // 新标签页
  'new_window' |    // 新窗口
  'popup';          // 弹出窗口

// 导航记录
export interface NavigationRecord {
  url: string;                 // 页面URL
  title?: string;              // 页面标题
  timestamp: number;           // 时间戳
  tabId: number;               // 标签页ID (技术实现需要)
  windowId?: number;           // 窗口ID (技术实现需要)
  favicon?: string;            // 网站图标
  navigationType?: NavigationType; // 导航类型
  openTarget?: OpenTarget;      // 打开位置
  referrer?: string;           // 来源页面
  loadTime?: number;           // 加载时间
  date?: string;               // 日期字符串 (YYYY-MM-DD)

}

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
  id: string;           // 节点唯一标识符
  record: NavigationRecord; // 关联的导航记录
  children: string[];   // 子节点ID列表
  depth: number;        // 节点在树中的深度
}

// 序列化的导航树
export interface SerializedNavigationTree {
  days: Record<string, DayGroup>;
}

// 父子关系映射
export interface NavigationRelations {
  [childNodeId: string]: string; // childNodeId -> parentNodeId
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