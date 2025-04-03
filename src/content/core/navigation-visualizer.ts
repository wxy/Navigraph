/**
 * 导航图谱可视化器核心类
 */
import { Logger } from '../../lib/utils/logger.js';
import { sessionManager } from './session-manager.js';
import { nodeManager } from './node-manager.js';
import { renderTreeLayout } from '../renderers/tree-renderer.js';
import { renderTimelineLayout } from '../renderers/timeline-renderer.js';
import { DebugTools } from '../debug/debug-tools.js';
import type { NavNode, NavLink, Visualizer } from '../types/navigation.js';
import type { SessionDetails } from '../types/session.js';
import { sendMessage, registerHandler, unregisterHandler } from '../messaging/content-message-service.js';
import { BaseMessage, BaseResponse } from '../../types/messages/common.js';
import { initStatusBar, updateStatusBar } from '../utils/state-manager.js';

const logger = new Logger('NavigationVisualizer');
/**
 * 导航可视化器类
 * 负责可视化导航数据
 */ 
export class NavigationVisualizer implements Visualizer {
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
  
  currentTransform?: { x: number; y: number; k: number; } | undefined;
  
  // 状态跟踪
  _isRestoringTransform: boolean = false;
  _savedTransform?: {x: number, y: number, k: number};
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
  currentSession?: SessionDetails = undefined; // 修改为可选属性，与Visualizer接口匹配
  statusBar?: HTMLElement; // 修改为可选属性，与Visualizer接口匹配
  
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
    logger.log('初始化NavigationVisualizer...');
    // 检查d3是否已加载
    if (typeof window.d3 === 'undefined') {
        logger.error('d3 库未加载，可视化功能将不可用');
        alert('d3 库未加载，可视化功能将不可用。请确保已包含d3.js库。');
    } else {
        logger.log('d3 库已加载:', window.d3.version);
    }
    
    // 不要在构造函数里面初始化，而应该外部初始化
    //this.initialize();
  }
  
  /**
   * 初始化导航可视化
   * 按照明确的层次结构组织初始化过程
   */
  async initialize() {
    try {
      logger.log('初始化导航可视化...');
      
      // 第一阶段：基础配置与消息
      // 加载配置并设置消息监听，这是其他所有功能的基础
      await this.initializeBaseConfig();
      
      // 第二阶段：UI组件初始化
      // 按照主视图、控制面板、状态栏的顺序初始化UI
      await this.initializeUIComponents();
      
      // 第三阶段：数据加载与应用
      // 加载会话数据并应用到视图
      await this.loadInitialData();
      
      logger.log('NavigationVisualizer 初始化完成');
    } catch (error) {
      this.showError('初始化失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 初始化基础配置与消息监听
   */
  private async initializeBaseConfig(): Promise<void> {
    // 设置消息监听器
    this.initMessageListener();
    
    // 应用全局配置
    this.applyGlobalConfig();
    
    // 确保DOM已加载完成
    if (document.readyState !== 'complete') {
      logger.log('等待DOM加载完成...');
      await new Promise<void>(resolve => {
        window.addEventListener('load', () => resolve());
      });
    }
    
    logger.log('基础配置与消息监听初始化完成');
  }

  /**
   * 初始化UI组件
   */
  private async initializeUIComponents(): Promise<void> {
    // 找到必要的容器元素
    this.container = document.getElementById('visualization-container');
    
    if (!this.container) {
      throw new Error('可视化容器不存在，无法初始化UI组件');
    }
    
    // 初始化主视图
    await this.initializeMainView();
    
    // 初始化控制面板
    await this.initializeControlPanel();
    
    // 初始化状态栏
    this.initStatusBar();
    
    // 添加窗口大小调整监听器
    window.addEventListener('resize', () => this.updateContainerSize());
    
    // 初始化调试工具
    this.initDebugTools();
    
    logger.log('UI组件初始化完成');
  }

  // 初始化状态栏
  public initStatusBar(): void {
    initStatusBar(this);
  }
  // 更新状态栏
  public updateStatusBar(): void {
    updateStatusBar(this);
  }

  /**
   * 初始化控制面板
   * 控制面板包含视图切换、筛选器和会话选择（未来为会话日历）等子组件
   */
  private async initializeControlPanel(): Promise<void> {
    try {
      logger.log('初始化控制面板...');
      
      // 获取控制面板元素
      const controlPanel = document.getElementById('control-panel');
      const handle = document.getElementById('control-panel-handle');
      
      if (!controlPanel || !handle) {
        logger.error('控制面板元素不存在');
        return;
      }
      
      // 初始化控制面板基础交互
      this.initializeControlPanelInteraction(controlPanel, handle);
      
      // 初始化视图切换组件
      await this.initializeViewSwitcher();
      
      // 初始化会话选择器（未来替换为会话日历）
      await this.initializeSessionSelector();
      
      // 初始化筛选器
      await this.initializeFilters();
      
      logger.log('控制面板初始化完成');
    } catch (error) {
      logger.error('初始化控制面板失败:', error);
    }
  }

  /**
   * 初始化控制面板交互
   */
  private initializeControlPanelInteraction(controlPanel: HTMLElement, handle: HTMLElement): void {
    const visualizationContainer = this.container;
    
    if (!visualizationContainer) return;
    
    let hoverTimer: number | null = null;
    let leaveTimer: number | null = null;
    
    // 鼠标悬停在抓手上时，显示面板（延迟200ms，避免意外触发）
    handle.addEventListener('mouseenter', () => {
      // 清除任何现有的离开计时器
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      
      // 如果面板已显示，不需要再设置计时器
      if (controlPanel.classList.contains('visible')) {
        return;
      }
      
      // 设置短暂延迟后显示面板
      hoverTimer = window.setTimeout(() => {
        controlPanel.classList.add('visible');
        handle.classList.add('panel-visible');
      }, 200);
    });
    
    // 鼠标离开抓手时，如果悬停计时器存在就取消它
    handle.addEventListener('mouseleave', () => {
      // 清除悬停计时器
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      
      // 面板已显示情况下不自动隐藏，用户需要点击外部或抓手来隐藏
    });

    // 点击抓手切换控制面板可见性（面板显示时点击将隐藏）
    handle.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      
      // 如果面板已显示，则隐藏它；否则就保持显示
      if (controlPanel.classList.contains('visible')) {
        controlPanel.classList.remove('visible');
        handle.classList.remove('panel-visible');
      }
    });
    
    // 鼠标进入面板时清除任何可能的离开计时器
    controlPanel.addEventListener('mouseenter', () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    });
    
    // 鼠标离开面板时，设置延迟后自动隐藏（可以通过用户移动到抓手或再次进入面板来取消）
    controlPanel.addEventListener('mouseleave', (e: MouseEvent) => {
      // 检查是否是移动到抓手上，如果是，不设置离开计时器
      const toElement = (e as any).relatedTarget;
      if (toElement === handle) {
        return;
      }
      
      // 设置离开计时器，延迟隐藏面板
      leaveTimer = window.setTimeout(() => {
        controlPanel.classList.remove('visible');
        handle.classList.remove('panel-visible');
      }, 500); // 给用户半秒钟的时间来回到面板
    });
    
    // 点击可视化区域关闭控制面板
    visualizationContainer.addEventListener('click', () => {
      if (controlPanel.classList.contains('visible')) {
        controlPanel.classList.remove('visible');
        handle.classList.remove('panel-visible');
      }
    });
    
    // 防止点击控制面板内部元素时关闭面板
    controlPanel.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
    });
    
    // 添加键盘快捷键 (Esc 关闭面板)
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && controlPanel.classList.contains('visible')) {
        controlPanel.classList.remove('visible');
        handle.classList.remove('panel-visible');
      }
    });
    
    // 记录初始状态
    if (controlPanel.classList.contains('visible')) {
      handle.classList.add('panel-visible');
    }
    
    logger.log('控制面板交互初始化完成');
  }

  /**
   * 初始化视图切换组件
   */
  private async initializeViewSwitcher(): Promise<void> {
    logger.log('初始化视图切换组件...');
    
    // 获取视图切换按钮
    const treeViewBtn = document.getElementById('tree-view');
    const timelineViewBtn = document.getElementById('timeline-view');
    
    if (!treeViewBtn || !timelineViewBtn) {
      logger.warn('未找到视图切换按钮，跳过初始化');
      return;
    }
    
    // 更新按钮状态以反映当前视图
    this.updateViewButtonsState();
    
    // 绑定点击事件
    treeViewBtn.addEventListener('click', () => {
      if (this.currentView !== 'tree') {
        this.switchView('tree');
      }
    });
    
    timelineViewBtn.addEventListener('click', () => {
      if (this.currentView !== 'timeline') {
        this.switchView('timeline');
      }
    });
    
    logger.log('视图切换组件初始化完成');
  }

  /**
   * 初始化会话选择器
   * 未来将替换为会话日历
   */
  private async initializeSessionSelector(): Promise<void> {
    logger.log('初始化会话选择器...');
    
    const sessionSelector = document.getElementById('session-selector');
    if (!sessionSelector) {
      logger.warn('未找到会话选择器元素');
      return;
    }
    
    // 添加临时加载选项
    sessionSelector.innerHTML = '';
    const loadingOption = document.createElement('option');
    loadingOption.value = '';
    loadingOption.textContent = '正在加载会话...';
    loadingOption.disabled = true;
    sessionSelector.appendChild(loadingOption);
    
    // 会话选择器将通过 handleSessionListLoaded 更新
    // 这里只设置初始状态
    
    logger.log('会话选择器初始化完成');
  }

  /**
   * 初始化筛选器
   */
  private async initializeFilters(): Promise<void> {
    logger.groupCollapsed('初始化筛选器...');
    
    // 为每个筛选器配置绑定事件处理
    this.filterConfigs.forEach(config => {
      const checkbox = document.getElementById(config.id) as HTMLInputElement;
      
      if (checkbox) {
        // 设置初始状态
        checkbox.checked = (this.filters as any)[config.property];
        
        // 绑定变更事件
        checkbox.addEventListener('change', () => {
          this.handleFilterChange(config.id, checkbox.checked);
        });
        
        logger.log(`筛选器 ${config.id} 初始化完成，状态: ${checkbox.checked}`);
      } else {
        logger.warn(`未找到筛选器元素: ${config.id}`);
      }
    });
    
    logger.groupEnd();
  }

  /**
   * 加载初始数据
   */
  private async loadInitialData(): Promise<void> {
    // 订阅会话加载事件
    sessionManager.onSessionLoaded(session => this.handleSessionLoaded(session));
    sessionManager.onSessionsListLoaded(sessions => this.handleSessionListLoaded(sessions));
    
    // 加载会话列表
    await sessionManager.loadSessions();
    
    // 加载当前会话
    await sessionManager.loadCurrentSession();
    
    logger.log('初始数据加载完成');
  }

  /**
   * 应用全局配置
   */
  applyGlobalConfig() {
    if (!window.navigraphSettings) {
      logger.log('全局配置不可用，使用默认设置');
      return;
    }
    
    try {
      const config = window.navigraphSettings;
      
      // 应用默认视图
      if (config.defaultView) {
        logger.log('应用默认视图:', config.defaultView);
        this.currentView = config.defaultView;
      }
            
      // 其他配置项应用...
      
    } catch (error) {
      logger.warn('应用全局配置出错:', error);
    }
  }

  /**
   * 初始化调试工具
   */
  private initDebugTools(): void {
    try {
      // 确保调试工具只初始化一次
      if (!this.debugTools) {
        logger.log('初始化调试工具...');
        this.debugTools = new DebugTools(this);
      }
    } catch (error) {
      logger.error('初始化调试工具失败:', error);
    }
  }
  /**
   * 初始化主视图
   * 包含主容器和SVG元素
   */
  private async initializeMainView(): Promise<void> {
    try {
      logger.log('初始化主视图...');
      
      // 调整容器大小
      this.updateContainerSize();
      
      // 初始化SVG
      this.initializeSvg();
      
      logger.log('主视图初始化完成');
    } catch (error) {
      logger.error('初始化主视图失败:', error);
      throw error;
    }
  }

  /**
   * 初始化SVG元素
   * 创建SVG元素及相应的分组
   */
  private initializeSvg(): void {
    if (!this.container) {
      throw new Error('容器不存在，无法初始化SVG');
    }
    
    logger.log('初始化SVG元素...');
    
    // 如果已有SVG元素，先移除
    const existingSvg = this.container.querySelector('svg');
    if (existingSvg) {
      existingSvg.remove();
    }
    
    try {
      // 创建SVG元素
      this.svg = window.d3.select(this.container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('class', 'visualization-svg')
        .attr('data-view', this.currentView);
      
      // 添加根分组
      const mainGroup = this.svg.append('g')
        .attr('class', 'main-group');
      
      // 创建链接组和节点组
      mainGroup.append('g')
        .attr('class', 'links-group');
      
      mainGroup.append('g')
        .attr('class', 'nodes-group');
      
      logger.log('SVG元素初始化成功');
    } catch (error) {
      logger.error('初始化SVG失败:', error);
      throw error;
    }
  }
  
  /**
   * 初始化消息监听
   */
  private initMessageListener(): void {
    logger.groupCollapsed('初始化可视化器消息监听...');
    
    // 使用已导入的 registerHandler 函数
    // 避免每次都动态导入
    
    // 注册刷新可视化消息处理函数
    registerHandler<BaseMessage, BaseResponse>('refreshVisualization', (message: any, sender, sendResponse) => {
      logger.log('收到可视化刷新请求');
      
      // 如果需要回复，发送响应
      if (message.requestId) {
        sendResponse({ success: true, requestId: message.requestId } as BaseResponse);
      }
      
      // 延迟执行刷新操作
      setTimeout(async () => {
        try {
          logger.log('🔄 开始执行刷新操作...');
          await sessionManager.loadSessions();
          await sessionManager.loadCurrentSession();
          this.refreshVisualization();
          logger.log('✅ 刷新操作完成');
        } catch (err) {
          logger.error('❌ 自动刷新可视化失败:', err);
        }
      }, 50);
      
      // 返回false表示已同步处理了响应
      return false;
    });
    
    // 注册页面活动消息处理函数
    registerHandler<BaseMessage, BaseResponse>('pageActivity', (message: any) => {
      logger.log('收到页面活动事件，触发刷新', message.source);
      
      // 触发刷新操作
      this.triggerRefresh();
      
      // 不需要回复
      return false;
    });
    
    // 链接点击消息处理
    registerHandler<BaseMessage, BaseResponse>('linkClicked', (message: any, sender, sendResponse) => {
      logger.log('收到链接点击消息:', message.linkInfo);
      
      // 确认收到
      if (message.requestId) {
        sendResponse({ success: true, requestId: message.requestId } as BaseResponse);
      }
      
      // 延迟刷新可视化图表
      setTimeout(async () => {
        try {
          await sessionManager.loadSessions();
          await sessionManager.loadCurrentSession();
          this.refreshVisualization();
          logger.log('基于链接点击刷新可视化完成');
        } catch (err) {
          logger.error('链接点击后刷新可视化失败:', err);
        }
      }, 100);
      
      return false;
    });
    
    // 表单提交消息处理
    registerHandler<BaseMessage, BaseResponse>('formSubmitted', (message: any, sender, sendResponse) => {
      logger.log('收到表单提交消息:', message.formInfo);
      
      // 确认收到
      if (message.requestId) {
        sendResponse({ success: true, requestId: message.requestId } as BaseResponse);
      }
      
      // 延迟刷新可视化图表
      setTimeout(async () => {
        try {
          await sessionManager.loadSessions();
          await sessionManager.loadCurrentSession();
          this.refreshVisualization();
          logger.log('基于表单提交刷新可视化完成');
        } catch (err) {
          logger.error('表单提交后刷新可视化失败:', err);
        }
      }, 150);
      
      return false;
    });
    
    // 节点ID获取消息处理
    registerHandler<BaseMessage, BaseResponse>('getNodeId', (message: any, sender, sendResponse) => {
      logger.log('收到获取节点ID请求:', message.url);
      
      // 从当前数据中查找URL对应的节点ID
      let nodeId: string | undefined = undefined;
      if (this.nodes && message.url) {
        const node = this.nodes.find(n => n.url === message.url);
        nodeId = node?.id;
      }
      
      // 返回找到的节点ID
      sendResponse({ success: true, nodeId, requestId: message.requestId } as BaseResponse);
      
      return false; // 同步处理
    });
    
    // favicon更新消息处理
    registerHandler<BaseMessage, BaseResponse>('faviconUpdated', (message: any, sender, sendResponse) => {
      logger.log('收到favicon更新消息:', message.url, message.favicon);
      
      // 确认收到
      if (message.requestId) {
        sendResponse({ success: true, requestId: message.requestId } as BaseResponse);
      }
      
      return false; // 同步处理
    });
    
    // 页面加载完成消息处理
    registerHandler<BaseMessage, BaseResponse>('pageLoaded', (message: any, sender, sendResponse) => {
      logger.log('收到页面加载完成消息:', message.pageInfo?.url);
      
      // 确认收到
      if (message.requestId) {
        sendResponse({ success: true, requestId: message.requestId } as BaseResponse);
      }
      
      // 延迟刷新视图
      setTimeout(async () => {
        try {
          await sessionManager.loadSessions();
          await sessionManager.loadCurrentSession();
          this.refreshVisualization();
          logger.log('页面加载后刷新可视化完成');
        } catch (err) {
          logger.error('页面加载后刷新可视化失败:', err);
        }
      }, 200);
      
      // 返回false表示已同步处理响应
      return false;
    });
    
    logger.groupEnd();
  }
  /**
   * 清理资源
   * 在可视化器销毁或者组件卸载时调用
   */
  cleanup(): void {
    logger.groupCollapsed('清理可视化器资源...');
    
    // 取消注册消息处理函数
    unregisterHandler('getNodeId');
    unregisterHandler('pageLoaded');
    unregisterHandler('pageTitleUpdated');
    unregisterHandler('faviconUpdated');
    unregisterHandler('pageActivity');
    unregisterHandler('linkClicked');
    unregisterHandler('formSubmitted');
    unregisterHandler('jsNavigation');
  
    // 移除事件监听器
    window.removeEventListener('resize', () => this.updateContainerSize());
    
    // 清理其他资源...
    logger.groupEnd;
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
      logger.log('最近已经刷新过，跳过此次刷新');
      return;
    }
    
    this.lastRefreshTime = now;
    logger.log('触发可视化刷新...');
    
    // 执行刷新操作
    setTimeout(async () => {
      try {
        await sessionManager.loadSessions();
        await sessionManager.loadCurrentSession();
        this.refreshVisualization();
        logger.log('页面活动触发的刷新完成');
      } catch (err) {
        logger.error('触发刷新失败:', err);
      }
    }, 100);
  }
  
  /**
   * 刷新可视化
   * 处理外部请求刷新可视化的消息
   */
  refreshVisualization(data?: any, options: { restoreTransform?: boolean } = {}): void {
    logger.log('执行刷新可视化...', data ? '使用提供的数据' : '使用现有数据');
    
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
      
      logger.log('可视化刷新完成');
    } catch (error) {
      this.showError('刷新失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  /**
   * 处理筛选器变化
   */
  private handleFilterChange(filterId: string, checked: boolean): void {
    // 查找对应的筛选器配置
    const config = this.filterConfigs.find(f => f.id === filterId);
    if (!config) {
      logger.warn(`未知筛选器ID: ${filterId}`);
      return;
    }
    
    // 更新筛选器状态
    (this.filters as any)[config.property] = checked;
    
    logger.log(`筛选器 ${filterId} (${config.property}) 已更改为 ${checked}`);
    
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
   * 处理单个会话加载
   */
  handleSessionLoaded(session: SessionDetails | null): void {
    logger.log('会话已加载，准备更新UI和数据');
    
    // 移除加载状态
    document.body.classList.remove('loading-session');
    
    if (!session) {
      this.showError('会话加载失败或无可用会话');
      return;
    }
    
    // 保存当前会话
    this.currentSession = session;
    
    // 从节点管理器获取处理好的数据
    this.allNodes = [...nodeManager.getNodes()];
    this.allEdges = [...nodeManager.getEdges()];
    this.nodes = [...this.allNodes];
    this.edges = [...this.allEdges];
    this.nodeMap = nodeManager.getNodeMap();
    
    // 更新会话相关UI
    this.updateSessionUI();
    
    // 应用筛选器
    this.applyFilters();
    
    // 刷新可视化
    this.refreshVisualization(undefined, { restoreTransform: true });
  }
  /**
   * 更新会话相关UI
   */
  private updateSessionUI(): void {
    // 更新会话选择器
    this.updateSessionSelector();
    
    // 更新状态栏
    this.updateStatusBar();
    
    // 隐藏控制面板（如果可见）
    const controlPanel = document.getElementById('control-panel');
    if (controlPanel && controlPanel.classList.contains('visible')) {
      controlPanel.classList.remove('visible');
    }
  }
  /**
   * 处理会话列表加载事件
   */
  handleSessionListLoaded(sessions: any[]): void {
    logger.log(`会话列表已加载，共${sessions.length}个会话`);
    
    // 更新会话选择器
    this.updateSessionSelector(sessions);
  }

  /**
   * 更新会话选择器
   */
  updateSessionSelector(sessions: any[] = []) {
    const selector = document.getElementById('session-selector') as HTMLSelectElement;
    if (!selector) {
      logger.warn('找不到会话选择器元素');
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
    
    // 移除旧的事件监听器，避免多次绑定
    selector.removeEventListener('change', this._sessionSelectorChangeHandler);
    
    // 添加会话切换事件处理
    this._sessionSelectorChangeHandler = async (e: Event) => {
      const target = e.target as HTMLSelectElement;
      if (!target.value) return;
      
      logger.log(`选择了新会话: ${target.value}`);
      
      try {
        // 显示加载状态
        document.body.classList.add('loading-session');
        
        // 切换到新会话
        await sessionManager.switchSession(target.value);
        
        // 加载成功后，loading状态会在handleSessionLoaded中移除
      } catch (error) {
        logger.error('切换会话失败:', error);
        document.body.classList.remove('loading-session');
        alert(`切换会话失败: ${error instanceof Error ? error.message : String(error)}`);
        
        // 回滚选择器值到当前会话
        const currentId = sessionManager.getCurrentSessionId();
        if (currentId) {
          selector.value = currentId;
        }
      }
    };
    
    selector.addEventListener('change', this._sessionSelectorChangeHandler);
    
    logger.log(`会话选择器已更新，共${sessions.length}个选项`);
  }

  // 添加到类定义中的属性部分
  private _sessionSelectorChangeHandler: (e: Event) => Promise<void> = async () => {};

  /**
   * 切换视图
   */
  switchView(view: 'tree' | 'timeline'): void {
    if (this.currentView === view) return;
    
    const previousView = this.currentView;
    logger.log(`切换视图: ${previousView} -> ${view}`);
    
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
      logger.error('切换视图失败:', error);
      
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
      logger.error('无法渲染可视化：容器或SVG不存在');
      return;
    }
    
    try {
      // 获取容器大小
      const width = this.container.clientWidth || 800;
      const height = this.container.clientHeight || 600;
      
      // 保存尺寸
      this.width = width;
      this.height = height;
      
      // 清除现有可视化
      this.svg.selectAll('*').remove();
      
      // 创建基本SVG结构
      const mainGroup = this.svg.append('g')
        .attr('class', 'main-group');
        
      mainGroup.append('g')
        .attr('class', 'links-group');
        
      const nodesGroup = mainGroup.append('g')
        .attr('class', 'nodes-group');
      
      // 检查是否有数据可渲染
      const hasData = this.nodes && this.nodes.length > 0;
      
      logger.log(`开始渲染${this.currentView}视图, 节点数: ${hasData ? this.nodes.length : 0}, 边数: ${hasData ? this.edges.length : 0}, 尺寸: ${width}x${height}`);
      
      // 如果没有数据，创建一个会话节点
      if (!hasData) {
        // 创建一个会话节点
        const sessionNode = nodesGroup.append('g')
          .attr('class', 'node session-node empty-session')
          .attr('transform', `translate(${width / 2}, ${height / 2})`);
        
        // 添加节点外圈
        sessionNode.append('circle')
          .attr('r', 40)
          .attr('class', 'node-circle empty-node-circle');
        
        // 添加会话图标
        sessionNode.append('text')
          .attr('class', 'node-icon empty-node-icon')
          .attr('text-anchor', 'middle')
          .text('📋');
        
        // 添加提示文字
        const sessionTitle = this.currentSession?.title || '当前会话';
        sessionNode.append('text')
          .attr('class', 'node-label empty-node-label')
          .attr('dy', 70)
          .attr('text-anchor', 'middle')
          .text(sessionTitle);
        
        // 添加无数据提示
        sessionNode.append('text')
          .attr('class', 'empty-data-message')
          .attr('dy', 90)
          .attr('text-anchor', 'middle')
          .text('暂无浏览记录');
        
        // 为空会话节点添加闪烁动画
        this.addEmptySessionAnimation(sessionNode);
        
        // 为会话节点添加点击事件，显示创建新会话选项
        sessionNode.on('click', () => {
          // 显示会话选项
          const sessionSelector = document.getElementById('session-selector');
          if (sessionSelector) {
            sessionSelector.click();
          }
        });
        
        // 添加简单的缩放功能
        this.setupBasicZoom();
        
      } else {
        // 根据当前视图类型渲染
        if (this.currentView === 'timeline') {
          if (this._timelineZoom) {
            this.zoom = this._timelineZoom;
          } else {
            this.zoom = 1.0;
            this._timelineZoom = 1.0;
          }
          
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
          if (this._treeZoom) {
            this.zoom = this._treeZoom;
          } else {
            this.zoom = 1.0;
            this._treeZoom = 1.0;
          }
          
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
      }
      
      // 更新状态栏
      this.updateStatusBar();
      
      logger.log('可视化渲染完成', {
        view: this.currentView,
        zoom: this.zoom ? '已设置' : '未设置',
        hasData
      });
      
    } catch (error) {
      this.showError('渲染失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 为空会话节点添加闪烁动画
   */
  private addEmptySessionAnimation(sessionNode: any): void {
    // 添加脉冲动画
    sessionNode.select('.node-circle')
      .append('animate')
      .attr('attributeName', 'r')
      .attr('values', '40;43;40')
      .attr('dur', '2s')
      .attr('repeatCount', 'indefinite');
      
    // 添加透明度变化
    sessionNode.select('.node-circle')
      .append('animate')
      .attr('attributeName', 'opacity')
      .attr('values', '0.5;0.8;0.5')
      .attr('dur', '2s')
      .attr('repeatCount', 'indefinite');
  }

  /**
   * 设置基本缩放功能
   */
  private setupBasicZoom(): void {
    if (!this.svg) return;
    
    const zoom = d3.zoom()
      .scaleExtent([0.5, 2])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        this.svg.select('.main-group')
          .attr('transform', event.transform);
          
        // 保存当前变换
        this.currentTransform = event.transform;
        
        // 更新状态栏
        this.updateStatusBar();
      });
      
    this.svg.call(zoom);
    this.zoom = zoom;
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
        logger.log(`更新容器大小: ${width}x${height}`);
        
        // 应用尺寸
        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;
        
        // 如果已有可视化，重新渲染
        if (this.nodes.length > 0) {
        this.renderVisualization({ restoreTransform: true });
        }
    } else {
        logger.log('容器大小变化不显著，跳过更新');
    }
  }
  
  /**
   * 应用筛选器并重新渲染
   * 可以选择传入新的筛选器，或使用当前类中的筛选器
   */
  applyFilters(): void {
    
    logger.log('应用筛选器:', this.filters);
    
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
      logger.warn('没有原始数据可供筛选');
      return;
    }
    
    logger.log('开始根据筛选条件过滤节点...');
    
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
          logger.log(`过滤掉节点：${nodeDesc} - 类型被禁用`);
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
    
    logger.log(`筛选结果: 从${this.allNodes.length}个节点中筛选出${filteredNodes.length}个符合条件的节点`);
    
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
      
      logger.log('已更新URL以反映当前视图和筛选状态');
    } catch (error) {
      logger.warn('更新URL失败:', error);
    }
  }
  
  /**
   * 显示错误
   */
  showError(message: string = '操作失败') {
    logger.error(message);

    // 显示错误通知而非空状态
    const notificationContainer = document.querySelector('.notification-container') || document.createElement('div');
    if (!notificationContainer.classList.contains('notification-container')) {
      notificationContainer.className = 'notification-container';
      document.body.appendChild(notificationContainer);
    }
    
    const notification = document.createElement('div');
    notification.className = 'notification error';
    notification.textContent = message;
    
    // 添加关闭按钮
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => notification.remove();
    notification.appendChild(closeBtn);
    
    notificationContainer.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
  }
  
  /**
   * 显示节点详情
   * @param node 节点数据
   */
  showNodeDetails(node: NavNode): void {
    logger.log('显示节点详情:', node);
    
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
   * 判断页面是否为跟踪页面
   */
  isTrackingPage(node: any): boolean {
    if (!node || !node.url) return false;
    
    const url = node.url.toLowerCase();
    
    return this.trackingKeywords.some(keyword => url.includes(keyword));
  }
  
  /**
   * 更新视图按钮状态
   */
  updateViewButtonsState(): void {    
    logger.log('更新视图按钮状态，当前视图:', this.currentView);
    
    // 直接获取视图按钮，而不是依赖未定义的 this.viewButtons
    const treeViewBtn = document.getElementById('tree-view');
    const timelineViewBtn = document.getElementById('timeline-view');
    
    if (!treeViewBtn || !timelineViewBtn) {
      logger.warn('未找到视图切换按钮，无法更新状态');
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
    
   logger.log('已更新按钮状态为:', this.currentView);
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
      logger.warn('无法应用变换状态', e);
      this._isRestoringTransform = false;
    }
  }
}