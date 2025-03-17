/**
 * Navigraph - 浏览历史可视化扩展
 * 主入口文件
 */

// 将旧的全局命名空间保留下来，用于兼容性
//window.Navigraph = window.Navigraph || {};

// 初始化函数
async function initialize() {
  console.log('初始化 Navigraph 可视化...');
  
  try {
    // 使用动态导入，避免"Cannot use import statement outside a module"错误
    const module = await import('./core/navigation-visualizer.js');
    const NavigationVisualizer = module.NavigationVisualizer;

    // 创建可视化器实例
    window.visualizer = new NavigationVisualizer();
    
    // 为了兼容性考虑
    window.NavigationVisualizer = NavigationVisualizer;
    
    console.log('Navigraph 可视化器初始化成功');
  } catch (error) {
    console.error('初始化可视化器失败:', error);
    showErrorMessage('初始化失败: ' + (error instanceof Error ? error.message : String(error)));
  }
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

// 文档加载完成后初始化
document.addEventListener('DOMContentLoaded', initialize);