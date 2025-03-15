export {}; // 确保这是一个模块

declare global {
  interface Window {
    // 添加 d3 全局变量声明
    d3: any;
    
    Navigraph: {
      enhanceVisualizer?: () => Promise<void>;
      [key: string]: any;
    };
    visualizer?: any;
    NavigationVisualizer?: new () => any;
    __moduleLoader?: {
      loadModule: (path: string) => Promise<any>;
      preloadModules?: (paths: string[]) => Promise<any[]>;
      [key: string]: any;
    };
  }

  // 为 d3 添加一个基本的全局命名空间定义
  namespace d3 {
    function select(selector: string | Element | null): any;
    function selectAll(selector: string): any;
    function zoom(): any;
    const zoomIdentity: {
      translate(x: number, y: number): any;
      scale(k: number): any;
    };
    function stratify<T>(): any;
    function tree(): any;
    function scaleTime(): any;
    function axisBottom(scale: any): any;
    function timeFormat(specifier: string): (date: Date) => string;
    function zoomTransform(element: Element): { x: number, y: number, k: number };
    
    // 用于事件数据的通用接口
    interface ZoomEvent {
      transform: { x: number, y: number, k: number };
    }
  }

  interface TreeRenderer {
    renderTreeLayout: (
      container: any, 
      treeSvg: any, 
      nodes: any[], 
      links: any[], 
      width: number, 
      height: number,
      visualizer: any
    ) => void;
  }
  interface TimelineRenderer {
    renderTimelineLayout: (
      container: any, 
      timelineSvg: any, 
      nodes: any[], 
      links: any[], 
      width: number, 
      height: number,
      visualizer: any
    ) => void;
  }
}