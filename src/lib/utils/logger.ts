/**
 * Navigraph 极简版开发者日志系统
 * 自动为不同模块分配艳丽颜色，精确显示源文件位置
 */

import { isDev } from '../environment.js';
import { i18n } from './i18n-utils.js';  // 添加本地化导入

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
  maxPathSegments: 1,     // 路径段数，如background/services/xxx.ts中的1段
  fileInfoPosition: 'end' as 'start' | 'end', // 文件信息位置：开始或结尾
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
    // 根据环境设置全局日志级别
    if (!isDev()) {
      // 生产环境只显示警告和错误
      config.globalLevel = LogLevel.WARN;
      
      // 关闭一些增强功能
      config.showFileInfo = false;  // 不显示文件信息
      config.useCompletion = false; // 不使用emoji补全
    } else {
      // 开发环境显示所有日志
      config.globalLevel = LogLevel.DEBUG;
    }
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
    // 如果空数组或第一项不是字符串，无需处理
    if (args.length === 0 || typeof args[0] !== 'string') {
      return args;
    }

    const rawMsg = args[0];
    
    // 按类型分组所有后续参数
    const placeholderParams: any[] = []; // 用于替换的占位符参数
    const metaParams: any[] = [];      // 其他元数据参数
    
    args.slice(1).forEach(param => {
      // 字符串和数字类型都应该用于占位符替换
      if (typeof param === 'string' || typeof param === 'number' || typeof param === 'boolean') {
        placeholderParams.push(param); // 字符串和数字参数加入占位符组
      } else {
        metaParams.push(param);      // 非基本类型参数保留为元数据
      }
    });

    // 尝试本地化首个字符串参数，使用收集的参数进行占位符替换
    let localized: string;
    try {
      // 确保所有占位符参数都转换为字符串
      const stringifiedParams = placeholderParams.map(p => String(p));
      localized = i18n(rawMsg, ...stringifiedParams);
    } catch {
      localized = rawMsg;
    }
    
    // 替换为本地化后的消息和元数据参数（不包含用于占位符的参数）
    args = [localized, ...metaParams];
    
    const timestamp = getSimpleTimestamp();
    const fileInfo = getCallerInfo();
    const timePrefix = timestamp ? `[${timestamp}] ` : "";
    const fileInfoFormatted = fileInfo && fileInfo !== "unknown" && fileInfo !== "error"
      ? ` [${fileInfo}]` 
      : "";

    // 处理第一个参数，添加emoji和颜色
    if (typeof args[0] === "string") {
      const enhancedMessage = addCompletionEmoji(args[0]);

      if (config.colorfulModules) {
        if (config.fileInfoPosition === "end") {
          return [
            `%c${timePrefix}%c${enhancedMessage}%c ${fileInfoFormatted}`,
            "color: #888",
            `color: ${this.moduleColor}; font-weight: 500`,
            "color: #888; font-size: 0.9em",
            ...args.slice(1)  // 现在只剩元数据
          ];
        } else {
          return [
            `%c${timePrefix}${fileInfo ? `[${fileInfo}] ` : ""}%c${enhancedMessage}`,
            "color: #888",
            `color: ${this.moduleColor}; font-weight: 500`,
            ...args.slice(1)  // 现在只剩元数据
          ];
        }
      } else {
        if (config.fileInfoPosition === "end") {
          return [
            `${timePrefix}${enhancedMessage}${fileInfoFormatted}`,
            ...args.slice(1)  // 现在只剩元数据
          ];
        } else {
          return [
            `${timePrefix}${fileInfo ? `[${fileInfo}] ` : ""}${enhancedMessage}`,
            ...args.slice(1)  // 现在只剩元数据
          ];
        }
      }
    } else {
      // 非字符串参数，保持原样
      if (config.colorfulModules) {
        return [`%c${timePrefix}${fileInfo}`, "color: #888", ...args];
      } else {
        return [`${timePrefix}${fileInfo}`, ...args];
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
    this.debug(i18n('logger_session_started', sessionName));

    return {
      end: () => {
        const duration = performance.now() - startTime;
        this.debug(i18n('logger_session_ended', sessionName, duration.toFixed(2)));
      },
    };
  }

  /**
   * 创建一个新的日志分组
   * 等同于console.group
   */
  group(...args: any[]): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    
    const formattedArgs = this.format(args);
    console.group(...formattedArgs);
  }
  
  /**
   * 创建一个新的折叠日志分组
   * 等同于console.groupCollapsed
   */
  groupCollapsed(...args: any[]): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    
    const formattedArgs = this.format(args);
    console.groupCollapsed(...formattedArgs);
  }
  
  /**
   * 结束当前日志分组
   * 等同于console.groupEnd
   */
  groupEnd(): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    
    console.groupEnd();
  }
  
  /**
   * 创建带有计时的折叠分组，适合用于性能监控
   * @param groupName 分组名称
   * @returns 包含end方法的对象，调用end方法会结束分组并显示耗时
   */
  timedGroup(groupName: string): { end: () => void } {
    if (!this.shouldLog(LogLevel.INFO)) {
      return { end: () => {} };
    }
    
    const startTime = performance.now();
    this.groupCollapsed(`${groupName}`);
    
    return {
      end: () => {
        const duration = performance.now() - startTime;
        this.log(i18n('logger_total_duration', duration.toFixed(2)));
        this.groupEnd();
      }
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
    fileInfoPosition?: 'start' | 'end';
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
        console.log(i18n("logger_debug_full_stack"), lines);

        // 分析每一行
        lines.forEach((line, i) => {
          console.log(i18n("logger_debug_line_number", i.toString()), line);

          // 测试各种正则表达式
          console.log(i18n("logger_debug_chrome_standard_format"),line.match(/at .+? \((.+?):(\d+):\d+\)/)
          );
          console.log(i18n("logger_debug_chrome_simple_format"), line.match(/at (.+?):(\d+):\d+/));
          console.log(i18n("logger_debug_firefox_format"), line.match(/(.+?)@(.+?):(\d+):\d+/));
          console.log(i18n("logger_debug_fallback_format"),line.match(/([^\/\\]+\.(js|ts|jsx|tsx|vue|html))(?::(\d+))?/i)
          );
          console.log("---");
        });
      } else {
        console.log(i18n("logger_debug_stack_first_five"), lines.slice(0, 5));
        console.log(i18n("logger_debug_stack_view_full"));
      }
    } catch (e) {
      console.error(i18n("logger_debug_stack_error"), e);
    }
  }
}

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
  
  // 使用i18n函数获取本地化关键词
  const completionEmojiMap: Record<string, string> = {
    // 基础状态
    [i18n('logger_keyword_completed')]: '✅',
    [i18n('logger_keyword_success')]: '🎉',
    [i18n('logger_keyword_ended')]: '🏁',
    [i18n('logger_keyword_failed')]: '❌',
    [i18n('logger_keyword_error')]: '❗️',
    [i18n('logger_keyword_warning')]: '⚠️',
    
    // 初始化相关
    [i18n('logger_keyword_initialized')]: '🚀',
    [i18n('logger_keyword_init_complete')]: '🚀',
    [i18n('logger_keyword_init_success')]: '🚀',
    [i18n('logger_keyword_started')]: '🚀',
    
    // 数据相关
    [i18n('logger_keyword_loaded')]: '📦',
    [i18n('logger_keyword_load_complete')]: '📦',
    [i18n('logger_keyword_saved')]: '💾',
    [i18n('logger_keyword_save_success')]: '💾',
    [i18n('logger_keyword_downloaded')]: '⬇️',
    [i18n('logger_keyword_uploaded')]: '⬆️',
    
    // 注册与创建
    [i18n('logger_keyword_created')]: '🆕',
    [i18n('logger_keyword_registered')]: '📝',
    [i18n('logger_keyword_added')]: '➕',
    [i18n('logger_keyword_deleted')]: '🗑️',
    
    // 设置与配置
    [i18n('logger_keyword_set')]: '⚙️',
    [i18n('logger_keyword_configured')]: '⚙️',
    [i18n('logger_keyword_settings_complete')]: '⚙️',
    
    // 运行状态
    [i18n('logger_keyword_started_action')]: '▶️',
    [i18n('logger_keyword_stopped')]: '⏹️',
    [i18n('logger_keyword_paused')]: '⏸️',
    [i18n('logger_keyword_resumed')]: '⏯️',
    [i18n('logger_keyword_ready')]: '👌',
    [i18n('logger_keyword_prepared')]: '👍',

    [i18n('logger_keyword_in_progress')]: '⏳', // 省略号
    [i18n('logger_keyword_processing')]: '⏳', // 处理中的状态
  };
  
  // 检查消息中是否包含关键词
  if (typeof message === 'string') {
    for (const keyword in completionEmojiMap) {
      if (message.includes(keyword)) {
        return `${completionEmojiMap[keyword]} ${message}`;
      }
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