// global-types.d.ts - 不需要被导入，只需放在项目中
// 添加TypeScript的特殊注释，确保编译器始终包含该文件
/// <reference types="d3" />

type NavigraphSettingsType = import('../../lib/settings/types.js').NavigraphSettings;
type NavigationVisualizerType = import('../core/navigation-visualizer.js').NavigationVisualizer;

declare global {
  interface Window {
    // 添加 d3 全局变量声明
    d3: any;

    navigraphSettings: NavigraphSettingsType;
    visualizer: NavigationVisualizerType;
    
    // 构造函数类型
    NavigationVisualizer: new () => NavigationVisualizerType;
    
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
      visualizer: NavigationVisualizerType
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
      visualizer: NavigationVisualizerType
    ) => void;
  }
}

// 添加空导出使文件成为模块
export {};