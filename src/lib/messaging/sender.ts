import { Logger } from '../../lib/utils/logger.js';
import { MessageTarget, BaseMessage, BaseResponse } from '../../types/messages/common.js';
import { RequestResponseMap } from '../../types/messages/index.js';

// 自定义类型帮助器，将target和action转换为RequestResponseMap的键
type PrefixedAction<T extends MessageTarget, A extends string> = 
  `${T}.${A}` extends keyof RequestResponseMap ? `${T}.${A}` : never;

// 查找不带前缀的动作对应的完整键名
type FindActionWithTarget<A extends string> = 
  {[K in keyof RequestResponseMap]: K extends `${infer T}.${A}` ? K : never}[keyof RequestResponseMap];

const logger = new Logger('MessageSender');

/**
 * 发送消息到指定目标
 * @param action 消息动作
 * @param target 目标接收者
 * @param data 消息数据
 */
export function sendMessage<T extends MessageTarget, A extends string>(
  action: A, 
  target: T,
  data: any = {}
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      // 构造带前缀的完整action键名
      const prefixedAction = `${target}.${action}` as keyof RequestResponseMap;
      const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
      
      const message = {
        action: action, // 保持原始action名称，不使用带前缀的键
        requestId,
        target,
        ...data
      };
      
      logger.log(`发送消息: ${action} [ID:${requestId}] 至 ${target}`);
      
      if (target === 'content') {
        // 发送到特定标签页内容脚本
        if ('tabId' in data && typeof data.tabId === 'number') {
          const tabId = data.tabId;
          delete (data as any).tabId; // 从数据中移除tabId，避免重复
          
          chrome.tabs.sendMessage(tabId, message, (response) => {
            handleResponse(response, resolve, reject);
          });
        } else {
          reject(new Error('发送到内容脚本时必须指定tabId'));
        }
      } else {
        // 发送到后台脚本或其他目标
        chrome.runtime.sendMessage(message, (response) => {
          handleResponse(response, resolve, reject);
        });
      }
    } catch (error) {
      logger.error('发送消息异常:', error);
      reject(error);
    }
  });
}

/**
 * 处理消息响应
 */
function handleResponse<T extends BaseResponse>(
  response: any, 
  resolve: (value: T) => void, 
  reject: (reason: any) => void
): void {
  if (chrome.runtime.lastError) {
    logger.error('发送消息时出错:', chrome.runtime.lastError);
    reject(chrome.runtime.lastError);
    return;
  }
  
  if (!response) {
    const error = new Error('没有收到响应');
    logger.error(error);
    reject(error);
    return;
  }
  
  if (!response.success) {
    const error = new Error(response.error || '未知错误');
    logger.error('收到错误响应:', response.error);
    reject(error);
    return;
  }
  
  resolve(response as T);
}

/**
 * 发送消息到后台脚本
 * 使用新的类型约束方式
 */
export function sendToBackground<A extends string>(
  action: A,
  data: any = {}
): Promise<any> {
  type ValidAction = PrefixedAction<'background', A>;
  return sendMessage(action, 'background', data);
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
  options: { maxRetries?: number; retryDelay?: number } = {}
): Promise<any> {
  const { maxRetries = 3, retryDelay = 1000 } = options;
  
  return new Promise(async (resolve, reject) => {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.log(`重试发送消息 (${attempt}/${maxRetries}): ${action}`);
          await new Promise(r => setTimeout(r, retryDelay * attempt));
        }
        
        const response = await sendMessage(action, target, data);
        resolve(response);
        return;
      } catch (error) {
        logger.warn(`发送消息失败 (${attempt}/${maxRetries}):`, error);
        lastError = error;
        
        // 如果是扩展上下文失效错误，不再重试
        if (error instanceof Error && 
            error.message.includes('Extension context invalidated')) {
          logger.error('扩展上下文已失效，不再重试');
          break;
        }
      }
    }
    
    reject(lastError || new Error(`在 ${maxRetries} 次尝试后发送消息失败`));
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
    logger.warn('扩展上下文已失效:', e);
    return false;
  }
}