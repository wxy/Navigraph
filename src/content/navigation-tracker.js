/**
 * 导航追踪内容脚本 - 在页面中监控所有导航相关事件
 */
(function() {
  // 存储从后台获取的标准节点ID
  let standardNodeId = null;
  let isExtensionActive = true;
  
  /**
   * 安全地发送消息到扩展
   * @param {Object} message - 要发送的消息对象
   * @param {Function} [callback] - 可选的回调函数
   * @returns {boolean} 是否成功发送消息
   */
  function safeSendMessage(message, callback) {
    if (!isExtensionActive) return false;
    
    try {
      if (callback) {
        chrome.runtime.sendMessage(message, function(response) {
          if (chrome.runtime.lastError) {
            console.log('发送消息时出现错误(正常现象):', chrome.runtime.lastError.message);
            return;
          }
          callback(response);
        });
      } else {
        chrome.runtime.sendMessage(message);
      }
      return true;
    } catch (error) {
      // 扩展上下文无效的情况
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已失效，此为正常导航行为，无需处理');
        isExtensionActive = false;
      } else {
        // 其他非预期错误
        console.error('发送消息时出错:', error);
      }
      return false;
    }
  }
  
  /**
   * 初始化内容脚本
   */
  function initialize() {
    // 从后台获取当前标签页的标准节点ID
    safeSendMessage({
      action: 'getNodeId'
    }, function(response) {
      if (response && response.success && response.nodeId) {
        // 保存标准节点ID
        standardNodeId = response.nodeId;
        console.log(`获取到标准节点ID: ${standardNodeId}`);
        
        // 设置事件监听器
        setupEventListeners();
        
        // 发送页面已加载消息(包含正确的节点ID)
        sendPageLoadedMessage();
      } else {
        console.error('无法获取标准节点ID', response?.error);
        
        // 即使没有获取到ID，也要设置基本的事件监听
        setupEventListeners();
        
        // 5秒后再次尝试获取ID
        setTimeout(initialize, 5000);
      }
    });
  }
  
  /**
   * 发送页面已加载消息
   */
  function sendPageLoadedMessage() {
    safeSendMessage({
      action: 'pageLoaded',
      pageInfo: {
        nodeId: standardNodeId,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        referrer: document.referrer
      }
    }, function(response) {
      console.log('页面加载消息已发送', response);
    });
  }
  
  /**
   * 设置事件监听器
   */
  function setupEventListeners() {
    // 监听标题变化
    const titleObserver = new MutationObserver(function() {
      if (document.title) {
        safeSendMessage({
          action: 'pageTitleUpdated',
          nodeId: standardNodeId,
          title: document.title
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
  function sendFavicon() {
    // 获取页面favicon
    let favicon = '';
    
    // 查找link标签中的favicon
    const linkTags = document.querySelectorAll('link[rel*="icon"]');
    if (linkTags.length > 0) {
      for (const link of linkTags) {
        if (link.href) {
          favicon = link.href;
          break;
        }
      }
    }
    
    // 如果没找到，使用默认位置
    if (!favicon) {
      try {
        const domain = new URL(window.location.href).hostname;
        favicon = `https://${domain}/favicon.ico`;
      } catch (e) {
        // URL解析失败，忽略
      }
    }
    
    // 发送favicon信息
    if (favicon && standardNodeId) {
      safeSendMessage({
        action: 'faviconUpdated',
        nodeId: standardNodeId,
        favicon: favicon
      });
      console.log(`发送favicon: ${favicon} (节点ID: ${standardNodeId})`);
    }
  }
  
  /**
   * 设置链接点击监听器
   * 使用更可靠的方法处理点击和导航
   */
  function setupLinkClickListener() {
    document.addEventListener('click', function(e) {
      // 如果没有标准节点ID或扩展不活跃，不处理点击事件
      if (!standardNodeId || !isExtensionActive) return;
      
      // 查找被点击的链接元素
      let linkElement = e.target;
      while (linkElement && linkElement.tagName !== 'A') {
        linkElement = linkElement.parentElement;
        if (!linkElement) break;
      }
      
      if (linkElement && linkElement.href) {
        const isNewTab = linkElement.target === '_blank' || 
                         e.ctrlKey || 
                         e.metaKey || 
                         e.button === 1;
        try {
          safeSendMessage({
            action: 'linkClicked',
            linkInfo: {
              sourceNodeId: standardNodeId,
              sourceUrl: window.location.href,
              targetUrl: linkElement.href,
              isNewTab: false,
              timestamp: Date.now()
            }
          });
          console.log(`链接点击: ${window.location.href} -> ${linkElement.href} `);
        } catch (e) {
          // 导航期间错误已在safeSendMessage中处理
        }
      }
    });
  }
  
  /**
   * 设置表单提交监听器
   */
  function setupFormSubmitListener() {
    document.addEventListener('submit', function(e) {
      if (!standardNodeId || !isExtensionActive) return;
      
      const form = e.target;
      if (form && form.action) {
        // 表单提交通常会导致页面导航，使用类似链接点击的处理方式
        try {
          const data = JSON.stringify({
            action: 'formSubmitted',
            formInfo: {
              sourceNodeId: standardNodeId,
              sourceUrl: window.location.href,
              formAction: form.action,
              method: form.method || 'get',
              timestamp: Date.now()
            }
          });
          
          // 尝试使用Beacon API
          const endpoint = chrome.runtime.getURL('/beacon');
          if (navigator.sendBeacon(endpoint, data)) {
            console.log(`通过Beacon API发送表单提交: ${window.location.href} -> ${form.action}`);
            return;
          }
        } catch (e) {
          // 如果Beacon失败，回退到常规方法
        }
        
        // 回退到常规消息发送
        safeSendMessage({
          action: 'formSubmitted',
          formInfo: {
            sourceNodeId: standardNodeId,
            sourceUrl: window.location.href,
            formAction: form.action,
            method: form.method || 'get',
            timestamp: Date.now()
          }
        });
        
        console.log(`表单提交: ${window.location.href} -> ${form.action}`);
      }
    });
  }
  
  /**
   * 设置JS导航监听器
   */
  function setupJsNavigationListener() {
    // 监听history.pushState
    const originalPushState = history.pushState;
    history.pushState = function() {
      const result = originalPushState.apply(this, arguments);
      
      if (standardNodeId && isExtensionActive) {
        const targetUrl = arguments[2]; // 新URL
        
        safeSendMessage({
          action: 'jsNavigation',
          sourceNodeId: standardNodeId,
          sourceUrl: document.referrer || window.location.href,
          targetUrl: targetUrl,
          navigationType: 'pushState',
          timestamp: Date.now()
        });
        
        console.log(`JS导航(pushState): ${document.referrer} -> ${targetUrl}`);
      }
      
      return result;
    };
    
    // 监听history.replaceState
    const originalReplaceState = history.replaceState;
    history.replaceState = function() {
      const result = originalReplaceState.apply(this, arguments);
      
      if (standardNodeId && isExtensionActive) {
        const targetUrl = arguments[2]; // 新URL
        
        safeSendMessage({
          action: 'jsNavigation',
          sourceNodeId: standardNodeId,
          sourceUrl: document.referrer || window.location.href,
          targetUrl: targetUrl,
          navigationType: 'replaceState',
          timestamp: Date.now()
        });
        
        console.log(`JS导航(replaceState): ${document.referrer} -> ${targetUrl}`);
      }
      
      return result;
    };
  }
  
  // 启动初始化
  initialize();
})();