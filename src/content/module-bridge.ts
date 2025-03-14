/**
 * 模块加载桥接文件
 * 解决Chrome扩展CSP限制问题
 */

// 导入模块加载器
import * as moduleLoader from './module-loader.js';

// 将模块加载器分配给全局对象
(window as any).__moduleLoader = moduleLoader;

// 触发就绪事件
window.dispatchEvent(new CustomEvent('moduleLoaderReady'));

console.log('模块加载器桥接文件已执行');