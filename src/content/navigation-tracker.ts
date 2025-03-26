/**
 * 导航追踪内容脚本 - 在页面中监控所有导航相关事件
 */
import { sendMessage } from './core/content-message-service.js';
  
(function() {
  // 存储从后台获取的标准节点ID
  let standardNodeId: string | null = null;
  let isExtensionActive: boolean = true;
  let lastRequestTime: number = 0;
  
  /**
   * 初始化函数
   */
  function init(): void {
    // 请求当前页面的节点ID
    requestNodeId();
    
    // 监听DOM加载完成
    document.addEventListener('DOMContentLoaded', () => {
      // 发送页面加载消息
      sendPageLoadedMessage();
      
      // 设置事件监听器
      setupEventListeners();
    });
  }
  
  /**
   * 请求当前页面的节点ID
   */
  function requestNodeId(): void {
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
    
    // 使用chrome.runtime.sendMessage直接获取当前标签页ID
    chrome.runtime.sendMessage({
      action: 'getTabId'
    }, function(response) {
      if (response && response.tabId) {
        // 发送符合GetNodeIdRequest类型的消息
        sendMessage('getNodeId', {
          tabId: response.tabId,
          url: url,
          referrer: document.referrer,
          timestamp: Date.now()
        }).then(response => {
          if (response.success && response.nodeId) {
            if (standardNodeId !== response.nodeId) {
              console.log(`更新节点ID: ${standardNodeId || 'null'} -> ${response.nodeId}`);
              standardNodeId = response.nodeId;
            }
          }
        }).catch(error => {
          console.error('获取节点ID失败:', error);
        });
      } else {
        console.error('无法获取当前标签页ID');
      }
    });
  }
  
  /**
   * 检查是否是系统页面（不应追踪的页面）
   */
  function isSystemPage(url: string): boolean {
    if (!url) return true;
    
    return url.startsWith('chrome://') || 
           url.startsWith('chrome-extension://') || 
           url.startsWith('about:') ||
           url.startsWith('data:') ||
           url.startsWith('file:');
  }
  
  /**
   * 发送页面已加载消息
   */
  function sendPageLoadedMessage(): void {
    const currentUrl = window.location.href;
    
    // 系统页面不发送
    if (isSystemPage(currentUrl)) {
      return;
    }
    
    // 使用chrome.runtime.sendMessage直接获取当前标签页ID
    chrome.runtime.sendMessage({
      action: 'getTabId'
    }, function(response) {
      if (response && response.tabId) {
        // 发送符合PageLoadedRequest类型的消息
        sendMessage('pageLoaded', {
          tabId: response.tabId,
          url: currentUrl,
          title: document.title,
          favicon: getFaviconUrl(),
          referrer: document.referrer
        }).then(response => {
          console.log('页面加载消息已发送', response);
          
          // 页面加载完成后，立即请求节点ID
          if (response.success) {
            requestNodeId();
          }
        }).catch(error => {
          console.error('发送页面加载消息失败:', error);
        });
      } else {
        console.error('无法获取当前标签页ID');
      }
    });
  }
  
  /**
   * 获取网站图标URL
   */
  function getFaviconUrl(): string {
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
   * 设置事件监听器
   */
  function setupEventListeners(): void {
    // 监听标题变化
    const titleObserver = new MutationObserver(function() {
      if (document.title && standardNodeId) {
        // 符合PageTitleUpdatedRequest类型
        sendMessage('pageTitleUpdated', {
          nodeId: standardNodeId,
          title: document.title
        }).catch(error => {
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
    // 获取页面favicon
    let favicon = getFaviconUrl();
    
    // 发送favicon信息
    if (favicon && standardNodeId) {
      // 符合FaviconUpdatedRequest类型
      sendMessage('faviconUpdated', {
        nodeId: standardNodeId,
        favicon: favicon
      }).catch(error => {
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
      if (!standardNodeId || !isExtensionActive) return;
      
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
      
      // 使用chrome.runtime.sendMessage直接获取当前标签页ID
      chrome.runtime.sendMessage({
        action: 'getTabId'
      }, function(response) {
        if (response && response.tabId) {
          // 符合LinkClickedRequest类型
          sendMessage('linkClicked', {
            tabId: response.tabId,
            url: linkElement.href,
            text: linkText,
            sourceUrl: window.location.href
          }).catch(error => {
            console.error('发送链接点击消息失败:', error);
          });
          
          console.log(`链接点击: ${window.location.href} -> ${linkElement.href} (${isNewTab ? '新标签页' : '当前标签页'})`);
        } else {
          console.error('无法获取当前标签页ID');
        }
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
        chrome.runtime.sendMessage({
          action: 'getTabId'
        }, function(response) {
          if (response && response.tabId) {
            // 符合FormSubmittedRequest类型
            sendMessage('formSubmitted', {
              tabId: response.tabId,
              url: form.action,
              formData: {
                method: form.method || 'get'
              },
              sourceUrl: window.location.href
            }).catch(error => {
              console.error('发送表单提交消息失败:', error);
            });
            
            console.log(`表单提交: ${window.location.href} -> ${form.action}`);
          } else {
            console.error('无法获取当前标签页ID');
          }
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
    history.pushState = function(...args) {
      // 正确地传递参数
      const result = originalPushState.apply(this, args);
      
      // 发送JS导航事件
      if (standardNodeId && isExtensionActive) {
        chrome.runtime.sendMessage({
          action: 'getTabId'
        }, function(response) {
          if (response && response.tabId) {
            // 符合JsNavigationRequest类型
            sendMessage('jsNavigation', {
              tabId: response.tabId,
              url: window.location.href,
              sourceUrl: document.referrer || window.location.href,
              cause: 'history.pushState'
            }).catch(error => {
              console.error('发送pushState导航消息失败:', error);
            });
            
            console.log(`JS导航(pushState): ${document.referrer || 'unknown'} -> ${window.location.href}`);
          } else {
            console.error('无法获取当前标签页ID');
          }
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
        chrome.runtime.sendMessage({
          action: 'getTabId'
        }, function(response) {
          if (response && response.tabId) {
            // 符合JsNavigationRequest类型
            sendMessage('jsNavigation', {
              tabId: response.tabId,
              url: window.location.href,
              sourceUrl: document.referrer || window.location.href,
              cause: 'history.replaceState'
            }).catch(error => {
              console.error('发送replaceState导航消息失败:', error);
            });
            
            console.log(`JS导航(replaceState): ${document.referrer || 'unknown'} -> ${window.location.href}`);
          } else {
            console.error('无法获取当前标签页ID');
          }
        });
      }
      
      return result;
    };
    
    // 监听popstate事件
    window.addEventListener('popstate', function() {
      // 发送JS导航事件
      if (standardNodeId && isExtensionActive) {
        chrome.runtime.sendMessage({
          action: 'getTabId'
        }, function(response) {
          if (response && response.tabId) {
            // 符合JsNavigationRequest类型
            sendMessage('jsNavigation', {
              tabId: response.tabId,
              url: window.location.href,
              sourceUrl: document.referrer || window.location.href,
              cause: 'popstate'
            }).catch(error => {
              console.error('发送popstate导航消息失败:', error);
            });
            
            console.log(`JS导航(popstate): ${document.referrer || 'unknown'} -> ${window.location.href}`);
          } else {
            console.error('无法获取当前标签页ID');
          }
        });
      }
    });
  }
  
  /**
   * 发送页面活动消息
   * 符合PageActivityRequest类型
   */
  function sendPageActivityMessage(source: string): void {
    sendMessage('pageActivity', {
      source: source,
      timestamp: Date.now()
    }).catch(error => {
      console.error('发送页面活动消息失败:', error);
    });
  }
  
  // 添加DOM可见性监听
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      // 如果页面变为可见且没有节点ID，重试获取
      if (!standardNodeId) {
        requestNodeId();
      } else {
        // 发送页面活动消息
        sendPageActivityMessage('visibility');
      }
    }
  });
  
  // 监听页面获得焦点
  window.addEventListener('focus', function() {
    if (standardNodeId) {
      sendPageActivityMessage('focus');
    }
  });
  
  // 检测扩展上下文是否有效
  window.addEventListener('error', function(event) {
    // 检查是否是与extension context invalidated相关的错误
    if (event.error && event.error.message && 
        event.error.message.includes('Extension context invalidated')) {
      console.log('扩展上下文已失效，此为正常导航行为');
      isExtensionActive = false;
      
      // 阻止错误冒泡，避免干扰其他脚本
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  
  // 启动初始化
  init();
})();