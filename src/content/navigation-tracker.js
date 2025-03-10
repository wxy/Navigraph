/**
 * 导航追踪内容脚本 - 在页面中监控所有导航相关事件
 */
(function() {
  // 为当前页面生成唯一ID
  const pageId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
  
  // 记录当前页面信息
  const pageInfo = {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    referrer: document.referrer,
    pageId: pageId
  };
  
  // 在页面加载完成后进行初始化
  function initialize() {
    console.log('[NavigationTracker] 初始化，页面：', window.location.href);
    
    // 获取favicon (尝试多种方法)
    let favicon = '';
    
    // 方法1: 从link标签获取
    const linkIcon = document.querySelector('link[rel*="icon"]');
    if (linkIcon) {
        favicon = linkIcon.href;
    }
    
    // 方法2: 使用预设的favicon路径
    if (!favicon) {
        try {
        const domain = window.location.hostname;
        favicon = `${window.location.protocol}//${domain}/favicon.ico`;
        } catch (e) {
        console.warn('无法构建默认favicon路径');
        }
    }
    
    // 更新页面信息
    pageInfo.favicon = favicon;
    
    // 通知后台脚本页面已加载
    chrome.runtime.sendMessage({
      action: 'pageLoaded',
      pageInfo: pageInfo
    }).catch(error => {
      // Chrome扩展消息在某些情况下会失败，这是正常的
      console.log('[NavigationTracker] 发送消息失败，可能是扩展上下文已改变');
    });
    
    // 监听所有点击事件，捕获链接点击
    document.addEventListener('click', captureClickEvents, true);
    
    // 监听表单提交
    document.addEventListener('submit', captureFormSubmit, true);
    
    // 拦截页面导航方法
    interceptNavigationMethods();
    
    // 更新页面标题（因为可能在DOMContentLoaded后变更）
    if (document.title && document.title !== pageInfo.title) {
      pageInfo.title = document.title;
      chrome.runtime.sendMessage({
        action: 'pageTitleUpdated',
        pageId: pageInfo.pageId,
        title: document.title
      }).catch(() => {});
    }
    
    // 监听标题变化
    const titleObserver = new MutationObserver((mutations) => {
      if (document.title !== pageInfo.title) {
        pageInfo.title = document.title;
        chrome.runtime.sendMessage({
          action: 'pageTitleUpdated',
          pageId: pageInfo.pageId,
          title: document.title
        }).catch(() => {});
      }
    });

    if (document.querySelector('title')) {
      titleObserver.observe(document.querySelector('title'), { 
        subtree: true, 
        characterData: true, 
        childList: true 
      });
    }
    
    setTimeout(() => {
      if (document.title && document.title !== pageInfo.title) {
        pageInfo.title = document.title;
        console.log('[NavigationTracker] 延迟捕获标题:', document.title);
        chrome.runtime.sendMessage({
        action: 'pageTitleUpdated',
        pageId: pageInfo.pageId,
        title: document.title
        }).catch(() => {});
    }
    }, 1000); // 延迟1秒钟
    
    // 监听popstate事件 (浏览器前进/后退)
    window.addEventListener('popstate', () => {
      console.log('[NavigationTracker] 捕获popstate事件');
      setTimeout(() => {
        // 延迟检查标题变化
        if (document.title !== pageInfo.title) {
        pageInfo.title = document.title;
        chrome.runtime.sendMessage({
            action: 'pageTitleUpdated',
            pageId: pageInfo.pageId,
            title: document.title
        }).catch(() => {});
        }
      }, 300);
    });
    
    // 创建额外的定时检查以捕获某些框架可能的延迟标题更改
    const titleCheckInterval = setInterval(() => {
      if (document.title && document.title !== pageInfo.title) {
        console.log('[NavigationTracker] 定时检测到标题变化:', document.title);
        pageInfo.title = document.title;
        chrome.runtime.sendMessage({
        action: 'pageTitleUpdated',
        pageId: pageInfo.pageId,
        title: document.title
        }).catch(() => {});
      }
    }, 2000); // 每2秒检查一次
    
    // 5分钟后停止定时检查，避免无限消耗资源
    setTimeout(() => {
      clearInterval(titleCheckInterval);
      console.log('[NavigationTracker] 停止标题定时检查');
    }, 5 * 60 * 1000);
    
    console.log('[NavigationTracker] 初始化完成');
  }
  
  /**
   * 捕获点击事件
   */
  function captureClickEvents(e) {
    // 查找被点击的链接
    const linkElement = findClickedLink(e.target);
    if (!linkElement) return;
    
    // 忽略javascript:void(0)等无效链接
    if (!linkElement.href || 
        linkElement.href.startsWith('javascript:') ||
        linkElement.href === '#' ||
        linkElement.href === window.location.href + '#') {
      return;
    }
    
    // 收集链接信息
    const linkInfo = {
      sourcePageId: pageId,
      sourceUrl: window.location.href,
      targetUrl: linkElement.href,
      targetText: linkElement.textContent.trim() || linkElement.title || '无文本',
      isNewTab: linkElement.target === '_blank' || 
                e.ctrlKey || 
                e.metaKey || 
                e.which === 2, // 中键点击
      timestamp: Date.now(),
      clickX: e.clientX,
      clickY: e.clientY
    };
    
    // 发送点击信息给后台
    chrome.runtime.sendMessage({
      action: 'linkClicked',
      linkInfo: linkInfo
    }).catch(() => {});
    
    console.log('[NavigationTracker] 捕获链接点击:', linkInfo.targetUrl);
  }
  
  /**
   * 捕获表单提交
   */
  function captureFormSubmit(e) {
    const form = e.target;
    
    // 收集表单信息
    const formInfo = {
      sourcePageId: pageId,
      sourceUrl: window.location.href,
      formAction: form.action || window.location.href,
      formMethod: form.method || 'get',
      timestamp: Date.now()
    };
    
    // 发送表单提交信息
    chrome.runtime.sendMessage({
      action: 'formSubmitted',
      formInfo: formInfo
    }).catch(() => {});
    
    console.log('[NavigationTracker] 捕获表单提交:', formInfo.formAction);
  }
  
  /**
   * 查找被点击的链接元素
   */
  function findClickedLink(target) {
    if (!target) return null;
    
    // 直接检查目标元素
    if (target.tagName === 'A' && target.href) {
      return target;
    }
    
    // 向上查找最近的链接
    let element = target;
    while (element && element !== document.body) {
      if (element.tagName === 'A' && element.href) {
        return element;
      }
      element = element.parentElement;
    }
    
    return null;
  }
  
  /**
   * 拦截常见的页面导航方法
   */
  function interceptNavigationMethods() {
    // 拦截window.open
    const originalWindowOpen = window.open;
    window.open = function(url, name, specs) {
      // 记录window.open调用
      if (url) {
        chrome.runtime.sendMessage({
          action: 'jsNavigation',
          navigationType: 'window.open',
          sourcePageId: pageId,
          sourceUrl: window.location.href,
          targetUrl: url,
          timestamp: Date.now()
        }).catch(() => {});
        
        console.log('[NavigationTracker] 捕获window.open:', url);
      }
      
      // 调用原始方法
      return originalWindowOpen.apply(this, arguments);
    };
    
    // 拦截location.href赋值
    try {
      const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window.Location.prototype, 'href');
      if (originalLocationDescriptor && originalLocationDescriptor.set) {
        Object.defineProperty(window.Location.prototype, 'href', {
          set: function(url) {
            // 记录location.href赋值
            chrome.runtime.sendMessage({
              action: 'jsNavigation',
              navigationType: 'location.href',
              sourcePageId: pageId,
              sourceUrl: window.location.href,
              targetUrl: url,
              timestamp: Date.now()
            }).catch(() => {});
            
            console.log('[NavigationTracker] 捕获location.href:', url);
            
            // 调用原始setter
            return originalLocationDescriptor.set.call(this, url);
          },
          get: originalLocationDescriptor.get,
          configurable: true
        });
      }
    } catch (e) {
      console.log('[NavigationTracker] 拦截location.href失败', e);
    }

    // 拦截History API
    const originalPushState = window.History.prototype.pushState;
    window.History.prototype.pushState = function(state, title, url) {
      if (url) {
        chrome.runtime.sendMessage({
          action: 'jsNavigation',
          navigationType: 'history.pushState',
          sourcePageId: pageId,
          sourceUrl: window.location.href,
          targetUrl: url,
          timestamp: Date.now()
        }).catch(() => {});
        
        console.log('[NavigationTracker] 捕获history.pushState:', url);
      }
      
      return originalPushState.apply(this, arguments);
    };
  }
  
  // 确保DOM已加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initialize();
      
      // 在window加载完成后再次检查标题，这对直接URL访问很重要
      window.addEventListener('load', () => {
        setTimeout(() => {
          if (document.title && document.title !== pageInfo.title) {
            console.log('[NavigationTracker] window.onload后捕获标题:', document.title);
            pageInfo.title = document.title;
            chrome.runtime.sendMessage({
              action: 'pageTitleUpdated',
              pageId: pageInfo.pageId,
              title: document.title,
              isDirectAccess: true, // 标记这是直接访问
              url: window.location.href // 附加URL便于后台匹配
            }).catch(() => {});
          }
        }, 500); // 延迟500ms给页面脚本时间设置标题
      });
    });
  } else {
    initialize();
    
    // 同样处理已加载状态
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(() => {
        if (document.title && document.title !== pageInfo.title) {
          console.log('[NavigationTracker] 页面已加载状态下捕获标题:', document.title);
          pageInfo.title = document.title;
          chrome.runtime.sendMessage({
            action: 'pageTitleUpdated',
            pageId: pageInfo.pageId,
            title: document.title,
            isDirectAccess: true,
            url: window.location.href
          }).catch(() => {});
        }
      }, 500);
    }
  }
})();