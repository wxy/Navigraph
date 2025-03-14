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