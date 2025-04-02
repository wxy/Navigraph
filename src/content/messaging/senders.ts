import { Logger } from '../../lib/utils/logger.js';
import { sendToBackground } from '../../lib/messaging/sender.js';

const logger = new Logger('ContentMessaging');
/**
 * 向后台发送链接点击信息
 */
export async function sendLinkClick(linkInfo: {
  targetUrl: string;
  isNewTab?: boolean; // 保持可选，但在实现中提供默认值
  anchorText?: string; // 保持可选，但在实现中提供默认值
}): Promise<void> {
  // 确保已获取节点ID
  // @ts-ignore - 全局变量可能未在类型中声明
  const nodeId = window.standardNodeId || '';
  
  await sendToBackground('linkClicked', { 
    linkInfo: {
      sourcePageId: nodeId,
      sourceUrl: window.location.href,
      targetUrl: linkInfo.targetUrl,
      isNewTab: linkInfo.isNewTab || false, // 提供默认值
      anchorText: linkInfo.anchorText || '', // 提供默认值
      timestamp: Date.now()
    }
  });
}

/**
 * 向后台发送表单提交信息
 */
export async function sendFormSubmit(formInfo: {
  formAction: string;
  formMethod: string;
  formData?: Record<string, string>;
}): Promise<void> {
  // 确保已获取节点ID
  // @ts-ignore - 全局变量可能未在类型中声明
  const nodeId = window.standardNodeId || '';
  
  await sendToBackground('formSubmitted', { 
    formInfo: {
      sourcePageId: nodeId,
      sourceUrl: window.location.href,
      formAction: formInfo.formAction,
      formMethod: formInfo.formMethod,
      formData: formInfo.formData || {},
      timestamp: Date.now()
    }
  });
}

/**
 * 向后台发送页面活动信息
 */
export async function sendPageActivity(source: string): Promise<void> {
  await sendToBackground('pageActivity', {
    source: source,
    timestamp: Date.now()
  });
}

/**
 * 向后台发送页面加载完成信息
 */
export async function sendPageLoaded(): Promise<void> {
  await sendToBackground('pageLoaded', {
    pageInfo: {
      url: window.location.href,
      title: document.title,
      referrer: document.referrer,
      loadTime: performance.now(),
      timestamp: Date.now()
    }
  });
}

/**
 * 向后台发送页面标题更新信息
 */
export async function sendPageTitleUpdated(title: string): Promise<void> {
  // 确保已获取节点ID
  // @ts-ignore - 全局变量可能未在类型中声明
  const nodeId = window.standardNodeId || '';
  
  await sendToBackground('pageTitleUpdated', {
    nodeId: nodeId,
    title: title
  });
}

/**
 * 向后台发送网站图标更新信息
 */
export async function sendFaviconUpdated(faviconUrl: string): Promise<void> {
  // 确保已获取节点ID
  // @ts-ignore - 全局变量可能未在类型中声明
  const nodeId = window.standardNodeId || '';
  
  await sendToBackground('faviconUpdated', {
    nodeId: nodeId,
    faviconUrl: faviconUrl
  });
}