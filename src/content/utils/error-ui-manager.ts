import { Logger } from "../../lib/utils/logger.js";
import { i18n } from "../../lib/utils/i18n-utils.js";

const logger = new Logger("ErrorUIManager");

/**
 * 错误UI管理器
 * 管理预定义的错误UI组件
 */
const ErrorUIManager = {
  /**
   * 显示标准错误消息
   * @param messageId 错误消息ID
   * @param params 消息替换参数
   */
  showErrorMessage(messageId: string, ...params: string[]): void {
    try {
      // 获取本地化消息
      const message = i18n(messageId);
      const formattedMessage = this.formatMessage(message, params);

      const errorContainer = document.getElementById("navigraph-error");
      if (!errorContainer) {
        logger.error("content_error_container_not_found");
        this.showNativeAlert(i18n("content_extension_error", "Navigraph 扩展错误:"), formattedMessage);
        return;
      }

      const messageEl = errorContainer.querySelector(".error-message");
      if (messageEl) {
        messageEl.textContent = formattedMessage;
      }

      errorContainer.style.display = "block";
    } catch (err) {
      logger.error("content_error_ui_display_failed", err);
      alert(messageId); // 直接显示消息ID，以便快速发现问题
    }
  },

  /**
   * 显示详细的错误消息
   * @param titleId 标题消息ID
   * @param error 错误对象
   */
  showDetailedErrorMessage(titleId: string, error: any): void {
    try {
      const title = i18n(titleId);

      const errorContainer = document.getElementById(
        "navigraph-error-detailed"
      );
      if (!errorContainer) {
        this.showErrorMessage(
          titleId,
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
      logger.error("content_detailed_error_ui_failed", err);
      this.showErrorMessage(
        titleId,
        error instanceof Error ? error.message : String(error)
      );
    }
  },

  /**
   * 显示通知消息
   * @param messageId 通知消息ID
   * @param duration 显示时长（毫秒）
   * @param params 消息替换参数
   */
  showToast(
    messageId: string,
    duration: number = 5000,
    ...params: string[]
  ): void {
    try {
      const message = i18n(messageId);
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
      logger.error("content_toast_display_failed", err);
    }
  },

  /**
   * 显示系统原生警告框
   * @param prefixId 前缀消息ID
   * @param message 消息内容
   */
  showNativeAlert(prefixId: string, message: string): void {
    const prefix = i18n(prefixId);
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
 * @param messageId 错误消息ID
 * @param params 消息替换参数
 */
export function showErrorMessage(messageId: string, ...params: string[]): void {
  ErrorUIManager.showErrorMessage(messageId, ...params);
}

/**
 * 显示详细的错误消息（便捷方法）
 * @param titleId 标题消息ID
 * @param error 错误对象
 */
export function showDetailedErrorMessage(titleId: string, error: any): void {
  ErrorUIManager.showDetailedErrorMessage(titleId, error);
}

/**
 * 显示通知消息（便捷方法）
 * @param messageId 通知消息ID
 * @param duration 显示时长（毫秒）
 * @param params 消息替换参数
 */
export function showToast(
  messageId: string,
  duration?: number,
  ...params: string[]
): void {
  ErrorUIManager.showToast(messageId, duration || 5000, ...params);
}

/**
 * 显示系统原生警告框（便捷方法）
 * @param prefixId 前缀消息ID
 * @param message 消息内容
 */
export function showNativeAlert(prefixId: string, message: string): void {
  ErrorUIManager.showNativeAlert(prefixId, message);
}
