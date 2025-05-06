(async function() {
  const DEBUG = false; // Debug mode flag
  try {
    // Inline implementation of sendToBackground function
    async function sendToBackground(action: string, data?: any): Promise<any> {
      return new Promise((resolve, reject) => {
        try {
          const requestId = Date.now().toString() + Math.random().toString(36).slice(2, 9);
          chrome.runtime.sendMessage({
            action,
            requestId,
            target: 'background', // Explicitly specify target
            ...data
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
    
    // Inline implementation of isExtensionContextValid function
    function isExtensionContextValid(): boolean {
      try {
        // Check if chrome.runtime is accessible
        // This is one way to detect if extension context is valid
        return typeof chrome !== 'undefined' && 
               typeof chrome.runtime !== 'undefined' && 
               typeof chrome.runtime.sendMessage === 'function';
      } catch (error) {
        return false;
      }
    }
    
    // Store standard node ID from background
    let standardNodeId: string | null = null;
    let isExtensionActive: boolean = true;
    let lastRequestTime: number = 0;
    
    /**
     * Check if it's a system page
     */
    function isSystemPage(url: string): boolean {
      // Check if it's an extension page, browser built-in page, etc.
      return url.startsWith('chrome://') || 
             url.startsWith('chrome-extension://') || 
             url.startsWith('about:') ||
             url.startsWith('edge://') ||
             url.startsWith('brave://') ||
             url.startsWith('opera://');
    }
    
    /**
     * Request node ID for current page
     */
    async function requestNodeId(): Promise<void> {
      if (!isExtensionContextValid() || !isExtensionActive) {
        if (DEBUG) {
          console.warn('Extension context invalid or extension inactive, unable to request node ID');
        }
        return;
      }
      
      const now = Date.now();
      
      // Rate limiting
      if (now - lastRequestTime < 5000) {
        if (DEBUG) {
          console.debug('Request node ID interval too short, skipped');
        }
        return;
      }
      
      lastRequestTime = now;
      const url = window.location.href;
      
      // Don't request for system pages
      if (isSystemPage(url)) {
        return;
      }
      
      try {        
        // Get tab ID
        const tabIdResponse = await sendToBackground('getTabId', {});
        
        if (DEBUG) {
          console.log('Received tab ID response:', tabIdResponse);
        }
        
        if (tabIdResponse.tabId !== undefined) {
          // Request node ID
          const nodeIdResponse = await sendToBackground('getNodeId', {
            tabId: tabIdResponse.tabId,
            url: url,
            referrer: document.referrer,
            timestamp: Date.now()
          });
          
          if (DEBUG) {
            console.log('Received node ID response:', nodeIdResponse);
          }
          
          if (nodeIdResponse.nodeId) {
            if (standardNodeId !== nodeIdResponse.nodeId) {
              if (DEBUG) {
                console.log(`Updated node ID: ${standardNodeId || 'null'} -> ${nodeIdResponse.nodeId}`);
              }
              standardNodeId = nodeIdResponse.nodeId;
            }
          } else {
            if (DEBUG) {
              console.warn('Unable to get node ID');
            }
          }
        } else {
          if (DEBUG) {
            console.warn('Unable to get tab ID');
          }
        }
      } catch (error) {
        if (DEBUG) {
          console.error('Failed to request node ID:', error);
        }
      }
    }
    
    /**
     * Initialization function
     */
    async function init(): Promise<void> {
      if (DEBUG) {
        console.log('Navigraph: Navigation graph initialization started');
      }
      
      try {
        if (DEBUG) {
          console.log('Waiting for background script initialization...');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Request node ID for current page
        await requestNodeId();
        
        // Register history state change listener
        window.addEventListener('popstate', () => {
          
          if (DEBUG) {
            console.log('History state change detected');
          }
          requestNodeId();
        });
        if (DEBUG) {
          console.log('Navigation graph initialization completed');
        }
      } catch (error) {
        if (DEBUG) {
          console.error('Navigation graph initialization failed:', error);
        }
      }
    }
    
    // Execute initialization function immediately
    await init();
    console.log('Navigraph: Navigation graph loaded');
  } catch (error) {
    if (DEBUG) {
      console.error('Navigation graph loading failed:', error);
    }
  }
})();
