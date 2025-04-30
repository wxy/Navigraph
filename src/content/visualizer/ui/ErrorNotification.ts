import { Logger } from '../../../lib/utils/logger.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';

const logger = new Logger('ErrorNotification');

/**
 * 错误通知类 - 使用现有HTML元素
 */
export class ErrorNotification {
  private simpleErrorElement: HTMLElement | null = null;
  private detailedErrorElement: HTMLElement | null = null;
  private toastElement: HTMLElement | null = null;
  private autoHideTimer: number | null = null;

  /**
   * 初始化错误通知组件
   */
  public initialize(): void {
    // 获取现有错误UI元素
    this.simpleErrorElement = document.getElementById('navigraph-error');
    this.detailedErrorElement = document.getElementById('navigraph-error-detailed');
    this.toastElement = document.getElementById('navigraph-toast');

    if (!this.simpleErrorElement || !this.detailedErrorElement || !this.toastElement) {
      logger.error(i18n('content_error_ui_missing'));
    }

    logger.log('错误通知组件已初始化');
  }

  /**
   * 显示简单错误消息
   * @param messageId 错误消息ID
   * @param duration 显示时长(毫秒)，0表示不自动隐藏
   */
  public show(messageId: string, duration: number = 5000): void {
    if (!this.simpleErrorElement) {
      this.initialize();
    }
    const message = i18n(messageId);

    logger.error(i18n("content_error_occurred", message));

    if (this.simpleErrorElement) {
      // 设置错误消息
      const messageElement = this.simpleErrorElement.querySelector('.error-message');
      if (messageElement) {
        messageElement.textContent = message;
      }
      
      // 本地化关闭按钮
      const closeButton = this.simpleErrorElement.querySelector('.close-button');
      if (closeButton) {
        closeButton.setAttribute('title', i18n('content_close'));
      }

      // 本地化刷新按钮（如果存在）
      const refreshButton = this.simpleErrorElement.querySelector('.refresh-button');
      if (refreshButton) {
        refreshButton.textContent = i18n('content_refresh');
      }

      // 显示元素
      this.simpleErrorElement.style.display = 'block';

      // 如果指定了持续时间，自动隐藏
      if (duration > 0) {
        if (this.autoHideTimer) {
          window.clearTimeout(this.autoHideTimer);
        }

        this.autoHideTimer = window.setTimeout(() => {
          this.hide();
        }, duration);
      }
    }
  }

  /**
   * 隐藏错误通知
   * 无参数版本，用于与原有接口兼容
   */
  public hide(): void {
    if (this.simpleErrorElement) {
      this.simpleErrorElement.style.display = 'none';
    }

    if (this.autoHideTimer) {
      window.clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  /**
   * 显示详细错误消息
   * @param titleId 错误标题ID
   * @param messageId 错误消息ID
   * @param stack 错误堆栈
   */
  public showDetailed(titleId: string, messageId: string, stack?: string): void {
    if (!this.detailedErrorElement) {
      this.initialize();
    }

    const title = i18n(titleId);
    const message = i18n(messageId);

    logger.error(`${title}: ${message}`);
    if (stack) {
      logger.error(stack);
    }

    if (this.detailedErrorElement) {
      // 设置错误标题
      const titleElement = this.detailedErrorElement.querySelector('.error-title');
      if (titleElement) {
        titleElement.textContent = title || i18n('content_error_default_title');
      }

      // 设置错误消息
      const messageElement = this.detailedErrorElement.querySelector('.error-message');
      if (messageElement) {
        messageElement.textContent = message;
      }

      // 设置堆栈信息
      const stackElement = this.detailedErrorElement.querySelector('.error-stack');
      if (stackElement && stack) {
        stackElement.textContent = stack;
      }
      
      // 本地化关闭按钮
      const closeButton = this.detailedErrorElement.querySelector('.close-button');
      if (closeButton) {
        closeButton.setAttribute('title', i18n('content_close'));
      }

      // 显示元素
      this.detailedErrorElement.style.display = 'block';
    }
  }

  /**
   * 隐藏详细错误消息
   */
  public hideDetailed(): void {
    if (this.detailedErrorElement) {
      this.detailedErrorElement.style.display = 'none';
    }
  }

  /**
   * 显示简短通知消息
   * @param message 消息内容
   * @param duration 显示时长(毫秒)
   */
  public showToast(message: string, duration: number = 5000): void {
    if (!this.toastElement) {
      this.initialize();
    }

    logger.log(`通知: ${message}`);

    if (this.toastElement) {
      // 清除之前的自动隐藏计时器
      if (this.autoHideTimer) {
        window.clearTimeout(this.autoHideTimer);
        this.autoHideTimer = null;
      }

      // 设置消息
      this.toastElement.textContent = message;

      // 显示元素
      this.toastElement.style.display = 'block';

      // 设置自动隐藏
      this.autoHideTimer = window.setTimeout(() => {
        this.hideToast();
      }, duration);
    }
  }

  /**
   * 隐藏通知消息
   */
  public hideToast(): void {
    if (this.toastElement) {
      this.toastElement.style.display = 'none';
    }

    if (this.autoHideTimer) {
      window.clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  /**
   * 隐藏所有错误消息
   */
  public hideAll(): void {
    this.hide();
    this.hideDetailed();
    this.hideToast();
  }
}