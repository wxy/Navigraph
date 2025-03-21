/**
 * 导航追踪内容脚本 - 在页面中监控所有导航相关事件
 */
(function() {
  // 存储从后台获取的标准节点ID
  let standardNodeId = null;
  let isExtensionActive = true;
  let lastRequestTime = 0;
  
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
    console.log('初始化导航追踪器...');
    
    const currentUrl = window.location.href;
    
    // 如果是系统页面，不进行追踪
    if (isSystemPage(currentUrl)) {
      console.log('系统页面，不追踪导航:', currentUrl);
      return;
    }
    
    // 请求当前页面的节点ID
    requestNodeId(currentUrl);
    
    // 设置事件监听器 - 即使没有节点ID也设置，节点ID获取后会自动生效
    setupEventListeners();
  }
  
  /**
   * 判断URL是否为系统页面
   * @param {string} url 要检查的URL
   * @returns {boolean} 是否为系统页面
   */
  function isSystemPage(url) {
    if (!url) return false;
    
    return url.startsWith('chrome://') || 
           url.startsWith('chrome-extension://') || 
           url.startsWith('devtools://') ||
           url.startsWith('about:') ||
           url.startsWith('edge://') ||
           url.startsWith('brave://') ||
           url.startsWith('opera://') ||
           url.startsWith('vivaldi://') ||
           url.startsWith('webkit://') ||
           url.startsWith('view-source:') ||
           url.startsWith('file://') ||
           url.startsWith('data:') ||
           url.startsWith('blob:');
  }

  /**
   * 请求当前页面的节点ID
   * @param {string} url 当前页面URL
   * @param {number} [retryCount=0] 重试次数
   */
  function requestNodeId(url, retryCount = 0) {
    if (!url) return;
    
    // 系统页面不需要节点ID
    if (isSystemPage(url)) {
      console.log('系统页面，不需要节点ID:', url);
      standardNodeId = null;
      return;
    }
    
    // 限制请求频率
    const now = Date.now();
    if (now - lastRequestTime < 500 && retryCount === 0) return;
    lastRequestTime = now;
    
    console.log(`向后台请求节点ID (尝试 ${retryCount + 1}/3):`, url);
    
    // 发送请求到后台脚本
    safeSendMessage({
      action: 'getNodeId',
      url: url
    }, response => {
      if (response && response.success && response.nodeId) {
        standardNodeId = response.nodeId;
        console.log('导航追踪器: 获取到当前页面ID:', standardNodeId);
      } else {
        // 处理未找到节点ID的情况
        if (retryCount < 2) {
          // 如果是第一次或第二次尝试，等待一段时间后重试
          // 每次重试增加等待时间，提高成功率
          const delay = 500 * (retryCount + 1);
          console.log(`节点ID请求失败，${delay}ms后重试 (${retryCount + 1}/3)`);
          
          setTimeout(() => {
            requestNodeId(url, retryCount + 1);
          }, delay);
        } else {
          // 最后一次尝试失败，记录警告但不报错
          if (!isSystemPage(url)) {
            console.warn('导航追踪器: 多次尝试后仍未找到当前页面ID:', url);
          }
          standardNodeId = null; // 确保节点ID为null
          
          // 虽然没有节点ID，仍然发送页面加载事件，以便后台可以获取更多信息
          sendPageLoadedMessage();
        }
      }
    });
  }
  
  /**
   * 发送页面已加载消息
   */
  function sendPageLoadedMessage() {
    const currentUrl = window.location.href;
    
    // 系统页面不发送
    if (isSystemPage(currentUrl)) {
      return;
    }
    
    safeSendMessage({
      action: 'pageLoaded',
      pageInfo: {
        nodeId: standardNodeId,  // 可能为null，后台会处理
        url: currentUrl,
        title: document.title,
        timestamp: Date.now(),
        referrer: document.referrer,
        favicon: getFaviconUrl(),  // 添加favicon信息
        // 增加有助于页面识别的额外信息
        userAgent: navigator.userAgent,
        windowName: window.name,
        ancestorOrigins: Array.from(location.ancestorOrigins || [])
      }
    }, function(response) {
      // 如果后台返回了节点ID，更新本地存储的ID
      if (response && response.success && response.nodeId) {
        if (standardNodeId !== response.nodeId) {
          console.log(`更新节点ID: ${standardNodeId || 'null'} -> ${response.nodeId}`);
          standardNodeId = response.nodeId;
        }
      }
      console.log('页面加载消息已发送', response);
    });
  }
  
  /**
   * 获取当前页面的favicon URL
   * @returns {string} favicon URL
   */
  function getFaviconUrl() {
    // 查找link标签中的favicon
    const linkTags = document.querySelectorAll('link[rel*="icon"]');
    if (linkTags.length > 0) {
      for (const link of linkTags) {
        if (link.href) {
          return link.href;
        }
      }
    }
    
    // 如果没找到，使用默认位置
    try {
      const domain = new URL(window.location.href).hostname;
      return `https://${domain}/favicon.ico`;
    } catch (e) {
      return '';
    }
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
   * @typedef {import('../types/message-types').LinkClickedMessage} LinkClickedMessage
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
          /** @type {LinkClickedMessage} */
          const message = {
            action: 'linkClicked',
            linkInfo: {
              sourceNodeId: standardNodeId,
              sourceUrl: window.location.href,
              targetUrl: linkElement.href,
              isNewTab: isNewTab,
              timestamp: Date.now()
            }
          };
          safeSendMessage(message);
          console.log(`链接点击: ${window.location.href} -> ${linkElement.href} `);
        } catch (e) {
          // 导航期间错误已在safeSendMessage中处理
        }
      }
    });
  }
  
  /**
   * 安全地处理链接点击
   * 如果没有节点ID，会跳过发送消息
   */
  function handleLinkClick(linkElement, isNewTab) {
    if (!standardNodeId) {
      console.log('链接点击：没有节点ID，跳过跟踪');
      return false;
    }
    
    if (!isExtensionActive) return false;
    
    try {
      safeSendMessage({
        action: 'linkClicked',
        linkInfo: {
          sourceNodeId: standardNodeId,
          sourceUrl: window.location.href,
          targetUrl: linkElement.href,
          isNewTab: isNewTab,
          timestamp: Date.now()
        }
      });
      console.log(`链接点击: ${window.location.href} -> ${linkElement.href} (新标签页: ${isNewTab})`);
      return true;
    } catch (e) {
      console.error('发送链接点击消息失败:', e);
      return false;
    }
  }
  
  /**
   * 设置表单提交监听器
   */
  function setupFormSubmitListener() {
    document.addEventListener('submit', function(e) {
      if (!standardNodeId || !isExtensionActive) return;
      
      const form = e.target;
      if (form && form.action) {
        // 使用安全发送方法
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
  
  // 添加DOM可见性监听
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      // 如果页面变为可见且没有节点ID，重试获取
      if (!standardNodeId) {
        console.log('页面变为可见状态，尝试获取节点ID');
        requestNodeId(window.location.href);
      }
    }
  });
  
  // 监听标签页聚焦事件
  window.addEventListener('focus', function() {
    // 如果获得焦点且没有节点ID，重试获取
    if (!standardNodeId) {
      console.log('页面获得焦点，尝试获取节点ID');
      requestNodeId(window.location.href);
    }
  });
  
  // 启动初始化
  initialize();
})();