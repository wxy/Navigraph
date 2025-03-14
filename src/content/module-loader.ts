/**
 * 模块加载器
 * 提供动态加载模块的功能
 */

// 添加模块缓存类型定义
interface ModuleCache {
  [path: string]: any;
}

// 为动态创建的全局对象定义接口
interface ModuleExport {
  exports: Record<string, any>;
}

// 缓存已加载的模块
const moduleCache: ModuleCache = {};

/**
 * 加载一个脚本作为模块
 * @param path - 要加载的模块路径
 */
export async function loadModule(path: string): Promise<any> {
  // 如果模块已加载，直接返回缓存
  if (moduleCache[path]) {
    return moduleCache[path];
  }
  
  // 计算完整路径
  const modulePath = `dist/content/${path}`;
  console.log(`加载模块: ${modulePath}`);
  
  // 创建一个Promise包装动态脚本加载
  return new Promise((resolve, reject) => {
    // 创建一个唯一标识符用于全局通信
    const moduleId = `module_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // 创建一个全局占位符，模块脚本会向其添加导出内容
    (window as Record<string, any>)[moduleId] = { exports: {} } as ModuleExport;
    
    // 创建脚本元素
    const script = document.createElement('script');
    
    // 设置脚本内容，将ES6模块转换为IIFE
    // 这种方法可以在没有ES模块支持的环境中使用
    script.textContent = `
      (function() {
        // 模块作用域内的导出对象
        const module = { exports: {} };
        
        // 提供export函数的实现
        function __export(obj) {
          for(const key in obj) {
            if (obj.hasOwnProperty(key)) {
              module.exports[key] = obj[key];
            }
          }
        }
        
        // 从服务器获取模块内容
        fetch('${chrome.runtime.getURL(modulePath)}')
          .then(response => {
            if (!response.ok) throw new Error('模块加载失败: ' + response.statusText);
            return response.text();
          })
          .then(code => {
            // 将export语句替换为对__export的调用
            code = code.replace(/export\\s+function\\s+(\\w+)/g, 'function $1');
            code = code.replace(/export\\s+const\\s+(\\w+)/g, 'const $1');
            code = code.replace(/export\\s+{([^}]+)}/g, '__export({$1})');
            
            // 执行模块代码
            try {
              const moduleFunc = new Function('module', '__export', code);
              moduleFunc(module, __export);
              
              // 将导出对象复制到全局占位符
              window['${moduleId}'].exports = module.exports;
              
              // 触发自定义事件表示模块加载完成
              window.dispatchEvent(new CustomEvent('moduleLoaded:${moduleId}'));
            } catch(e) {
              console.error('模块执行失败:', e);
              window.dispatchEvent(new CustomEvent('moduleError:${moduleId}', {
                detail: { error: e }
              }));
            }
          })
          .catch(error => {
            console.error('模块加载失败:', error);
            window.dispatchEvent(new CustomEvent('moduleError:${moduleId}', {
              detail: { error }
            }));
          });
      })();
    `;
    
    // 插入脚本到文档
    document.head.appendChild(script);
    
    // 监听模块加载完成事件
    window.addEventListener('moduleLoaded:' + moduleId, (() => {
      // 缓存并返回模块导出
      moduleCache[path] = (window as Record<string, any>)[moduleId].exports;
      resolve((window as Record<string, any>)[moduleId].exports);
      
      // 清理全局占位符
      setTimeout(() => {
        delete (window as Record<string, any>)[moduleId];
      }, 100);
    }) as EventListener, { once: true });
    
    // 监听错误事件
    window.addEventListener('moduleError:' + moduleId, ((event: CustomEvent<{error: Error}>) => {
      reject(event.detail.error);
      
      // 清理全局占位符
      setTimeout(() => {
        delete (window as Record<string, any>)[moduleId];
      }, 100);
    }) as EventListener, { once: true });
  });
}

/**
 * 预加载模块 - 可用于提前加载经常使用的模块
 * @param paths - 要预加载的模块路径数组
 */
export function preloadModules(paths: string[]): Promise<any[]> {
  return Promise.all(paths.map(path => loadModule(path).catch(err => {
    console.warn(`预加载模块失败: ${path}`, err);
    return null;
  })));
}