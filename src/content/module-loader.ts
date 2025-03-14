/**
 * 模块加载器
 * 提供动态加载模块的功能
 */

// 全局模块缓存
const moduleCache = new Map<string, any>();

/**
 * 加载一个脚本作为模块
 * @param path - 要加载的模块路径
 */
export async function loadModule(path: string): Promise<any> {
  try {
    console.log(`尝试加载模块: ${path}`);
    
    // 检查缓存
    if (moduleCache.has(path)) {
      console.log(`从缓存返回模块: ${path}`);
      return moduleCache.get(path);
    }
    
    // 构建完整路径
    // 注意：确保路径以 dist/content/ 开头
    const fullPath = path.startsWith('dist/content/') 
      ? path 
      : `dist/content/${path}`;
    
    const moduleUrl = chrome.runtime.getURL(fullPath);
    console.log(`完整模块URL: ${moduleUrl}`);
    
    // 动态导入
    const module = await import(moduleUrl);
    
    // 缓存模块
    moduleCache.set(path, module);
    
    console.log(`模块加载成功: ${path}`);
    return module;
  } catch (err) {
    console.error(`加载模块失败 ${path}:`, err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`加载模块 ${path} 失败: ${errorMessage}`);
  }
}

/**
 * 预加载多个模块
 * @param paths - 要加载的模块路径列表
 */
export async function preloadModules(paths: string[]): Promise<void> {
  try {
    console.log(`预加载 ${paths.length} 个模块`);
    
    await Promise.all(paths.map(path => loadModule(path)));
    
    console.log('所有模块预加载完成');
  } catch (err) {
    console.error('预加载模块失败:', err);
    throw err;
  }
}