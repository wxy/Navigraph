/**
 * Navigraph - 浏览历史可视化扩展
 * 模块化入口文件
 * 
 * 此文件假设index-old.js已通过HTML直接加载，
 * 专注于提供额外功能和未来模块化的基础框架。
 */
/// <reference path="types/global.ts" />

// 立即执行函数
(function() {
  'use strict';
  
  // 设置全局命名空间
  window.Navigraph = window.Navigraph || {};
  console.log('Navigraph 模块化增强版本');
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
      try {
        const timelineRenderer = await loadModule('renderers/timeline-renderer.js');
        
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
      } catch (timelineErr) {
        console.error('时间线渲染器加载失败:', timelineErr);
      }
      
      // 加载树形图渲染模块
      try {
        const treeRenderer = await loadModule('renderers/tree-renderer.js');
        
        if (treeRenderer && typeof treeRenderer.renderTreeLayout === 'function') {
          console.log('替换树形图渲染方法');
          
          // 保存原始方法便于调试或回退
          window.visualizer._originalRenderTreeLayout = window.visualizer.renderTreeLayout;
          
          // 替换为模块化版本，并适配参数顺序
          window.visualizer.renderTreeLayout = function(
            container: any, 
            nodes: any[], 
            links: any[], 
            width: number, 
            height: number
          ): void {
            console.log('调用增强树形图渲染器，参数适配中');
            
            // 创建一个新的SVG容器，在container内部
            let treeSvg = null;

            try {
              // 标准化链接数据
              const normalizedLinks = links.map(link => {
                const result: any = { ...link };
                
                // 确保source和target是正确格式
                if (typeof result.source === 'string') {
                  const sourceNode = nodes.find(n => n.id === result.source);
                  result.source = sourceNode || result.source;
                }
                
                if (typeof result.target === 'string') {
                  const targetNode = nodes.find(n => n.id === result.target);
                  result.target = targetNode || result.target;
                }
                
                return result;
              });
              
              // 检查container是否是D3选择器
              if (container && typeof container.append === 'function') {
                console.log('container是D3选择器，查找或创建SVG');
                
                // 首先尝试查找已存在的svg元素
                treeSvg = container.select('svg.tree-view');
                
                // 如果没有找到，则创建一个
                if (!treeSvg.node()) {
                  console.log('container中未找到SVG，创建一个新的');
                  treeSvg = container.append('svg')
                    .attr('class', 'tree-view')
                    .attr('width', width)
                    .attr('height', height);
                }
              } else {
                console.log('container不是D3选择器，转换它');
                try {
                  const containerSelection = d3.select(container);
                  
                  // 首先尝试查找已存在的svg元素
                  treeSvg = containerSelection.select('svg.tree-view');
                  
                  // 如果没有找到，则创建一个
                  if (!treeSvg.node()) {
                    console.log('container中未找到SVG，创建一个新的');
                    treeSvg = containerSelection.append('svg')
                      .attr('class', 'tree-view')
                      .attr('width', width)
                      .attr('height', height);
                  }
                } catch (d3Error : any) {
                  console.error('d3转换失败:', d3Error);
                  throw new Error('无法创建SVG容器: ' + d3Error.message);
                }
              }
              
              // 确认treeSvg是有效的
              if (!treeSvg || typeof treeSvg.selectAll !== 'function') {
                throw new Error('无法创建有效的树形图SVG容器');
              }
              
              console.log('Tree SVG准备就绪:', !!treeSvg.node());
              
              // 调用我们的渲染器，注意参数顺序的转换
              return treeRenderer.renderTreeLayout(
                container,       // container保持不变
                treeSvg,         // 专门的SVG元素
                nodes,           // 原来的第二个参数
                normalizedLinks, // 标准化后的链接
                width,           // 原来的第四个参数
                height,          // 原来的第五个参数
                this             // 当前可视化器实例
              );
            } catch (err) {
              console.error('树形图渲染适配错误:', err);
              
              // 如果有原始方法，回退使用
              if (this._originalRenderTreeLayout) {
                console.warn('回退到原始树形图渲染方法');
                return this._originalRenderTreeLayout.call(this, container, nodes, links, width, height);
              }
              
              throw err;
            }
          };
        }
      } catch (treeErr) {
        console.error('树形图渲染器加载失败:', treeErr);
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
   */
  function importModuleLoader(): Promise<{ loadModule: (path: string) => Promise<any> }> {
    return new Promise((resolve, reject) => {
      try {
        const script = document.createElement('script');
        script.type = 'module';
        
        // 使用外部脚本，而不是内联脚本
        script.src = chrome.runtime.getURL('dist/content/module-bridge.js');
        
        // 设置超时
        const timeout = setTimeout(() => {
          reject(new Error('模块加载器加载超时'));
        }, 10000);
        
        // 监听自定义事件
        window.addEventListener('moduleLoaderReady', () => {
          clearTimeout(timeout);
          if (window.__moduleLoader) {
            resolve(window.__moduleLoader);
          } else {
            reject(new Error('模块加载器定义丢失'));
          }
        }, { once: true });
        
        script.onerror = () => {
          clearTimeout(timeout);
          console.error('加载模块加载器脚本失败');
          reject(new Error('无法加载模块加载器'));
        };
        
        document.head.appendChild(script);
      } catch (err) {
        reject(err);
      }
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