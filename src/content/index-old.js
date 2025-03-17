/**
 * 导航图谱可视化 - 重构版
 * 支持节点和导航边分离的新数据模型
 */
(function() {
  // 主类
  class NavigationVisualizer {
    constructor() {
      this.sessions = [];
      this.currentSession = null;
      this.currentView = 'tree'; // 'tree' 或 'timeline'
      this.svg = null;
      this.simulationTree = null;
      this.simulationTimeline = null;
      this.nodes = [];
      this.edges = [];
      this.nodeElements = null;
      this.edgeElements = null;
      this.tooltip = d3.select('#tooltip');
      this.loading = document.getElementById('loading');
      this.noData = document.getElementById('no-data');
      
      this.filters = {
        reload: true,
        history: true,
        closed: false, // 默认不显示已关闭页面
        typeLink: true,
        typeAddress: true,
        typeForm: true,
        typeJs: true,
        showTracking: false // 默认不显示跟踪页面
      };
      
      this.initialize();
    }
    
    /**
     * 初始化可视化
     */
    async initialize() {
      try {
        console.log('初始化导航可视化...');
        
        // 设置消息监听器 - 添加在方法开始处
        this.setupMessageListener();
        
        // 确保DOM已加载完成
        if (document.readyState !== 'complete') {
          console.log('等待DOM加载完成...');
          await new Promise(resolve => {
            window.addEventListener('load', resolve);
          });
        }
        
        // 查找visualization-container容器
        const container = document.getElementById('visualization-container');
        
        // 如果不存在，则创建它
        if (!container) {
          console.log('可视化容器不存在，创建visualization-container');
          
          // 在body中创建主容器
          const mainContainer = document.createElement('div');
          mainContainer.className = 'visualization-container';
          mainContainer.id = 'visualization-container';
          document.body.appendChild(mainContainer);
        }
        
        // 设置事件监听器
        this.setupEventListeners();
        
        // 加载会话列表
        await this.loadSessions();
        if (this.sessions.length > 0) {
          await this.loadCurrentSession();
        } else {
          this.showNoData('没有可用的会话');
        }
        console.log('初始化完成');

        // 添加容器大小变化监听
        if (window.ResizeObserver) {
          const container = document.getElementById('visualization-container');
          if (container) {
            const resizeObserver = new ResizeObserver(() => {
              if (this.svg && this.timelineSvg) {
                // 更新容器尺寸
                const width = container.clientWidth || 800;
                const height = container.clientHeight || 600;
                
                // 更新SVG尺寸
                this.svg
                  .attr('width', width)
                  .attr('height', height);
                
                // 更新时间线宽度
                this.timelineSvg
                  .attr('width', width)
                  .select('rect')
                  .attr('width', width);
                  
                console.log('容器大小变化，更新视图尺寸');
              }
            });
            resizeObserver.observe(container);
          }
        }
      } catch (error) {
        console.error('初始化可视化失败:', error);
        
        // 显示用户友好的错误信息
        const statusText = document.getElementById('status-text');
        if (statusText) {
          statusText.textContent = `初始化失败: ${error.message}`;
        }
      }
    }
    
    /**
     * 设置消息监听器
     */
    setupMessageListener() {
      // 监听后台发来的消息
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'refreshVisualization') {
          console.log('收到可视化刷新请求', new Date(message.timestamp).toLocaleTimeString(),
          message.requestId ? `[ID:${message.requestId}]` : '');
          
          // 立即回复已处理，包含原请求ID
          sendResponse({
            success: true,
            action: 'refreshVisualization',
            requestId: message.requestId
          });
          // 使用setTimeout延迟刷新操作，避免响应干扰
          setTimeout(() => {
            this.loadSessions().then(() => {
              if (this.sessions.length > 0) {
                // 重新加载当前选择的会话或最新的会话
                const sessionId = this.currentSessionId || this.sessions[0].id;
                this.loadCurrentSession(sessionId);
              }
            }).catch(err => {
              console.error('自动刷新可视化时重新加载会话失败:', err);
            });
          }, 50); // 短暂延迟，确保响应已发送
          
          return false; // 不需要保持通道开放，我们已经同步回复
        }
      });
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
      // 视图切换
      document.getElementById('tree-view').addEventListener('click', () => this.switchView('tree'));
      document.getElementById('timeline-view').addEventListener('click', () => this.switchView('timeline'));
      
      // 会话选择器
      document.getElementById('session-selector').addEventListener('change', (e) => {
        this.loadSession(e.target.value);
      });
      
      // 筛选器
      document.getElementById('filter-reload').addEventListener('change', (e) => {
        this.filters.reload = e.target.checked;
        this.applyFilters();
      });
      
      document.getElementById('filter-history').addEventListener('change', (e) => {
        this.filters.history = e.target.checked;
        this.applyFilters();
      });
      
      document.getElementById('filter-closed').addEventListener('change', (e) => {
        this.filters.closed = e.target.checked;
        this.applyFilters();
      });
      
      document.getElementById('filter-tracking').addEventListener('change', (e) => {
        this.filters.showTracking = e.target.checked;
        this.applyFilters();
      });

      document.getElementById('type-link').addEventListener('change', (e) => {
        this.filters.typeLink = e.target.checked;
        this.applyFilters();
      });
      
      document.getElementById('type-address').addEventListener('change', (e) => {
        this.filters.typeAddress = e.target.checked;
        this.applyFilters();
      });
      
      document.getElementById('type-form').addEventListener('change', (e) => {
        this.filters.typeForm = e.target.checked;
        this.applyFilters();
      });
      
      document.getElementById('type-js').addEventListener('change', (e) => {
        this.filters.typeJs = e.target.checked;
        this.applyFilters();
      });
      
      // 窗口大小变化
      window.addEventListener('resize', this.handleResize.bind(this));
      
      // 绑定调试按钮
      document.getElementById('debug-check-data')?.addEventListener('click', () => this.debugCheckData());
      document.getElementById('debug-check-dom')?.addEventListener('click', () => this.debugCheckDOM());
      document.getElementById('debug-test-render')?.addEventListener('click', () => this.debugTestRender());
      document.getElementById('debug-clear-data')?.addEventListener('click', () => this.debugClearData());
    }

    /**
     * 发送带有唯一请求ID的消息到后台
     * @param {string} action - 消息类型
     * @param {object} data - 消息数据
     * @returns {Promise} - 返回响应Promise
     */
    async sendMessage(action, data = {}) {
      // 生成唯一请求ID
      const requestId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      
      // 构建带ID的消息
      const message = {
        action,
        requestId,
        ...data
      };
      
      console.log(`发送${action}请求 [ID:${requestId}]`);
      
      return new Promise((resolve, reject) => {
        const messageHandler = (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.error(`发送${action}请求错误:`, error);
            reject(new Error(error.message));
            return;
          }
          
          console.log(`收到${action}响应 [ID:${response?.requestId || '未知'}]`);
          
          // 验证响应是否匹配请求
          if (!response) {
            reject(new Error(`没有收到${action}响应`));
            return;
          }
          
          if (response.requestId !== requestId) {
            console.warn('响应ID不匹配:', response.requestId, '!=', requestId);
            return;
          }
          // ID匹配，解析Promise
          resolve(response);
        }
        // 发送消息并设置回调
        chrome.runtime.sendMessage(message, messageHandler);
      });
    }
    
    /**
     * 渲染时间线视图
     */
    renderTimelineView() {
      const width = this.svg.attr('width');
      const height = this.svg.attr('height');
      
      // 过滤节点和边
      const visibleNodes = this.filterNodes();
      const visibleEdges = this.filterEdges(visibleNodes);
      
      // 如果没有可见节点，显示无数据
      if (visibleNodes.length === 0) {
        this.showNoData();
        return;
      }
      
      // 确定时间范围
      const minTime = Math.min(...visibleNodes.map(node => node.timestamp));
      const maxTime = Math.max(...visibleNodes.map(node => node.timestamp));
      const timeRange = maxTime - minTime;
      
      // 创建时间刻度
      const timeScale = d3.scaleTime()
        .domain([new Date(minTime), new Date(maxTime)])
        .range([100, width - 100]);
      
      // 绘制时间轴
      const xAxis = d3.axisBottom(timeScale)
        .ticks(10)
        .tickFormat(d3.timeFormat('%H:%M:%S'));
      
      this.svg.select('g')
        .append('g')
        .attr('transform', `translate(0, ${height - 30})`)
        .attr('class', 'time-axis')
        .call(xAxis);
      
      // 计算时间线布局
      visibleNodes.forEach(node => {
        // X坐标基于时间
        node.x = timeScale(new Date(node.timestamp));
        
        // Y坐标基于深度，但可以用扇形布局增加视觉层次感
        const depthOffset = node.depth * 80;
        node.y = height / 2 - depthOffset;
      });
      
      // 绘制边
      this.edgeElements = this.svg.select('g').selectAll('.edge')
        .data(visibleEdges)
        .enter()
        .append('path')
        .attr('class', d => `edge ${d.type}`)
        .attr('id', d => `edge-${d.id}`)
        .attr('marker-end', 'url(#arrowhead)');
      
      // 创建箭头定义
      const defs = this.svg.select('g').append('defs');
      
      defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .append('path')
        .attr('d', 'M 0,-5 L 10,0 L 0,5')
        .attr('fill', '#999')
        .attr('stroke', 'none');
      
      // 绘制节点 - 这里是问题所在，模板字符串没有闭合
      this.nodeElements = this.svg.select('g').selectAll('.node')
        .data(visibleNodes)
        .enter()
        .append('g')
        .attr('class', d => `node depth-${d.depth}${d.isRoot ? ' root' : ''}${d.isClosed ? ' closed' : ''}`)
        .attr('id', d => `node-${d.id}`);
      
      // 绘制节点卡片和内容，类似于树形视图
      // ... 节点内容渲染 ...
      
      // 更新边位置
      this.edgeElements.attr('d', d => {
        const sourceNode = visibleNodes.find(n => n.id === d.source);
        const targetNode = visibleNodes.find(n => n.id === d.target);
            
        if (!sourceNode || !targetNode) return '';
            
        const source = {x: sourceNode.x, y: sourceNode.y};
        const target = {x: targetNode.x, y: targetNode.y};
        
        // 不同类型的边使用不同的路径
        if (d.source === d.target) {
          // 自环
          const dx = source.x;
          const dy = source.y;
          const dr = 30;
          return `M ${dx},${dy} a ${dr},${dr} 0 1,1 0,0.01`;
        } else if (d.type === 'history_back' || d.type === 'history_forward') {
          // 历史导航
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
          return `M ${source.x},${source.y} A ${dr},${dr} 0 0,1 ${target.x},${target.y}`;
        } else {
          // 标准边
          return `M ${source.x},${source.y} L ${target.x},${target.y}`;
        }
      });
    }
    
    /**
     * 切换视图 (树/时间线)
     */
    switchView(view) {
      if (this.currentView === view) return;
      
      this.currentView = view;
      
      // 更新UI
      document.getElementById('tree-view').classList.toggle('active', view === 'tree');
      document.getElementById('timeline-view').classList.toggle('active', view === 'timeline');
      
      this.updateStatistics();
      // 重新渲染
      this.renderVisualization();
    }
    
    /**
     * 应用过滤器
     */
    applyFilters() {
      // 保存当前的变换状态，以便在重新渲染后恢复
      let currentTransform = null;
      if (this.svg && this.zoom) {
        try {
          // 获取当前的变换矩阵
          currentTransform = d3.zoomTransform(this.svg.node());
          console.log('保存当前变换状态:', 
                    `比例=${currentTransform.k.toFixed(2)}, x=${currentTransform.x.toFixed(0)}, y=${currentTransform.y.toFixed(0)}`);
        } catch (e) {
          console.warn('获取变换状态时出错:', e);
        }
      }
    
      // 更新统计信息
      this.updateStatistics();
      
      // 重新渲染可视化
      this.renderVisualization({ restoreTransform: true });
      
      // 如果有保存的变换状态，恢复它
      if (currentTransform && this.svg && this.zoom) {
        setTimeout(() => {
          console.log('恢复变换状态:', 
                    `比例=${currentTransform.k.toFixed(2)}, x=${currentTransform.x.toFixed(0)}, y=${currentTransform.y.toFixed(0)}`);
          this.svg.call(this.zoom.transform, currentTransform);
        }, 100); // 给DOM渲染一些时间
      }
    }
    
    /**
     * 过滤节点 - 增加跟踪页面过滤
     */
    filterNodes() {
      return this.nodes.filter(node => {
        // 根据类型筛选
        if (node.type === 'link_click' && !this.filters.typeLink) return false;
        if (node.type === 'address_bar' && !this.filters.typeAddress) return false;
        if (node.type === 'form_submit' && !this.filters.typeForm) return false;
        if (['javascript', 'initial', 'redirect'].includes(node.type) && !this.filters.typeJs) return false;
        
        // 根据状态筛选
        if (node.isClosed && !this.filters.closed) return false;
        
        // 新增: 识别和过滤跟踪页面
        if (this.isTrackingPage(node)) {
          if (!this.filters.showTracking) return false; // 如果不显示跟踪页面，则过滤掉
        }
        
        return true;
      });
    }
    /**
     * 智能过滤视窗内的节点，避免过度渲染
     * @param {Array} nodes - 应用了普通过滤器后的节点
     * @param {Object} viewBox - 当前视窗范围 {x, y, width, height}
     * @param {number} zoomLevel - 当前缩放级别
     * @returns {Array} 最终可见的节点
     */
    applyDynamicNodeFiltering(nodes, viewBox, zoomLevel) {
      // 计算视窗内节点数量
      const nodesInView = nodes.filter(node => {
        // 使用渲染坐标判断节点是否在视图范围内
        const renderX = node.renderX !== undefined ? node.renderX : (node.x || 0);
        const renderY = node.renderY !== undefined ? node.renderY : (node.y || 0);
        
        return renderX >= viewBox.x && 
               renderX <= viewBox.x + viewBox.width &&
               renderY >= viewBox.y && 
               renderY <= viewBox.y + viewBox.height;
      });
      
      console.log(`视窗内有${nodesInView.length}个节点，缩放级别: ${zoomLevel.toFixed(2)}`);
      
      // 如果视窗内节点数量在合理范围内，直接返回全部节点
      const NODE_THRESHOLD = 200; // 视窗内节点数量阈值
      if (nodesInView.length <= NODE_THRESHOLD) {
        return nodes;
      }
      
      // 开始智能过滤，根据重要性排序
      const priorityNodes = [...nodesInView];
      
      // 按重要性评分
      priorityNodes.forEach(node => {
        // 初始分数
        let score = 50;
        
        // 规则1: 活跃时间
        if (node.activeTime) {
          if (node.activeTime > 60000) score += 30; // >1分钟高优先级
          else if (node.activeTime > 15000) score += 20; // >15秒中优先级
          else if (node.activeTime < 2000) score -= 20; // <2秒低优先级
        } else {
          score -= 10; // 无活跃时间记录，降低优先级
        }
        
        // 规则2: 节点类型
        if (node.type === 'address_bar') score += 20; // 地址栏导航通常是重要页面
        if (node.type === 'form_submit') score += 15; // 表单提交通常是重要操作
        if (this.isTrackingPage(node)) score -= 30; // 跟踪页面通常不重要
        
        // 规则3: 节点深度
        if (node.depth === 0) score += 25; // 根节点重要
        if (node.depth === 1) score += 15; // 第一层节点重要
        if (node.depth > 3) score -= 10; // 过深的节点次要
        
        // 规则4: 已关闭状态
        if (node.isClosed) score -= 15; // 已关闭节点次要
        
        // 规则5: 子节点数量
        const childCount = this.nodes.filter(n => n.parentId === node.id).length;
        score += Math.min(childCount * 5, 25); // 有更多子节点的页面更重要
        
        // 保存评分
        node.importanceScore = score;
      });
      
      // 按分数排序
      priorityNodes.sort((a, b) => b.importanceScore - a.importanceScore);
      
      // 根据缩放级别决定保留节点数量
      const visibleCount = Math.min(
        Math.max(50, Math.floor(NODE_THRESHOLD / zoomLevel)), // 缩放级别越小，显示越少
        nodesInView.length
      );
      
      // 创建需要保留的节点ID集合
      const keepNodeIds = new Set(priorityNodes
        .slice(0, visibleCount)
        .map(node => node.id));
      
      // 筛选返回结果：保留视窗外的所有节点和视窗内的高优先级节点
      const filteredNodes = nodes.filter(node => {
        // 获取渲染坐标
        const renderX = node.renderX !== undefined ? node.renderX : (node.x || 0);
        const renderY = node.renderY !== undefined ? node.renderY : (node.y || 0);
        
        // 视窗外的节点保留
        const isOutsideViewport = !(
          renderX >= viewBox.x && 
          renderX <= viewBox.x + viewBox.width &&
          renderY >= viewBox.y && 
          renderY <= viewBox.y + viewBox.height
        );
        
        // 视窗内的节点根据优先级决定是否保留
        return isOutsideViewport || keepNodeIds.has(node.id);
      });
      
      console.log(`动态过滤后保留${filteredNodes.length}/${nodes.length}个节点`);
      return filteredNodes;
    }
    /**
     * 判断是否为跟踪页面 - 专注于JS打开的页面
     */
    isTrackingPage(node) {
      // 如果不是JavaScript打开的页面，使用之前的普通判断
      if (node.type !== 'javascript') {
        // 只检查明确的跟踪URL路径模式
        if (node.url) {
          const lowerUrl = node.url.toLowerCase();
          
          const trackingKeywords = [
            '/track/', '/pixel/', '/analytics/', '/beacon/', '/telemetry/', 
            '/stats/', '/log/', '/metrics/', '/collect/', '/monitor/', 
            'piwik.', 'matomo.', 'ga.js', 'gtm.js', 'fbevents', 
            'insight.', '/counter/', 'www.google-analytics.com'
          ];
          
          if (trackingKeywords.some(keyword => lowerUrl.includes(keyword))) {
            return true;
          }
        }
        return false;
      }
      
      // 特殊处理JavaScript打开的页面 - 使用多重特征组合判断
      // 计算置信度分数，分数越高越可能是跟踪页面
      let trackingScore = 0;
      
      // 特征1: 检查URL特征 (权重高)
      if (node.url) {
        const lowerUrl = node.url.toLowerCase();
        
        // 1.1 明确的跟踪URL模式 (强特征)
        const strongTrackingPatterns = [
          'google-analytics.com', '/collect?', '/analytics?', '/pixel?', 
          '/track?', '/beacon?', '/ping?', '/log?', 'mixpanel.com',
          '/piwik?', 'clarity.ms', 'doubleclick.net'
        ];
        
        if (strongTrackingPatterns.some(pattern => lowerUrl.includes(pattern))) {
          trackingScore += 50; // 强特征，高分
        }
        
        // 1.2 可疑的URL参数模式 (中等特征)
        if (lowerUrl.includes('?')) {
          const queryPart = lowerUrl.split('?')[1];
          const params = new URLSearchParams(queryPart);
          
          // 检查跟踪参数
          const trackingParams = ['utm_', 'gclid', 'fbclid', 'trackid', 'affiliate', 
                                'sid', '_ga', 'cid', 'uid', 'visitor'];
          
          for (const param of trackingParams) {
            if (Array.from(params.keys()).some(key => key.includes(param))) {
              trackingScore += 10;
            }
          }
          
          // 参数超长
          if (queryPart.length > 150) {
            trackingScore += 15;
          }
          
          // 参数数量异常多
          if (params.size > 8) {
            trackingScore += 10;
          }
        }
        
        // 1.3 URL路径本身很短但查询字符串很长 (典型的跟踪模式)
        const urlPath = new URL(lowerUrl).pathname;
        if (urlPath.length < 10 && lowerUrl.includes('?') && lowerUrl.length > 150) {
          trackingScore += 15;
        }
        
        // 1.4 白名单匹配 (排除正常JS导航)
        const importantPages = ['/login', '/account', '/profile', '/cart', 
                               '/checkout', '/product', '/item', '/article',
                               '/post', '/news', '/blog', '/story'];
        
        if (importantPages.some(page => lowerUrl.includes(page))) {
          trackingScore -= 30; // 强力降低分数
        }
      }
      
      // 特征2: 检查活跃时间 (JS打开的跟踪页面通常活跃时间极短)
      if (node.activeTime !== undefined) {
        if (node.activeTime < 200) {
          trackingScore += 20; // 活跃时间极短，很可能是跟踪请求
        } else if (node.activeTime < 500) {
          trackingScore += 10; // 活跃时间短，可能是跟踪请求
        } else if (node.activeTime > 10000) {
          trackingScore -= 20; // 活跃时间长，可能是正常页面
        }
      }
      
      // 特征3: 检查标题特征 (跟踪页面通常无标题或标题无意义)
      if (!node.title) {
        trackingScore += 15; // 无标题，可能是跟踪页面
      } else {
        // 标题包含正常页面关键词，降低分数
        const normalTitleWords = ['page', 'home', 'blog', 'article', 'product', 
                                 'search', 'result', 'profile', 'shop'];
        if (normalTitleWords.some(word => node.title.toLowerCase().includes(word))) {
          trackingScore -= 10;
        }
      }
      
      // 特征4: 检查节点关系 (跟踪页面通常是叶子节点)
      const hasChildren = this.nodes.some(n => n.parentId === node.id);
      if (!hasChildren) {
        trackingScore += 10; // 没有子节点，增加跟踪可能性
      } else {
        trackingScore -= 15; // 有子节点，降低跟踪可能性
      }
      
      // 特征5: 检查favicon (跟踪页面通常没有favicon或使用通用favicon)
      if (!node.favicon) {
        trackingScore += 5;
      }
      
      // 判定阈值: 50分及以上很可能是跟踪页面
      return trackingScore >= 50;
    }
    
    /**
     * 过滤边
     */
    filterEdges(visibleNodes) {
      // 创建可见节点ID集合，用于快速查找
      const visibleNodeIds = new Set(visibleNodes.map(node => node.id));
      
      return this.edges.filter(edge => {
        // 源节点和目标节点都必须可见
        if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
          return false;
        }
        
        // 根据类型过滤
        if ((edge.type === 'reload') && !this.filters.reload) return false;
        if ((edge.type === 'history_back' || edge.type === 'history_forward') && !this.filters.history) return false;
        
        return true;
      });
    }
    
    /**
     * 截断文本
     */
    truncateText(text, maxWidth) {
      if (!text) return '';
      return text.length > maxWidth ? text.substring(0, maxWidth - 3) + '...' : text;
    }
    
    /**
     * 显示节点tooltip
     */
    showTooltip(event, d) {
      const date = new Date(d.timestamp).toLocaleString();
      let html = `
        <div class="tooltip-title">${d.label}</div>
        <div class="tooltip-url">${d.url}</div>
        <div class="tooltip-time">时间: ${date}</div>
      `;
      
      if (d.activeTime) {
        const seconds = Math.floor(d.activeTime / 1000);
        const minutes = Math.floor(seconds / 60);
        html += `<div class="tooltip-active">活跃时间: ${minutes}分 ${seconds % 60}秒</div>`;
      }
      
      if (d.loadTime) {
        html += `<div class="tooltip-load">加载时间: ${d.loadTime}ms</div>`;
      }
      
      this.tooltip.html(html)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY + 10) + 'px')
        .style('display', 'block');
    }
    
    /**
     * 隐藏tooltip
     */
    hideTooltip() {
      this.tooltip.style('display', 'none');
    }
    
    /**
     * 处理节点点击
     */
    handleNodeClick(event, d) {
      // 高亮点击的节点
      d3.selectAll('.node').classed('selected', false);
      d3.select(`#node-${d.id}`).classed('selected', true);
      
      // 显示节点详情
      const detailsPane = document.getElementById('details-pane');
      if (detailsPane) {
        detailsPane.innerHTML = `
          <h3>${d.label}</h3>
          <p><a href="${d.url}" target="_blank">${d.url}</a></p>
          <p>时间: ${new Date(d.timestamp).toLocaleString()}</p>
          <p>类型: ${this.getNavigationTypeDisplay(d.type)}</p>
          ${d.activeTime ? `<p>活跃时间: ${this.formatTime(d.activeTime)}</p>` : ''}
          ${d.loadTime ? `<p>加载时间: ${d.loadTime}ms</p>` : ''}
          <p>状态: ${d.isClosed ? '已关闭' : '活跃中'}</p>
        `;
      }
      
      // 高亮相关连接
      this.highlightConnections(d.id);
    }
    
    /**
     * 高亮节点的连接
     */
    highlightConnections(nodeId) {
      d3.selectAll('.edge').classed('highlighted', false);
      
      // 高亮所有与此节点相关的边
      const relatedEdges = this.edges.filter(edge => 
        edge.source === nodeId || edge.target === nodeId
      );
      
      relatedEdges.forEach(edge => {
        d3.select(`#edge-${edge.id}`).classed('highlighted', true);
      });
    }
    
    /**
     * 获取导航类型的显示文本
     */
    getNavigationTypeDisplay(type) {
      const displayMap = {
        'link_click': '链接点击',
        'address_bar': '地址栏输入',
        'form_submit': '表单提交',
        'history_back': '历史后退',
        'history_forward': '历史前进',
        'reload': '页面刷新',
        'redirect': '重定向',
        'javascript': 'JavaScript导航',
        'initial': '初始加载'
      };
      
      return displayMap[type] || type;
    }
    
    /**
     * 格式化时间
     */
    formatTime(ms) {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours}小时 ${minutes % 60}分钟`;
      } else if (minutes > 0) {
        return `${minutes}分钟 ${seconds % 60}秒`;
      } else {
        return `${seconds}秒`;
      }
    }
    
    /**
     * 拖拽开始
     */
    dragstarted(event) {
      if (!event.active) this.simulationTree.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }
    
    /**
     * 拖拽中
     */
    dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }
    
    /**
     * 拖拽结束
     */
    dragended(event) {
      if (!event.active) this.simulationTree.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }
    
    /**
     * 处理窗口大小变化
     */
    handleResize() {
      try {
        const container = document.getElementById('visualization-container');
        if (!container) return;
        
        const width = container.clientWidth || 800;
        const height = container.clientHeight || 600;
        
        // 不依赖this.svg，而是重新渲染
        this.renderVisualization();
      } catch (error) {
        console.error('窗口大小变化处理失败:', error);
      }
    }
    
    /**
     * 显示加载中状态
     */
    showLoading() {
      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.style.display = 'flex';
      
      const noDataEl = document.getElementById('no-data');
      if (noDataEl) noDataEl.style.display = 'none';
    }
    
    /**
     * 显示无数据状态
     */
    showNoData(message = '暂无数据') {
      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.style.display = 'none';
      
      const noDataEl = document.getElementById('no-data');
      if (!noDataEl) return;
      
      // 确保浮层只在可视化容器中显示 - 添加这段代码
      const container = document.getElementById('visualization-container');
      if (container && noDataEl.parentNode !== container) {
        // 如果浮层不在容器中，将其移入容器
        container.appendChild(noDataEl);
      }
      
      noDataEl.style.display = 'flex';
      
      const statusText = document.getElementById('status-text');
      if (statusText) statusText.textContent = message;
    }
    
    /**
     * 隐藏加载状态
     */
    hideLoading() {
      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.style.display = 'none';
    }

    /**
     * 加载会话列表
     */
    async loadSessions() {
      try {
        console.log('加载会话列表...');
        
        const response = await chrome.runtime.sendMessage({ action: 'getSessions' });
        console.log('收到会话列表响应:', response);
        
        // 强化错误处理和类型检查
        if (response && response.success === true && Array.isArray(response.sessions)) {
          this.sessions = response.sessions;
          console.log(`成功加载${this.sessions.length}个会话`);

          // 更新会话选择器UI
          this.updateSessionSelector();
          
          return this.sessions;
        } else {
          console.warn('会话响应格式不正确:', response);
          throw new Error(response?.error || '获取会话列表失败');
        }
      } catch (error) {
        console.error('加载会话列表失败:', error);
        throw error;
      }
    }
    
    /**
     * 加载当前会话
     */
    async loadCurrentSession() {
      if (this.sessions.length === 0) {
        this.showNoData();
        return;
      }
      
      // 加载最新的会话
      await this.loadSession(this.sessions[0].id);
    }
    
    /**
     * 加载指定会话
     */
    async loadSession(sessionId) {
      try {
        this.showLoading();
        
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.textContent = '加载会话数据...';
        
        console.log(`尝试加载会话: ${sessionId}`);
        
        // 使用新的sendMessage方法
        const response = await this.sendMessage('getSessionDetails', { sessionId });
        
        console.log('getSessionDetails响应:', response);
        
        if (response && response.success && response.session) {
          console.log('会话数据获取成功, 节点数:', 
                     response.session.records ? Object.keys(response.session.records).length : 0);
          
          this.currentSession = response.session;
          
          // 处理会话数据为可视化格式
          this.processSessionData();
          
          // 更新会话选择器
          const selector = document.getElementById('session-selector');
          if (selector) selector.value = sessionId;
          
          // 更新统计信息
          this.updateStatistics();
          
          // 渲染可视化
          this.renderVisualization();
          
          if (statusText) {
            statusText.textContent = 
              `已加载会话: ${new Date(this.currentSession.startTime).toLocaleString()}`;
          }
        } else {
          console.error('获取会话详情失败, 响应:', response);
          throw new Error(response && response.error ? response.error : '获取会话详情失败');
        }
      } catch (error) {
        console.error('加载会话详情失败:', error);
        this.showNoData(`加载会话失败: ${error.message}`);
      } finally {
        this.hideLoading();
      }
    }
    
    /**
     * 构建节点ID到节点对象的映射表，优化查询性能
     * 将O(n)的数组查找转换为O(1)的映射表查询
     */
    buildNodeMap() {
      this.nodeMap = new Map();
      if (this.nodes && this.nodes.length) {
        this.nodes.forEach(node => {
          this.nodeMap.set(node.id, node);
        });
      }
      console.log(`已建立${this.nodeMap.size}个节点的索引`);
    }

    /**
     * 处理会话数据为可视化格式
     */
    processSessionData() {
      if (!this.currentSession) return;
      
      console.log('开始处理会话数据...');
      
      try {
        // 记录存储
        const records = this.currentSession.records || {};
        const recordIds = Object.keys(records);
        
        console.log(`处理${recordIds.length}条记录`);
        
        // 转换为节点数组
        this.nodes = recordIds.map(id => {
          const record = records[id];

          // 检测并修正自循环
          let parentId = record.parentId;
          if (parentId === record.id) {
            console.log(`检测到节点 ${record.id} 自循环，修正为根节点`);
            parentId = null;  // 修正为根节点
          }

          return {
            id: record.id,
            url: record.url,
            title: record.title || this.extractTitle(record.url),
            favicon: record.favicon,
            type: record.navigationType || 'unknown',
            timestamp: record.timestamp,
            tabId: record.tabId,
            parentId: parentId, 
            referrer: record.referrer || '',
            isClosed: record.isClosed || false,
            // 确保所有节点都有children数组
            children: []
          };
        });
        
        // 重建父子关系
        this.reconstructParentChildRelationships();
        
        // 获取所有边
        const edgeMap = this.currentSession.edges || {};
        const edgeIds = Object.keys(edgeMap);
        
        console.log(`处理${edgeIds.length}条边`);
        
        // 转换为边数组
        this.edges = edgeIds.map(id => {
          const edge = edgeMap[id];
          return {
            id: edge.id,
            source: edge.sourceId,
            target: edge.targetId,
            timestamp: edge.timestamp,
            type: edge.action || 'unknown'
          };
        });
        
        // 添加基于重构的父子关系创建附加边
        this.enhanceEdgesFromParentChildRelationships();
        
        // 构建节点映射表
        this.buildNodeMap();
        
        console.log('会话数据处理完成');
        console.log('节点:', this.nodes.length);
        console.log('边:', this.edges.length);
      } catch (error) {
        console.error('处理会话数据失败:', error);
        this.nodes = [];
        this.edges = [];
      }
    }
    
    /**
     * 重建父子关系 - 按导航顺序重建
     */
    reconstructParentChildRelationships() {
      console.log('开始重建父子关系...');
      
      // 创建节点ID映射，便于快速查找
      const nodesById = {};
      this.nodes.forEach(node => {
        nodesById[node.id] = node;
      });
      
      // 按标签页和时间排序
      const nodesByTabId = {};
      this.nodes.forEach(node => {
        if (!nodesByTabId[node.tabId]) {
          nodesByTabId[node.tabId] = [];
        }
        nodesByTabId[node.tabId].push(node);
      });
      
      // 对每个标签页的节点按时间排序
      Object.keys(nodesByTabId).forEach(tabId => {
        nodesByTabId[tabId].sort((a, b) => a.timestamp - b.timestamp);
      });
      
      let assignedCount = 0;
      
      // 1. 首先按照时间顺序处理所有节点 - 模拟实际导航序列
      const sortedNodes = [...this.nodes].sort((a, b) => a.timestamp - b.timestamp);
      
      // 跟踪每个标签页当前活跃的节点
      const activeNodesByTabId = {};
      
      // 遍历所有节点，按时间顺序模拟导航过程
      sortedNodes.forEach(node => {
        // 如果已有有效的父节点引用，保留它
        if (node.parentId && nodesById[node.parentId] && node.parentId !== node.id) {
          assignedCount++;
          return;
        }
        
        // 自循环检测 - 将自引用修正为根节点
        if (node.parentId === node.id) {
          console.log(`节点 ${node.id} 是自循环，修正为根节点`);
          node.parentId = null;
          return;
        }
        
        // 获取导航类型
        const navigationType = node.type || node.navigationType;
        
        // 根据导航类型确定父节点
        switch(navigationType) {
          case 'link_click':
            // 链接点击通常来自同一标签页的前一个节点
            const sameTabNodes = nodesByTabId[node.tabId] || [];
            const nodeIndex = sameTabNodes.findIndex(n => n.id === node.id);
            
            // 如果在同一标签页中有前一个节点，将其设为父节点
            if (nodeIndex > 0) {
              node.parentId = sameTabNodes[nodeIndex - 1].id;
              assignedCount++;
            }
            break;
            
          case 'address_bar':
            // 地址栏输入通常是新的导航序列，可能没有父节点
            // 但如果是在现有标签页中输入，可能与前一页有关
            if (activeNodesByTabId[node.tabId]) {
              node.parentId = activeNodesByTabId[node.tabId].id;
              assignedCount++;
            } else {
              node.parentId = null; // 新标签页的第一次导航
            }
            break;
            
          case 'form_submit':
            // 表单提交通常来自同一标签页的前一个节点
            if (activeNodesByTabId[node.tabId]) {
              node.parentId = activeNodesByTabId[node.tabId].id;
              assignedCount++;
            }
            break;
            
          case 'history_back':
          case 'history_forward':
            // 历史导航指向同一标签页中的某个节点
            // 这种情况较复杂，暂时保持当前处理方式
            break;
            
          case 'reload':
            // 刷新操作应该保持当前节点，不改变父子关系
            // 已在上面处理了自循环情况
            break;
            
          default:
            // 对于其他类型，查找直接的导航关系
            // 用边信息补充 - 这是原始记录的实际导航关系
            if (this.edges) {
              const directEdges = this.edges.filter(e => 
                (e.target === node.id || e.targetId === node.id) && 
                e.type !== 'generated' // 跳过推断生成的边
              );
              
              if (directEdges.length > 0) {
                // 优先使用最近的边
                directEdges.sort((a, b) => b.timestamp - a.timestamp);
                node.parentId = directEdges[0].source || directEdges[0].sourceId;
                assignedCount++;
              }
            }
            break;
        }
        
        // 更新当前标签页的活跃节点
        activeNodesByTabId[node.tabId] = node;
      });
      
      console.log(`父子关系重建完成: ${assignedCount}/${this.nodes.length} 节点有父节点`);
    }
    
    /**
     * 根据重构的父子关系增强边集合
     */
    enhanceEdgesFromParentChildRelationships() {
      // 创建现有边的映射
      const existingEdgeMap = {};
      this.edges.forEach(edge => {
        const source = edge.source || edge.sourceId;
        const target = edge.target || edge.targetId;
        const key = `${source}#${target}`;
        existingEdgeMap[key] = true;
      });
      
      // 为缺失的父子关系创建新边
      const newEdges = [];
      this.nodes.forEach(node => {
        if (node.parentId) {
          const source = node.parentId;
          const target = node.id;
          const key = `${source}#${target}`;
          
          // 如果这个关系的边不存在，添加一个新的
          // 使用nodeMap验证父节点是否存在
          const parentExists = this.nodeMap && this.nodeMap.has(source);
          
          if (!existingEdgeMap[key] && parentExists) {
            newEdges.push({
              id: `generated-${key}`,
              source: source,
              sourceId: source,
              target: target,
              targetId: target,
              timestamp: node.timestamp,
              type: node.type || 'unknown',
              action: node.navigationType || node.type || 'unknown',
              generated: true // 标记为生成的边
            });
          }
        }
      });
      
      if (newEdges.length > 0) {
        console.log(`添加了${newEdges.length}条生成的边`);
        this.edges = [...this.edges, ...newEdges];
      }
    }
    
    /**
     * 计算节点深度
     */
    calculateNodeDepths() {
      try {
        // 首先找出所有根节点
        const rootNodes = this.nodes.filter(node => !node.parentId);
        
        if (rootNodes.length === 0) {
          console.warn('没有找到根节点，设置所有节点深度为0');
          this.nodes.forEach(node => node.depth = 0);
          return;
        }
        
        // 为每个根节点及其子节点计算深度
        rootNodes.forEach(rootNode => {
          rootNode.depth = 0;
          this.calculateChildDepths(rootNode, 1);
        });
      } catch (error) {
        console.error('计算节点深度失败:', error);
        // 出错时确保所有节点至少有深度值
        this.nodes.forEach(node => {
          if (typeof node.depth === 'undefined') node.depth = 0;
        });
      }
    }
    
    calculateChildDepths(parentNode, depth) {
      if (!parentNode || !parentNode.id) return;
      
      // 找出父节点的所有直接子节点
      const childNodes = this.nodes.filter(node => 
        node.parentId === parentNode.id && node.id !== parentNode.id
      );
      
      // 设置子节点深度并递归处理
      childNodes.forEach(childNode => {
        childNode.depth = depth;
        // 防止循环引用导致栈溢出
        if (childNode.id !== parentNode.id) {
          this.calculateChildDepths(childNode, depth + 1);
        }
      });
    }
    
    /**
     * 重置统计信息到默认值
     */
    resetStatistics() {
      // Windows风格状态栏的默认值
      const defaultValues = {
        'status-nodes': '节点: 0',
        'status-edges': '连接: 0',
        'status-pages': '页面: 0',
        'status-navigations': '导航: 0',
        'status-time': '时间: 0分钟'
      };
      
      // 安全地更新所有状态栏格子
      Object.entries(defaultValues).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      });
      
      // 更新消息格子
      const messageElement = document.getElementById('status-message');
      if (messageElement) {
        messageElement.textContent = `${this.currentView === 'tree' ? '树形视图' : '时间线视图'} | ${new Date().toLocaleTimeString()}`;
      }
    }
    /**
     * 更新统计信息
     */
    updateStatistics() {
      if (!this.currentSession) {
        // 如果没有会话，重置统计信息
        this.resetStatistics();
        return;
      }
      try {
        // 所有节点和应用过滤器后的节点
        const allNodes = this.nodes || [];
        const visibleNodes = this.filterNodes();
        const visibleEdges = this.filterEdges(visibleNodes);
        
        // 计算被过滤的节点数
        const filteredNodesCount = allNodes.length - visibleNodes.length;
    
        // 计算总活跃时间
        const totalActiveTime = visibleNodes.reduce((sum, node) => sum + (node.activeTime || 0), 0);
        const minutes = Math.floor(totalActiveTime / 60000);
        
        const uniqueUrls = new Set(visibleNodes.filter(node => node.url).map(node => node.url));
        const pagesCount = uniqueUrls.size;
        
        // 计算导航次数 - 通过边的数量来估算
        const navigationCount = visibleEdges.length;
        
        // 更新Windows风格的状态栏格子
        const elements = {
          'status-nodes': `节点: ${visibleNodes.length}/${allNodes.length}`,
          'status-edges': `连接: ${visibleEdges.length}`,
          'status-pages': `页面: ${pagesCount}`,
          'status-navigations': `导航: ${navigationCount}`,
          'status-time': `时间: ${minutes}分钟`,
          'status-filtered': `已过滤: ${filteredNodesCount}`
        };
        
        // 遍历所有需要更新的格子 - 添加防御性检查和日志
        Object.entries(elements).forEach(([id, value]) => {
          const element = document.getElementById(id);
          if (element) {
            element.textContent = value;
          } else {
            console.warn(`状态栏元素未找到: ${id}`);
          }
        });
        // 更新消息格子
        const messageElement = document.getElementById('status-message');
        if (messageElement) {
          const filterTypes = [];
          if (!this.filters.typeLink) filterTypes.push('链接');
          if (!this.filters.typeAddress) filterTypes.push('地址栏');
          if (!this.filters.typeForm) filterTypes.push('表单');
          if (!this.filters.typeJs) filterTypes.push('JS');
          if (!this.filters.showTracking) filterTypes.push('跟踪');
          
          const filterMsg = filterTypes.length > 0 ? `已隐藏: ${filterTypes.join(',')}` : '显示所有类型';
          messageElement.textContent = `${this.currentView === 'tree' ? '树形视图' : '时间线视图'} | ${filterMsg}`;
        }
        console.log('状态栏已更新:', elements);
      
      } catch (error) {
        console.error('更新统计信息失败:', error);
      }
    }
    
    /**
     * 渲染可视化
     */
    renderVisualization() {
      try {
        // 标记是否需要恢复变换（用于其他方法判断）
        this._isRestoringTransform = arguments[0]?.restoreTransform === true;        
        // 清除现有内容
        const container = document.getElementById('visualization-container');
        if (!container) {
          console.error('找不到可视化容器，无法渲染');
          return;
        }
        
        // 清除现有内容
        container.innerHTML = '';
        
        // 如果没有数据，显示提示
        if (!this.currentSession || !this.nodes || this.nodes.length === 0) {
          this.showNoData();
          return;
        }
        
        // 标记有被过滤子节点的父节点 (在应用过滤器之前调用)
        this.markNodesWithFilteredChildren();

        // 应用过滤器
        const visibleNodes = this.filterNodes();
        const visibleLinks = this.filterEdges(visibleNodes);
        
        if (visibleNodes.length === 0) {
          this.showNoData('筛选条件下没有数据');
          return;
        }
        
        console.log(`渲染${visibleNodes.length}个节点和${visibleLinks.length}条边`);
        
        // 获取容器尺寸
        const width = container.clientWidth || 800;
        const height = container.clientHeight || 600;
        const timelineHeight = 40; // 时间线高度

        // 创建一个包含两个SVG的容器
        const vizContainer = d3.select(container)
          .append('div')
          .attr('class', 'viz-container')
          .style('position', 'relative')
          .style('width', '100%')
          .style('height', '100%');
        
        // 创建主SVG容器 (高度减去时间线的高度)
        const svg = vizContainer.append('svg')
          .attr('class', 'main-svg')
          .attr('width', width)
          .attr('height', height)
          .attr('viewBox', [0, 0, width, height]);
        
        // 在主SVG容器中添加事件处理
        svg.on('click', (event) => {
          // 检查是否点击了节点以外的区域
          if (event.target === svg.node()) {
            this.hideNodeDetails();
          }
        });
        
        // 添加主要内容分组
        const mainGroup = svg.append('g');
        
        // 保存到实例变量
        this.svg = svg;
        
        // 创建时间线SVG容器 (固定在底部)
        const timelineSvg = vizContainer.append('svg')
          .attr('class', 'timeline-svg')
          .attr('width', '100%')
          .attr('height', timelineHeight)
          .style('position', 'absolute')
          .style('bottom', '0')
          .style('left', '0')
          .style('width', '100%')  // 确保始终占满宽度
          .style('background-color', '#333')
          .style('border-top', '1px solid #555')
          .style('z-index', '10');
        
        // 保存时间线SVG供后续使用
        this.timelineSvg = timelineSvg;
        // 根据当前视图调用相应的渲染方法
        if (this.currentView === 'tree') {
          // 树形视图不需要时间线，隐藏它
          this.timelineSvg.style('display', 'none');

          this.renderTreeLayout(mainGroup, visibleNodes, visibleLinks, width, height);
        } else {
          this.timelineSvg.style('display', null);
          // 主视图高度减去时间线高度
          svg.attr('height', height - timelineHeight)
             .attr('viewBox', [0, 0, width, height - timelineHeight]);
          this.renderTimelineLayout(mainGroup, timelineSvg, visibleNodes, visibleLinks, width, height - timelineHeight);
        }
        
        // 添加缩放和平移功能
        const zoom = d3.zoom()
          .scaleExtent([0.1, 3])
          .on('zoom', (event) => {
            mainGroup.attr('transform', event.transform);
            
            // 计算当前视窗范围
            const transform = event.transform;
            const viewBox = {
              x: -transform.x / transform.k,
              y: -transform.y / transform.k,
              width: width / transform.k,
              height: height / transform.k
            };
            
            // 只有在缩放级别较小时才应用智能过滤（更多节点可见）
            if (transform.k < 0.8) {
              // 获取当前过滤条件下的所有可见节点
              const allVisibleNodes = this.filterNodes();
              
              // 应用动态节点过滤，根据视窗内节点密度和重要性智能过滤
              const filteredNodes = this.applyDynamicNodeFiltering(
                allVisibleNodes, 
                viewBox, 
                transform.k
              );
              
              // 根据已过滤的节点获取可见的边
              const filteredEdges = this.filterEdges(filteredNodes);
              
              // 计算过滤前后的节点差异
              const nodesRemoved = allVisibleNodes.length - filteredNodes.length;
              
              // 显示过滤信息提示（如果有节点被过滤）
              if (nodesRemoved > 0) {
                const statusMessage = document.getElementById('status-message');
                if (statusMessage) {
                  statusMessage.textContent = `已动态隐藏${nodesRemoved}个低优先级节点`;
                  
                  // 临时高亮显示状态消息
                  statusMessage.classList.add('highlight');
                  setTimeout(() => {
                    statusMessage.classList.remove('highlight');
                  }, 2000);
                }
                
                // 在视图中添加视觉指示器
                this.showFilteringIndicator(transform);
              }
              
              // 更新节点可见性
              if (this.currentView === 'tree') {
                // 树形视图中的节点处理
                d3.select(container).selectAll('.node')
                  .style('display', d => {
                    if (!d) return 'none';
                    const nodeId = typeof d.data === 'object' ? d.data.id : d.id;
                    // 会话根节点特殊处理 - 始终显示
                    if (nodeId === 'session-root') return null;
                    return filteredNodes.some(n => n.id === nodeId) ? null : 'none';
                  });
                  
                // 更新连接线可见性
                d3.select(container).selectAll('.link')
                  .style('display', d => {
                    if (!d || !d.source || !d.target) return 'none';
                    const sourceId = typeof d.source === 'object' ? d.source.data.id : d.source;
                    const targetId = typeof d.target === 'object' ? d.target.data.id : d.target;
                    
                    // 与会话根节点相关的连接线特殊处理 - 始终显示
                    if (sourceId === 'session-root' || targetId === 'session-root') return null;
                    return filteredEdges.some(e => 
                      (e.source === sourceId && e.target === targetId)
                    ) ? null : 'none';
                  });
              } else {
                // 时间线视图中的节点处理
                d3.select(container).selectAll('.node')
                  .style('display', d => {
                    return filteredNodes.some(n => n.id === d.id) ? null : 'none';
                  });
                  
                d3.select(container).selectAll('.edge')
                  .style('display', d => {
                    return filteredEdges.some(e => 
                      (e.source === d.source && e.target === d.target)
                    ) ? null : 'none';
                  });
              }
            } else {
              // 缩放级别较大时，显示所有节点
              d3.select(container).selectAll('.node, .link, .edge')
                .style('display', null);
                
              // 清除过滤指示器
              this.hideFilteringIndicator();
            }
            // 如果是时间线视图，同步时间线的水平缩放
            if (this.currentView === 'timeline') {
              const transform = event.transform;
              // 只应用水平缩放和平移，保持垂直位置不变
              timelineSvg.select('g.time-axis-group')
                .attr('transform', `translate(${transform.x}, 0) scale(${transform.k}, 1)`);

              // 计算缩放后的可见宽度
              const scaledWidth = Math.max(width * transform.k, width);
              
              // 确保时间线背景的宽度始终不小于可视区域
              const actualWidth = Math.max(scaledWidth, width);
              
              // 修改时间线SVG容器的宽度
              if (transform.k > 1.0) {
                // 当放大时，扩展SVG宽度
                timelineSvg.style('width', actualWidth + 'px');
              } else {
                // 当缩小或平移时，保持100%宽度
                timelineSvg.style('width', '100%');
              }

              // 更新时间线背景矩形以始终覆盖可见区域
              timelineSvg.select('rect')
              .attr('width', actualWidth)
              .attr('x', transform.x < 0 ? transform.x : 0);
            
              // 添加视觉反馈
              timelineSvg.classed('zoomed', transform.k > 1.0);
            }
          });
        
        svg.call(zoom);
        this.zoom = zoom;
        
      } catch (error) {
        console.error('渲染可视化失败:', error);
        this.showNoData(`渲染可视化失败: ${error.message}`);
      }
      finally {
        // 重置标记
        this._isRestoringTransform = false;
      }
      this.updateStatistics();
    }
    // 添加过滤指示器相关方法
    
    /**
     * 显示过滤指示器
     */
    showFilteringIndicator(transform) {
      // 如果已经有指示器，移除它
      this.hideFilteringIndicator();
      
      // 创建指示器
      const indicator = d3.select('#visualization-container')
        .append('div')
        .attr('class', 'filtering-indicator')
        .style('position', 'absolute')
        .style('top', '10px')
        .style('right', '10px')
        .style('background', 'rgba(0,0,0,0.7)')
        .style('color', 'white')
        .style('padding', '8px 12px')
        .style('border-radius', '4px')
        .style('font-size', '0.9em')
        .style('z-index', '1000')
        .style('pointer-events', 'none')
        .style('opacity', '0')
        .style('transition', 'opacity 0.3s');
        
      // 添加缩放提示
      indicator.html(`
        <span><i class="zoom-icon">🔍</i> 放大查看更多节点</span><br>
        <span style="font-size: 0.8em">当前缩放: ${Math.round(transform.k * 100)}%</span>
      `);
      
      // 显示指示器
      setTimeout(() => {
        indicator.style('opacity', '1');
      }, 10);
      
      // 储存引用
      this._filteringIndicator = indicator.node();
    }
    
    /**
     * 隐藏过滤指示器
     */
    hideFilteringIndicator() {
      // 移除现有指示器
      if (this._filteringIndicator) {
        this._filteringIndicator.remove();
        this._filteringIndicator = null;
      }
    }
    /**
     * 渲染树形布局
     */
    renderTreeLayout(container, nodes, links, width, height) {
      // 创建虚拟的会话根节点
      const sessionNode = {
        id: 'session-root',
        type: 'session',
        title: `会话 ${new Date(this.currentSession.startTime).toLocaleString()}`,
        level: 0
      };
    
      // 计算节点层级
      const nodeById = {};
      nodes.forEach(node => {
        nodeById[node.id] = node;
        node.children = [];
        node.level = 0;
      });
      
      // 构建树结构
      const rootNodes = [];
      const selfLoopNodes = []; // 用于跟踪自循环节点
      nodes.forEach(node => {
        if (node.parentId === node.id) {
          console.log(`检测到节点 ${node.id} 自循环，标记为刷新节点`);
          node.isSelfLoop = true; // 标记为自循环，用于特殊显示
          selfLoopNodes.push(node);
        } 
        
        // 判断是否为根节点或父节点不存在
        if (node.parentId === null || !nodeById[node.parentId]) {
          // 明确作为根节点处理
          node.isRoot = true;
          rootNodes.push(node);
        } 
        // 正常父子关系处理
        else if (nodeById[node.parentId]) {
          // 添加到父节点的子节点列表
          if (!nodeById[node.parentId].children) {
            nodeById[node.parentId].children = [];
          }
          nodeById[node.parentId].children.push(node);
        }
      });
      
      console.log(`找到${rootNodes.length}个根节点，${selfLoopNodes.length}个自循环节点`);

      // 计算层级 (根节点是第1层，子节点是第2层，以此类推)
      function assignLevels(node, level) {
        node.level = level;
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach(child => assignLevels(child, level + 1));
        }
      }
      
      // 修改安全的forEach调用
      if (rootNodes.length > 0) {
        rootNodes.forEach(root => assignLevels(root, 1));
      } else {
        console.warn('没有找到根节点，可能导致树形视图不完整');
        // 创建一个虚拟根节点连接所有孤立节点
        nodes.forEach(node => {
          if (!node.parentId) {
            node.parentId = 'session-root';
          }
        });
      }
    
      // 将虚拟根节点添加到节点列表
      const allNodes = [sessionNode, ...nodes];
      
      // 创建连接会话节点到根节点的链接
      const sessionLinks = rootNodes.length > 0 ? 
      rootNodes.map(root => ({
        id: `session-${root.id}`,
        source: sessionNode.id,
        target: root.id,
        type: 'session_link'
      })) : 
      // 如果没有根节点，创建连接到所有节点的链接
      nodes.map(node => ({
        id: `session-${node.id}`,
        source: sessionNode.id,
        target: node.id,
        type: 'session_link'
      }));
      
      // 合并所有链接
      const allLinks = [...sessionLinks, ...links];
      
      // 创建层次化树形布局 - 注意修改这里的配置
      const treeLayout = d3.tree()
      .nodeSize([30, 140])  // 增加固定节点间距，确保不会过度压缩
      .separation((a, b) => {
        // 更细致的间距控制: 同级节点给予2.5倍基础间距，非同级4倍间距
        // 根据节点深度额外增加间距，防止更深层节点过度挤压
        const depthFactor = Math.min(1.3, (a.depth + b.depth) * 0.08 + 1);
        return (a.parent === b.parent ? 3 : 4.5) * depthFactor;
      });
      // 创建层次结构
      const hierarchy = d3.stratify()
        .id(d => d.id)
        .parentId(d => {
          // 如果是会话根节点，则没有父节点
          if (d.id === 'session-root') return null;
          
          // 如果有父ID并且父节点存在，使用此父ID
          if (d.parentId && nodeById[d.parentId]) {
            return d.parentId;
          }
          
          // 默认情况：连接到会话根节点
          return 'session-root';
        })
        // 确保传入的数据包含session-root节点，避免ID引用错误
        (allNodes.some(n => n.id === 'session-root') ? allNodes : [sessionNode, ...nodes]);
      
      // 应用布局
      const treeData = treeLayout(hierarchy);
      
      // 立即计算树的边界
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      
      treeData.descendants().forEach(d => {
        minX = Math.min(minX, d.y);
        maxX = Math.max(maxX, d.y);
        minY = Math.min(minY, d.x);
        maxY = Math.max(maxY, d.x);
      });
      
      // 固定水平偏移量，确保根节点在左侧而不是居中
      const leftMargin = width * 0.2; // 左侧预留20%的空间
      const xOffset = leftMargin;
      
      // 垂直方向居中
      const contentHeight = maxY - minY;
      const yOffset = (height - contentHeight) / 2 - minY + 50; // 增加50像素的顶部间距
      
      // 计算合适的缩放因子
      const contentWidth = maxX - minX;
      // 限制最大缩放，确保保持节点间距
      const scaleFactor = Math.min(
        (width - leftMargin - 100) / Math.max(contentWidth, 1), // 增加边距
        (height - 120) / Math.max(contentHeight, 1), 
        0.9 // 更低的最大缩放限制，保证更多空间
      );
      
      // 创建适当的变换矩阵
      const transformMatrix = d3.zoomIdentity
        .translate(xOffset, yOffset)
        .scale(1); // 先不缩放，保持原始大小的树
      
      // 渲染树结构 - 应用初始偏移
      
      // 创建连接线分组 - 已应用初始变换
      const linkGroup = container.append('g')
        .attr('class', 'links')
        .attr('transform', `translate(${xOffset}, ${yOffset})`);
      
      // 节点分组 - 已应用初始变换
      const nodeGroup = container.append('g')
        .attr('class', 'nodes')
        .attr('transform', `translate(${xOffset}, ${yOffset})`);
      
      // 正常绘制连接线和节点
      // ...连接线和节点的渲染代码...
      
      // 所有渲染完毕后，如果需要缩放，一次性应用缩放变换
      // 检查是否来自applyFilters方法 - 通过检查currentTransform是否存在
      if (this.svg && this.zoom && scaleFactor < 1.0 && !this._isRestoringTransform) {
        // 缩放时添加额外边距，避免节点太靠近边缘
        const finalTransform = d3.zoomIdentity
          .translate(xOffset * scaleFactor + 30, yOffset * scaleFactor + 30)
          .scale(scaleFactor * 0.95); // 稍微降低缩放以增加边距
          
        // 延迟应用变换，确保DOM已完全渲染
        setTimeout(() => {
          this.svg.call(this.zoom.transform, finalTransform);
        }, 100);
      }
      
      // 创建箭头标记
      container.append('defs').append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#999');
           
      // 绘制连接线 - 注意使用曲线路径
      linkGroup.selectAll('path')
        .data(treeData.links())
        .join('path')
        .attr('class', d => `link ${d.target.data.type || ''}`)
        .attr('d', d => {
          // 创建平滑曲线，从源节点到目标节点
          return d3.linkHorizontal()
            .x(d => d.y) // 注意：D3树布局中，y代表水平位置，x代表垂直位置
            .y(d => d.x)({
              source: d.source,
              target: d.target
            });
        })
        .attr('stroke', d => d.target.data.type === 'session' ? '#555' : this.getEdgeColor(d.target.data.type))
        .attr('stroke-width', 1.5)
        .attr('fill', 'none')
        .attr('marker-end', 'url(#arrow)');
      
      // 绘制节点
      const node = nodeGroup.selectAll('.node')
        .data(treeData.descendants())
        .join('g')
        .attr('class', d => {
          // 合并多个类名：基本节点类、类型类、关闭状态类
          let classes = `node ${d.data.type || ''}`;
          
          // 添加关闭状态
          if (d.data.isClosed) {
            classes += ' closed';
          }
          
          // 添加根节点标记
          if (d.data.isRoot) {
            classes += ' root';
          }
          
          // 添加跟踪页面标记
          if (this.isTrackingPage && this.isTrackingPage(d.data)) {
            classes += ' tracking';
          }
          
          return classes;
        })
        .attr('transform', d => `translate(${d.y},${d.x})`); // 注意x和y的使用
      
      // 会话节点特殊处理
      node.filter(d => d.data.id === 'session-root')
        .append('rect')
        .attr('width', 120)
        .attr('height', 40)
        .attr('x', -60)
        .attr('y', -20)
        .attr('rx', 8)
        .attr('ry', 8)
        .attr('fill', '#444')
        .attr('stroke', '#222');
      
      // 普通节点
      node.filter(d => d.data.id !== 'session-root')
        .append('circle')
        .attr('r', 20)
        .attr('fill', d => this.getNodeColor(d.data.type))
        .attr('stroke', '#333')
        .attr('stroke-width', 1.5);
      
      // 添加图标
      node.filter(d => d.data.id !== 'session-root')
        .append('image')
        .attr('xlink:href', d => d.data.favicon || chrome.runtime.getURL('images/logo-48.png'))
        .attr('x', -8)
        .attr('y', -8)
        .attr('width', 16)
        .attr('height', 16)
        .attr('class', d => d.data.favicon ? '' : 'default-icon')
        .on('error', function() {
          // 图像加载失败时替换为默认图标
          d3.select(this)
            .attr('xlink:href', chrome.runtime.getURL('images/logo-48.png'))
            .classed('default-icon', true);
        });
      // 添加节点标题
      node.append('title')
        .text(d => d.data.title || d.data.url || '未命名节点');
      
      // 为会话节点添加文字标签
      node.filter(d => d.data.id === 'session-root')
        .append('text')
        .attr('dy', '.35em')
        .attr('text-anchor', 'middle')
        .attr('fill', 'white')
        .text(d => {
          const date = new Date(this.currentSession.startTime);
          return date.toLocaleDateString();
        });
      
      // 为普通节点添加简短标签
      node.filter(d => d.data.id !== 'session-root')
        .append('text')
        .attr('dy', 35)
        .attr('text-anchor', 'middle')
        .attr('fill', '#333')
        .style('font-size', '12px')
        .text(d => {
          if (!d.data.title) return '';
          return d.data.title.length > 15 ? d.data.title.substring(0, 12) + '...' : d.data.title;
        });

      // 为有被过滤子节点的节点添加标记
      node.filter(d => d.data.hasFilteredChildren)
        .append('circle')
        .attr('r', 6)
        .attr('cx', 18)
        .attr('cy', -18)
        .attr('fill', '#ff5722')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('class', 'filtered-indicator')
        .append('title')
        .text(d => `包含${d.data.filteredChildrenCount}个被过滤的子节点`);

      // 添加交互
      node.on('click', (event, d) => {
        if (d.data.id === 'session-root') return;
        
        // 显示节点详情
        this.showNodeDetails(d.data);
        
        // 高亮节点
        container.selectAll('.node')
          .classed('highlighted', false);
        
        d3.select(event.currentTarget)
          .classed('highlighted', true);
      });
    }
    
    /**
     * 渲染时间线布局
     */
    renderTimelineLayout(container, timelineSvg, nodes, links, width, height) {
      // 清除现有内容以避免重复
      timelineSvg.selectAll("*").remove();
      
      // 先添加背景矩形，确保覆盖整个时间线区域
      timelineSvg.append('rect')
        .attr('class', 'timeline-background')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('x', 0)
        .attr('y', 0)
        .attr('fill', '#333');
      
      // 绘制时间轴组
      const timeAxisGroup = timelineSvg.append('g')
        .attr('class', 'time-axis-group')
        .attr('transform', 'translate(0, 0)');
    
      if (nodes.length > 0) {
        // 计算时间范围
        let minTime = Math.min(...nodes.map(node => node.timestamp));
        let maxTime = Math.max(...nodes.map(node => node.timestamp));
        let timeRange = maxTime - minTime;
        
        // 确保有最小时间范围，避免除零错误
        if (timeRange < 60000) { // 小于1分钟
          const mid = (minTime + maxTime) / 2;
          minTime = mid - 30000; // 扩展30秒
          maxTime = mid + 30000; // 扩展30秒
          timeRange = 60000;
        }
        
        // 扩展时间范围以充满宽度
        const extraPercentage = 0.2; // 两侧各增加20%
        minTime -= timeRange * extraPercentage;
        maxTime += timeRange * extraPercentage;
        
        // 创建时间刻度 - 覆盖整个宽度
        const timeScale = d3.scaleTime()
          .domain([new Date(minTime), new Date(maxTime)])
          .range([0, width]);
        
        // 计算节点位置
        nodes.forEach(node => {
          // X坐标基于时间
          node.renderX = timeScale(new Date(node.timestamp));
          
          // Y坐标基于类型，分层展示
          let yBase = 0;
          switch (node.type) {
            case 'link_click': yBase = height * 0.25; break;
            case 'address_bar': yBase = height * 0.45; break;
            case 'form_submit': yBase = height * 0.65; break;
            default: yBase = height * 0.4;
          }
          
          // 添加一些随机偏移避免重叠
          node.renderY = yBase + (Math.random() - 0.5) * height * 0.25;
        });
        
        // 创建箭头定义
        container.append('defs').append('marker')
          .attr('id', 'arrowhead')
          .attr('viewBox', '-0 -5 10 10')
          .attr('refX', 20)
          .attr('refY', 0)
          .attr('orient', 'auto')
          .attr('markerWidth', 6)
          .attr('markerHeight', 6)
          .append('path')
          .attr('d', 'M0,-5L10,0L0,5')
          .attr('fill', '#999');
        
        // 绘制边
        const linkElements = container.append('g')
          .selectAll('.edge')
          .data(links)
          .enter()
          .append('path')
          .attr('class', d => `edge ${d.type}`)
          .attr('marker-end', 'url(#arrowhead)')
          .attr('d', d => {
            const sourceNode = this.nodeMap ? this.nodeMap.get(d.source) : nodes.find(n => n.id === d.source);
            const targetNode = this.nodeMap ? this.nodeMap.get(d.target) : nodes.find(n => n.id === d.target);
                      
            if (!sourceNode || !targetNode) return '';
            
            const source = {x: sourceNode.renderX, y: sourceNode.renderY};
            const target = {x: targetNode.renderX, y: targetNode.renderY};
            
            if (d.type === 'history_back' || d.type === 'history_forward') {
              // 弯曲的线条
              return `M${source.x},${source.y} 
                      C${source.x + (target.x - source.x) * 0.5},${source.y} 
                        ${source.x + (target.x - source.x) * 0.5},${target.y} 
                        ${target.x},${target.y}`;
            } else {
              // 直线
              return `M${source.x},${source.y} L${target.x},${target.y}`;
            }
          })
          .attr('stroke', d => this.getEdgeColor(d.type))
          .attr('stroke-width', 1.5)
          .attr('fill', 'none');
        
        // 绘制节点
        const nodeElements = container.append('g')
          .selectAll('.node')
          .data(nodes)
          .enter()
          .append('g')
          .attr('class', d => {
            // 组合多个类名
            let classes = `node ${d.type}`;
            
            // 添加关闭状态
            if (d.isClosed) {
              classes += ' closed';
            }
            
            // 添加跟踪标记
            if (this.isTrackingPage(d)) {
              classes += ' tracking';
            }
            
            return classes;
          })
          .attr('transform', d => `translate(${d.renderX},${d.renderY})`);
        
        nodeElements.append('circle')
          .attr('r', 20)
          .attr('fill', d => this.getNodeColor(d.type));
        
        nodeElements.append('title')
          .text(d => d.title || d.url);
        
        nodeElements.filter(d => d.favicon)
          .append('image')
          .attr('xlink:href', d => d.favicon)
          .attr('x', -8)
          .attr('y', -8)
          .attr('width', 16)
          .attr('height', 16)
          .on('error', function() {
            // 图像加载失败时替换为默认图标
            d3.select(this)
              .attr('xlink:href', chrome.runtime.getURL('images/logo-48.png'))
              .classed('default-icon', true);
          });
        
        nodeElements.append('text')
          .attr('dy', 35)
          .attr('text-anchor', 'middle')
          .attr('fill', '#fff')
          .style('font-size', '12px')
          .text(d => d.title ? d.title.substring(0, 10) + '...' : '');
        
        // 添加交互
        nodeElements.on('click', (event, d) => {
          this.showNodeDetails(d);
          
          container.selectAll('.node')
            .classed('highlighted', false);
          
          d3.select(event.currentTarget)
            .classed('highlighted', true);
        });
        
        // 绘制时间轴 - 使用整个宽度
        const xAxis = d3.axisBottom(timeScale)
          .ticks(15)
          .tickFormat(d3.timeFormat('%H:%M:%S'))
          .tickSize(6) 
          .tickPadding(2);
        
        // 渲染时间轴 - 确保从左到右完全对齐
        timeAxisGroup.append('g')
          .attr('class', 'time-axis')
          .attr('transform', `translate(0, 20)`)
          .call(xAxis)
          .call(g => {
            // 设置轴线样式
            g.select('.domain')
              .attr('stroke', '#aaa')
              .attr('stroke-width', 1)
              .attr('opacity', 0.7);
            
            // 设置刻度线样式
            g.selectAll('.tick line')
              .attr('stroke', '#aaa')
              .attr('y2', 6);
            
            // 设置文字样式
            g.selectAll('.tick text')
              .attr('fill', '#eee')
              .attr('font-size', '10px');
          });
        
        // 添加网格线以提高可读性
        timeAxisGroup.append('g')
          .attr('class', 'grid')
          .attr('transform', `translate(0, 0)`)
          .call(d3.axisBottom(timeScale)
            .tickSize(40)
            .tickFormat('')
            .ticks(30))
          .call(g => {
            g.select('.domain').remove();
            g.selectAll('.tick line')
              .attr('stroke', '#555')
              .attr('stroke-width', 0.5)
              .attr('opacity', 0.3);
          });
        // 在renderTimelineLayout方法末尾的setTimeout部分添加动态居中计算
        setTimeout(() => {
          try {
            // 如果正在恢复变换状态，跳过自动居中
            if (this._isRestoringTransform) {
              console.log('跳过时间线自动居中，正在恢复用户设置的变换');
              return;
            }
            // 如果有节点，计算边界以实现真正的居中
            if (nodes.length > 0) {
              // 获取所有节点的位置信息
              const xValues = nodes.map(node => node.renderX);
              const yValues = nodes.map(node => node.renderY);
              
              // 计算实际内容边界
              const minX = Math.min(...xValues);
              const maxX = Math.max(...xValues);
              const minY = Math.min(...yValues);
              const maxY = Math.max(...yValues);
              
              // 计算内容尺寸，增加边距使视觉更平衡
              const contentWidth = maxX - minX + 80; // 增加水平边距
              const contentHeight = maxY - minY + 80; // 增加垂直边距
              
              console.log('时间线节点边界:', {minX, maxX, minY, maxY, contentWidth, contentHeight});
              
              // 时间线高度使用固定值40
              const timelineHeight = 40;
              
              // 计算更精确的缩放因子 - 考虑可用空间
              const availableHeight = height - timelineHeight; // 减去时间线高度后的可用空间
              
              const scaleFactor = Math.min(
                (width * 0.9) / Math.max(contentWidth, 1), // 水平方向留出10%边距
                (availableHeight * 0.9) / Math.max(contentHeight, 1), // 垂直方向留出10%边距
                0.9 // 最大缩放限制
              );
              
              // 计算更精确的中心点 - 关键改进
              // 水平中心点：容器中心 + 适当偏移
              const centerX = (width - contentWidth * scaleFactor) / 2 + (20 - minX) * scaleFactor;
              
              // 垂直中心点：考虑时间线，计算可用空间的中心
              const centerY = (availableHeight - contentHeight * scaleFactor) / 2 + (20 - minY) * scaleFactor;
              
              // 创建并应用变换
              const transform = d3.zoomIdentity
                .translate(centerX, centerY)
                .scale(scaleFactor);
              
              if (this.svg && this.zoom) {
                console.log('应用时间线居中变换:', {centerX, centerY, scaleFactor, availableHeight});
                this.svg.call(this.zoom.transform, transform);
              }
            } else {
              // 没有节点，使用默认变换
              const transform = d3.zoomIdentity
                .translate(width / 2, height / 3)
                .scale(0.9);
              
              if (this.svg && this.zoom) {
                this.svg.call(this.zoom.transform, transform);
              }
            }
          } catch (err) {
            console.error('应用时间线居中失败:', err);
          }
        }, 150);  // 延时确保DOM完全渲染   
      } else {
        // 没有节点时显示默认时间线
        const now = new Date();
        const sixHoursMs = 6 * 60 * 60 * 1000;
        const minTime = now.getTime() - sixHoursMs;
        const maxTime = now.getTime() + sixHoursMs;
        
        const timeScale = d3.scaleTime()
          .domain([new Date(minTime), new Date(maxTime)])
          .range([0, width]);
        
        const xAxis = d3.axisBottom(timeScale)
          .ticks(15)
          .tickFormat(d3.timeFormat('%H:%M:%S'))
          .tickSize(6)
          .tickPadding(2);
        
        timeAxisGroup.append('g')
          .attr('class', 'time-axis')
          .attr('transform', `translate(0, 20)`)
          .call(xAxis)
          .call(g => {
            g.select('.domain')
              .attr('stroke', '#aaa')
              .attr('stroke-width', 1)
              .attr('opacity', 0.7);
            
            g.selectAll('.tick text')
              .attr('fill', '#999')
              .attr('font-size', '10px');
          });
          
        // 添加提示文本
        timeAxisGroup.append('text')
          .attr('x', width / 2)
          .attr('y', 20)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', '#999')
          .text('无时间数据可显示');
      }
    }
    
    /**
     * 获取节点颜色
     */
    getNodeColor(type) {
      switch(type) {
        case 'link_click': return '#7cb9e8';
        case 'address_bar': return '#c0e8a5';
        case 'form_submit': return '#f5d76e';
        case 'reload': return '#bcbcbc';
        case 'history_back':
        case 'history_forward': return '#d3a4f9';
        case 'redirect': return '#ff9966';
        case 'javascript': return '#66ccff';
        default: return '#aaaaaa';
      }
    }

    /**
     * 获取边的颜色
     */
    getEdgeColor(type) {
      const colors = {
        'link_click': '#7cb9e8',
        'address_bar': '#c0e8a5',
        'form_submit': '#f5d76e',
        'reload': '#bcbcbc',
        'history_back': '#d3a4f9',
        'history_forward': '#d3a4f9',
        'redirect': '#ff9966',
        'javascript': '#66ccff',
        'generated': '#aaaaaa', // 为生成的边添加颜色
        'session_link': '#555555'
      };
      
      return colors[type] || '#999999';
    }

    /**
     * 显示节点详情
     */
    showNodeDetails(node) {
      if (!node) {
        document.getElementById('node-details').innerHTML = '<p>请选择一个节点查看详情</p>';
        return;
      }
      const detailsPanel = document.getElementById('node-details');
      if (!detailsPanel) return;
      
      // 格式化时间
      const formatTime = (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleString();
      };
      
      // 截断URL以便更好地显示，不使用复杂的展开/折叠
      const truncateUrl = (url, maxLength = 60) => {
        if (!url || url.length <= maxLength) return url;
        
        try {
          // 解析URL，分别处理基本部分和查询参数
          const urlObj = new URL(url);
          const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
          
          // 如果没有查询参数或整个URL较短，直接截断
          if (!urlObj.search || url.length <= maxLength) {
            return url.length > maxLength ? url.substring(0, maxLength) + '...' : url;
          }
          
          // 对于有查询参数的URL，保留基本URL，截断查询参数
          const queryLength = maxLength - baseUrl.length - 5; // 为"?..."预留5个字符
          if (queryLength <= 0) {
            // 基本URL已经很长，直接截断
            return baseUrl.substring(0, maxLength - 3) + '...';
          } else {
            // 保留基本URL，截断查询参数
            return baseUrl + '?' + urlObj.search.substring(1, queryLength) + '...';
          }
        } catch (e) {
          // 如果URL格式不正确，简单截断
          return url.substring(0, maxLength - 3) + '...';
        }
      };
      const html = `
        <div class="details-header">
          <h3>${node.title || '未命名页面'}</h3>
          <button id="close-details" class="close-btn">&times;</button>
        </div>
        <!-- 新增节点ID信息 -->
        <div class="detail-row">
          <span class="label">节点ID:</span>
          <span class="value monospace">${node.id}</span>
        </div>
        <div class="detail-row">
          <span class="label">URL:</span>
          <a href="${node.url}" target="_blank" rel="noopener" class="url-link">${truncateUrl(node.url)}</a>
        </div>
        <div class="detail-row">
          <span class="label">访问时间:</span>
          <span>${formatTime(node.timestamp)}</span>
        </div>
        <div class="detail-row">
          <span class="label">导航类型:</span>
          <span class="tag type-${node.type}">${this.getNavigationTypeLabel(node.type)}</span>
        </div>
        ${node.loadTime ? `
        <div class="detail-row">
          <span class="label">加载时间:</span>
          <span>${(node.loadTime/1000).toFixed(2)}秒</span>
        </div>` : ''}
        ${node.activeTime ? `
        <div class="detail-row">
          <span class="label">活跃时间:</span>
          <span>${this.formatDuration(node.activeTime)}</span>
        </div>` : ''}
        <div class="actions">
          <button id="visit-page" class="btn">访问页面</button>
          <button id="find-similar" class="btn">查找相似</button>
        </div>
      `;
      
      detailsPanel.innerHTML = html;
      
      // 添加事件处理器
      document.getElementById('visit-page')?.addEventListener('click', () => {
        chrome.tabs.create({ url: node.url });
      });
      
      document.getElementById('find-similar')?.addEventListener('click', () => {
        this.findSimilarNodes(node.url);
      });
      
      // 添加关闭按钮事件处理
      document.getElementById('close-details')?.addEventListener('click', () => {
        this.hideNodeDetails();
      });
      
      // 显示详情面板
      detailsPanel.classList.add('visible');
    }

    /**
     * 隐藏节点详情
     */
    hideNodeDetails() {
      const detailsPanel = document.getElementById('node-details');
      if (detailsPanel) {
        detailsPanel.classList.remove('visible');
      }
    }

    /**
     * 调试功能：检查数据状态
     */
    debugCheckData() {
      console.group('📊 数据状态检查');
      
      // 检查会话数据
      console.log('当前会话:', this.currentSession);
      if (this.currentSession) {
        console.log('会话ID:', this.currentSession.id);
        console.log('会话开始时间:', new Date(this.currentSession.startTime).toLocaleString());
        console.log('会话结束时间:', this.currentSession.endTime ? new Date(this.currentSession.endTime).toLocaleString() : '活跃中');
      }
      
      // 检查节点和边
      console.log('节点数量:', this.nodes ? this.nodes.length : 0);
      console.log('边数量:', this.edges ? this.edges.length : 0);
      
      // 样本数据
      if (this.nodes && this.nodes.length > 0) {
        console.log('节点样本:', this.nodes.slice(0, 3));
      }
      
      if (this.edges && this.edges.length > 0) {
        console.log('边样本:', this.edges.slice(0, 3));
      }
      
      // 检查过滤器状态
      console.log('过滤器状态:', this.filters);
      
      // 尝试过滤后的节点数
      const visibleNodes = this.nodes ? this.filterNodes() : [];
      const visibleLinks = visibleNodes.length > 0 ? this.filterEdges(visibleNodes) : [];
      console.log('过滤后节点数:', visibleNodes.length);
      console.log('过滤后边数:', visibleLinks.length);
      
      console.groupEnd();
      
      // 显示弹窗反馈
      const message = `
        数据检查完成！请查看控制台。
        
        ▶ 当前会话: ${this.currentSession ? '存在' : '不存在'}
        ▶ 总节点数: ${this.nodes ? this.nodes.length : 0}
        ▶ 总边数: ${this.edges ? this.edges.length : 0}
        ▶ 过滤后节点: ${visibleNodes.length}
        ▶ 过滤后边: ${visibleLinks.length}
      `;
      
      alert(message);
    }
    
    /**
     * 调试功能：检查DOM状态
     */
    debugCheckDOM() {
      console.group('🔍 DOM状态检查');
      
      // 检查关键元素
      const elements = [
        'visualization-container',
        'visualization',
        'loading',
        'no-data',
        'status-text',
        'node-details',
        'session-selector'
      ];
      
      elements.forEach(id => {
        const el = document.getElementById(id);
        console.log(`${id}: ${el ? '✅ 找到' : '❌ 未找到'}`);
        
        if (el) {
          console.log(`- 尺寸: ${el.clientWidth}x${el.clientHeight}`);
          console.log(`- 可见性: ${getComputedStyle(el).display}`);
        }
      });
      
      // 检查可视化容器尺寸
      const container = document.getElementById('visualization-container');
      if (container) {
        console.log('可视化容器样式:');
        console.log('- width:', getComputedStyle(container).width);
        console.log('- height:', getComputedStyle(container).height);
        console.log('- position:', getComputedStyle(container).position);
        console.log('- display:', getComputedStyle(container).display);
      }
      
      // 检查SVG是否存在
      const svg = container?.querySelector('svg');
      console.log('SVG元素:', svg ? '✅ 存在' : '❌ 不存在');
      if (svg) {
        console.log('- SVG尺寸:', svg.clientWidth, 'x', svg.clientHeight);
        console.log('- SVG子元素数:', svg.childNodes.length);
      }
      
      // 修复错误：安全地检查重叠元素
      if (container) {
        const rect = container.getBoundingClientRect();
        const overlappingElements = document.elementsFromPoint(
          rect.left + rect.width / 2, 
          rect.top + rect.height / 2
        );
        
        console.log('位于可视化中心的元素堆栈:');
        overlappingElements.forEach(el => {
          // 安全地获取类名
          let classStr = '';
          if (el.classList && el.classList.length) {
            // 使用classList而不是className
            classStr = `.${Array.from(el.classList).join('.')}`;
          } else if (typeof el.className === 'string') {
            // 如果className是字符串
            classStr = el.className ? `.${el.className.replace(/\s+/g, '.')}` : '';
          } else if (el.className && el.className.baseVal !== undefined) {
            // SVG元素特殊处理
            classStr = el.className.baseVal ? `.${el.className.baseVal.replace(/\s+/g, '.')}` : '';
          }
          
          console.log('- ', el.tagName, el.id ? `#${el.id}` : '', classStr);
        });
      }
      
      console.groupEnd();
      
      // 显示弹窗反馈
      const container_status = container ? 
        `找到 (${container.clientWidth}x${container.clientHeight})` : 
        '未找到';
        
      const svg_status = svg ? 
        `找到 (${svg.childNodes.length} 个子元素)` : 
        '未找到';
        
      const loading_el = document.getElementById('loading');
      const no_data_el = document.getElementById('no-data');
      
      const message = `
        DOM检查完成！请查看控制台。
        
        ▶ 可视化容器: ${container_status}
        ▶ SVG元素: ${svg_status}
        ▶ 加载中元素: ${loading_el ? '可见性=' + getComputedStyle(loading_el).display : '未找到'}
        ▶ 无数据元素: ${no_data_el ? '可见性=' + getComputedStyle(no_data_el).display : '未找到'}
      `;
      
      alert(message);
    }
    
    /**
     * 调试功能：测试渲染基本图形
     */
    debugTestRender() {
      try {
        const container = document.getElementById('visualization-container');
        if (!container) {
          alert('错误: 找不到visualization-container元素');
          return;
        }
        
        // 清除容器内容
        container.innerHTML = '';
        
        // 隐藏无数据提示
        const noDataEl = document.getElementById('no-data');
        if (noDataEl) noDataEl.style.display = 'none';
        
        console.log('开始测试渲染，容器尺寸:', container.clientWidth, 'x', container.clientHeight);
        
        // 创建测试SVG
        const svg = d3.select(container)
          .append('svg')
          .attr('width', container.clientWidth || 800)
          .attr('height', container.clientHeight || 600)
          .attr('viewBox', [0, 0, container.clientWidth || 800, container.clientHeight || 600])
          .style('background-color', '#FFF')
          .style('border', '1px dashed #ff0');
        
        // 添加一些测试图形
        // 1. 矩形
        svg.append('rect')
          .attr('x', 50)
          .attr('y', 50)
          .attr('width', 100)
          .attr('height', 100)
          .attr('fill', 'red');
        
        // 2. 圆形
        svg.append('circle')
          .attr('cx', 250)
          .attr('cy', 100)
          .attr('r', 50)
          .attr('fill', 'blue');
        
        // 3. 文本
        svg.append('text')
          .attr('x', 400)
          .attr('y', 100)
          .attr('fill', 'white')
          .text('测试渲染');
        
        // 4. 线
        svg.append('line')
          .attr('x1', 50)
          .attr('y1', 200)
          .attr('x2', 450)
          .attr('y2', 200)
          .attr('stroke', 'green')
          .attr('stroke-width', 3);
        
        // 5. 如果有节点数据，渲染一个简单节点
        if (this.nodes && this.nodes.length > 0) {
          const sampleNodes = this.nodes.slice(0, 5);
          
          svg.selectAll('g.test-node')
            .data(sampleNodes)
            .enter()
            .append('g')
            .attr('class', 'test-node')
            .attr('transform', (d, i) => `translate(${100 + i * 150}, 300)`)
            .each(function(d) {
              const g = d3.select(this);
              
              // 节点圆形
              g.append('circle')
                .attr('r', 30)
                .attr('fill', '#f90');
              
              // 节点文字
              g.append('text')
                .attr('text-anchor', 'middle')
                .attr('dy', '0.3em')
                .attr('fill', 'white')
                .text(d => d.title ? d.title.substring(0, 10) : '无标题');
            });
        }
        
        console.log('测试渲染完成');
        alert('测试渲染完成！请检查图形是否显示（红色矩形、蓝色圆形、绿线和文字）。');
      } catch (error) {
        console.error('测试渲染失败:', error);
        alert('测试渲染失败: ' + error.message);
      }
    }
    
    /**
     * 调试功能：清除所有数据
     */
    async debugClearData() {
      if (!confirm('警告: 这将删除所有导航数据！确定要继续吗？')) {
        return;
      }
      
      try {
        this.showLoading();
        document.getElementById('status-message').textContent = '清除数据中...';
        
        // 发送清除数据请求到后台
        const response = await this.sendMessage('clearAllData');
        
        console.log('清除数据响应:', response);
        
        if (response && response.success) {
          // 重置实例变量
          this.sessions = [];
          this.currentSession = null;
          this.nodes = [];
          this.edges = [];
          
          // 清除UI
          document.getElementById('visualization-container').innerHTML = '';
          document.getElementById('session-selector').innerHTML = '<option value="">暂无会话</option>';
          
          // 更新统计信息
          this.resetStatistics();
          
          // 显示成功消息
          this.showNoData('数据已清除');
          //alert('所有数据已成功清除！');
        } else {
          throw new Error(response ? response.error : '清除数据失败');
        }
      } catch (error) {
        console.error('清除数据失败:', error);
        this.showNoData(`清除数据失败: ${error.message}`);
        alert('清除数据出错: ' + error.message);
      } finally {
        this.hideLoading();
      }
    }

    /**
     * 从URL中提取标题
     */
    extractTitle(url) {
      try {
        if (!url) return '未知页面';
        
        // 解析URL
        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch (e) {
          // 处理无效URL
          return url.substring(0, 30);
        }
        
        // 获取不带www的主机名
        const hostname = parsedUrl.hostname.replace(/^www\./, '');
        
        // 如果URL只有域名，直接返回
        if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
          return hostname;
        }
        
        // 尝试从路径中提取有意义的信息
        const pathSegments = parsedUrl.pathname.split('/').filter(segment => segment);
        
        // 如果路径为空，返回域名
        if (pathSegments.length === 0) {
          return hostname;
        }
        
        // 获取最后一个路径段，通常包含页面名称
        let lastSegment = pathSegments[pathSegments.length - 1];
        
        // 清理最后一个段中的文件扩展名和其他内容
        lastSegment = lastSegment
          .replace(/\.(html|htm|php|aspx|jsp|asp)$/, '')  // 移除文件扩展名
          .replace(/[-_]/g, ' ')  // 将连字符和下划线替换为空格
          .replace(/\b\w/g, c => c.toUpperCase());  // 首字母大写
        
        // 如果段为空或只有数字，使用上一级路径
        if (lastSegment.length === 0 || /^\d+$/.test(lastSegment)) {
          if (pathSegments.length > 1) {
            lastSegment = pathSegments[pathSegments.length - 2]
              .replace(/[-_]/g, ' ')
              .replace(/\b\w/g, c => c.toUpperCase());
          }
        }
        
        // 组合域名和路径段以创建描述性标题
        if (lastSegment && lastSegment.length > 0 && lastSegment !== 'Index') {
          return `${hostname} › ${lastSegment}`;
        } else {
          return hostname;
        }
      } catch (error) {
        console.error('提取标题失败:', error);
        return url.substring(0, 30) || '未知页面';
      }
    }
    
    /**
     * 获取导航类型的标签
     */
    getNavigationTypeLabel(type) {
      const labels = {
        'link_click': '链接点击',
        'address_bar': '地址栏输入',
        'form_submit': '表单提交',
        'reload': '页面刷新',
        'history_back': '返回上页',
        'history_forward': '前进',
        'redirect': '重定向',
        'javascript': 'JS导航',
        'session': '会话',
        'generated': '推断连接',
        'session_link': '会话链接',
        'unknown': '未知类型'
      };
      
      return labels[type] || type;
    }
    
    /**
     * 格式化时间段
     */
    formatDuration(ms) {
      if (!ms) return '0秒';
      
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours}小时${minutes % 60}分钟`;
      }
      
      if (minutes > 0) {
        return `${minutes}分钟${seconds % 60}秒`;
      }
      
      return `${seconds}秒`;
    }
    /**
     * 更新会话选择器下拉列表
     */
    updateSessionSelector() {
      const selector = document.getElementById('session-selector');
      if (!selector) {
        console.warn('找不到会话选择器元素');
        return;
      }
      
      // 清空现有选项
      selector.innerHTML = '';
      
      // 如果没有会话，显示提示
      if (!this.sessions || this.sessions.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '暂无会话';
        option.disabled = true;
        option.selected = true;
        selector.appendChild(option);
        return;
      }
      
      // 添加会话选项
      this.sessions.forEach(session => {
        const option = document.createElement('option');
        option.value = session.id;
        
        // 优化格式化会话时间
        const date = new Date(session.startTime);
        
        option.textContent = session.title || `${date}`;
        
        selector.appendChild(option);
      });
      
      // 默认选择第一个会话
      if (this.sessions.length > 0) {
        selector.value = this.sessions[0].id;
      }
      
      console.log(`会话选择器已更新，共${this.sessions.length}个选项`);
    }

    /**
     * 标记有被过滤子节点的父节点
     * 在renderVisualization之前调用
     */
    markNodesWithFilteredChildren() {
      // 重置所有节点的标记
      this.nodes.forEach(node => {
        node.hasFilteredChildren = false;
        node.filteredChildrenCount = 0;
      });
      
      // 创建可见节点ID集合
      const visibleNodes = this.filterNodes();
      const visibleNodeIds = new Set(visibleNodes.map(node => node.id));
      
      // 找出所有节点，检查它们是否被过滤掉了
      this.nodes.forEach(node => {
        if (!visibleNodeIds.has(node.id)) {
          // 节点被过滤了，标记它的父节点
          const parentNode = node.parentId && this.nodeMap ? 
                              this.nodeMap.get(node.parentId) : 
                              this.nodes.find(n => n.id === node.parentId);
          if (parentNode) {
            parentNode.hasFilteredChildren = true;
            parentNode.filteredChildrenCount = (parentNode.filteredChildrenCount || 0) + 1;
          }
        }
      });
    }
  }
  // 等待DOM加载完成后初始化可视化
  document.addEventListener('DOMContentLoaded', () => {
    // 创建可视化实例
    window.visualizer = new NavigationVisualizer();
  });
})();
