/**
 * Navigraph 本地化工具类
 * 支持强制指定本地化，和两种使用方式：
 * 1. 静态 HTML 本地化 (data-i18n 属性)
 * 2. 动态获取本地化字符串 (i18n 函数)
 */

import { Logger } from '../../lib/utils/logger.js';
const logger = new Logger('i18n-utils');

export class I18nUtils {
  private static instance: I18nUtils;
  private loadedMessages: Record<string, {message: string, description?: string}> = {};
  private forcedLocale: string | null = null;
  private hasInitialized: boolean = false;

  /**
   * 获取单例实例
   */
  public static getInstance(): I18nUtils {
    if (!I18nUtils.instance) {
      I18nUtils.instance = new I18nUtils();
    }
    return I18nUtils.instance;
  }

  /**
   * 初始化本地化工具并应用到页面
   * 集成了初始化和应用到页面两个步骤
   * 该方法可以安全地多次调用，只会执行一次初始化和应用
   */
  public async apply(): Promise<void> {
    // 如果已经初始化过，不再重复执行
    if (this.hasInitialized) {
      logger.debug('本地化工具已初始化，跳过重复操作');
      return;
    }
    
    this.hasInitialized = true;
    
    // 获取 URL 查询参数中的本地化设置
    try {
      const urlParams = new URLSearchParams(window.location.search);
      this.forcedLocale = urlParams.get('locale')?.replace('-', '_') ?? null;
      
      if (this.forcedLocale) {
        logger.log(`使用URL参数指定的本地化: ${this.forcedLocale}`);
        const response = await fetch(`../_locales/${this.forcedLocale}/messages.json`);
        
        if (!response.ok) {
          throw new Error(`Unable to load specified language file: ${response.status}`);
        }
        
        this.loadedMessages = await response.json();
        logger.log(`已加载本地化消息: ${Object.keys(this.loadedMessages).length} 条`);
      }
    } catch (error) {
      logger.error(`加载本地化文件失败:`, error);
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
    
    logger.debug('页面本地化应用完成');
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
  public readonly technical?: string; // 更明确的名称
  
  /**
   * 构造函数
   * @param messageId 错误消息ID (必须以'content_'开头的本地化ID)
   * @param technical 技术细节，不会被本地化 (可选)
   * @param defaultMessage 当消息ID无法解析时的默认消息 (可选)
   */
  constructor(messageId: string, technical?: string, defaultMessage?: string) {
    // 使用本地化的消息作为错误消息，如果解析失败则使用默认消息
    super(I18nUtils.getInstance().getMessage(messageId, defaultMessage));
    
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

/**
 * 获取本地化字符串并支持参数替换
 * @param messageId 消息ID
 * @param args 用于替换消息中的{0}, {1}等占位符的参数
 * @returns 本地化后的字符串
 */
export function i18n(messageId: string, ...args: string[]): string {
  // 首先获取基本消息字符串
  const message = I18nUtils.getInstance().getMessage(messageId);
  
  // 如果没有参数需要替换，直接返回
  if (!args || args.length === 0) {
    return message;
  }
  
  // 替换所有 {0}, {1}, {2} 等占位符
  let result = message;
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp('\\{' + i + '\\}', 'g'), args[i]);
  }
  
  return result;
}

/**
 * 创建本地化错误
 * @param messageId 错误消息ID
 * @param technical 技术细节 (不会被本地化)
 * @param defaultMessage 当消息ID无法解析时的默认消息
 */
export function i18nError(
  messageId: string, 
  technical?: string, 
  defaultMessage?: string
): I18nError {
  return new I18nError(messageId, technical, defaultMessage);
}

// 自动初始化处理
if (typeof document !== 'undefined') {
  // 使用新的合并方法
  I18nUtils.getInstance().apply();
}