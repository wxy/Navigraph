/**
 * 消息处理模块
 * 负责与扩展后台通信
 */

import type { 
  BaseMessage, 
  Message, 
  MessageHandler, 
  ResponseMessage 
} from '../types/message-types.js';

// 用于存储消息处理函数的映射
const messageHandlers: Record<string, MessageHandler[]> = {};

/**
 * 发送带有唯一请求ID的消息到后台
 * @param action - 消息类型
 * @param data - 消息数据（可选）
 * @returns 响应Promise
 */
export async function sendMessage<T extends ResponseMessage = ResponseMessage>(
  action: string, 
  data: Record<string, any> = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      // 生成唯一请求ID
      const requestId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      
      // 构建带ID的消息
      const message = {
        action,
        requestId,
        ...data
      };
      
      console.log(`发送${action}请求 [ID:${requestId}]`);
      
      chrome.runtime.sendMessage(message, (response: T) => {
        // 检查是否有通信错误
        const error = chrome.runtime.lastError;
        if (error) {
          console.error(`发送${action}请求错误:`, error);
          reject(new Error(error.message));
          return;
        }
        
        // 验证响应是否有效
        if (!response) {
          reject(new Error(`没有收到${action}响应`));
          return;
        }
        
        console.log(`收到${action}响应 [ID:${response.requestId || '未知'}]`);
        
        // 验证响应ID是否匹配
        if (response.requestId !== requestId) {
          console.warn('响应ID不匹配:', response.requestId, '!=', requestId);
          // 仍然解析响应，因为在某些情况下ID可能不匹配但响应有效
        }
        
        resolve(response);
      });
    } catch (err) {
      console.error('消息发送失败:', err);
      reject(err);
    }
  });
}

/**
 * 注册消息处理函数
 * @param action 消息类型
 * @param handler 处理函数
 */
export function registerMessageHandler<T extends BaseMessage>(
  action: T['action'], 
  handler: MessageHandler<T>
): void {
  if (!messageHandlers[action]) {
    messageHandlers[action] = [];
  }
  messageHandlers[action].push(handler as MessageHandler);
  console.log(`已注册消息处理函数: ${action}, 当前处理函数数量: ${messageHandlers[action].length}`);
}

/**
 * 取消注册消息处理函数
 * @param action 消息类型
 * @param handler 处理函数 (可选，如果不提供则移除所有该类型的处理函数)
 */
export function unregisterMessageHandler(action: string, handler?: MessageHandler): void {
  if (!messageHandlers[action]) {
    return;
  }
  
  if (handler) {
    const index = messageHandlers[action].indexOf(handler);
    if (index !== -1) {
      messageHandlers[action].splice(index, 1);
      console.log(`已移除消息处理函数: ${action}, 剩余处理函数数量: ${messageHandlers[action].length}`);
    }
  } else {
    messageHandlers[action] = [];
    console.log(`已移除所有${action}消息处理函数`);
  }
}

/**
 * 设置消息监听器
 * 这个函数应该在应用初始化时调用一次
 */
export function setupMessageListener(): void {
  console.log('设置全局消息监听器...');
  
  // 设置chrome.runtime.onMessage监听器
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) {
      return false;
    }
    
    console.log(`收到chrome消息: ${message.action}`, message);
    
    // 调用对应的处理函数
    const handlers = messageHandlers[message.action];
    if (handlers && handlers.length > 0) {
      let responseHandled = false;
      
      // 调用所有注册的处理函数
      handlers.forEach(handler => {
        try {
          // 调用处理函数，传递消息、发送者和响应函数
          const result = handler(message, sender, (response: any) => {
            if (!responseHandled) {
              sendResponse(response);
              responseHandled = true;
            }
          });
          
          // 如果处理函数返回true，表示它会异步处理响应
          if (result === true) {
            responseHandled = true;
          }
        } catch (error) {
          console.error(`处理消息${message.action}时出错:`, error);
        }
      });
      
      // 如果有处理函数返回true，则返回true以保持消息通道开放
      return responseHandled;
    } else {
      // 无处理函数时的默认响应处理
      console.debug(`没有处理函数注册用于消息类型: ${message.action}`);
      
      // 针对特定消息类型的默认处理
      switch (message.action) {
        case 'linkClicked':
        case 'pageLoaded':
        case 'faviconUpdated':
        case 'getNodeId':
          // 这些消息类型来自内容脚本，需自动响应以避免阻塞
          if (sendResponse) {
            sendResponse({
              success: true,
              action: message.action,
              requestId: message.requestId,
              message: '已收到但无专门处理程序',
              timestamp: Date.now()
            });
          }
          return false; // 不保持通道开放
          
        default:
          // 其他未知消息类型
          return false;
      }
    }
  });
  
  // 设置window.message监听器（用于页面内通信）
  window.addEventListener('message', (event) => {
    const message = event.data;
    
    // 忽略非对象消息或没有类型的消息
    if (!message || typeof message !== 'object' || !message.type) {
      return;
    }
    
    console.log('收到window消息:', message.type);
    
    // 将window消息转换为标准格式
    const standardMessage = {
      action: message.type,
      ...message
    };
    
    // 调用对应的处理函数
    const handlers = messageHandlers[message.type];
    if (handlers && handlers.length > 0) {
      handlers.forEach(handler => {
        try {
          handler(standardMessage, { source: 'window' }, () => {});
        } catch (error) {
          console.error(`处理window消息${message.type}时出错:`, error);
        }
      });
    }
  });
  
  // 设置页面可见性和焦点事件监听
  setupPageActivityListeners();
}

/**
 * 设置页面活动监听器
 * 用于在页面激活时发送特殊消息
 */
function setupPageActivityListeners(): void {
  // 上次活动时间
  let lastActivityTime = 0;
  const MIN_ACTIVITY_INTERVAL = 5000; // 至少5秒间隔
  
  // 监听页面可见性变化
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      triggerPageActivityEvent('visibility');
    }
  });
  
  // 监听页面获得焦点
  window.addEventListener('focus', () => {
    triggerPageActivityEvent('focus');
  });
  
  /**
   * 触发页面活动事件
   * 这会发出一个特殊的 "pageActivity" 消息，让注册的处理函数知道页面被激活了
   */
  function triggerPageActivityEvent(source: string): void {
    const now = Date.now();
    if (now - lastActivityTime > MIN_ACTIVITY_INTERVAL) {
      lastActivityTime = now;
      console.log(`检测到页面活动(${source}), 距离上次: ${now - lastActivityTime}ms`);
      
      // 创建页面活动消息
      const activityMessage = {
        action: 'pageActivity',
        source: source,
        timestamp: now
      };
      
      // 调用所有注册的pageActivity处理函数
      const handlers = messageHandlers['pageActivity'];
      if (handlers && handlers.length > 0) {
        handlers.forEach(handler => {
          try {
            handler(activityMessage, { source: 'internal' }, () => {});
          } catch (error) {
            console.error('处理页面活动事件时出错:', error);
          }
        });
      } else {
        console.debug('没有处理函数注册用于pageActivity消息');
      }
    } else {
      console.debug(`页面活动(${source})距离上次时间过短(${now - lastActivityTime}ms)，忽略`);
    }
  }
}