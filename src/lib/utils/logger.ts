/**
 * Navigraph 极简版开发者日志系统
 * 自动为不同模块分配艳丽颜色，精确显示源文件位置
 */

import { isDev } from '../environment.js';
import { _, _Error } from './i18n.js';  // 添加本地化导入

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

    // 安全序列化对象以用于占位符（处理循环引用）
    function safeStringify(obj: any): string {
      try {
        const seen = new WeakSet();
        return JSON.stringify(obj, function (k, v) {
          if (v && typeof v === 'object') {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          return v;
        });
      } catch (e) {
        try { return String(obj); } catch { return '[unserializable]'; }
      }
    }

    args.slice(1).forEach(param => {
      // 原始的字符串/数字/布尔直接作为占位符
      if (typeof param === 'string' || typeof param === 'number' || typeof param === 'boolean') {
        placeholderParams.push(param);
        return;
      }

      // 对象类型：将其序列化为字符串以用于占位符替换
      if (param && typeof param === 'object') {
        placeholderParams.push(safeStringify(param));
        return;
      }

      // 函数或其他无法序列化的项保留在 metaParams，作为额外参数传给 console
      metaParams.push(param);
    });

    // 进行占位符替换处理
    let formattedMessage = rawMsg; // 更改变量名以反映实际功能

    // 手动替换占位符
    if (placeholderParams.length > 0) {
      try {
        // 确保所有占位符参数都转换为字符串
        const stringifiedParams = placeholderParams.map(p => String(p));
        
        // 手动替换所有{0}, {1}等占位符
        stringifiedParams.forEach((param, index) => {
          const placeholder = new RegExp(`\\{${index}\\}`, 'g');
          formattedMessage = formattedMessage.replace(placeholder, param);
        });
      } catch {
        // 发生错误时回退到原始消息
        formattedMessage = rawMsg;
      }
    }

    // 替换为处理后的消息和元数据参数
    args = [formattedMessage, ...metaParams];
    
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
    this.debug(_('logger_session_started', '{0} - 开始', sessionName));

    return {
      end: () => {
        const duration = performance.now() - startTime;
        this.debug(_('logger_session_ended', '{0} - 结束 (耗时: {1}ms)', sessionName, duration.toFixed(2)));
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
        this.log(_('logger_total_duration', '总耗时: {0}ms', duration.toFixed(2)));
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
        console.log(_('logger_debug_full_stack', '完整堆栈:'), lines);

        // 分析每一行
        lines.forEach((line, i) => {
          console.log(_('logger_debug_line_number', '行 {0}:', i.toString()), line);

          // 测试各种正则表达式
          console.log(_('logger_debug_chrome_standard_format', ' Chrome标准格式:'),line.match(/at .+? \((.+?):(\d+):\d+\)/)
          );
          console.log(_('logger_debug_chrome_simple_format', ' Chrome简单格式:'), line.match(/at (.+?):(\d+):\d+/));
          console.log(_('logger_debug_firefox_format', ' Firefox格式:'), line.match(/(.+?)@(.+?):(\d+):\d+/));
          console.log(_('logger_debug_fallback_format', ' 后备格式:'),line.match(/([^\/\\]+\.(js|ts|jsx|tsx|vue|html))(?::(\d+))?/i)
          );
          console.log("---");
        });
      } else {
        console.log(_('logger_debug_stack_first_five', '堆栈前5行:'), lines.slice(0, 5));
        console.log(_('logger_debug_stack_view_full', '使用Logger.debugStack("full")查看完整分析'));
      }
    } catch (e) {
      console.error(_('logger_debug_stack_error', '无法获取堆栈'), e);
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
    [_('logger_keyword_completed', '完成')]: '✅',
    [_('logger_keyword_success', '成功')]: '🎉',
    [_('logger_keyword_ended', '结束')]: '🏁',
    [_('logger_keyword_failed', '失败')]: '❌',
    [_('logger_keyword_error', '错误')]: '❗️',
    [_('logger_keyword_warning', '警告')]: '⚠️',
    
    // 初始化相关
    [_('logger_keyword_initialized', '已初始化')]: '🚀',
    [_('logger_keyword_init_complete', '初始化完成')]: '🚀',
    [_('logger_keyword_init_success', '初始化成功')]: '🚀',
    [_('logger_keyword_started', '启动完成')]: '🚀',
    
    // 数据相关
    [_('logger_keyword_loaded', '已加载')]: '📦',
    [_('logger_keyword_load_complete', '加载完成')]: '📦',
    [_('logger_keyword_saved', '已保存')]: '💾',
    [_('logger_keyword_save_success', '保存成功')]: '💾',
    [_('logger_keyword_downloaded', '已下载')]: '⬇️',
    [_('logger_keyword_uploaded', '已上传')]: '⬆️',
    
    // 注册与创建
    [_('logger_keyword_created', '已创建')]: '🆕',
    [_('logger_keyword_registered', '已注册')]: '📝',
    [_('logger_keyword_added', '已添加')]: '➕',
    [_('logger_keyword_deleted', '已删除')]: '🗑️',
    
    // 设置与配置
    [_('logger_keyword_set', '已设置')]: '⚙️',
    [_('logger_keyword_configured', '已配置')]: '⚙️',
    [_('logger_keyword_settings_complete', '设置完成')]: '⚙️',
    
    // 运行状态
    [_('logger_keyword_started_action', '已启动')]: '▶️',
    [_('logger_keyword_stopped', '已停止')]: '⏹️',
    [_('logger_keyword_paused', '已暂停')]: '⏸️',
    [_('logger_keyword_resumed', '已恢复')]: '⏯️',
    [_('logger_keyword_ready', '已就绪')]: '👌',
    [_('logger_keyword_prepared', '已准备')]: '👍',

    [_('logger_keyword_in_progress', '...')]: '⏳', // 省略号
    [_('logger_keyword_processing', '处理中')]: '⏳', // 处理中的状态
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
    const stack = (err.stack || '').split('\n').map(s => s.trim()).filter(Boolean);

  const skipPatterns = [/logger\.ts/i, /logger\.js/i, /src_lib_utils_logger/i, /src[\\\/]lib[\\\/]utils[\\\/]logger/i, /at Logger\b/, /node_modules/i, /\(internal/i];

    for (let i = 0; i < stack.length; i++) {
      const line = stack[i];
      if (!line || i === 0) continue; // 第一行通常是错误消息
      if (skipPatterns.some(r => r.test(line))) continue;

      // 支持三种常见格式： (path:line:col) | at path:line:col | func@path:line:col
      const m = line.match(/\(([^)]+):(\d+):\d+\)/) || line.match(/at\s+([^()\s]+):(\d+):\d+/) || line.match(/@(.+?):(\d+):\d+/);
      if (!m) continue;

      const filePathRaw = m[1];
      const lineNumber = m[2];

      // 如果调用路径看起来仍然属于 logger 本身（打包名或路径包含 logger），跳过此帧
      if (/\blogger\b/i.test(filePathRaw) || /logger[_\-\.]?ts/i.test(filePathRaw) || /src[_]lib[_]utils[_]logger/i.test(filePathRaw)) {
        continue;
      }

      // 1) 移除前缀 scheme（webpack:/// file:// 等）
      let p = String(filePathRaw).replace(/^webpack:\/\/{3}/, '').replace(/^webpack:\/\//, '').replace(/^file:\/\//, '');

      // 2) 移除任何中间出现的 extension scheme（如 chrome-extension:, moz-extension:）
      p = p.replace(/(chrome-extension|moz-extension|safari-extension|extension):\/\//ig, '');
      p = p.replace(/(chrome-extension|moz-extension|safari-extension|extension):/ig, '');

      // 3) 将路径切分为段，移除纯粹的扩展 id 片段
      const rawParts = p.split(/[\/\\]/).filter(Boolean).filter(part => {
        if (/^[a-z0-9]{16,64}$/i.test(part) && !part.includes('.')) return false; // 很可能是 id
        if (/^[a-z0-9-]+:$/i.test(part)) return false; // 像 'chrome-extension:' 残留
        return true;
      });

      // 4) 对每个段进行下划线展开尝试：如果段中包含已知提示词，则把 '_' 视为 '/'
      const hintRe = /(src|content|core|navigation|visualizer|renderers|lib|utils|background|options|ui|state)/i;
      const rebuilt: string[] = [];

      for (const seg of rawParts) {
        // 先提取显式扩展名（如 .ts/.js），以便在处理后重新附加
        const extMatch = seg.match(/(\.(ts|js|jsx|tsx|vue|html))$/i);
        const explicitExt = extMatch ? extMatch[1] : '';
        const baseSeg = explicitExt ? seg.slice(0, -explicitExt.length) : seg;

        if (baseSeg.includes('_')) {
          const tokens = baseSeg.split('_').filter(Boolean);
          if (tokens.some(t => hintRe.test(t))) {
            // 如果最后一个 token 是语言标识（ts/js），把它作为扩展名附加到前一个 token
            const lastToken = (tokens[tokens.length - 1] || '').toLowerCase();
            if (/^(ts|js|jsx|tsx|vue|html)$/.test(lastToken) && tokens.length > 1) {
              tokens.pop();
              tokens[tokens.length - 1] = tokens[tokens.length - 1] + '.' + lastToken;
            }

            // 将 tokens 扩展开来
            rebuilt.push(...tokens);

            // 如果原始段有显式扩展名，且最后一段还没有扩展名，则附加它
            if (explicitExt) {
              if (!rebuilt[rebuilt.length - 1].endsWith(explicitExt)) {
                rebuilt[rebuilt.length - 1] = rebuilt[rebuilt.length - 1] + explicitExt;
              }
            }
            continue;
          }

          // 处理像 foo_ts 或 foo_js 的情况（无显式扩展名）
          if (/(_ts|_js)$/.test(baseSeg)) {
            rebuilt.push(baseSeg.replace(/_ts$/, '.ts').replace(/_js$/, '.js'));
            continue;
          }
        }

        // 非下划线展开的段：把显式扩展名重新附加，并修正重复后缀 foo_ts.ts -> foo.ts
        let finalSeg = baseSeg + explicitExt;
        finalSeg = finalSeg.replace(/_ts\.ts$/, '.ts').replace(/_js\.js$/, '.js');
        rebuilt.push(finalSeg);
      }

      let normalized = rebuilt.join('/');

      // 折叠重复的扩展名（例如 .ts.ts, .js.js）为单一 .ts
      normalized = normalized.replace(/(\.ts|\.js){2,}$/i, match => {
        // 总是以 .ts 作为最终显示
        return '.ts';
      });

      // 根据配置返回短路径或文件名
      if (config.showModulePath) {
        const segs = normalized.split('/').filter(Boolean);
        const visibleParents = Math.max(1, config.maxPathSegments || 1);
        const visible = segs.slice(-visibleParents - 0);
        const shouldElide = segs.length > (visibleParents + 1) || normalized.length > 60;
        const short = (shouldElide ? '.../' : '') + visible.join('/');
        return `${short}:${lineNumber}`;
      }

      const fileName = normalized.split(/[\/\\]/).pop() || 'unknown';
      return `${fileName.replace(/\.js$/, '.ts')}:${lineNumber}`;
    }

    return 'unknown';
  } catch (e) {
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