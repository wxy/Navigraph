/**
 * 导航图谱可视化器核心类
 */
import { Logger } from '../../lib/utils/logger.js';
import { _, _Error } from '../../lib/utils/i18n.js';
import { DebugTools } from '../debug/debug-tools.js';
import type { NavNode, NavLink, Visualizer } from '../types/navigation.js';
import type { SessionDetails } from '../types/session.js';
import { nodeManager } from './node-manager.js';
import { DataProcessor } from '../visualizer/DataProcessor.js';
import { UIManager } from '../visualizer/ui/UIManager.js';
import { RendererFactory } from '../visualizer/renderers/RendererFactory.js';
import { ViewStateManager } from '../visualizer/state/ViewStateManager.js';
import { SessionViewController } from '../visualizer/state/SessionViewController.js';
import { NavigationMessageHandler } from '../messaging/handlers/navigation-message-handler.js';
import { FilterManager } from '../visualizer/state/FilterManager.js';
import type { FilterStates } from '../visualizer/ui/FilterConfig.js';
import { RenderingManager } from '../visualizer/renderers/RenderingManager.js';

const logger = new Logger('NavigationVisualizer');
/**
 * 导航可视化器类
 * 负责可视化导航数据
 */ 
export class NavigationVisualizer implements Visualizer {
  // 可视化容器
  container: HTMLElement | null = null;

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

  private dataProcessor: DataProcessor = new DataProcessor();
  private uiManager: UIManager = new UIManager(this);
  
  // 添加调试工具属性
  private debugTools: DebugTools | null = null;

  // 添加ViewStateManager
  private viewStateManager: ViewStateManager;

  // 添加消息处理器属性
  private messageHandler: NavigationMessageHandler;

  // 添加会话视图控制器属性
  private sessionViewController: SessionViewController;

  // 添加 FilterManager 属性
  private filterManager: FilterManager;

  // 添加渲染管理器属性
  private renderingManager: RenderingManager;

  // 修改 filters getter 以使用 FilterManager
  get filters(): FilterStates {
    return this.filterManager.filters;
  }

  /**
   * 构造函数
   */
  constructor() {
    logger.log(_('nav_visualizer_init_start', '初始化NavigationVisualizer...'));
    
    // 初始化视图状态管理器
    this.viewStateManager = new ViewStateManager(this);
    
    // 初始化消息处理器
    this.messageHandler = new NavigationMessageHandler(this);
    
    // 初始化UI管理器
    this.uiManager = new UIManager(this);
    
    // 初始化会话视图控制器
    this.sessionViewController = new SessionViewController(this, this.uiManager);
    
    // 初始化筛选器管理器 - 新增
    this.filterManager = new FilterManager(this, this.dataProcessor, this.uiManager);
    
    // 初始化渲染管理器
    this.renderingManager = new RenderingManager(this, this.viewStateManager, this.uiManager);
    
    // 设置缩放变化回调
    this.viewStateManager.setOnZoomChangeCallback(
      // 使用NavigationVisualizer中的节流函数
      () => this.updateStatusBarThrottled()
    );
    // 检查d3是否已加载
    if (typeof window.d3 === "undefined") {
      logger.error(_('content_d3_lib_missing', 'd3 库未加载，可视化功能将不可用。请确保已包含d3.js库。'));
      alert(_('content_d3_lib_missing', 'd3 库未加载，可视化功能将不可用。请确保已包含d3.js库。'));
    } else {
      logger.log(_('d3_lib_loaded', 'd3 库已加载: {0}'), window.d3.version);
    }
  }

  // 代理属性，保持向后兼容性
  get currentView(): string {
    return this.viewStateManager.currentView;
  }
  
  set currentView(view: string) {
    this.viewStateManager.currentView = view;
  }
  
  get svg(): any {
    return this.viewStateManager.svg;
  }
  
  set svg(value: any) {
    this.viewStateManager.svg = value;
  }
  
  get zoom(): any {
    return this.viewStateManager.zoom;
  }
  
  set zoom(value: any) {
    this.viewStateManager.zoom = value;
  }
  
  get currentTransform(): any {
    return this.viewStateManager.currentTransform;
  }
  
  set currentTransform(value: any) {
    this.viewStateManager.currentTransform = value;
  }
  
  // 暴露瀑布视图的观察窗口索引
  get waterfallObservationIndex(): number {
    return this.viewStateManager.waterfallObservationIndex;
  }
  
  set waterfallObservationIndex(value: number) {
    this.viewStateManager.waterfallObservationIndex = value;
  }

  /**
   * 初始化导航可视化
   * 按照明确的层次结构组织初始化过程
   */
  async initialize() {
    try {
      logger.log(_('nav_visualization_init_start', '初始化导航可视化...'));

      // 第一阶段：基础配置与消息
      await this.initializeBaseConfig();

      // 第二阶段：委托UI管理器处理所有UI初始化
      await this.initializeUI();
      
      // 初始化筛选器管理器 - 新增
      this.filterManager.initialize();

      // 初始化调试工具
      this.initDebugTools();

      // 第三阶段：数据加载与应用 - 使用会话视图控制器
      await this.sessionViewController.initialize();

      logger.log(_('nav_visualizer_init_complete', 'NavigationVisualizer 初始化完成'));
    } catch (error) {
      this.showError(
        _('content_init_failed', '初始化失败: ') + ": " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * 初始化基础配置与消息监听
   */
  private async initializeBaseConfig(): Promise<void> {
    // 初始化消息处理器 - 替换原来的 initMessageListener
    this.messageHandler.initialize();

    // 应用全局配置
    this.applyGlobalConfig();

    // 确保DOM已加载完成
    if (document.readyState !== "complete") {
      logger.log(_('waiting_for_dom_complete', '等待DOM加载完成...'));
      await new Promise<void>((resolve) => {
        window.addEventListener("load", () => resolve());
      });
    }

    logger.log(_('base_config_and_messaging_init_complete', '基础配置与消息监听初始化完成'));
  }

  /**
   * 初始化UI - 修改使用渲染管理器
   */
  private async initializeUI(): Promise<void> {
    // 委托UI管理器处理所有UI相关任务，并获取SVG元素
    const { container, svg } = this.uiManager.initialize();
    this.container = container;

    // 初始化渲染管理器
    this.renderingManager.initialize(container);

    // 添加窗口大小变化监听 - 委托给渲染管理器
    window.addEventListener("resize", () => this.renderingManager.handleResize());
    
    // 使用返回的SVG元素
    if (svg) {
      // 使用渲染管理器配置SVG
      this.renderingManager.setupSvg(svg);
    } else {
      throw new _Error('content_svg_create_failed', '无法创建SVG元素');
    }
  }

  // 更新状态栏
  public updateStatusBar(): void {
    this.uiManager.updateStatusBar();
  }

  /**
   * 获取观察窗口时间范围（仅瀑布视图）
   * @returns 时间范围字符串，如 "14:20 - 14:50"，如果不是瀑布视图或无数据则返回 null
   */
  public getObservationWindowTimeRange(): string | null {
    if (this.currentView !== 'waterfall') {
      return null;
    }

    const currentRenderer = this.renderingManager.getCurrentRenderer();
    if (currentRenderer && typeof currentRenderer.getObservationWindowTimeRange === 'function') {
      return currentRenderer.getObservationWindowTimeRange();
    }

    return null;
  }

  /**
   * 应用全局配置
   */
  applyGlobalConfig() {
    if (!window.navigraphSettings) {
      logger.log(_('global_config_unavailable_using_defaults', '全局配置不可用，使用默认设置'));
      return;
    }

    try {
      const config = window.navigraphSettings;

      // 应用默认视图
      if (config.defaultView) {
        logger.log(_('applying_default_view', '应用默认视图: {0}'), config.defaultView);
      }

      // 其他配置项应用...
    } catch (error) {
      logger.warn(_('global_config_apply_failed', '应用全局配置出错'), error);
    }
  }

  /**
   * 初始化调试工具
   */
  private initDebugTools(): void {
    try {
      // 确保调试工具只初始化一次
      if (!this.debugTools) {
        logger.log(_('debug_tools_init_start', '初始化调试工具...'));
        this.debugTools = new DebugTools(this);
      }
    } catch (error) {
      logger.error(_('debug_tools_init_failed', '初始化调试工具失败'), error);
    }
  }

  /**
   * 清理资源
   * 在可视化器销毁或者组件卸载时调用
   */
  cleanup(): void {
    logger.groupCollapsed(_('visualizer_resources_cleanup_start', '清理可视化器资源...'));

    // 清理消息处理器
    this.messageHandler.cleanup();

    // 清理筛选器管理器
    this.filterManager.cleanup();
    
    // 清理渲染管理器
    this.renderingManager.cleanup();

    // 移除事件监听器
    window.removeEventListener("resize", () => this.renderingManager.handleResize());

    // 清理其他资源...
    logger.groupEnd();
  }

  /**
   * 更新容器大小 - 委托给渲染管理器
   */
  updateContainerSize(): void {
    this.renderingManager.updateContainerSize();
  }
  /**
   * 节流更新状态栏
   */
  private updateStatusBarThrottled = (() => {
    let ticking = false;
    return () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          this.updateStatusBar();
          ticking = false;
        });
        ticking = true;
      }
    };
  })();
  /**
   * 触发刷新操作
   * 包含节流控制逻辑
   */
  private lastRefreshTime = 0;
  private readonly REFRESH_MIN_INTERVAL = 5000; // 最少5秒刷新一次

  triggerRefresh(): void {
    const now = Date.now();
    if (now - this.lastRefreshTime < this.REFRESH_MIN_INTERVAL) {
      logger.log(_('refresh_skipped_too_frequent', '最近已经刷新过，跳过此次刷新'));
      return;
    }

    this.lastRefreshTime = now;
    logger.log(_('visualization_refresh_triggered', '触发可视化刷新...'));

    // 执行刷新操作
    setTimeout(async () => {
      try {
        // 修改：通过会话处理器刷新数据，而不是直接调用sessionServiceClient
        await this.sessionViewController.refreshSessionData();
        this.refreshVisualization();
        logger.log(_('page_activity_refresh_complete', '页面活动触发的刷新完成'));
      } catch (err) {
        logger.error(_('refresh_trigger_failed', '触发刷新失败'), err);
      }
    }, 100);
  }

  /**
   * 刷新可视化
   */
  public refreshVisualization(data?: any, options: any = {}): void {
    // 获取控制选项
    const skipSessionEvents = options.skipSessionEvents === true;
    
    try {
      this.renderingManager.refreshVisualization(data, options);
    
      // 触发会话相关事件的条件判断
      if (!skipSessionEvents) {
        // 可能触发会话加载的代码...
      }
      
      logger.log(_('visualization_refresh_complete', '可视化刷新完成'));
    } catch (error) {
      logger.error(_('visualization_refresh_failed', '可视化刷新失败'), error);
    }
  }

  /**
   * 处理筛选器变化
   * 修改为使用FilterManager
   */
  private handleFilterChange(filterId: string, checked: boolean): void {
    this.filterManager.handleFilterChange(filterId, checked);
  }

  /**
   * 切换视图 - 修改使用渲染管理器
   */
  switchView(view: "tree" | "timeline" | "waterfall"): void {
    // 过滤掉 timeline（已删除）
    if (view === "timeline") {
      logger.warn(_('timeline_view_removed', 'Timeline 视图已被移除'));
      return;
    }
    
    // 使用视图状态管理器切换视图
    this.viewStateManager.switchView(view as "tree" | "waterfall");

    // 更新按钮状态
    this.updateViewButtonsState();

    try {
      // 重新初始化 SVG 结构
      const svg = this.uiManager.createSvgElement();
      if (svg) {
        // 使用渲染管理器配置SVG
        this.renderingManager.setupSvg(svg);
      } else {
        throw new _Error('content_svg_missing', 'SVG元素不存在');
      }

      // 使用渲染管理器重新渲染
      this.refreshVisualization(undefined, { restoreTransform: true });
    } catch (error) {
      logger.error(_('reinit_view_failed', '重新初始化视图失败'), error);
      this.showError(_('content_view_switch_failed', '切换视图失败') + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 应用筛选器并刷新（实现Visualizer接口）
   * 修改为使用FilterManager
   */
  public applyFilters(): void {
    const result = this.filterManager.applyFilters(this.allNodes, this.allEdges);
    this.nodes = result.nodes;
    this.edges = result.edges;
  }

  /**
   * 切换已关闭页面筛选器
   */
  public toggleClosedFilter(): void {
    logger.log(_('toggle_closed_filter', '切换已关闭页面筛选器'));
    
    // 获取当前 closed 筛选器的状态
    const currentState = this.filters.closed;
    
    // 切换状态
    this.filterManager.handleFilterChange('filter-closed', !currentState);
  }

  /**
   * 切换视图（在树形和瀑布视图之间）
   */
  public toggleView(): void {
    logger.log(_('toggle_view', '切换视图'));
    
    // 获取当前视图
    const currentView = this.viewStateManager.currentView;
    
    // 切换到另一个视图
    const newView = currentView === 'tree' ? 'waterfall' : 'tree';
    
    logger.log(_('switching_view', '从 {0} 切换到 {1}'), currentView, newView);
    
    // 使用现有的 switchView 方法
    this.switchView(newView);
  }

  /**
   * 切换到当天的会话
   */
  public switchToToday(): void {
    logger.log(_('switch_to_today', '切换到当天'));
    
    // 使用 SessionViewController 切换到当天
    if (this.sessionViewController) {
      this.sessionViewController.switchToToday();
    } else {
      logger.warn(_('session_view_controller_unavailable', 'SessionViewController 不可用'));
    }
  }

  /**
   * 更新筛选器配置（实现Visualizer接口）
   * 修改为使用FilterManager
   */
  public updateFilter(filterId: string, value: boolean): void {
    this.filterManager.updateFilter(filterId, value);
  }

  /**
   * 更新节点视觉效果 - 委托给渲染管理器
   */
  private updateNodeVisual(nodeId: string): void {
    this.renderingManager.updateNodeVisual(nodeId, this.nodeMap);
  }

  /**
   * 显示错误
   */
  public showError(message: string): void {
    this.uiManager.showError(message);
  }
  /**
   * 设置加载状态
   */
  private setLoadingState(loading: boolean): void {
    this.uiManager.setLoadingState(loading);
  }
  /**
   * 显示节点详情
   * @param node 节点数据
   */
  public showNodeDetails(node: NavNode): void {
    this.uiManager.showNodeDetails(node);
  }
  public showDetailedError(
    title: string,
    message: string,
    stack?: string
  ): void {
    this.uiManager.showDetailedError(title, message, stack);
  }

  /**
   * 判断页面是否为跟踪页面
   */
  isTrackingPage(node: NavNode): boolean {
    return this.dataProcessor.isTrackingPage(node);
  }
  // 添加构建节点映射的方法
  buildNodeMap(nodes: NavNode[]): Map<string, NavNode> {
    return this.dataProcessor.buildNodeMap(nodes);
  }

  // 使用 dataProcessor 的 identifyRootNodes 方法
  identifyRootNodes(nodes: NavNode[]): string[] {
    return this.dataProcessor.identifyRootNodes(nodes);
  }
  /**
   * 更新视图按钮状态
   */
  private updateViewButtonsState(): void {
    this.uiManager.updateViewButtonsState(this.currentView);
  }
  /**
   * 更新节点元信息
   * @param nodeId 节点ID
   * @param metadata 元数据对象，可以包含title和favicon等
   */
  updateNodeMetadata(nodeId: string, metadata: {[key: string]: string}): void {
    if (!nodeId || !metadata) return;
    
    logger.debug(_('node_metadata_updating', '更新节点元信息: {0}'), nodeId, metadata);
    
    // 委托给节点管理器
    const updated = nodeManager.updateNodeMetadata(nodeId, metadata);
    
    if (updated) {
      // 如果更新成功，更新节点视觉效果
      this.updateNodeVisual(nodeId);
      logger.debug(_('node_metadata_updated', '节点{0}元信息已更新'), nodeId);
    } else {
      logger.warn(_('node_update_failed', '未能更新节点: {0}'), nodeId);
    }
  }

  /**
   * 获取或创建节点ID
   * @param url 页面URL
   * @returns 节点ID
   */
  getOrCreateNodeId(url: string): string {
    // 现有实现已经在 NodeManager 中
    return nodeManager.getOrCreateNodeId(url);
  }
  
  /**
   * 设置原始数据
   * 为会话处理器提供接口
   */
  setRawData(nodes: NavNode[], edges: NavLink[], nodeMap?: Map<string, NavNode>): void {
    // 保存原始数据
    this.allNodes = [...nodes];
    this.allEdges = [...edges];
    this.nodes = [...nodes];
    this.edges = [...edges];
    
    // 如果提供了节点映射，使用它
    if (nodeMap) {
      this.nodeMap = nodeMap;
    } else {
      this.nodeMap = this.buildNodeMap(nodes);
    }
    
    // 应用筛选器
    this.applyFilters();
  }
  
  /**
   * 处理页面加载消息 - 委托给会话处理器
   */
  async handlePageLoaded(message: any): Promise<void> {
    try {
      await this.sessionViewController.refreshSessionData();
      this.refreshVisualization();
      logger.log(_('page_load_refresh_complete', '页面加载后刷新可视化完成'));
    } catch (error) {
      logger.error(_('page_load_refresh_failed', '页面加载后刷新可视化失败'), error);
      throw error;
    }
  }
  
  /**
   * 处理链接点击消息 - 委托给会话处理器
   */
  async handleLinkClicked(message: any): Promise<void> {
    try {
      await this.sessionViewController.refreshSessionData();
      this.refreshVisualization();
      logger.log(_('link_click_refresh_complete', '基于链接点击刷新可视化完成'));
    } catch (error) {
      logger.error(_('link_click_refresh_failed', '链接点击后刷新可视化失败'), error);
      throw error;
    }
  }
  
  /**
   * 处理表单提交消息 - 姭托给会话处理器
   */
  async handleFormSubmitted(message: any): Promise<void> {
    try {
      await this.sessionViewController.refreshSessionData();
      this.refreshVisualization();
      logger.log(_('form_submit_refresh_complete', '基于表单提交刷新可视化完成'));
    } catch (error) {
      logger.error(_('form_submit_refresh_failed', '表单提交后刷新可视化失败'), error);
      throw error;
    }
  }
  
  /**
   * 处理JS导航消息 - 委托给会话处理器
   */
  async handleJsNavigation(message: any): Promise<void> {
    try {
      await this.sessionViewController.refreshSessionData();
      this.refreshVisualization();
      logger.log(_('js_navigation_refresh_complete', '基于JS导航刷新可视化完成'));
    } catch (error) {
      logger.error(_('js_navigation_refresh_failed', 'JS导航后刷新可视化失败'), error);
      throw error;
    }
  }
  
  /**
   * 刷新数据 - 委托给会话处理器
   */
  async refreshData(): Promise<void> {
    try {
      await this.sessionViewController.refreshSessionData();
      this.refreshVisualization();
      logger.log(_('data_refresh_complete', '刷新数据完成'));
    } catch (error) {
      logger.error(_('data_refresh_failed', '刷新数据失败'), error);
      throw error;
    }
  }

  /**
   * 实现 Visualizer.updateData 方法
   */
  updateData(data: any): void {
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
  
  /**
   * 实现 Visualizer.getFilterUrlParam 方法
   */
  getFilterUrlParam(): string {
    return this.filterManager.getFilterUrlParam();
  }
}