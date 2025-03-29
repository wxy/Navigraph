import { sendToBackground, isExtensionContextValid } from '../lib/messaging/sender.js';
import { registerContentMessageHandlers } from './messaging/index.js';

// 存储从后台获取的标准节点ID
let standardNodeId: string | null = null;
let isExtensionActive: boolean = true;
let lastRequestTime: number = 0;

/**
 * 检查是否是系统页面
 */
function isSystemPage(url: string): boolean {
  // 检查是否是扩展页面、浏览器内置页面等
  return url.startsWith('chrome://') || 
         url.startsWith('chrome-extension://') || 
         url.startsWith('about:') ||
         url.startsWith('edge://') ||
         url.startsWith('brave://') ||
         url.startsWith('opera://');
}

/**
 * 请求当前页面的节点ID
 */
async function requestNodeId(): Promise<void> {
  if (!isExtensionContextValid() || !isExtensionActive) {
    console.warn('扩展不活跃或上下文无效，无法请求节点ID');
    return;
  }
  
  const now = Date.now();
  
  // 限制频率
  if (now - lastRequestTime < 5000) {
    console.debug('请求节点ID间隔过短，跳过');
    return;
  }
  
  lastRequestTime = now;
  const url = window.location.href;
  
  // 系统页面不请求
  if (isSystemPage(url)) {
    return;
  }
  
  try {
    console.log('请求标签页ID...');
    
    // 获取标签页ID
    const tabIdResponse = await sendToBackground('getTabId', {});
    
    console.log('收到标签页ID响应:', tabIdResponse);
    
    if (tabIdResponse.tabId !== undefined) {
      // 请求节点ID
      const nodeIdResponse = await sendToBackground('getNodeId', {
        tabId: tabIdResponse.tabId,
        url: url,
        referrer: document.referrer,
        timestamp: Date.now()
      });
      
      console.log('收到节点ID响应:', nodeIdResponse);
      
      if (nodeIdResponse.nodeId) {
        if (standardNodeId !== nodeIdResponse.nodeId) {
          console.log(`更新节点ID: ${standardNodeId || 'null'} -> ${nodeIdResponse.nodeId}`);
          standardNodeId = nodeIdResponse.nodeId;
        }
      } else {
        console.warn('无法获取节点ID');
      }
    } else {
      console.warn('无法获取标签页ID');
    }
  } catch (error) {
    console.error('获取节点ID失败:', error);
  }
}

/**
 * 初始化函数
 */
async function init(): Promise<void> {
  console.log('Navigraph: 导航追踪器初始化开始');
  
  try {
    // 注册内容脚本消息处理程序
    registerContentMessageHandlers();
    
    // 等待后台脚本初始化
    console.log('等待后台脚本初始化...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 请求当前页面的节点ID
    await requestNodeId();
    
    // 其他初始化代码...
    
    console.log('Navigraph: 导航追踪器初始化完成');
  } catch (error) {
    console.error('导航追踪器初始化失败:', error);
  }
}

// 立即运行初始化函数
init().catch(error => {
  console.error('导航追踪器启动失败:', error);
});
