import { Logger } from '../../lib/utils/logger.js';
import { I18nError, i18n } from '../utils/i18n.js';  // 引入 I18nError
import {
  MessageTarget,
  BaseMessage,
  BaseResponse,
  RetryInfo
} from '../../types/messages/common.js';
import {
  RequestResponseMap,
  PrefixedAction,
  FindActionWithTarget
} from '../../types/messages/index.js';

const logger = new Logger('MessageSender');

/**
 * 发送消息到指定目标
 */
export function sendMessage<T extends MessageTarget, A extends string>(
  action: A,
  target: T,
  data: any = {},
  retryInfo?: RetryInfo
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      // 构造带前缀的完整action键名
      const prefixedAction = `${target}.${action}` as keyof RequestResponseMap;
      const requestId = Date.now().toString() + Math.random().toString(36).slice(2, 9);

      // 本地化发送日志
      if (!retryInfo || retryInfo.isLastAttempt || retryInfo.attempt === 0) {
        logger.log(_('message_send', '发送消息: {0} [ID:{1}] 目标:{2}'),
          action,
          requestId,
          target
        );
      }

      const message = {
        action: action,
        requestId,
        target,
        ...data
      };

      if (target === 'content') {
        // 发送到特定标签页内容脚本
        if ('tabId' in data && typeof data.tabId === 'number') {
          const tabId = data.tabId;
          delete (data as any).tabId; // 从数据中移除tabId，避免重复

          chrome.tabs.sendMessage(tabId, message, (response) => {
            handleResponse(response, resolve, reject, retryInfo);
          });
        } else {
          // 使用 I18nError 并本地化日志
          const err = new Error(_('message_missing_tab_id', '发送到内容脚本时必须指定 tabId'));
          logger.error(_('message_missing_tab_id', '发送到内容脚本时必须指定 tabId'));
          reject(err);
        }
      } else {
        // 发送到后台脚本或其他目标
        chrome.runtime.sendMessage(message, (response) => {
          handleResponse(response, resolve, reject, retryInfo);
        });
      }
    } catch (error) {
      // 只有在最后一次尝试时才记录错误
      if (!retryInfo || retryInfo.isLastAttempt) {
        logger.error(_('message_send_error', '发送消息异常: {0}'), error instanceof Error ? error.message : String(error));
      } 
      const msg = error instanceof I18nError
        ? error
        : new Error(_('message_send_error', '发送消息异常: {0}', error instanceof Error ? error.message : String(error)));
      reject(msg);
    }
  });
}

/**
 * 处理消息响应
 */
function handleResponse<T extends BaseResponse>(
  response: any,
  resolve: (value: T) => void,
  reject: (reason: any) => void,
  retryInfo?: RetryInfo
): void {
  const suppressErrors = retryInfo?.isLastAttempt === false;

  if (chrome.runtime.lastError) {
    if (!suppressErrors) {
      logger.error(_('message_runtime_error', '运行时错误: {0}'), chrome.runtime.lastError.message);
    }
    reject(new Error(_('message_runtime_error', '运行时错误: {0}', chrome.runtime.lastError.message)));
    return;
  }

  if (!response) {
    const err = new Error(_('message_no_response', '没有收到响应'));
    if (!suppressErrors) {
      logger.error(_('message_no_response', '没有收到响应'));
    }
    reject(err);
    return;
  }

  if (!response.success) {
    const err = new Error(_('message_response_error', '收到错误响应: {0}', response.error));
    if (!suppressErrors) {
      logger.error(_('message_response_error', '收到错误响应: {0}'), response.error);
    }
    reject(err);
    return;
  }

  resolve(response as T);
}

/**
 * 发送消息到后台脚本
 * 支持配置重试选项
 */
export function sendToBackground<A extends string>(
  action: A,
  data: any = {},
  options?: {
    retry?: boolean;           // 是否启用重试
    maxRetries?: number;       // 最大重试次数
    initialDelay?: number;     // 初始延迟(毫秒)
    maxDelay?: number;         // 最大延迟(毫秒)
    factor?: number;           // 退避因子
    defaultValue?: any;        // 所有重试失败后返回的默认值
  }
): Promise<any> {
  // 默认不开启重试
  if (!options?.retry) {
    return sendMessage(action, 'background', data);
  }

  // 启用重试
  return sendMessageWithRetry(
    action,
    'background',
    data,
    {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.initialDelay || 500,
      exponentialBackoff: true,
      factor: options.factor || 2,
      maxDelay: options.maxDelay || 5000,
      defaultValue: options.defaultValue
    }
  );
}

/**
 * 发送消息到内容脚本
 */
export function sendToContent<A extends string>(
  tabId: number,
  action: A,
  data: any = {}
): Promise<any> {
  type ValidAction = PrefixedAction<'content', A>;
  return sendMessage(action, 'content', { ...data, tabId });
}

/**
 * 发送消息到弹出窗口
 */
export function sendToPopup<A extends string>(
  action: A,
  data: any = {}
): Promise<any> {
  type ValidAction = PrefixedAction<'popup', A>;
  return sendMessage(action, 'popup', data);
}

/**
 * 发送消息到选项页
 */
export function sendToOptions<A extends string>(
  action: A,
  data: any = {}
): Promise<any> {
  type ValidAction = PrefixedAction<'options', A>;
  return sendMessage(action, 'options', data);
}

/**
 * 带重试功能的发送消息
 */
export function sendMessageWithRetry<T extends MessageTarget, A extends string>(
  action: A,
  target: T,
  data: any = {},
  options: {
    maxRetries?: number;
    retryDelay?: number;
    exponentialBackoff?: boolean;
    factor?: number;
    maxDelay?: number;
    defaultValue?: any;
  } = {}
): Promise<any> {
  const {
    maxRetries = 3,
    retryDelay = 500,
    exponentialBackoff = true,
    factor = 2,
    maxDelay = 5000,
    defaultValue = undefined
  } = options;

  return new Promise(async (resolve, reject) => {
    let lastError: any;
    let currentDelay = retryDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.log(_('message_retry', '重试发送消息 ({0}/{1}): {2}'), attempt, maxRetries, action);
          await new Promise(r => setTimeout(r, currentDelay));

          // 计算下一次延迟（如果启用指数退避）
          if (exponentialBackoff) {
            const jitter = Math.random() * 0.3 + 0.85;
            currentDelay = Math.min(currentDelay * factor * jitter, maxDelay);
          }
        }

        // 创建更详细的重试信息对象
        const retryInfo = {
          isRetrying: attempt > 0,
          isLastAttempt: attempt === maxRetries,
          attempt: attempt,
          maxRetries: maxRetries
        };

        const response = await sendMessage(action, target, data, retryInfo);
        resolve(response);
        return;
      } catch (error) {
        lastError = error;

        // 如果是扩展上下文失效错误，不再重试
        if (error instanceof Error &&
          (error.message.includes('invalid') || error.message.includes('closed'))) {
          logger.error(_('message_extension_context_invalid', '扩展上下文失效或端口已关闭: {0}'), error.message);
          break;
        }
      }
    }

    // 所有重试都失败了
    if (defaultValue !== undefined) {
      logger.warn(_('message_send_failed_default', '发送消息 {0} 失败，已使用默认值'), action);
      resolve(defaultValue);
    } else {
      // 最终失败时记录一条整体错误
      logger.error(_('message_send_final_failed', '在第 {1} 次尝试后发送消息失败: {0}'), action, maxRetries + 1);
      reject(
        lastError instanceof I18nError
          ? lastError
          : new Error(_('message_send_final_failed', '在第 {1} 次尝试后发送消息失败: {0}', [action, `${maxRetries + 1}`]))
      );
    }
  });
}

/**
 * 检查扩展上下文是否有效
 * 用于检测扩展是否被禁用、更新或重新加载
 */
export function isExtensionContextValid(): boolean {
  try {
    // 尝试访问chrome.runtime.id，这会在扩展上下文无效时抛出错误
    const id = chrome.runtime.id;
    return !!id;
  } catch (e) {
    logger.warn(_('message_extension_context_invalid', '扩展上下文失效或端口已关闭: {0}'), e instanceof Error ? e.message : String(e));
    return false;
  }
}