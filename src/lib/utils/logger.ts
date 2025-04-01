/**
 * Navigraph 极简版开发者日志系统
 * 自动为不同模块分配艳丽颜色，精确显示源文件位置
 */

// 日志级别枚举
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 100  // 用于完全禁用日志
}

// 全局配置对象
const config = {
  // 默认配置
  globalLevel: LogLevel.INFO,
  moduleFilters: {} as Record<string, LogLevel>,
  disabled: false, // 全局开关
  showTimeStamp: true,
  showFileInfo: true,  // 显示文件信息
  colorfulModules: true, // 为模块使用不同颜色
  useCompletion: true,   // 使用完成emoji
  showModulePath: false,  // 是否显示简短模块路径
  maxPathSegments: 1     // 路径段数，如background/services/xxx.ts中的1段
};

// 更艳丽的调色板
const COLOR_PALETTE = [
  '#FF3366', '#33CCFF', '#33FF66', '#FF9933', '#CC33FF', 
  '#00FFCC', '#FF6600', '#3366FF', '#00CC99', '#FF3300', 
  '#66CC00', '#0099FF', '#CC00FF', '#FFCC00', '#FF0099'
];

// 模块颜色缓存
const moduleColorMap: Record<string, string> = {};

/**
 * 为模块名生成一致的颜色
 */
function getModuleColor(moduleName: string): string {
  if (moduleColorMap[moduleName]) {
    return moduleColorMap[moduleName];
  }
  
  // 使用简单的字符串哈希算法
  let hash = 0;
  for (let i = 0; i < moduleName.length; i++) {
    hash = ((hash << 5) - hash) + moduleName.charCodeAt(i);
    hash |= 0; // 转换为32位整数
  }
  
  // 选择颜色
  const colorIndex = Math.abs(hash) % COLOR_PALETTE.length;
  const color = COLOR_PALETTE[colorIndex];
  
  // 缓存结果
  moduleColorMap[moduleName] = color;
  return color;
}

/**
 * 检测完成消息并添加emoji
 */
function addCompletionEmoji(message: string): string {
  if (!config.useCompletion) return message;
  
  // 完成相关关键词
  const completionKeywords = [
    '完成', '成功', '结束', '已初始化', '已加载', '已创建', '已设置',
    '成功加载', '初始化成功', '已注册', '已启动', '已准备'
  ];
  
  // emoji列表
  const completionEmojis = ['✅', '🎉', '🚀', '👍', '✨'];
  
  for (const keyword of completionKeywords) {
    if (typeof message === 'string' && message.includes(keyword)) {
      const hash = message.length + message.charCodeAt(0) + message.charCodeAt(message.length - 1);
      const emoji = completionEmojis[hash % completionEmojis.length];
      return `${message} ${emoji}`;
    }
  }
  
  return message;
}

/**
 * 获取简化的时间戳（只包含分:秒.毫秒）
 */
function getSimpleTimestamp(): string {
  if (!config.showTimeStamp) return '';
  
  const now = new Date();
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  
  return `${mins}:${secs}.${ms}`;
}

/**
 * 获取调用者信息并转换为TypeScript文件路径
 */
function getCallerInfo(): string {
  if (!config.showFileInfo) return '';
  
  try {
    const err = new Error();
    const stackLines = err.stack?.split('\n') || [];
    
    // 查找非logger相关的调用
    for (let i = 0; i < stackLines.length; i++) {
      const line = stackLines[i];
      
      // 跳过logger相关的行
      if (i === 0 || 
          line.includes('/logger.') || 
          line.includes('at Logger.') || 
          !line.trim()) {
        continue;
      }
      
      // 提取文件名和行号
      const match = line.match(/\(([^)]+):(\d+):\d+\)/) || 
                   line.match(/at\s+([^(]+):(\d+):\d+/);
      
    if (match) {
      const [, filePath, lineNumber] = match;

      // 根据配置决定展示路径还是仅文件名
      if (config.showModulePath) {
        // 分割路径
        const pathSegments = filePath.split(/[\/\\]/);

        // 取最后几段（包含文件名）
        const segments = pathSegments.slice(-1 - config.maxPathSegments);

        // 构建简短路径
        let shortPath = segments.join("/");

        // 将.js替换为.ts
        if (shortPath.endsWith(".js")) {
          shortPath = shortPath.replace(/\.js$/, ".ts");
        }

        return `${shortPath}:${lineNumber}`;
      } else {
        // 仅提取文件名的原始逻辑
        let fileName = filePath.split(/[\/\\]/).pop() || "unknown";
        if (fileName.endsWith(".js")) {
          fileName = fileName.replace(/\.js$/, ".ts");
        }
        return `${fileName}:${lineNumber}`;
      }
    }
    }
    
    return 'unknown';
  } catch (error) {
    return 'error';
  }
}

/**
 * 从文件路径中提取文件名
 */
function extractFileName(path: string, lineNumber: string): string {
  // 提取文件名 (移除路径)
  const fileName = path.split(/[\/\\]/).pop() || path;
  return `${fileName}:${lineNumber}`;
}

/**
 * 日志记录器类
 */
export class Logger {
  private moduleName: string;
  private moduleColor: string;

  /**
   * 创建日志记录器实例
   */
  constructor(moduleName: string) {
    this.moduleName = moduleName || "unknown";
    this.moduleColor = getModuleColor(this.moduleName);
  }

  /**
   * 获取模块的有效日志级别
   */
  private getEffectiveLevel(): LogLevel {
    if (config.disabled) return LogLevel.NONE;

    if (this.moduleName in config.moduleFilters) {
      return config.moduleFilters[this.moduleName];
    }

    return config.globalLevel;
  }

  /**
   * 检查是否应该记录日志
   */
  private shouldLog(level: LogLevel): boolean {
    return level >= this.getEffectiveLevel();
  }

  /**
   * 格式化日志消息
   */
  private format(args: any[]): any[] {
    if (args.length === 0) return args;

    const timestamp = getSimpleTimestamp();
    const fileInfo = getCallerInfo();

    // 构建前缀，使用浅灰色
    const prefix = timestamp ? `[${timestamp}] ` : "";
    const filePart =
      fileInfo !== "unknown" && fileInfo !== "error" ? `[${fileInfo}] ` : "";

    // 处理第一个参数，添加前缀和可能的完成emoji
    if (typeof args[0] === "string") {
      const enhancedMessage = addCompletionEmoji(args[0]);

      if (config.colorfulModules) {
        // 使用两段颜色：灰色时间戳和彩色消息
        return [
          `%c${prefix}${filePart}%c${enhancedMessage}`,
          "color: #888", // 时间戳和文件信息颜色
          `color: ${this.moduleColor}; font-weight: 500`, // 消息颜色
          ...args.slice(1),
        ];
      } else {
        return [`${prefix}${filePart}${enhancedMessage}`, ...args.slice(1)];
      }
    } else {
      // 非字符串参数处理
      if (config.colorfulModules) {
        return [`%c${prefix}${filePart}`, "color: #888", ...args];
      } else {
        return [`${prefix}${filePart}`, ...args];
      }
    }
  }

  /**
   * 标准日志方法
   */
  debug(...args: any[]): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    console.debug(...this.format(args));
  }

  info(...args: any[]): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    console.info(...this.format(args));
  }

  warn(...args: any[]): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    console.warn(...this.format(args));
  }

  error(...args: any[]): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    console.error(...this.format(args));
  }

  log(...args: any[]): void {
    this.info(...args);
  }

  /**
   * 调试会话跟踪
   */
  debugSession(sessionName: string): { end: () => void } {
    if (!this.shouldLog(LogLevel.DEBUG)) {
      return { end: () => {} };
    }

    const startTime = performance.now();
    this.debug(`${sessionName} - 开始`);

    return {
      end: () => {
        const duration = performance.now() - startTime;
        this.debug(`${sessionName} - 结束 (耗时: ${duration.toFixed(2)}ms)`);
      },
    };
  }

  /**
   * 配置日志系统
   */
  static configure(options: {
    globalLevel?: LogLevel;
    disabled?: boolean;
    showTimeStamp?: boolean;
    showFileInfo?: boolean;
    colorfulModules?: boolean;
    useCompletion?: boolean;
    showModulePath?: boolean;
    maxPathSegments?: number;
  }): void {
    Object.assign(config, options);
  }

  /**
   * 设置模块日志级别
   */
  static setModuleLevel(moduleName: string, level: LogLevel): void {
    config.moduleFilters[moduleName] = level;
  }

  /**
   * 禁用模块日志
   */
  static disableModule(moduleName: string): void {
    config.moduleFilters[moduleName] = LogLevel.NONE;
  }

  /**
   * 用于调试堆栈跟踪问题的辅助方法
   */
  static debugStack(detailLevel: "basic" | "full" = "basic"): void {
    try {
      const err = new Error("Debug stack");
      const stack = err.stack || "";
      const lines = stack.split("\n");

      if (detailLevel === "full") {
        console.log("完整堆栈:", lines);

        // 分析每一行
        lines.forEach((line, i) => {
          console.log(`行 ${i}:`, line);

          // 测试各种正则表达式
          console.log(
            " Chrome标准格式:",
            line.match(/at .+? \((.+?):(\d+):\d+\)/)
          );
          console.log(" Chrome简单格式:", line.match(/at (.+?):(\d+):\d+/));
          console.log(" Firefox格式:", line.match(/(.+?)@(.+?):(\d+):\d+/));
          console.log(
            " 后备格式:",
            line.match(/([^\/\\]+\.(js|ts|jsx|tsx|vue|html))(?::(\d+))?/i)
          );
          console.log("---");
        });
      } else {
        console.log("堆栈前5行:", lines.slice(0, 5));
        console.log('使用Logger.debugStack("full")查看完整分析');
      }
    } catch (e) {
      console.error("无法获取堆栈", e);
    }
  }
}