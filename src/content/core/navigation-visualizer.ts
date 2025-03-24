/**
 * 导航图谱可视化器核心类
 * 替代 index-old.js 中的 NavigationVisualizer 类
 */
import { sessionManager } from './session-manager.js';
import { nodeManager } from './node-manager.js';
import { 
  registerMessageHandler, 
  unregisterMessageHandler,
  getTypedMessage,
  createResponse
} from './message-handler.js';
import { renderTreeLayout } from '../renderers/tree-renderer.js';
import { renderTimelineLayout } from '../renderers/timeline-renderer.js';
import { DebugTools } from '../debug/debug-tools.js';
import type { NavNode, NavLink } from '../types/navigation.js';
import type { SessionDetails } from '../types/session.js';

export class NavigationVisualizer {
  // 可视化容器
  container: HTMLElement | null = null;
  
  // 当前视图类型 ('tree' | 'timeline')
  currentView: string = 'tree';
  
  // 过滤器设置
  filters = {
    reload: true,
    history: true,
    closed: false, // 默认不显示已关闭页面
    typeLink: true,
    typeAddress: true,
    typeForm: true,
    typeJs: true,
    showTracking: false // 默认不显示跟踪页面
  };
  
  // D3相关
  svg: any = null;
  zoom: any = null;
  
  // 状态跟踪
  _isRestoringTransform: boolean = false;
  _savedTransform?: {x: number, y: number, k: number};
  _savedZoom: any = null; // 通用缓存
  _treeZoom: any = null; // 树形视图的缩放状态
  _timelineZoom: any = null; // 时间线视图的缩放状态
  
  // 数据存储
  nodes: NavNode[] = [];
  edges: NavLink[] = [];
  nodeMap: Map<string, NavNode> = new Map();
  
  // 原始未过滤数据
  allNodes: NavNode[] = [];
  allEdges: NavLink[] = [];
  
  // 其他属性
  width: number = 0;
  height: number = 0;
  currentSession: SessionDetails | null = null;
  noData: HTMLElement | null = null;
  statusBar: HTMLElement | null = null;
  timelineSvg: any = null;
  
  private trackingKeywords = [
    '/track/', '/pixel/', '/analytics/', '/beacon/', '/telemetry/', 
    '/stats/', '/log/', '/metrics/', '/collect/', '/monitor/', 
    'piwik.', 'matomo.', 'ga.js', 'gtm.js', 'fbevents', 
    'insight.', '/counter/', 'www.google-analytics.com'
  ];
  // 添加调试工具属性
  private debugTools: DebugTools | null = null;
  /**
   * 筛选器配置定义
   */
  private readonly filterConfigs = [
    { id: 'filter-reload', text: '显示刷新', property: 'reload', defaultValue: true },
    { id: 'filter-history', text: '显示历史', property: 'history', defaultValue: true },
    { id: 'filter-closed', text: '显示已关闭', property: 'closed', defaultValue: false },
    { id: 'filter-tracking', text: '显示跟踪页面', property: 'showTracking', defaultValue: false },
    { id: 'type-link', text: '链接点击', property: 'typeLink', defaultValue: true },
    { id: 'type-address', text: '地址栏输入', property: 'typeAddress', defaultValue: true },
    { id: 'type-form', text: '表单提交', property: 'typeForm', defaultValue: true },
    { id: 'type-js', text: 'JS导航', property: 'typeJs', defaultValue: true }
  ];
  /**
   * 构造函数
   */
  constructor() {
    console.log('初始化NavigationVisualizer...');
    // 检查d3是否已加载
    if (typeof window.d3 === 'undefined') {
        console.error('d3 库未加载，可视化功能将不可用');
        alert('d3 库未加载，可视化功能将不可用。请确保已包含d3.js库。');
    } else {
        console.log('d3 库已加载:', window.d3.version);
    }
    this.noData = document.getElementById('no-data');
    
    // 不要在构造函数里面初始化，而应该外部初始化
    //this.initialize();
  }
  
  /**
   * 初始化导航可视化
   */
  async initialize() {
    try {
      console.log('初始化导航可视化...');
      
      // 设置消息监听器
      this.initMessageListener();
      
      // 确保DOM已加载完成
      if (document.readyState !== 'complete') {
        console.log('等待DOM加载完成...');
        await new Promise(resolve => {
          window.addEventListener('load', resolve);
        });
      }
      
      // 查找visualization-container容器
      this.container = document.getElementById('visualization-container');
      
      // 如果不存在，显示错误
      if (!this.container) {
        console.error('可视化容器不存在，无法初始化');
        throw new Error('可视化容器不存在');
      }
      
      // 查找状态栏
      this.statusBar = document.querySelector('.windows-status-bar') as HTMLElement;
      
      // 调整容器大小
      this.updateContainerSize();
      
      // 初始化SVG
      this.initializeSvg();
      
      // 初始化筛选器 - 使用HTML中已定义的元素
      this.initializeFilters();
      
      // 初始化视图切换器 - 使用HTML中已定义的元素
      this.initializeViewSwitcher();
      
      // 添加窗口大小调整监听器
      window.addEventListener('resize', () => this.updateContainerSize());
      
      // 订阅会话加载事件
      sessionManager.onSessionLoaded(session => this.handleSessionLoaded(session));
      sessionManager.onSessionsListLoaded(sessions => this.handleSessionListLoaded(sessions));
      
      // 加载会话列表
      await sessionManager.loadSessions();
      
      // 加载当前会话
      await sessionManager.loadCurrentSession();

      // 在所有初始化完成后，初始化调试工具
      this.initDebugTools();
    } catch (error) {
      console.error('初始化可视化失败:', error);
      this.showNoData('初始化失败: ' + (error instanceof Error ? error.message : String(error)));
    }
    
    console.log('NavigationVisualizer 初始化完成，当前配置:', {
      container: this.container ? '已找到' : '未找到',
      svg: this.svg ? '已创建' : '未创建',
      filters: this.filters,
      currentView: this.currentView,
      elements: {
        filterClosed: document.getElementById('filter-closed') ? '已找到' : '未找到',
        filterTracking: document.getElementById('filter-tracking') ? '已找到' : '未找到',
        treeView: document.getElementById('tree-view') ? '已找到' : '未找到',
        timelineView: document.getElementById('timeline-view') ? '已找到' : '未找到'
      }
    });
  }
  /**
   * 初始化调试工具
   */
  private initDebugTools(): void {
    try {
      // 确保调试工具只初始化一次
      if (!this.debugTools) {
        console.log('初始化调试工具...');
        this.debugTools = new DebugTools(this);
      }
    } catch (error) {
      console.error('初始化调试工具失败:', error);
    }
  }
  /**
   * 初始化SVG元素
   */
  private initializeSvg(): void {
    if (!this.container) {
      console.error('无法初始化SVG：容器不存在');
      return;
    }
    
    console.log('初始化SVG元素...');
    
    // 如果已有SVG元素，先移除
    const existingSvg = this.container.querySelector('svg');
    if (existingSvg) {
      existingSvg.remove();
    }
    
    try {
      // 创建新的SVG元素
      this.svg = window.d3.select(this.container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('class', 'visualization-svg')
        .attr('data-view', this.currentView); // 添加当前视图类型作为属性
      
      // 添加根分组节点 - 所有可视化元素都应该添加到这个组
      const mainGroup = this.svg.append('g')
        .attr('class', 'main-group');
        
      // 在主组中创建两个子组，一个用于边，一个用于节点
      // 边应该在下方，节点应该在上方
      mainGroup.append('g')
        .attr('class', 'links-group');
        
      mainGroup.append('g')
        .attr('class', 'nodes-group');
      
      console.log('SVG元素初始化成功');
    } catch (error) {
      console.error('SVG元素初始化失败:', error);
      this.showNoData('创建可视化图表失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  
  /**
   * 初始化消息监听
   */
  initMessageListener() {
    console.log('注册消息处理函数...');
    
    // 注册刷新可视化消息处理函数
    registerMessageHandler<'refreshVisualization'>('refreshVisualization', 
      (message, sender, sendResponse) => {
        // 使用类型化消息
        const typedMessage = getTypedMessage('refreshVisualization', message);
        console.log('收到可视化刷新请求', typedMessage.timestamp ? 
          new Date(typedMessage.timestamp).toLocaleTimeString() : 'unknown');
        
        // 如果需要回复，使用类型化响应
        if (message.requestId) {
          const response = createResponse('refreshVisualization', message.requestId);
          sendResponse(response);
        }
        
        // 延迟执行刷新操作
        setTimeout(async () => {
          try {
            console.log('🔄 开始执行刷新操作...');
            await sessionManager.loadSessions();
            await sessionManager.loadCurrentSession();
            this.refreshVisualization();
            console.log('✅ 刷新操作完成');
          } catch (err) {
            console.error('❌ 自动刷新可视化失败:', err);
          }
        }, 50);
        
        // 返回false表示我们已经同步处理了响应
        return false;
      });
    
    // 注册页面活动消息处理函数
    registerMessageHandler<'pageActivity'>('pageActivity', 
      (message) => {
        // 使用类型化消息
        const typedMessage = getTypedMessage('pageActivity', message);
        console.log('收到页面活动事件，触发刷新', typedMessage.source);
        
        // 触发刷新操作
        this.triggerRefresh();
        
        // 不需要回复
        return false;
      });
    
    // 链接点击消息处理
    registerMessageHandler<'linkClicked'>('linkClicked', (message, sender, sendResponse) => {
      // 使用类型化消息
      const typedMessage = getTypedMessage('linkClicked', message);
      console.log('收到链接点击消息:', typedMessage.linkInfo);
      
      // 确认收到，使用类型化响应
      if (message.requestId) {
        const response = createResponse('linkClicked', message.requestId);
        sendResponse(response);
      }
      
      // 延迟刷新可视化图表
      setTimeout(async () => {
        try {
          await sessionManager.loadSessions();
          await sessionManager.loadCurrentSession();
          this.refreshVisualization();
          console.log('基于链接点击刷新可视化完成');
        } catch (err) {
          console.error('链接点击后刷新可视化失败:', err);
        }
      }, 100);
      
      // 返回false表示已同步处理响应
      return false;
    });
    
    // 节点ID获取消息处理
    registerMessageHandler<'getNodeId'>('getNodeId', (message, sender, sendResponse) => {
      // 使用类型化消息
      const typedMessage = getTypedMessage('getNodeId', message);
      console.log('收到获取节点ID请求:', typedMessage.url);
      
      // 从当前数据中查找URL对应的节点ID
      let nodeId: string | undefined = undefined;
      if (this.nodes && typedMessage.url) {
        const node = this.nodes.find(n => n.url === typedMessage.url);
        nodeId = node?.id;
      }
      
      // 返回找到的节点ID，使用类型化响应
      const response = createResponse('getNodeId', message.requestId);
      (response as any).nodeId = nodeId; // 添加特定字段
      sendResponse(response);
      
      return false; // 同步处理
    });
    
    // favicon更新消息处理
    registerMessageHandler<'faviconUpdated'>('faviconUpdated', (message, sender, sendResponse) => {
      // 使用类型化消息
      const typedMessage = getTypedMessage('faviconUpdated', message);
      console.log('收到favicon更新消息:', typedMessage.url, typedMessage.favicon);
      
      // 确认收到，使用类型化响应
      if (message.requestId) {
        const response = createResponse('faviconUpdated', message.requestId);
        sendResponse(response);
      }
      
      return false; // 同步处理
    });
    
    // 页面加载完成消息处理
    registerMessageHandler<'pageLoaded'>('pageLoaded', (message, sender, sendResponse) => {
      // 使用类型化消息
      const typedMessage = getTypedMessage('pageLoaded', message);
      console.log('收到页面加载完成消息:', typedMessage.pageInfo?.url);
      
      // 确认收到，使用类型化响应
      if (message.requestId) {
        const response = createResponse('pageLoaded', message.requestId);
        sendResponse(response);
      }
      
      // 如果配置了自动刷新，延迟刷新视图
      setTimeout(async () => {
        try {
          await sessionManager.loadSessions();
          await sessionManager.loadCurrentSession();
          this.refreshVisualization();
          console.log('页面加载后刷新可视化完成');
        } catch (err) {
          console.error('页面加载后刷新可视化失败:', err);
        }
      }, 200);
      
      // 返回false表示已同步处理响应
      return false;
    });
  }
  /**
   * 清理资源
   * 在可视化器销毁或者组件卸载时调用
   */
  cleanup(): void {
    console.log('清理可视化器资源...');
    
    // 取消注册消息处理函数
    unregisterMessageHandler('refreshVisualization');
    unregisterMessageHandler('debug');
    unregisterMessageHandler('pageActivity');
    unregisterMessageHandler('linkClicked');
    unregisterMessageHandler('getNodeId');
    unregisterMessageHandler('faviconUpdated');
    unregisterMessageHandler('pageLoaded');
  
    // 移除事件监听器
    window.removeEventListener('resize', () => this.updateContainerSize());
    
    // 清理其他资源...
    console.log('可视化器资源清理完成');
  }
  /**
   * 触发刷新操作
   * 包含节流控制逻辑
   */
  private lastRefreshTime = 0;
  private readonly REFRESH_MIN_INTERVAL = 5000; // 最少5秒刷新一次
  
  triggerRefresh(): void {
    const now = Date.now();
    if (now - this.lastRefreshTime < this.REFRESH_MIN_INTERVAL) {
      console.log('最近已经刷新过，跳过此次刷新');
      return;
    }
    
    this.lastRefreshTime = now;
    console.log('触发可视化刷新...');
    
    // 执行刷新操作
    setTimeout(async () => {
      try {
        await sessionManager.loadSessions();
        await sessionManager.loadCurrentSession();
        this.refreshVisualization();
        console.log('页面活动触发的刷新完成');
      } catch (err) {
        console.error('触发刷新失败:', err);
      }
    }, 100);
  }
  
  /**
   * 刷新可视化
   * 处理外部请求刷新可视化的消息
   */
  refreshVisualization(data?: any, options: { restoreTransform?: boolean } = {}): void {
    console.log('执行刷新可视化...', data ? '使用提供的数据' : '使用现有数据');
    
    try {
      // 如果提供了新数据，则更新数据
      if (data) {
        if (data.nodes) {
          this.nodes = data.nodes;
        }
        
        if (data.edges) {
          this.edges = data.edges;
        }
        
        if (data.session) {
          this.currentSession = data.session;
        }
      }
      
      // 重新应用过滤器
      this.applyFilters();
      
      // 重新渲染可视化
      this.renderVisualization({ 
        restoreTransform: options.restoreTransform === true 
      });
      
      // 更新URL
      this.updateUrl();

      // 更新状态栏
      this.updateStatusBar();
      
      console.log('可视化刷新完成');
    } catch (error) {
      console.error('刷新可视化失败:', error);
      this.showNoData('刷新失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  /**
   * 处理筛选器变化
   */
  private handleFilterChange(filterId: string, checked: boolean): void {
    // 查找对应的筛选器配置
    const config = this.filterConfigs.find(f => f.id === filterId);
    if (!config) {
      console.warn(`未知筛选器ID: ${filterId}`);
      return;
    }
    
    // 更新筛选器状态
    (this.filters as any)[config.property] = checked;
    
    console.log(`筛选器 ${filterId} (${config.property}) 已更改为 ${checked}`);
    
    // 使用完整的刷新流程
    this.refreshVisualization(undefined, { restoreTransform: true });
  }

  /**
   * 创建工具栏
   */
  createToolbar(container: HTMLElement) {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    container.appendChild(toolbar);
    
    // 会话选择器
    const sessionSelector = document.createElement('select');
    sessionSelector.id = 'session-selector';
    toolbar.appendChild(sessionSelector);
    
    // 会话选择器事件
    sessionSelector.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.value) {
        sessionManager.loadSession(target.value);
      }
    });
    
    // 视图切换按钮
    const viewGroup = document.createElement('div');
    viewGroup.className = 'view-group';
    toolbar.appendChild(viewGroup);
    
    const treeViewButton = document.createElement('button');
    treeViewButton.id = 'tree-view';
    treeViewButton.className = 'active';
    treeViewButton.textContent = '树形';
    viewGroup.appendChild(treeViewButton);
    
    const timelineViewButton = document.createElement('button');
    timelineViewButton.id = 'timeline-view';
    timelineViewButton.textContent = '时间线';
    viewGroup.appendChild(timelineViewButton);
    
    // 视图按钮事件
    treeViewButton.addEventListener('click', () => this.switchView('tree'));
    timelineViewButton.addEventListener('click', () => this.switchView('timeline'));
    
    // 过滤器组
    const filterGroup = document.createElement('div');
    filterGroup.className = 'filter-group';
    toolbar.appendChild(filterGroup);
    
   // 使用配置创建筛选器
   this.createFilters(filterGroup);
  }
  /**
   * 创建筛选器元素
   */
  private createFilters(container: HTMLElement): void {
    this.filterConfigs.forEach(config => {
      const checkboxContainer = document.createElement('label');
      checkboxContainer.className = 'checkbox-container';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = config.id;
      checkbox.checked = (this.filters as any)[config.property];
      
      const span = document.createElement('span');
      span.className = 'checkbox-text';
      span.textContent = config.text;
      
      checkboxContainer.appendChild(checkbox);
      checkboxContainer.appendChild(span);
      container.appendChild(checkboxContainer);
      
      // 添加事件监听器
      checkbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        this.handleFilterChange(config.id, target.checked);
      });
    });
  }
  /**
   * 处理会话加载事件
   */
  handleSessionLoaded(session: SessionDetails | null) {
    if (!session) {
      this.showNoData('会话加载失败或无会话');
      return;
    }
    
    console.log('会话已加载，准备更新UI');
    this.currentSession = session;
    
    // 更新会话选择器，确保当前会话被选中
    this.updateSessionSelector();
    
    // 从节点管理器获取处理好的数据
    // 保存原始数据 - 这是关键修改
    this.allNodes = [...nodeManager.getNodes()];
    this.allEdges = [...nodeManager.getEdges()];
    
    // 设置当前使用的数据
    this.nodes = [...this.allNodes];
    this.edges = [...this.allEdges];
    this.nodeMap = nodeManager.getNodeMap();
    
    // 显示数据
    this.hideNoData();
    
    this.refreshVisualization(undefined, { restoreTransform: true });
  }
  
  /**
   * 处理会话列表加载事件
   */
  handleSessionListLoaded(sessions: any[]) {
    // 更新会话选择器
    this.updateSessionSelector(sessions);
  }

  /**
   * 更新会话选择器
   */
  updateSessionSelector(sessions: any[] = []) {
    const selector = document.getElementById('session-selector') as HTMLSelectElement;
    if (!selector) {
      console.warn('找不到会话选择器元素');
      return;
    }
    
    // 清空现有选项
    selector.innerHTML = '';
    
    // 如果没有传入会话列表，使用 sessionManager 中的
    if (!sessions.length) {
      sessions = sessionManager.getSessions();
    }
    
    // 如果没有会话，显示提示
    if (!sessions || sessions.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '暂无会话';
      option.disabled = true;
      option.selected = true;
      selector.appendChild(option);
      return;
    }
    
    // 添加会话选项
    sessions.forEach(session => {
      const option = document.createElement('option');
      option.value = session.id;
      
      // 优化格式化会话时间
      const date = new Date(session.startTime);
      
      option.textContent = session.title || date.toLocaleString();
      
      selector.appendChild(option);
    });
    
    // 默认选择当前会话或第一个会话
    const currentSessionId = sessionManager.getCurrentSessionId();
    if (currentSessionId) {
      selector.value = currentSessionId;
    } else if (sessions.length > 0) {
      selector.value = sessions[0].id;
    }
    
    console.log(`会话选择器已更新，共${sessions.length}个选项`);
  }
  
  /**
   * 切换视图
   */
  switchView(view: 'tree' | 'timeline'): void {
    if (this.currentView === view) return;
    
    const previousView = this.currentView;
    console.log(`切换视图: ${previousView} -> ${view}`);
    
    try {
      // 更新当前视图
      this.currentView = view;
      
      // 立即更新按钮状态
      this.updateViewButtonsState();
      
      // 重要：重置缩放状态
      this.zoom = null;
      
      // 清除 SVG 内容
      if (this.svg) {
        this.svg.selectAll("*").remove();
      }
      
      // 重新初始化 SVG 结构
      this.initializeSvg();
      
      // 重新渲染
      this.refreshVisualization(undefined, { restoreTransform: true });
      
    } catch (error) {
      console.error('切换视图失败:', error);
      
      // 恢复到先前的视图
      this.currentView = previousView;
      this.updateViewButtonsState();
      this.refreshVisualization(undefined, { restoreTransform: true });
    }
  }
  
  /**
   * 渲染可视化
   */
  renderVisualization(options: { restoreTransform?: boolean } = {}): void {
    if (!this.container || !this.svg) {
      console.error('无法渲染可视化：容器或SVG不存在');
      return;
    }
    
    try {
      // 获取容器大小
      const width = this.container.clientWidth || 800;
      const height = this.container.clientHeight || 600;
      
      // 保存尺寸
      this.width = width;
      this.height = height;
      
      console.log(`开始渲染${this.currentView}视图, 节点数: ${this.nodes.length}, 边数: ${this.edges.length}, 尺寸: ${width}x${height}`);
      
      // 清除现有可视化
      this.svg.selectAll('*').remove();
      
      // 检查是否有数据可渲染
      if (!this.nodes || this.nodes.length === 0) {
        this.showNoData('没有符合筛选条件的数据可显示');
        return;
      }
      
      // 根据当前视图类型渲染 - 直接调用导入的渲染函数
      if (this.currentView === 'timeline') {
        console.log('准备渲染时间线视图');
        // 尝试恢复之前保存的时间线缩放
        if (this._timelineZoom) {
          console.log('使用保存的时间线缩放');
          this.zoom = this._timelineZoom;
        }
        
        // 直接调用导入的时间线渲染函数
        renderTimelineLayout(
          this.container,
          this.svg,
          this.nodes,
          this.edges,
          width,
          height,
          this
        );
      } else {
        console.log('准备渲染树形视图');
        // 尝试恢复之前保存的树形视图缩放
        if (this._treeZoom) {
          console.log('使用保存的树形视图缩放');
          this.zoom = this._treeZoom;
        }
        
        // 直接调用导入的树形渲染函数
        renderTreeLayout(
          this.container,
          this.svg,
          this.nodes,
          this.edges,
          width,
          height,
          this
        );
      }
      
      console.log('可视化渲染完成', {
        view: this.currentView,
        zoom: this.zoom ? '已设置' : '未设置'
      });
      
    } catch (error) {
      console.error('可视化渲染失败:', error);
      this.showNoData('渲染失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  
  /**
   * 更新容器大小
   */
  updateContainerSize(): void {
    if (!this.container) return;
    
    // 获取主容器尺寸
    const mainContainer = this.container.closest('.main-container');
    
    let width, height;
    
    if (mainContainer) {
      // 使用父容器的尺寸
      const rect = mainContainer.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    } else {
      // 回退到窗口尺寸，但不完全占满（留出一些边距）
      width = window.innerWidth - 40;
      height = window.innerHeight - 100;
    }
    
    // 检查尺寸是否真的变化了
    const oldWidth = parseFloat(this.container.style.width) || 0;
    const oldHeight = parseFloat(this.container.style.height) || 0;
    
    // 只有当尺寸变化超过一定阈值时才更新
    const threshold = 5; // 5像素的阈值
    if (Math.abs(width - oldWidth) > threshold || Math.abs(height - oldHeight) > threshold) {
        console.log(`更新容器大小: ${width}x${height}`);
        
        // 应用尺寸
        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;
        
        // 如果已有可视化，重新渲染
        if (this.nodes.length > 0) {
        this.renderVisualization({ restoreTransform: true });
        }
    } else {
        console.log('容器大小变化不显著，跳过更新');
    }
  }
  
  /**
   * 应用筛选器并重新渲染
   * 可以选择传入新的筛选器，或使用当前类中的筛选器
   */
  applyFilters(): void {
    
    console.log('应用筛选器:', this.filters);
    
    // 筛选后重置缩放状态，确保缩放被重新创建
    this.zoom = null;
    
    // 从所有节点中筛选出符合条件的节点
    this.filterNodes();
  }
  
  /**
   * 根据筛选条件过滤节点
   */
  private filterNodes(): void {
    // 确保有原始数据可供筛选
    if (!this.allNodes || !this.allEdges) {
      console.warn('没有原始数据可供筛选');
      return;
    }
    
    console.log('开始根据筛选条件过滤节点...');
    
    // 从所有节点开始
    let filteredNodes = [...this.allNodes];
    let filteredEdges = [...this.allEdges];
    
    // 修改类型筛选逻辑 - 使用白名单方式，但不过滤未知类型
    // 并确保指定的类型能正确通过
    filteredNodes = filteredNodes.filter(node => {
      // 创建一个节点描述，方便调试
      const nodeDesc = `${node.id} (${node.title || 'Untitled'}, 类型=${node.type || 'unknown'})`;
      
      // 类型筛选 - 只过滤明确禁用的已知类型
      if (node.type) {
        // 特定类型使用对应的过滤配置
        if (
          (node.type === 'link_click' && !this.filters.typeLink) ||
          (node.type === 'address_bar' && !this.filters.typeAddress) ||
          (node.type === 'form_submit' && !this.filters.typeForm) ||
          (node.type === 'javascript' && !this.filters.typeJs)
        ) {
          console.log(`过滤掉节点：${nodeDesc} - 类型被禁用`);
          return false;
        }
      }
      
      // 刷新筛选
      if (!this.filters.reload && node.type === 'reload') {
        return false;
      }
      
      // 历史筛选
      if (!this.filters.history && (node.type === 'history_back' || node.type === 'history_forward')) {
        return false;
      }
      
      // 关闭页面筛选
      if (!this.filters.closed && node.isClosed) {
        return false;
      }
      
      // 跟踪页面筛选
      if (!this.filters.showTracking && this.isTrackingPage(node)) {
        return false;
      }
      
      // 通过其他类型，包括 redirect 类型
      return true;
    });
    
    console.log(`筛选结果: 从${this.allNodes.length}个节点中筛选出${filteredNodes.length}个符合条件的节点`);
    
    // 获取所有符合条件的节点ID集合，用于边过滤
    const nodeIds = new Set(filteredNodes.map(node => node.id));
    
    // 过滤连接，只保留两端都在筛选后节点中的连接
    filteredEdges = filteredEdges.filter(edge => {
      const sourceId = edge.source;
      const targetId = edge.target;
      
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });
    
    // 更新当前使用的节点和边
    this.nodes = filteredNodes;
    this.edges = filteredEdges;
  }
  
  /**
   * 更新URL以反映当前视图和筛选状态
   * 实现原本可能缺失的 updateUrl 方法
   */
  private updateUrl(): void {
    try {
      const url = new URL(window.location.href);
      
      // 更新视图参数
      url.searchParams.set('view', this.currentView);
      
      // 更新筛选器参数
      url.searchParams.set('filter', JSON.stringify({
        reload: this.filters.reload,
        history: this.filters.history,
        closed: this.filters.closed,
        tracking: this.filters.showTracking,
        typeLink: this.filters.typeLink,
        typeAddress: this.filters.typeAddress,
        typeForm: this.filters.typeForm,
        typeJs: this.filters.typeJs
      }));
      
      // 不触发页面刷新的情况下更新URL
      window.history.replaceState(null, '', url);
      
      console.log('已更新URL以反映当前视图和筛选状态');
    } catch (error) {
      console.warn('更新URL失败:', error);
    }
  }
  
  /**
   * 更新状态栏
   */
  updateStatusBar() {
    if (!this.statusBar || !this.currentSession) return;
    
    try {
      // 计算关键统计数据
      const totalNodes = this.nodes.length;
      
      // 过滤的节点数量
      const filteredCount = this.allNodes ? this.allNodes.length - this.nodes.length : 0;
      
      // 计算会话时长
      let sessionDuration = 0;
      if (this.currentSession.startTime) {
        const endTime = this.currentSession.endTime || Date.now();
        sessionDuration = Math.floor((endTime - this.currentSession.startTime) / 60000); // 分钟
      }
      
      // 获取当前视图类型的显示名称
      const viewName = this.currentView === 'tree' ? '树形图' : '时间线';
  
      // 获取当前缩放比例
      let zoomLevel = 1.0;
      if (this.zoom) {
        if (this._savedTransform && this._savedTransform.k) {
          zoomLevel = this._savedTransform.k;
        } else if (this.svg) {
          const transform = window.d3.zoomTransform(this.svg.node());
          if (transform) {
            zoomLevel = transform.k;
          }
        }
      }
      
      // 格式化缩放级别，保留两位小数
      const formattedZoom = zoomLevel.toFixed(2);
      
      // 格式化会话日期
      const sessionDate = this.currentSession.startTime ? 
        new Date(this.currentSession.startTime).toLocaleDateString() : '未知';
  
      // 定义简化后的状态项
      const statusUpdates = {
        'status-date': `会话日期: ${sessionDate}`,
        'status-duration': `时长: ${sessionDuration}分钟`,
        'status-nodes': `节点: ${totalNodes}`,
        'status-filtered': `已隐藏: ${filteredCount}`,
        'status-view': `视图: ${viewName}`,
        'status-zoom': `缩放: ${formattedZoom}x`
      };
      
      // 批量更新状态栏
      this.updateStatusElements(statusUpdates);
      
    } catch (error) {
      console.error('更新状态栏失败:', error);
      // 简化错误信息
      this.updateStatusElement('status-view', '状态更新失败');
    }
  }

  /**
   * 批量更新状态元素
   * @param updates 要更新的元素ID和文本内容的键值对
   */
  private updateStatusElements(updates: Record<string, string>): void {
    for (const [id, text] of Object.entries(updates)) {
      this.updateStatusElement(id, text);
    }
  }

  /**
   * 更新单个状态元素
   * @param id 元素ID
   * @param text 要设置的文本内容
   */
  private updateStatusElement(id: string, text: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    }
  }
  
  /**
   * 显示无数据状态
   */
  showNoData(message: string = '暂无数据') {
    if (this.noData) {
      this.noData.style.display = 'flex';
      const statusText = document.getElementById('status-text');
      if (statusText) {
        statusText.textContent = message;
      }
    } else {
      console.warn('no-data元素不存在');
    }
  }
  
  /**
   * 隐藏无数据状态
   */
  hideNoData() {
    if (this.noData) {
      this.noData.style.display = 'none';
    }
  }

  /**
   * 显示节点详情
   * @param node 节点数据
   */
  showNodeDetails(node: NavNode): void {
    console.log('显示节点详情:', node);
    
    // 如果已有详情面板，移除它
    document.querySelectorAll('.node-details-panel').forEach(el => el.remove());
    
    // 创建详情面板
    const panel = document.createElement('div');
    panel.className = 'node-details-panel';
    
    // 添加关闭按钮
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.className = 'node-details-close';
    closeButton.onclick = () => panel.remove();
    panel.appendChild(closeButton);
    
    // 添加标题
    const title = document.createElement('h3');
    title.textContent = node.title || '未命名页面';
    title.className = 'node-details-title';
    panel.appendChild(title);
    
    // 添加内容
    const content = document.createElement('div');
    
    // URL
    if (node.url) {
      const urlContainer = document.createElement('div');
      urlContainer.className = 'detail-item';
      
      const urlLabel = document.createElement('span');
      urlLabel.textContent = 'URL: ';
      urlLabel.className = 'detail-label';
      
      const urlValue = document.createElement('a');
      urlValue.href = node.url;
      urlValue.textContent = node.url.length > 35 ? node.url.substring(0, 32) + '...' : node.url;
      urlValue.target = '_blank';
      urlValue.className = 'detail-url';
      urlValue.title = node.url;
      
      urlContainer.appendChild(urlLabel);
      urlContainer.appendChild(urlValue);
      content.appendChild(urlContainer);
    }
    
    // 类型
    if (node.type) {
      const typeContainer = document.createElement('div');
      typeContainer.className = 'detail-item';
      
      const typeLabel = document.createElement('span');
      typeLabel.textContent = '类型: ';
      typeLabel.className = 'detail-label';
      
      const typeValue = document.createElement('span');
      typeValue.className = 'detail-value';
      
      // 将类型代码转换为更友好的描述
      let typeText = node.type;
      switch (node.type) {
        case 'link_click': typeText = '链接点击'; break;
        case 'address_bar': typeText = '地址栏输入'; break;
        case 'form_submit': typeText = '表单提交'; break;
        case 'reload': typeText = '页面刷新'; break;
        case 'history_back': typeText = '历史后退'; break;
        case 'history_forward': typeText = '历史前进'; break;
        case 'javascript': typeText = 'JavaScript导航'; break;
        case 'tab_open': typeText = '标签页打开'; break;
        case 'redirect': typeText = '页面重定向'; break;
      }
      
      typeValue.textContent = typeText;
      
      typeContainer.appendChild(typeLabel);
      typeContainer.appendChild(typeValue);
      content.appendChild(typeContainer);
    }
    
    // 时间
    if (node.timestamp) {
      const timeContainer = document.createElement('div');
      timeContainer.className = 'detail-item';
      
      const timeLabel = document.createElement('span');
      timeLabel.textContent = '时间: ';
      timeLabel.className = 'detail-label';
      
      const timeValue = document.createElement('span');
      timeValue.className = 'detail-value';
      const date = new Date(node.timestamp);
      timeValue.textContent = date.toLocaleString();
      
      timeContainer.appendChild(timeLabel);
      timeContainer.appendChild(timeValue);
      content.appendChild(timeContainer);
    }
    
    // 状态
    const statusContainer = document.createElement('div');
    statusContainer.className = 'detail-item';
    
    const statusLabel = document.createElement('span');
    statusLabel.textContent = '状态: ';
    statusLabel.className = 'detail-label';
    
    const statusValue = document.createElement('span');
    if (node.isClosed) {
      statusValue.textContent = '已关闭';
      statusValue.className = 'status-closed';
    } else {
      statusValue.textContent = '活跃';
      statusValue.className = 'status-active';
    }
    
    statusContainer.appendChild(statusLabel);
    statusContainer.appendChild(statusValue);
    content.appendChild(statusContainer);
    
    // 技术详情 - 可折叠部分
    const technicalDetails = document.createElement('details');
    technicalDetails.className = 'technical-details';
    
    const summary = document.createElement('summary');
    summary.textContent = '技术详情';
    
    const detailContent = document.createElement('div');
    detailContent.className = 'technical-content';
  
    // 标签ID
    if (node.tabId) {
      const tabContainer = document.createElement('div');
      tabContainer.className = 'detail-item';
      
      const tabLabel = document.createElement('span');
      tabLabel.textContent = '标签ID: ';
      tabLabel.className = 'detail-label';
      
      const tabValue = document.createElement('span');
      tabValue.className = 'detail-value';
      tabValue.textContent = node.tabId;
      
      tabContainer.appendChild(tabLabel);
      tabContainer.appendChild(tabValue);
      detailContent.appendChild(tabContainer);
    }
  
    // 节点ID
    const idContainer = document.createElement('div');
    idContainer.className = 'detail-item';
    
    const idLabel = document.createElement('span');
    idLabel.textContent = '节点ID: ';
    idLabel.className = 'detail-label';
    
    const idValue = document.createElement('span');
    idValue.className = 'detail-value';
    idValue.textContent = node.id;
    
    idContainer.appendChild(idLabel);
    idContainer.appendChild(idValue);
    detailContent.appendChild(idContainer);
    
    // 父节点ID
    if (node.parentId) {
      const parentContainer = document.createElement('div');
      parentContainer.className = 'detail-item';
      
      const parentLabel = document.createElement('span');
      parentLabel.textContent = '父节点ID: ';
      parentLabel.className = 'detail-label';
      
      const parentValue = document.createElement('span');
      parentValue.className = 'detail-value';
      parentValue.textContent = node.parentId;
      
      parentContainer.appendChild(parentLabel);
      parentContainer.appendChild(parentValue);
      detailContent.appendChild(parentContainer);
    }
    
    // 引用来源
    if (node.referrer) {
      const referrerContainer = document.createElement('div');
      referrerContainer.className = 'detail-item';
      
      const referrerLabel = document.createElement('span');
      referrerLabel.textContent = '引用来源: ';
      referrerLabel.className = 'detail-label';
      
      const referrerValue = document.createElement('span');
      referrerValue.className = 'detail-value';
      referrerValue.textContent = node.referrer;
      
      referrerContainer.appendChild(referrerLabel);
      referrerContainer.appendChild(referrerValue);
      detailContent.appendChild(referrerContainer);
    }
    
    technicalDetails.appendChild(summary);
    technicalDetails.appendChild(detailContent);
    
    content.appendChild(technicalDetails);
    panel.appendChild(content);
    
    // 添加到DOM
    if (this.container) {
      this.container.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
    
    // 添加拖拽功能
    this.makeDraggable(panel);
  }
  
  /**
   * 使元素可拖拽
   */
  private makeDraggable(element: HTMLElement): void {
    // 状态变量
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let originalLeft = 0, originalTop = 0;
    
    // 设置初始位置 - 放置在右上角
    element.style.position = 'absolute';
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    
    // 设置右上角位置
    const containerRect = this.container ? 
      this.container.getBoundingClientRect() : 
      { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      
    // 初始位置：右上角，距离右侧20px，距离顶部70px
    element.style.left = `${containerRect.width - 320}px`;
    element.style.top = '70px';
    
    // 创建拖拽手柄
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    element.appendChild(handle);
    
    // 标题也可以用来拖动
    const title = element.querySelector('.node-details-title');
    if (title) {
      (title as HTMLElement).style.cursor = 'move';
    }
    
    // 拖动开始处理函数
    const onDragStart = (e: MouseEvent) => {
      // 只响应鼠标左键
      if (e.button !== 0) return;
      
      // 检查目标元素是否为手柄或标题
      const target = e.target as HTMLElement;
      if (!(target === handle || target === title)) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      // 记录开始拖动时的状态
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      
      // 记录元素原始位置
      originalLeft = parseInt(element.style.left || '0', 10);
      originalTop = parseInt(element.style.top || '0', 10);
      
      // 添加拖动中的样式
      element.classList.add('dragging');
      
      // 添加文档级事件监听
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    };
    
    // 拖动过程处理函数
    const onDragMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      e.preventDefault();
      
      // 计算拖动距离
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      
      // 计算新位置（基于原始位置）
      const newLeft = originalLeft + deltaX;
      const newTop = originalTop + deltaY;
      
      // 限制在容器内
      const maxX = containerRect.width - element.offsetWidth;
      const maxY = containerRect.height - element.offsetHeight;
      
      // 应用新位置
      element.style.left = `${Math.max(0, Math.min(newLeft, maxX))}px`;
      element.style.top = `${Math.max(0, Math.min(newTop, maxY))}px`;
    };
    
    // 拖动结束处理函数
    const onDragEnd = () => {
      if (!isDragging) return;
      
      // 清理状态
      isDragging = false;
      element.classList.remove('dragging');
      
      // 移除文档级事件监听
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
    };
    
    // 添加拖动开始事件监听
    handle.addEventListener('mousedown', onDragStart);
    if (title) {
      handle.addEventListener('mousedown', onDragStart);
    }
  }

  /**
   * 初始化筛选器
   */
  private initializeFilters(): void {
    console.log('初始化筛选器...');
    // 为每个筛选器绑定事件处理程序
    this.filterConfigs.forEach(config => {
      const checkbox = document.getElementById(config.id) as HTMLInputElement;
      if (checkbox) {
        // 设置初始值
        checkbox.checked = (this.filters as any)[config.property];
        
        // 添加事件监听器
        checkbox.addEventListener('change', () => {
          this.handleFilterChange(config.id, checkbox.checked);
        });
        
        console.log(`已绑定筛选器 ${config.id}, 初始状态: ${checkbox.checked}`);
      } else {
        console.warn(`未找到筛选器元素: ${config.id}`);
      }
    });
  }

  /**
   * 判断页面是否为跟踪页面
   */
  isTrackingPage(node: any): boolean {
    if (!node || !node.url) return false;
    
    const url = node.url.toLowerCase();
    
    return this.trackingKeywords.some(keyword => url.includes(keyword));
  }

  /**
   * 初始化视图切换器
   */
  initializeViewSwitcher(): void {
    // 获取视图切换按钮
    const treeViewBtn = document.getElementById('tree-view');
    const timelineViewBtn = document.getElementById('timeline-view');
    
    // 设置默认视图类型
    if (!this.currentView) {
      this.currentView = 'tree';
    }
    
    if (treeViewBtn && timelineViewBtn) {
      // 根据当前视图设置按钮状态
      this.updateViewButtonsState();
      
      // 添加点击事件
      treeViewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchView('tree');
      });
      
      timelineViewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchView('timeline');
      });
      
      console.log('视图切换器初始化完成');
    } else {
      console.warn('未找到视图切换按钮');
    }
  }
  
  /**
   * 更新视图按钮状态
   */
  updateViewButtonsState(): void {    
    console.log('更新视图按钮状态，当前视图:', this.currentView);
    
    // 直接获取视图按钮，而不是依赖未定义的 this.viewButtons
    const treeViewBtn = document.getElementById('tree-view');
    const timelineViewBtn = document.getElementById('timeline-view');
    
    if (!treeViewBtn || !timelineViewBtn) {
      console.warn('未找到视图切换按钮，无法更新状态');
      return;
    }
    
    // 移除所有按钮的激活状态
    treeViewBtn.classList.remove('active');
    timelineViewBtn.classList.remove('active');
    
    // 根据当前视图添加激活状态
    if (this.currentView === 'tree') {
      treeViewBtn.classList.add('active');
    } else if (this.currentView === 'timeline') {
      timelineViewBtn.classList.add('active');
    }
    
   console.log('已更新按钮状态为:', this.currentView);
 }

  /**
   * 应用变换状态
   */
  private applyTransform(transform: any): void {
    if (!transform || !this.svg || !this.zoom) return;
    
    this._isRestoringTransform = true;
    
    try {
      this.svg.call(this.zoom.transform, transform);
      setTimeout(() => {
        this._isRestoringTransform = false;
      }, 100);
    } catch (e) {
      console.warn('无法应用变换状态', e);
      this._isRestoringTransform = false;
    }
  }
}