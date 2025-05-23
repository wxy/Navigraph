import { Logger } from "../../lib/utils/logger.js";
import { _, _Error } from "../../lib/utils/i18n.js";

const logger = new Logger("ErrorUIManager");

/**
 * 错误UI管理器
 * 管理预定义的错误UI组件
 */
const ErrorUIManager = {
  /**
   * 显示标准错误消息
   * @param message 错误消息文本
   * @param params 消息替换参数
   */
  showErrorMessage(message: string, ...params: string[]): void {
    try {
      // 直接使用传入的消息文本，只进行参数替换
      const formattedMessage = this.formatMessage(message, params);

      const errorContainer = document.getElementById("navigraph-error");
      if (!errorContainer) {
        logger.error(_('content_error_container_not_found', '找不到错误UI容器，降级到alert'));
        this.showNativeAlert(_("content_extension_error", "Navigraph 扩展错误:"), formattedMessage);
        return;
      }

      const messageEl = errorContainer.querySelector(".error-message");
      if (messageEl) {
        messageEl.textContent = formattedMessage;
      }

      errorContainer.style.display = "block";
    } catch (err) {
      logger.error(_('content_error_ui_display_failed', '显示错误UI失败: {0}'), err);
      alert(message); // 直接显示传入的消息
    }
  },

  /**
   * 显示详细的错误消息
   * @param title 标题文本
   * @param error 错误对象
   */
  showDetailedErrorMessage(title: string, error: any): void {
    try {
      // 直接使用传入的标题
      const errorContainer = document.getElementById("navigraph-error-detailed");
      if (!errorContainer) {
        this.showErrorMessage(
          title,
          error instanceof Error ? error.message : String(error)
        );
        return;
      }

      // 设置标题
      const titleEl = errorContainer.querySelector(".error-title");
      if (titleEl) {
        titleEl.textContent = title;
      }

      // 设置错误消息
      const messageEl = errorContainer.querySelector(".error-message");
      if (messageEl) {
        messageEl.textContent =
          error instanceof Error ? error.message : String(error);
      }

      // 检查是否有堆栈信息
      const hasStack = error instanceof Error && error.stack;

      // 设置错误堆栈
      const stackEl = errorContainer.querySelector(".error-stack");
      if (stackEl) {
        stackEl.textContent = hasStack ? error.stack ?? "" : "";
      }

      // 控制详情元素
      const detailsEl = errorContainer.querySelector("details");
      if (detailsEl) {
        // 如果有堆栈信息，则设置open属性
        if (hasStack) {
          detailsEl.setAttribute("open", ""); // 打开详情
        } else {
          detailsEl.removeAttribute("open"); // 关闭详情
          detailsEl.style.display = "none"; // 完全隐藏详情部分
        }
      }

      // 显示容器
      errorContainer.style.display = "block";
    } catch (err) {
      logger.error(_('content_detailed_error_ui_failed', '显示详细错误UI失败: {0}'), err);
      this.showErrorMessage(
        title,
        error instanceof Error ? error.message : String(error)
      );
    }
  },

  /**
   * 显示通知消息
   * @param message 通知消息文本
   * @param duration 显示时长（毫秒）
   * @param params 消息替换参数
   */
  showToast(
    message: string,
    duration: number = 5000,
    ...params: string[]
  ): void {
    try {
      // 直接使用传入的消息文本
      const formattedMessage = this.formatMessage(message, params);

      const toastEl = document.getElementById("navigraph-toast");
      if (!toastEl) return;

      toastEl.textContent = formattedMessage;
      toastEl.style.display = "block";

      // 设置自动隐藏
      setTimeout(() => {
        if (toastEl) {
          toastEl.style.display = "none";
        }
      }, duration);
    } catch (err) {
      logger.error(_('content_toast_display_failed', '显示通知消息失败: {0}'), err);
    }
  },

  /**
   * 显示系统原生警告框
   * @param prefix 前缀文本
   * @param message 消息内容
   */
  showNativeAlert(prefix: string, message: string): void {
    // 直接使用传入的前缀
    alert(`${prefix} ${message}`);
  },

  /**
   * 格式化消息，替换参数标记
   * @param message 消息模板
   * @param params 替换参数
   * @returns 格式化后的消息
   */
  formatMessage(message: string, params: string[] = []): string {
    if (!params || params.length === 0) return message;

    let result = message;
    for (let i = 0; i < params.length; i++) {
      result = result.replace(new RegExp(`\\{${i}\\}`, "g"), params[i]);
    }
    return result;
  },
};

/**
 * 显示标准错误消息（便捷方法）
 * @param message 错误消息文本
 * @param params 消息替换参数
 */
export function showErrorMessage(message: string, ...params: string[]): void {
  ErrorUIManager.showErrorMessage(message, ...params);
}

/**
 * 显示详细的错误消息（便捷方法）
 * @param title 标题文本
 * @param error 错误对象
 */
export function showDetailedErrorMessage(title: string, error: any): void {
  ErrorUIManager.showDetailedErrorMessage(title, error);
}

/**
 * 显示通知消息（便捷方法）
 * @param message 通知消息文本
 * @param duration 显示时长（毫秒）
 * @param params 消息替换参数
 */
export function showToast(
  message: string,
  duration?: number,
  ...params: string[]
): void {
  ErrorUIManager.showToast(message, duration || 5000, ...params);
}

/**
 * 显示系统原生警告框（便捷方法）
 * @param prefix 前缀文本
 * @param message 消息内容
 */
export function showNativeAlert(prefix: string, message: string): void {
  ErrorUIManager.showNativeAlert(prefix, message);
}
