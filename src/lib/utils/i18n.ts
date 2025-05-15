/**
 * 本地化工具类
 * 支持强制指定本地化，和两种使用方式：
 * 1. 静态 HTML 本地化 (data-i18n 属性)
 * 2. 动态获取本地化字符串 (i18n 函数)
 */

// 为避免与 logger 循环依赖，直接使用 console 打印

export class I18n {
  private static instance: I18n;
  private loadedMessages: Record<string, {message: string, description?: string}> = {};
  private forcedLocale: string | null = null;
  private hasInitialized: boolean = false;

  /**
   * 获取单例实例
   */
  public static getInstance(): I18n {
    if (!I18n.instance) {
      I18n.instance = new I18n();
    }
    return I18n.instance;
  }

  /**
   * 初始化国际化系统
   * 适用于所有环境，包括无DOM环境（如后台脚本）
   * 只加载消息，不应用到DOM
   */
  public async init(): Promise<void> {
    // 如果已经初始化过，不再重复执行
    if (this.hasInitialized) {
      console.debug('[i18n-utils] I18n already initialized, skipping');
      return;
    }
    
    // 标记为已初始化
    this.hasInitialized = true;
    
    try {
      // 从 Chrome API 获取首选语言
      if (typeof chrome !== 'undefined' && chrome.i18n) {
        // Chrome扩展环境中的国际化已由浏览器处理
        console.debug('[i18n-utils] Using Chrome API for localization');
        return;
      }
      
      // 非扩展环境、测试环境或强制本地化场景
      // 可以从配置或存储获取首选语言
      this.forcedLocale = 'en';
      
      // 加载消息文件
      if (typeof fetch !== 'undefined') {
        try {
          const response = await fetch(`../_locales/${this.forcedLocale}/messages.json`);
          
          if (!response.ok) {
            throw new Error(`Unable to load language file: ${response.status}`);
          }
          
          this.loadedMessages = await response.json();
          console.log(`[i18n-utils] Loaded ${Object.keys(this.loadedMessages).length} localization messages`);
        } catch (error) {
          console.error('[i18n-utils] Failed to load localization file:', error);
          this.forcedLocale = null;
        }
      }
    } catch (error) {
      console.error('[i18n-utils] Initialization error:', error);
      // 即使出错也维持已初始化状态，避免重复尝试
    }
  }

  /**
   * 初始化本地化工具并应用到页面
   * 集成了初始化和应用到页面两个步骤
   * 该方法可以安全地多次调用，只会执行一次初始化和应用
   */
  public async apply(): Promise<void> {
    // 如果已经初始化过，不再重复执行
    if (this.hasInitialized) {
      console.debug('[i18n-utils] I18n already initialized, skipping');
      return;
    }
    
    this.hasInitialized = true;
    
    // 获取 URL 查询参数中的本地化设置
    try {
      const urlParams = new URLSearchParams(window.location.search);
      this.forcedLocale = urlParams.get('locale')?.replace('-', '_') ?? null;
      
      if (this.forcedLocale) {
        console.log(`[i18n-utils] Using locale from URL: ${this.forcedLocale}`);
        const response = await fetch(`../_locales/${this.forcedLocale}/messages.json`);
        
        if (!response.ok) {
          throw new Error(`Unable to load specified language file: ${response.status}`);
        }
        
        this.loadedMessages = await response.json();
        console.log(`[i18n-utils] Loaded ${Object.keys(this.loadedMessages).length} localization messages`);
      }
    } catch (error) {
      console.error('[i18n-utils] Failed to load localization file:', error);
      this.forcedLocale = null;
    }
    
    // 如果DOM已就绪，立即应用本地化
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        // DOM仍在加载，等待完成后应用
        document.addEventListener('DOMContentLoaded', () => this.applyToPage());
      } else {
        // DOM已就绪，立即应用
        this.applyToPage();
      }
    }
  }

  /**
   * 获取本地化字符串
   */
  public getMessage(messageId: string, defaultValue?: string): string {
    // 强制本地化
    if (this.forcedLocale && this.loadedMessages[messageId]) {
      return this.loadedMessages[messageId].message;
    }
    
    // Chrome API本地化
    if (typeof chrome !== 'undefined' && chrome.i18n) {
      const message = chrome.i18n.getMessage(messageId);
      if (message) return message;
    }
    
    // 后备值
    return defaultValue || messageId;
  }

  /**
   * 格式化消息，处理参数替换
   * @param messageId 消息ID
   * @param defaultMessage 默认消息字符串
   * @param args 替换参数
   * @returns 格式化后的消息
   */
  public formatMessage(messageId: string, defaultMessage: string, ...args: any[]): string {
    // 获取基本消息字符串
    const message = this.getMessage(messageId, defaultMessage);
    
    // 处理替换参数
    let replacementArgs: any[] = [];
    
    // 如果有参数
    if (args.length > 0) {
      // 检查第一个参数是否为数组
      if (args.length === 1 && Array.isArray(args[0])) {
        // 如果是数组，使用数组内容作为替换参数
        replacementArgs = args[0];
      } else {
        // 否则使用所有参数作为替换参数
        replacementArgs = args;
      }
    }
    
    // 如果没有替换参数，直接返回消息
    if (replacementArgs.length === 0) {
      return message;
    }
    
    // 替换所有 {0}, {1}, {2} 等占位符
    let result = message;
    for (let i = 0; i < replacementArgs.length; i++) {
      // 确保参数是字符串
      const argString = String(replacementArgs[i] ?? '');
      result = result.replace(new RegExp('\\{' + i + '\\}', 'g'), argString);
    }
    
    return result;
  }

  /**
   * 对DOM元素应用本地化
   * 该方法安全地处理多次调用
   */
  public applyToPage(): void {
    if (typeof document === 'undefined') return;
    
    // 只要DOM就绪，就可以应用本地化
    // 处理页面标题
    const titleElement = document.querySelector('title[data-i18n]');
    if (titleElement) {
      const key = titleElement.getAttribute('data-i18n');
      if (key) {
        document.title = this.getMessage(key, document.title);
      }
    }
    
    // 处理所有带data-i18n的元素
    const i18nElements = document.querySelectorAll('[data-i18n]');
    i18nElements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      if (key) {
        const translated = this.getMessage(key);
        if (translated) {
          this.setElementContent(element, translated);
        }
      }
    });
    
    console.debug('[i18n-utils] Applied localization to page');
  }

  /** 
   * 设置元素内容方法保持不变
   */
  private setElementContent(element: Element, message: string): void {
    switch (element.tagName) {
      case 'INPUT':
        const inputElem = element as HTMLInputElement;
        if (['submit', 'button'].includes(inputElem.type)) {
          inputElem.value = message;
        } else {
          inputElem.placeholder = message;
        }
        break;
      case 'OPTION':
        (element as HTMLOptionElement).text = message;
        break;
      case 'IMG':
        (element as HTMLImageElement).alt = message;
        break;
      default:
        if (element.hasAttribute('placeholder')) {
          element.setAttribute('placeholder', message);
        } else {
          element.textContent = message;
        }
        break;
    }
  }
}

/**
 * 本地化错误类
 */
export class I18nError extends Error {
  public readonly messageId: string;
  public readonly technical?: string;
  
  /**
   * 创建一个已本地化的错误对象
   * 所有可能暴露给用户的错误都应使用此类
   * 
   * @param messageId 消息ID，用于本地化
   * @param defaultMessage 默认消息，当本地化失败时使用
   * @param technical 技术细节，仅用于日志记录，不会显示给用户
   */
  constructor(messageId: string, defaultMessage: string = messageId, technical?: string) {
    // 使用本地化的消息作为错误消息
    super(I18n.getInstance().getMessage(messageId, defaultMessage));
    
    this.messageId = messageId;
    this.technical = technical;
    
    // 修复原型链
    Object.setPrototypeOf(this, I18nError.prototype);
    
    // 保留原始堆栈
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, I18nError);
    }
  }
  
  /**
   * 获取完整错误信息
   */
  getFullMessage(): string {
    if (this.technical) {
      return `${this.message} (${this.technical})`;
    }
    return this.message;
  }
}

// 保持原有 i18n 对象，但优化实现
export const i18n = {
  init: async () => await I18n.getInstance().init(),
  apply: async () => await I18n.getInstance().apply(),
  getMessage: (messageId: string, defaultMessage?: string) => 
    I18n.getInstance().getMessage(messageId, defaultMessage),
  translate: (messageId: string, defaultMessage: string, ...args: any[]): string => 
    I18n.getInstance().formatMessage(messageId, defaultMessage, ...args)
};

/**
 * 本地化函数 (更简洁的调用方式)
 * @param messageId 消息ID
 * @param defaultMessage 默认消息字符串，当无法找到messageId对应的消息时使用
 * @param args 用于替换消息中的{0}, {1}等占位符的参数
 * @returns 本地化后的字符串
 */
export function _(messageId: string, defaultMessage: string, ...args: any[]): string {
  // 简化为直接调用实例方法
  return I18n.getInstance().formatMessage(messageId, defaultMessage, ...args);
}

export const _Error = (messageId: string, defaultMessage?: string, technical?: string) => 
  new I18nError(messageId, defaultMessage, technical);

// 自动初始化处理 - 保持不变
if (typeof document !== 'undefined') {
  I18n.getInstance().apply();
}