/**
 * 导航追踪内容脚本 - 在页面中监控所有导航相关事件
 */
(function() {
  // 存储从后台获取的标准节点ID
  let standardNodeId = null;
  
  /**
   * 初始化内容脚本
   */
  function initialize() {
    // 从后台获取当前标签页的标准节点ID
    chrome.runtime.sendMessage({
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
    chrome.runtime.sendMessage({
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
        chrome.runtime.sendMessage({
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
      chrome.runtime.sendMessage({
        action: 'faviconUpdated',
        nodeId: standardNodeId,
        favicon: favicon
      });
      console.log(`发送favicon: ${favicon} (节点ID: ${standardNodeId})`);
    }
  }
  
  /**
   * 设置链接点击监听器
   */
  function setupLinkClickListener() {
    document.addEventListener('click', function(e) {
      // 如果没有标准节点ID，不处理点击事件
      if (!standardNodeId) return;
      
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
                         
        chrome.runtime.sendMessage({
          action: 'linkClicked',
          linkInfo: {
            sourceNodeId: standardNodeId, // 使用标准节点ID
            sourceUrl: window.location.href,
            targetUrl: linkElement.href,
            isNewTab: isNewTab,
            timestamp: Date.now()
          }
        });
        
        console.log(`链接点击: ${window.location.href} -> ${linkElement.href} (${isNewTab ? '新标签' : '同标签'})`);
      }
    });
  }
  
  /**
   * 设置表单提交监听器
   */
  function setupFormSubmitListener() {
    document.addEventListener('submit', function(e) {
      if (!standardNodeId) return;
      
      const form = e.target;
      if (form && form.action) {
        chrome.runtime.sendMessage({
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
      
      if (standardNodeId) {
        const targetUrl = arguments[2]; // 新URL
        
        chrome.runtime.sendMessage({
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
      
      if (standardNodeId) {
        const targetUrl = arguments[2]; // 新URL
        
        chrome.runtime.sendMessage({
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