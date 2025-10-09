/**
 * 编译时间显示插件
 * 在编译完成后显示编译耗时和当前时间
 */
class CompilationTimePlugin {
  constructor(options = {}) {
    this.options = {
      // 是否显示详细信息
      verbose: options.verbose || false,
      // 时间格式
      timeFormat: options.timeFormat || 'zh-CN',
      ...options
    };
  }

  apply(compiler) {
    let compilationStartTime;

    // 监听编译开始
    compiler.hooks.beforeCompile.tap('CompilationTimePlugin', () => {
      compilationStartTime = Date.now();
    });

    // 监听编译完成
    compiler.hooks.done.tap('CompilationTimePlugin', (stats) => {
      const compilationEndTime = Date.now();
      const compilationTime = compilationEndTime - compilationStartTime;
      
      // 格式化编译时间
      const timeStr = this.formatTime(compilationTime);
      
      // 获取当前时间
      const currentTime = new Date().toLocaleString(this.options.timeFormat, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      // 检查是否有错误或警告
      const hasErrors = stats.compilation.errors.length > 0;
      const hasWarnings = stats.compilation.warnings.length > 0;
      
      // 选择显示的emoji和颜色
      let statusEmoji = '✅';
      let statusText = '编译成功';
      
      if (hasErrors) {
        statusEmoji = '❌';
        statusText = '编译失败';
      } else if (hasWarnings) {
        statusEmoji = '⚠️';
        statusText = '编译完成(有警告)';
      }

      // 输出分隔线和编译信息
      console.log('');
      console.log('═'.repeat(80));
      console.log(`${statusEmoji} ${statusText}`);
      console.log(`⏱️ 编译耗时: ${timeStr}`);
      console.log(`🕐 完成时间: ${currentTime}`);
      
      if (this.options.verbose) {
        console.log(`📦 输出文件: ${Object.keys(stats.compilation.assets).length} 个`);
        console.log(`📁 输出目录: ${stats.compilation.outputOptions.path}`);
      }
      
      console.log('═'.repeat(80));
      console.log('');
    });

    // 监听watch模式下的编译
    compiler.hooks.watchRun.tap('CompilationTimePlugin', () => {
      compilationStartTime = Date.now();
      console.log('🔄 检测到文件变化，重新编译中...');
    });
  }

  /**
   * 格式化编译时间
   * @param {number} milliseconds 毫秒数
   * @returns {string} 格式化后的时间字符串
   */
  formatTime(milliseconds) {
    if (milliseconds < 1000) {
      return `${milliseconds}ms`;
    } else if (milliseconds < 60000) {
      return `${(milliseconds / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(milliseconds / 60000);
      const seconds = ((milliseconds % 60000) / 1000).toFixed(2);
      return `${minutes}m ${seconds}s`;
    }
  }
}

module.exports = CompilationTimePlugin;