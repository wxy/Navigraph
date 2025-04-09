(async function() {
  const DEBUG = false; // 是否启用调试模式
  try {
    // 内联实现sendToBackground函数
    async function sendToBackground(action: string, data?: any): Promise<any> {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({
            action,
            ...data,
            target: 'background' // 明确指定目标
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
              return;
            }
            resolve(response);
          });
        } catch (error) {
          reject(error);
        }
      });
    }
    
    // 内联实现isExtensionContextValid函数
    function isExtensionContextValid(): boolean {
      try {
        // 检查chrome.runtime是否可访问
        // 这是检测扩展上下文是否有效的一种方法
        return typeof chrome !== 'undefined' && 
               typeof chrome.runtime !== 'undefined' && 
               typeof chrome.runtime.sendMessage === 'function';
      } catch (error) {
        return false;
      }
    }
    
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
        if (DEBUG) {
          console.warn('扩展上下文无效或扩展不活跃，无法请求节点ID');
        }
        return;
      }
      
      const now = Date.now();
      
      // 限制频率
      if (now - lastRequestTime < 5000) {
        if (DEBUG) {
          console.debug('请求节点ID间隔过短，跳过');
        }
        return;
      }
      
      lastRequestTime = now;
      const url = window.location.href;
      
      // 系统页面不请求
      if (isSystemPage(url)) {
        return;
      }
      
      try {        
        // 获取标签页ID
        const tabIdResponse = await sendToBackground('getTabId', {});
        
        if (DEBUG) {
          console.log('收到标签页ID响应:', tabIdResponse);
        }
        
        if (tabIdResponse.tabId !== undefined) {
          // 请求节点ID
          const nodeIdResponse = await sendToBackground('getNodeId', {
            tabId: tabIdResponse.tabId,
            url: url,
            referrer: document.referrer,
            timestamp: Date.now()
          });
          
          if (DEBUG) {
            console.log('收到节点ID响应:', nodeIdResponse);
          }
          
          if (nodeIdResponse.nodeId) {
            if (standardNodeId !== nodeIdResponse.nodeId) {
              if (DEBUG) {
                console.log(`更新节点ID: ${standardNodeId || 'null'} -> ${nodeIdResponse.nodeId}`);
              }
              standardNodeId = nodeIdResponse.nodeId;
            }
          } else {
            if (DEBUG) {
              console.warn('无法获取节点ID');
            }
          }
        } else {
          if (DEBUG) {
            console.warn('无法获取标签页ID');
          }
        }
      } catch (error) {
        if (DEBUG) {
          console.error('请求节点ID失败:', error);
        }
      }
    }
    
    /**
     * 初始化函数
     */
    async function init(): Promise<void> {
      if (DEBUG) {
        console.log('Navigraph: 导航图谱初始化开始');
      }
      
      try {
        if (DEBUG) {
          console.log('等待后台脚本初始化...');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 请求当前页面的节点ID
        await requestNodeId();
        
        // 注册历史记录状态变化监听
        window.addEventListener('popstate', () => {
          
          if (DEBUG) {
            console.log('检测到历史记录状态变化');
          }
          requestNodeId();
        });
        if (DEBUG) {
          console.log('导航图谱初始化完成');
        }
      } catch (error) {
        if (DEBUG) {
          console.error('导航图谱初始化失败:', error);
        }
      }
    }
    
    // 立即执行初始化函数
    await init();
    console.log('Navigraph: 导航图谱已加载');
  } catch (error) {
    if (DEBUG) {
      console.error('导航图谱加载失败:', error);
    }
  }
})();
