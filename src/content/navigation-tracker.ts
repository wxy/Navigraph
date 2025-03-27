/**
 * 导航追踪内容脚本 - 在页面中监控所有导航相关事件
 * 使用动态导入确保模块正确加载
 */

// 存储从后台获取的标准节点ID
let standardNodeId: string | null = null;
let isExtensionActive: boolean = true;
let lastRequestTime: number = 0;
let sendMessage: any = null;

/**
 * 异步加载所需的模块
 */
async function loadDependencies() {
  try {
    // 动态导入消息服务模块
    const messageModule = await import('./core/content-message-service.js');
    sendMessage = messageModule.sendMessage;
    
    console.log('Navigraph: 消息服务模块加载成功');
    return true;
  } catch (error) {
    console.error('Navigraph: 加载消息服务模块失败:', error);
    
    // 尝试备用方法 - 如果消息服务模块被注入为全局变量
    if ((window as any).contentMessageService && (window as any).contentMessageService.sendMessage) {
      sendMessage = (window as any).contentMessageService.sendMessage;
      console.log('Navigraph: 使用全局消息服务');
      return true;
    }
    
    // 所有方法都失败
    console.error('Navigraph: 无法获取消息服务，导航跟踪将不可用');
    return false;
  }
}

/**
 * 请求当前页面的节点ID
 */
async function requestNodeId(): Promise<void> {
  // 确保sendMessage可用
  if (!sendMessage) {
    console.warn('消息服务不可用，无法请求节点ID');
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
    // 获取标签页ID，明确指定target为background
    const tabIdResponse = await sendMessage('getTabId', {
      target: 'background' // 明确指定目标为后台
    });
    
    if (tabIdResponse && tabIdResponse.success && tabIdResponse.tabId !== undefined) {
      // 发送符合GetNodeIdRequest类型的消息，同样指定target
      const nodeIdResponse = await sendMessage('getNodeId', {
        target: 'background', // 明确指定目标为后台
        tabId: tabIdResponse.tabId,
        url: url,
        referrer: document.referrer,
        timestamp: Date.now()
      });
      
      if (nodeIdResponse && nodeIdResponse.success && nodeIdResponse.nodeId) {
        if (standardNodeId !== nodeIdResponse.nodeId) {
          console.log(`更新节点ID: ${standardNodeId || 'null'} -> ${nodeIdResponse.nodeId}`);
          standardNodeId = nodeIdResponse.nodeId;
        }
      }
    } else {
      console.warn('无法获取当前标签页ID', tabIdResponse);
    }
  } catch (error) {
    console.error('获取节点ID失败:', error);
  }
}

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
 * 发送页面已加载消息
 */
async function sendPageLoadedMessage(): Promise<void> {
  if (!sendMessage) return;
  
  const currentUrl = window.location.href;
  
  // 系统页面不发送
  if (isSystemPage(currentUrl)) {
    return;
  }
  
  try {
    const response = await sendMessage('getTabId', {});
    
    if (response && response.success && response.tabId !== undefined) {
      // 发送符合PageLoadedRequest类型的消息
      const pageLoadResponse = await sendMessage('pageLoaded', {
        tabId: response.tabId,
        url: currentUrl,
        title: document.title,
        favicon: getFaviconUrl(),
        referrer: document.referrer
      });
      
      console.log('页面加载消息已发送', pageLoadResponse);
      
      // 页面加载完成后，立即请求节点ID
      if (pageLoadResponse && pageLoadResponse.success) {
        requestNodeId();
      }
    } else {
      throw new Error('无法获取当前标签页ID');
    }
  } catch (error) {
    console.error('发送页面加载消息失败:', error);
  }
}

/**
 * 获取网站图标URL
 */
function getFaviconUrl(): string {
  // 函数实现保持不变...
  // 首先查找预定义的图标链接
  const iconLink = document.querySelector('link[rel="icon"]') || 
                  document.querySelector('link[rel="shortcut icon"]') ||
                  document.querySelector('link[rel="apple-touch-icon"]');
  
  if (iconLink && iconLink.getAttribute('href')) {
    let iconHref = iconLink.getAttribute('href') || '';
    
    // 处理相对路径
    if (iconHref.startsWith('/')) {
      iconHref = window.location.origin + iconHref;
    } else if (!iconHref.startsWith('http')) {
      // 处理相对于当前路径的相对路径
      const base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
      iconHref = base + iconHref;
    }
    
    return iconHref;
  }
  
  // 没有找到图标链接，返回默认网站图标路径
  return window.location.origin + '/favicon.ico';
}

/**
 * DOM准备好时的处理
 */
async function onDOMReady(): Promise<void> {
  // 发送页面加载消息
  await sendPageLoadedMessage();
  
  // 设置事件监听器
  setupEventListeners();
}

/**
 * 设置事件监听器
 */
function setupEventListeners(): void {
  // 监听标题变化
  const titleObserver = new MutationObserver(function() {
    if (document.title && standardNodeId && sendMessage) {
      // 符合PageTitleUpdatedRequest类型
      sendMessage('pageTitleUpdated', {
        nodeId: standardNodeId,
        title: document.title
      }).catch((error: any) => {
        console.error('发送标题更新消息失败:', error);
      });
      console.log(`发送标题更新: "${document.title}" (节点ID: ${standardNodeId})`);
    }
  });
  
  // 检查是否有title元素
  const titleElement = document.querySelector('title');
  if (titleElement) {
    titleObserver.observe(titleElement, { 
      childList: true, 
      characterData: true, 
      subtree: true 
    });
  }
  
  // 发送当前favicon
  sendFavicon();
  
  // 设置链接点击监听
  setupLinkClickListener();
  
  // 设置表单提交监听
  setupFormSubmitListener();
  
  // 设置JS导航监听
  setupJsNavigationListener();
}

/**
 * 发送favicon信息
 */
function sendFavicon(): void {
  if (!sendMessage) return;
  
  // 获取页面favicon
  let favicon = getFaviconUrl();
  
  // 发送favicon信息
  if (favicon && standardNodeId) {
    // 符合FaviconUpdatedRequest类型
    sendMessage('faviconUpdated', {
      nodeId: standardNodeId,
      favicon: favicon
    }).catch((error: any) => {
      console.error('发送favicon更新消息失败:', error);
    });
    console.log(`发送favicon更新: ${favicon} (节点ID: ${standardNodeId})`);
  }
}

/**
 * 设置链接点击监听器
 */
function setupLinkClickListener(): void {
  document.addEventListener('click', function(e) {
    if (!standardNodeId || !isExtensionActive || !sendMessage) return;
    
    // 查找被点击的链接
    let target = e.target as HTMLElement;
    while (target && target !== document.body) {
      if (target.tagName === 'A') {
        const linkElement = target as HTMLAnchorElement;
        
        // 处理链接点击
        if (linkElement.href && !linkElement.href.startsWith('javascript:')) {
          handleLinkClick(linkElement, linkElement.target === '_blank' || e.ctrlKey || e.metaKey);
        }
        break;
      }
      target = target.parentElement as HTMLElement;
    }
  });
}

/**
 * 安全地处理链接点击
 * 如果没有节点ID，会跳过发送消息
 */
function handleLinkClick(linkElement: HTMLAnchorElement, isNewTab: boolean): boolean {
  try {
    if (!standardNodeId) {
      console.log('链接点击未记录：没有节点ID');
      return false;
    }
    
    // 获取链接文本，优先使用innerText，如果为空则使用href作为文本
    let linkText = linkElement.innerText.trim();
    if (!linkText) {
      // 尝试获取img元素的alt属性作为文本
      const img = linkElement.querySelector('img');
      if (img && img.alt) {
        linkText = img.alt.trim();
      } else {
        // 如果没有文本和alt属性，使用URL
        linkText = linkElement.href;
      }
    }
    
    sendMessage("getTabId", {})
      .then((response: any) => {
        if (response && response.success && response.tabId !== undefined) {
          // 符合LinkClickedRequest类型
          return sendMessage("linkClicked", {
            tabId: response.tabId,
            url: linkElement.href,
            text: linkText,
            sourceUrl: window.location.href,
          });
        } else {
          throw new Error("无法获取当前标签页ID");
        }
      })
      .then((response: any) => {
        console.log(
          `链接点击: ${window.location.href} -> ${linkElement.href} (${
            isNewTab ? "新标签页" : "当前标签页"
          })`
        );
      })
      .catch((error: any) => {
        console.error("发送链接点击消息失败:", error);
      });
    
    return true;
  } catch (err) {
    console.error('处理链接点击失败:', err);
    return false;
  }
}

/**
 * 设置表单提交监听器
 */
function setupFormSubmitListener(): void {
  document.addEventListener('submit', function(e) {
    if (!standardNodeId || !isExtensionActive) return;
    
    const form = e.target as HTMLFormElement;
    if (form && form.action) {
      // 使用chrome.runtime.sendMessage直接获取当前标签页ID
      sendMessage("getTabId", {})
        .then((response: any) => {
          if (response && response.success && response.tabId !== undefined) {
            // 符合FormSubmittedRequest类型
            return sendMessage("formSubmitted", {
              tabId: response.tabId,
              url: form.action,
              formData: {
                method: form.method || "get",
              },
              sourceUrl: window.location.href,
            });
          } else {
            throw new Error("无法获取当前标签页ID");
          }
        })
        .then((response: any) => {
          console.log(`表单提交: ${window.location.href} -> ${form.action}`);
        })
        .catch((error: any) => {
          console.error("发送表单提交消息失败:", error);
        });
    }
  });
}

/**
 * 设置JS导航监听器
 */
function setupJsNavigationListener(): void {
  // 监听history.pushState
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    // 正确地传递参数
    const result = originalPushState.apply(this, args);

    // 发送JS导航事件
    if (standardNodeId && isExtensionActive) {
      sendMessage("getTabId", {})
        .then((response: any) => {
          if (response && response.success && response.tabId !== undefined) {
            // 符合JsNavigationRequest类型
            return sendMessage("jsNavigation", {
              tabId: response.tabId,
              url: window.location.href,
              sourceUrl: document.referrer || window.location.href,
              cause: "history.pushState",
            });
          } else {
            throw new Error("无法获取当前标签页ID");
          }
        })
        .then((response: any) => {
          console.log(
            `JS导航(pushState): ${document.referrer || "unknown"} -> ${
              window.location.href
            }`
          );
        })
        .catch((error: any) => {
          console.error("发送pushState导航消息失败:", error);
        });
    }

    return result;
  };
  
  // 监听history.replaceState
  const originalReplaceState = history.replaceState;
  history.replaceState = function(...args) {
    // 正确地传递参数
    const result = originalReplaceState.apply(this, args);
    
    // 发送JS导航事件
    if (standardNodeId && isExtensionActive) {
      sendMessage('getTabId', {})
        .then((response: any) => {
          if (response && response.success && response.tabId !== undefined) {
            // 符合JsNavigationRequest类型
            return sendMessage('jsNavigation', {
              tabId: response.tabId,
              url: window.location.href,
              sourceUrl: document.referrer || window.location.href,
              cause: 'history.replaceState'
            });
          } else {
            throw new Error('无法获取当前标签页ID');
          }
        })
        .then((response: any) => {
          console.log(`JS导航(replaceState): ${document.referrer || 'unknown'} -> ${window.location.href}`);
        })
        .catch((error: any) => {
          console.error('发送replaceState导航消息失败:', error);
        });
    }
    
    return result;
  };
  
  // 监听popstate事件
  window.addEventListener('popstate', function() {
    // 发送JS导航事件
    if (standardNodeId && isExtensionActive) {
      sendMessage('getTabId', {})
        .then((response: any) => {
          if (response && response.success && response.tabId !== undefined) {
            // 符合JsNavigationRequest类型
            return sendMessage('jsNavigation', {
              tabId: response.tabId,
              url: window.location.href,
              sourceUrl: document.referrer || window.location.href,
              cause: 'popstate'
            });
          } else {
            throw new Error('无法获取当前标签页ID');
          }
        })
        .then((response: any) => {
          console.log(`JS导航(popstate): ${document.referrer || 'unknown'} -> ${window.location.href}`);
        })
        .catch((error: any) => {
          console.error('发送popstate导航消息失败:', error);
        });
    }
  });
}

/**
 * 发送页面活动消息
 * 符合PageActivityRequest类型
 */
function sendPageActivityMessage(source: string): void {
  if (!sendMessage) return;
  
  sendMessage('pageActivity', {
    source: source,
    timestamp: Date.now()
  }).catch((error: any) => {
    console.error('发送页面活动消息失败:', error);
  });
}

/**
 * DOM可见性变化时的处理
 */
function onVisibilityChange(): void {
  if (!sendMessage) return;
  
  if (document.visibilityState === 'visible') {
    // 如果页面变为可见且没有节点ID，重试获取
    if (!standardNodeId) {
      requestNodeId();
    } else {
      // 发送页面活动消息
      sendPageActivityMessage('visibility');
    }
  }
}

/**
 * 窗口获得焦点时的处理
 */
function onWindowFocus(): void {
  if (standardNodeId && sendMessage) {
    sendPageActivityMessage('focus');
  }
}

/**
 * 错误事件处理
 */
function onError(event: ErrorEvent): void {
  // 检查是否是与extension context invalidated相关的错误
  if (event.error && event.error.message && 
      event.error.message.includes('Extension context invalidated')) {
    console.log('扩展上下文已失效，此为正常导航行为');
    isExtensionActive = false;
    
    // 阻止错误冒泡，避免干扰其他脚本
    event.preventDefault();
    event.stopPropagation();
  }
}

/**
 * 初始化函数
 */
async function init(): Promise<void> {
  console.log('Navigraph: 导航追踪器初始化开始');
  
  // 首先加载依赖
  const loaded = await loadDependencies();
  if (!loaded) {
    console.error('Navigraph: 依赖加载失败，导航跟踪器无法启动');
    return;
  }
  
  console.log('Navigraph: 导航追踪器依赖已加载');
  
  // 请求当前页面的节点ID
  await requestNodeId();
  
  // 监听DOM加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => onDOMReady());
  } else {
    await onDOMReady();
  }
  
  // 添加DOM可见性监听
  document.addEventListener('visibilitychange', onVisibilityChange);
  
  // 监听页面获得焦点
  window.addEventListener('focus', onWindowFocus);
  
  // 检测扩展上下文是否有效
  window.addEventListener('error', onError, true);
  
  console.log('Navigraph: 导航追踪器初始化完成');
}

// 立即运行初始化函数
init().catch(error => {
  console.error('Navigraph: 导航追踪器初始化失败:', error);
});
