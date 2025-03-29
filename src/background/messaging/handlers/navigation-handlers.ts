import { BackgroundMessageService } from '../bg-message-service.js';
import { BackgroundMessages, BackgroundResponses } from '../../../types/messages/background.js';

/**
 * 注册导航相关的消息处理程序
 */
export function registerNavigationHandlers(messageService: BackgroundMessageService): void {
  // 获取导航节点ID
  messageService.registerHandler('getNodeId', (
    message: BackgroundMessages.GetNodeIdRequest, 
    sender: chrome.runtime.MessageSender, 
    sendResponse: (response: BackgroundResponses.GetNodeIdResponse) => void
  ) => {
    const ctx = messageService.createMessageContext(message, sender, sendResponse);
    const { tabId, url, referrer, timestamp } = message;
    
    console.log('处理getNodeId请求:', { tabId, url });
    
    // 这里应该调用实际的业务逻辑
    getOrCreateNavigationNode(tabId, url, referrer, timestamp)
      .then(nodeId => {
        ctx.success({ nodeId });
      })
      .catch(error => {
        ctx.error(`获取节点ID失败: ${error.message}`);
      });
    
    return true; // 需要异步响应
  });
}

/**
 * 创建或获取导航节点ID
 * @param tabId 标签页ID
 * @param url URL
 * @param referrer 引荐URL
 * @param timestamp 时间戳
 * @returns Promise<string> 节点ID
 */
async function getOrCreateNavigationNode(
  tabId: number, 
  url: string, 
  referrer: string, 
  timestamp: number
): Promise<string> {
  // 实际业务逻辑，这里只是模拟
  return new Promise((resolve) => {
    setTimeout(() => {
      // 简单生成一个基于URL的节点ID
      const hash = Math.abs(hashString(url + tabId)).toString(16);
      resolve(`node-${hash}`);
    }, 100);
  });
}

/**
 * 记录页面访问
 */
async function recordPageVisit(
  tabId: number,
  url: string,
  title: string,
  referrer: string,
  timestamp: number
): Promise<string> {
  // 实际业务逻辑，这里只是模拟
  return new Promise((resolve) => {
    setTimeout(() => {
      const visitId = `visit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      resolve(visitId);
    }, 100);
  });
}

/**
 * 简单的字符串哈希函数
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // 转为32位整数
  }
  return hash;
}