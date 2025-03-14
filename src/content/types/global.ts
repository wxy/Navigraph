export {}; // 确保这是一个模块

declare global {
  interface Window {
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

  // 在global块内定义时间线渲染器接口
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