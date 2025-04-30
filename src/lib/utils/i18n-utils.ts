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
   * 初始化本地化工具
   * 检查URL参数并可能加载特定的本地化文件
   */
  public async initialize(): Promise<void> {
    // 获取 URL 查询参数中的本地化设置
    try {
      const urlParams = new URLSearchParams(window.location.search);
      this.forcedLocale = urlParams.get('locale')?.replace('-', '_') ?? null;
      
      if (this.forcedLocale) {
        logger.log(`使用URL参数指定的本地化: ${this.forcedLocale}`);
        const response = await fetch(`../_locales/${this.forcedLocale}/messages.json`);
        
        if (!response.ok) {
          throw new Error(`无法加载指定语言文件: ${response.status}`);
        }
        
        this.loadedMessages = await response.json();
        logger.log(`已加载本地化消息: ${Object.keys(this.loadedMessages).length} 条`);
      }
    } catch (error) {
      logger.error(`加载本地化文件失败:`, error);
      this.forcedLocale = null;
    }
  }

  /**
   * 获取本地化字符串
   * 优先使用强制指定的本地化，如果未找到则使用Chrome本地化API
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
   * 查找带有data-i18n属性的元素并替换内容
   */
  public applyToPage(): void {
    if (typeof document === 'undefined') return;

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
  }

  /**
   * 根据元素类型设置本地化内容
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

// 创建简单的全局函数，用于快速访问
export function i18n(messageId: string, defaultValue?: string): string {
  return I18nUtils.getInstance().getMessage(messageId, defaultValue);
}

// 在DOM就绪后自动应用本地化
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    const i18nUtils = I18nUtils.getInstance();
    await i18nUtils.initialize();
    i18nUtils.applyToPage();
  });
}