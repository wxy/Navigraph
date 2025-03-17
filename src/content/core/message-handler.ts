/**
 * 消息处理模块
 * 负责与扩展后台通信
 */

/**
 * 发送带有唯一请求ID的消息到后台
 * @param action - 消息类型
 * @param data - 消息数据（可选）
 * @returns 响应Promise
 */
export async function sendMessage(action: string, data: Record<string, any> = {}): Promise<any> {
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
      
      chrome.runtime.sendMessage(message, (response) => {
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
 * 设置消息监听器
 * @param visualizer 可视化器实例
 */
export function setupMessageListener(visualizer: any) {
  console.log('设置消息监听器');
  
  window.addEventListener('message', (event) => {
    const message = event.data;
    
    // 忽略非对象消息或没有类型的消息
    if (!message || typeof message !== 'object' || !message.type) {
      return;
    }
    
    console.log('收到消息:', message.type);
    
    switch (message.type) {
      case 'sessionLoaded':
        // 处理会话加载消息
        if (visualizer && typeof visualizer.handleSessionLoaded === 'function') {
          visualizer.handleSessionLoaded(message.session);
        }
        break;
        
      case 'sessionsListLoaded':
        // 处理会话列表加载消息
        if (visualizer && typeof visualizer.handleSessionListLoaded === 'function') {
          visualizer.handleSessionListLoaded(message.sessions);
        }
        break;
      
      // 添加对 refreshVisualization 消息的处理
      case 'refreshVisualization':
        // 处理刷新可视化消息
        if (visualizer && typeof visualizer.refreshVisualization === 'function') {
          visualizer.refreshVisualization(message.data);
        } else {
          console.warn('收到刷新可视化消息，但处理函数不存在');
        }
        break;
        
      // 其他消息类型...
      
      default:
        console.warn('未知的消息类型:', message.type);
    }
  });
}