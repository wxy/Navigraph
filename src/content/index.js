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
        closed: true,
        typeLink: true,
        typeAddress: true,
        typeForm: true,
        typeJs: true
      };
      
      this.initialize();
    }
    
    /**
     * 初始化可视化
     */
    async initialize() {
      try {
        // 设置事件监听器
        this.setupEventListeners();
        
        // 创建SVG
        this.createSvg();
        
        // 加载会话数据
        await this.loadSessions();
        
        // 如果有会话数据，加载当前会话
        if (this.sessions.length > 0) {
          await this.loadCurrentSession();
        } else {
          this.showNoData();
        }
        
      } catch (error) {
        console.error('初始化可视化失败:', error);
        this.hideLoading();
      }
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
    }
    
    /**
     * 创建SVG
     */
    createSvg() {
      const container = document.getElementById('visualization');
      const width = container.clientWidth;
      const height = container.clientHeight;
      
      this.svg = d3.select('#visualization')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .call(d3.zoom().on('zoom', (event) => {
          this.svg.select('g').attr('transform', event.transform);
        }));
      
      this.svg.append('g');
    }
    
    // ... 其他方法保持不变 ...
    
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
      
      // 重新渲染
      this.renderVisualization();
    }
    
    /**
     * 应用过滤器
     */
    applyFilters() {
      this.renderVisualization();
    }
    
    /**
     * 过滤节点
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
        
        return true;
      });
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
      const container = document.getElementById('visualization');
      const width = container.clientWidth;
      const height = container.clientHeight;
      
      this.svg.attr('width', width)
        .attr('height', height);
      
      this.renderVisualization();
    }
    
    /**
     * 显示加载中状态
     */
    showLoading() {
      if (this.loading) {
        this.loading.style.display = 'flex';
      }
      
      if (this.noData) {
        this.noData.style.display = 'none';
      }
    }
    
    /**
     * 隐藏加载中状态
     */
    hideLoading() {
      if (this.loading) {
        this.loading.style.display = 'none';
      }
    }
    
    /**
     * 显示无数据状态
     */
    showNoData() {
      this.hideLoading();
      
      if (this.noData) {
        this.noData.style.display = 'flex';
      }
    }

    /**
     * 加载会话列表
     */
    async loadSessions() {
      this.showLoading();
      console.log('开始加载会话列表...');
      
      try {
        // 通过Chrome扩展API获取会话列表
        console.log('发送getSessions消息到后台...');
        const response = await chrome.runtime.sendMessage({
          action: 'getSessions'
        });
        
        console.log('收到后台响应:', response);
        
        if (response && response.success && response.data) {
          this.sessions = response.data;
          
          console.log(`成功加载${this.sessions.length}个会话`);
          
          // 更新会话选择器
          const selector = document.getElementById('session-selector');
          selector.innerHTML = '';
          
          if (this.sessions.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '无会话数据';
            selector.appendChild(option);
            this.showNoData();
          } else {
            this.sessions.forEach(session => {
              const option = document.createElement('option');
              option.value = session.id;
              
              const date = new Date(session.startTime);
              const dateStr = date.toLocaleDateString();
              const timeStr = date.toLocaleTimeString();
              
              option.textContent = `${dateStr} ${timeStr}`;
              selector.appendChild(option);
            });
            
            // 预选最新的会话
            selector.value = this.sessions[0].id;
          }
          
          this.hideLoading();
        } else {
          console.error('后台返回无效响应:', response);
          throw new Error('无法加载会话');
        }
      } catch (error) {
        console.error('加载会话列表失败:', error);
        
        // 显示更友好的错误信息
        const selector = document.getElementById('session-selector');
        selector.innerHTML = '<option value="">加载会话失败</option>';
        
        document.getElementById('status-text').textContent = '无法连接到后台服务';
        this.showNoData();
        
        // 如果是通信错误，尝试重新连接
        if (error.message.includes('Could not establish connection')) {
          console.log('检测到通信错误，5秒后重试...');
          setTimeout(() => this.loadSessions(), 5000);
        }
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
      this.showLoading();
      document.getElementById('status-text').textContent = '加载会话数据...';
      
      try {
        console.log(`尝试加载会话: ${sessionId}`);
        
        // 通过Chrome扩展API获取会话详情
        const response = await chrome.runtime.sendMessage({ 
          action: 'getSessionDetails', 
          sessionId 
        });
        
        console.log('getSessionDetails响应:', response);
        
        // 修改这里：使用response.data而不是response.session
        if (response && response.success && response.data) {
          console.log('会话数据获取成功, 节点数:', 
                      response.data.records ? Object.keys(response.data.records).length : 0);
          
          this.currentSession = response.data;
          
          // 处理会话数据为可视化格式
          this.processSessionData();
          
          // 更新会话选择器
          document.getElementById('session-selector').value = sessionId;
          
          // 更新统计信息
          this.updateStatistics();
          
          // 渲染可视化
          this.renderVisualization();
          
          document.getElementById('status-text').textContent = 
            `已加载会话: ${new Date(this.currentSession.startTime).toLocaleString()}`;
        } else {
          console.error('获取会话详情失败, 响应:', response);
          throw new Error(response && response.error ? response.error : '获取会话详情失败');
        }
      } catch (error) {
        console.error('加载会话详情失败:', error);
        document.getElementById('status-text').textContent = `加载会话失败: ${error.message}`;
        this.showNoData();
      }
      
      this.hideLoading();
    }
    
    /**
     * 处理会话数据为可视化格式
     */
    processSessionData() {
      if (!this.currentSession) return;
      
      // 转换导航记录为节点
      this.nodes = Object.values(this.currentSession.records).map(record => {
        // 提取域名作为标签，如果有标题则使用标题
        const url = new URL(record.url);
        const label = record.title || url.hostname || record.url;
        
        return {
          id: record.id,
          url: record.url,
          label: this.truncateText(label, 30),
          domain: url.hostname,
          favicon: record.favicon || `https://www.google.com/s2/favicons?domain=${url.hostname}`,
          timestamp: record.timestamp,
          type: record.navigationType,
          parentId: record.parentId,
          depth: 0, // 将在计算树状结构时填充
          activeTime: record.activeTime || 0,
          loadTime: record.loadTime,
          isClosed: record.isClosed || false,
          isRoot: !record.parentId,
          tabId: record.tabId
        };
      });
      
      // 计算节点深度 - 这是构建树形结构的关键
      this.calculateNodeDepths();
      
      // 转换导航边
      this.edges = Object.values(this.currentSession.edges).map(edge => {
        return {
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          type: edge.action,
          timestamp: edge.timestamp,
          sequence: edge.sequence
        };
      });
      
      // 根据序列号排序边
      this.edges.sort((a, b) => a.sequence - b.sequence);
    }
    
    /**
     * 计算节点深度
     */
    calculateNodeDepths() {
      // 首先找出所有根节点
      const rootNodes = this.nodes.filter(node => !node.parentId);
      
      // 为每个根节点及其子节点计算深度
      rootNodes.forEach(rootNode => {
        rootNode.depth = 0;
        this.calculateChildDepths(rootNode, 1);
      });
    }
    
    /**
     * 递归计算子节点深度
     */
    calculateChildDepths(parentNode, depth) {
      // 找出父节点的所有直接子节点
      const childNodes = this.nodes.filter(node => node.parentId === parentNode.id);
      
      // 设置子节点深度并递归处理
      childNodes.forEach(childNode => {
        childNode.depth = depth;
        this.calculateChildDepths(childNode, depth + 1);
      });
    }
    
    /**
     * 更新统计信息
     */
    updateStatistics() {
      if (!this.currentSession) return;
      
      // 可见节点和边的计数
      const visibleNodes = this.filterNodes();
      const visibleEdges = this.filterEdges(visibleNodes);
      
      // 更新DOM
      document.getElementById('stats-nodes').textContent = visibleNodes.length;
      document.getElementById('stats-edges').textContent = visibleEdges.length;
      
      // 计算总活跃时间
      const totalActiveTime = visibleNodes.reduce((sum, node) => sum + (node.activeTime || 0), 0);
      const minutes = Math.floor(totalActiveTime / 60000);
      document.getElementById('stats-time').textContent = `${minutes}分钟`;
    }
    
    /**
     * 渲染可视化
     */
    renderVisualization() {
      // 清空之前的可视化
      this.svg.select('g').selectAll('*').remove();
      
      // 如果没有会话或节点，显示无数据状态
      if (!this.currentSession || !this.nodes.length) {
        this.showNoData();
        return;
      }
      
      // 根据当前视图类型渲染
      if (this.currentView === 'tree') {
        this.renderTreeView();
      } else {
        this.renderTimelineView();
      }
      
      // 更新统计信息
      this.updateStatistics();
      
      this.hideLoading();
    }
    
    /**
     * 渲染树状视图
     */
    renderTreeView() {
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
      
      // 创建D3力导向图数据
      const graphNodes = visibleNodes.map(d => ({...d}));
      const graphLinks = visibleEdges.map(d => ({
        source: d.source,
        target: d.target,
        id: d.id,
        type: d.type
      }));
      
      // 设置力导向图
      this.simulationTree = d3.forceSimulation(graphNodes)
        .force('link', d3.forceLink(graphLinks)
          .id(d => d.id)
          .distance(100)
          .strength(0.7))
        .force('charge', d3.forceManyBody()
          .strength(-300))
        .force('x', d3.forceX(width / 2))
        .force('y', d3.forceY(d => height / 2 + (d.depth * 80 - 200)))
        .force('collision', d3.forceCollide().radius(50))
        .on('tick', () => this.ticked());
      
      // 添加箭头定义
      const defs = this.svg.select('g').append('defs');
      
      defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 30)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .append('path')
        .attr('d', 'M 0,-5 L 10,0 L 0,5')
        .attr('fill', '#999')
        .attr('stroke', 'none');
      
      // 创建边
      this.edgeElements = this.svg.select('g').selectAll('.edge')
        .data(graphLinks)
        .enter()
        .append('path')
        .attr('class', d => `edge ${d.type}`)
        .attr('id', d => `edge-${d.id}`)
        .attr('marker-end', 'url(#arrowhead)');
      
      // 创建节点组
      this.nodeElements = this.svg.select('g').selectAll('.node')
        .data(graphNodes)
        .enter()
        .append('g')
        .attr('class', d => `node depth-${d.depth}${d.isRoot ? ' root' : ''}${d.isClosed ? ' closed' : ''}`)
        .attr('id', d => `node-${d.id}`)
        .call(d3.drag()
          .on('start', this.dragstarted.bind(this))
          .on('drag', this.dragged.bind(this))
          .on('end', this.dragended.bind(this))
        )
        .on('mouseover', (event, d) => this.showTooltip(event, d))
        .on('mouseout', () => this.hideTooltip())
        .on('click', (event, d) => this.handleNodeClick(event, d));
      
      // 添加节点卡片背景
      this.nodeElements.append('rect')
        .attr('width', d => 150 + Math.min(100, d.activeTime / 60000)) // 基于活跃时间调整宽度
        .attr('height', 60)
        .attr('rx', 5)
        .attr('ry', 5);
      
      // 添加网站图标
      this.nodeElements.append('image')
        .attr('x', 10)
        .attr('y', 10)
        .attr('width', 16)
        .attr('height', 16)
        .attr('href', d => d.favicon);
      
      // 添加标题文本
      this.nodeElements.append('text')
        .attr('x', 35)
        .attr('y', 24)
        .text(d => d.label);
      
      // 添加URL文本
      this.nodeElements.append('text')
        .attr('x', 10)
        .attr('y', 45)
        .attr('class', 'url')
        .text(d => this.truncateText(d.url, 25));
    }
    
    /**
     * 力导向图每帧更新
     */
    ticked() {
      // 更新边位置
      this.edgeElements.attr('d', d => {
        const deltaX = d.target.x - d.source.x;
        const deltaY = d.target.y - d.source.y;
        const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const normX = deltaX / dist;
        const normY = deltaY / dist;
        
        // 计算源和目标节点边缘的坐标，而不是中心
        const sourceX = d.source.x + (normX * 25);
        const sourceY = d.source.y + (normY * 25);
        const targetX = d.target.x - (normX * 25);
        const targetY = d.target.y - (normY * 25);
        
        if (d.source === d.target) {
          // 自环
          return `M ${d.source.x},${d.source.y} a 20,20 0 1,1 0.01,0`;
        } else if (d.type === 'history_back' || d.type === 'history_forward') {
          // 历史导航
          const dx = targetX - sourceX;
          const dy = targetY - sourceY;
          const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
          return `M ${sourceX},${sourceY} A ${dr},${dr} 0 0,1 ${targetX},${targetY}`;
        } else {
          // 标准边
          return `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
        }
      });
      
      // 更新节点位置
      this.nodeElements.attr('transform', d => `translate(${d.x - 75},${d.y - 30})`);
    }
  }
  
  // 等待DOM加载完成后初始化可视化
  document.addEventListener('DOMContentLoaded', () => {
    // 创建可视化实例
    window.visualizer = new NavigationVisualizer();
  });
})();