/**
 * Navigraph - 浏览历史可视化扩展
 * 模块化入口文件
 * 
 * 此文件假设index-old.js已通过HTML直接加载，
 * 专注于提供额外功能和未来模块化的基础框架。
 */

import './types/global'; // 导入全局类型定义

// 立即执行函数
(function() {
  'use strict';
  
  // 设置全局命名空间
  window.Navigraph = window.Navigraph || {};
  
  // 监听DOM加载完成事件
  document.addEventListener('DOMContentLoaded', function() {
    console.log('Navigraph 模块化增强版本初始化中...');
    
    // 给原始初始化代码一点执行时间
    setTimeout(initializeEnhancement, 500);
  });
  
  /**
   * 初始化增强功能
   */
  function initializeEnhancement(): void {
    // 检查可视化器是否已经存在
    if (window.visualizer) {
      console.log('检测到可视化器实例，准备应用增强功能');
      applyEnhancements();
      return;
    }
    
    console.warn('未检测到可视化器实例，尝试创建');
    
    // 尝试检查NavigationVisualizer类是否可用
    if (typeof window.NavigationVisualizer === 'function') {
      try {
        console.log('创建新的可视化器实例');
        window.visualizer = new window.NavigationVisualizer();
        
        // 如果成功创建，应用增强功能
        if (window.visualizer) {
          console.log('可视化器创建成功，应用增强功能');
          applyEnhancements();
        }
      } catch (err) {
        console.error('创建可视化器实例失败:', err);
        showErrorMessage('初始化可视化器失败');
      }
    } else {
      console.error('NavigationVisualizer类不可用，可能是index-old.js未正确加载');
      showErrorMessage('找不到必要的类定义，请确保扩展正确安装');
    }
  }
  
  /**
   * 应用增强功能
   * 这里是模块化重构的核心
   */
  async function applyEnhancements(): Promise<void> {
    if (!window.visualizer) return;
    
    console.log('开始应用增强功能...');
    
    // 例1：增加版本识别
    window.visualizer.version = "1.0.0-modular";
    
    try {
      // 导入模块加载器
      const { loadModule } = await importModuleLoader();
      console.log('模块加载器已加载');
      
      // 加载时间线渲染模块
      const timelineRenderer = await loadModule('renderers/timeline-renderer.js') as TimelineRenderer;
      
      if (timelineRenderer && typeof timelineRenderer.renderTimelineLayout === 'function') {
        console.log('替换时间线渲染方法');
        
        // 保存原始方法便于调试或回退
        window.visualizer._originalRenderTimelineLayout = window.visualizer.renderTimelineLayout;
        
        // 替换为模块化版本
        window.visualizer.renderTimelineLayout = function(
          container: any, 
          timelineSvg: any, 
          nodes: any[], 
          links: any[], 
          width: number, 
          height: number
        ): void {
          return timelineRenderer.renderTimelineLayout(container, timelineSvg, nodes, links, width, height, this);
        };
      }
      
      // 添加性能监控
      const originalRenderMethod = window.visualizer.renderVisualization;
      if (originalRenderMethod) {
        window.visualizer.renderVisualization = function(): any {
          console.time('renderVisualization');
          const result = originalRenderMethod.apply(this, arguments);
          console.timeEnd('renderVisualization');
          return result;
        };
      }
      
      console.log('模块加载和替换完成');
    } catch (err) {
      console.error('模块加载失败:', err);
    }
    
    // 向命名空间暴露关键功能，便于调试和开发
    window.Navigraph.enhanceVisualizer = applyEnhancements;
    
    console.log('增强功能应用完成');
  }
  
  /**
   * 导入模块加载器
   * 这是一个辅助函数，通过动态脚本加载module-loader.js
   */
  function importModuleLoader(): Promise<{ loadModule: (path: string) => Promise<any> }> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      
      // 修正路径，使用dist目录而不是src
      script.textContent = `
        import * as moduleLoader from '${chrome.runtime.getURL('dist/content/module-loader.js')}';
        window.__moduleLoader = moduleLoader;
        window.dispatchEvent(new CustomEvent('moduleLoaderReady'));
      `;
      
      window.addEventListener('moduleLoaderReady', () => {
        if (window.__moduleLoader) {
          resolve(window.__moduleLoader);
        } else {
          reject(new Error('模块加载器定义丢失'));
        }
      }, { once: true });
      
      script.onerror = function(this: HTMLScriptElement, ev: Event | string) {
        console.error('加载模块加载器失败:', ev);
        reject(new Error('无法加载模块加载器'));
      };
      
      document.head.appendChild(script);
    });
  }
  
  /**
   * 显示错误消息
   */
  function showErrorMessage(message: string): void {
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#333;color:#fff;padding:20px;border-radius:5px;text-align:center;z-index:1000;';
    container.innerHTML = `<h3>错误</h3><p>${message}</p><button onclick="location.reload()">刷新页面</button>`;
    document.body.appendChild(container);
  }
})();