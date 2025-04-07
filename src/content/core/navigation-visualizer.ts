/**
 * 导航图谱可视化器核心类
 */
import { Logger } from '../../lib/utils/logger.js';
import { DebugTools } from '../debug/debug-tools.js';
import type { NavNode, NavLink, Visualizer } from '../types/navigation.js';
import type { SessionDetails } from '../types/session.js';

import { DataProcessor } from '../visualizer/DataProcessor.js';
import { UIManager } from '../visualizer/ui/UIManager.js';
import { FilterConfig, FilterStates, getInitialFilters, extractFilterStates } from '../visualizer/ui/FilterConfig.js';
import { RendererFactory } from '../visualizer/renderers/RendererFactory.js';
import { ViewStateManager } from '../visualizer/state/ViewStateManager.js';
import { SessionViewController } from '../visualizer/state/SessionViewController.js';
import { NavigationMessageHandler } from '../messaging/handlers/navigation-message-handler.js';

const logger = new Logger('NavigationVisualizer');
/**
 * 导航可视化器类
 * 负责可视化导航数据
 */ 
export class NavigationVisualizer implements Visualizer {
  // 可视化容器
  container: HTMLElement | null = null;

  // 替换原有的筛选器相关属性
  private filterConfigs: FilterConfig[] = getInitialFilters();
  
  get filters(): FilterStates {
    return extractFilterStates(this.filterConfigs);
  }

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

  /**
   * 构造函数
   */
  constructor() {
    logger.log("初始化NavigationVisualizer...");
    
    // 初始化视图状态管理器
    this.viewStateManager = new ViewStateManager(this);
    
    // 初始化消息处理器
    this.messageHandler = new NavigationMessageHandler(this);
    
    // 初始化UI管理器
    this.uiManager = new UIManager(this);
    
    // 初始化会话视图控制器
    this.sessionViewController = new SessionViewController(this, this.uiManager);
    
    // 设置缩放变化回调
    this.viewStateManager.setOnZoomChangeCallback(
      // 使用NavigationVisualizer中的节流函数
      () => this.updateStatusBarThrottled()
    );
    // 检查d3是否已加载
    if (typeof window.d3 === "undefined") {
      logger.error("d3 库未加载，可视化功能将不可用");
      alert("d3 库未加载，可视化功能将不可用。请确保已包含d3.js库。");
    } else {
      logger.log("d3 库已加载:", window.d3.version);
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

  /**
   * 初始化导航可视化
   * 按照明确的层次结构组织初始化过程
   */
  async initialize() {
    try {
      logger.log("初始化导航可视化...");

      // 第一阶段：基础配置与消息
      await this.initializeBaseConfig();

      // 第二阶段：委托UI管理器处理所有UI初始化
      await this.initializeUI();

      // 第三阶段：数据加载与应用 - 使用会话视图控制器
      await this.sessionViewController.initialize();

      logger.log("NavigationVisualizer 初始化完成");
    } catch (error) {
      this.showError(
        "初始化失败: " +
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
      logger.log("等待DOM加载完成...");
      await new Promise<void>((resolve) => {
        window.addEventListener("load", () => resolve());
      });
    }

    logger.log("基础配置与消息监听初始化完成");
  }

  private async initializeUI(): Promise<void> {
    // 委托UI管理器处理所有UI相关任务，并获取SVG元素
    const { container, svg } = this.uiManager.initialize();
    this.container = container;

    // 添加窗口大小变化监听
    window.addEventListener("resize", () => this.updateContainerSize());
    // 使用返回的SVG元素
    if (svg) {
      this.setupSvg(svg); // 配置SVG，添加所需的事件监听等
    } else {
      throw new Error("初始化失败：无法创建SVG元素");
    }
  }

  // 更新状态栏
  public updateStatusBar(): void {
    this.uiManager.updateStatusBar();
  }

  /**
   * 应用全局配置
   */
  applyGlobalConfig() {
    if (!window.navigraphSettings) {
      logger.log("全局配置不可用，使用默认设置");
      return;
    }

    try {
      const config = window.navigraphSettings;

      // 应用默认视图
      if (config.defaultView) {
        logger.log("应用默认视图:", config.defaultView);
        this.currentView = config.defaultView;
      }

      // 其他配置项应用...
    } catch (error) {
      logger.warn("应用全局配置出错:", error);
    }
  }

  /**
   * 初始化调试工具
   */
  private initDebugTools(): void {
    try {
      // 确保调试工具只初始化一次
      if (!this.debugTools) {
        logger.log("初始化调试工具...");
        this.debugTools = new DebugTools(this);
      }
    } catch (error) {
      logger.error("初始化调试工具失败:", error);
    }
  }

  /**
   * 配置SVG元素，添加D3所需结构
   * @param svgElement 由UIManager创建的原生SVG元素
   */
  private setupSvg(svgElement: SVGElement): void {
    logger.log("配置SVG元素...");

    try {
      // 确保有效的SVG元素
      if (!svgElement) {
        throw new Error("SVG元素为空");
      }
      
      // 将原生SVG元素转换为D3选择集
      const svg = d3
        .select(svgElement)
        .attr("class", "visualization-svg")
        .attr("data-view", this.currentView);
      
      // 设置SVG到视图状态管理器
      this.viewStateManager.svg = svg;

      // 添加根分组
      const mainGroup = svg.append("g").attr("class", "main-group");

      // 创建链接组和节点组
      mainGroup.append("g").attr("class", "links-group");
      mainGroup.append("g").attr("class", "nodes-group");

      // 使用视图状态管理器设置缩放行为
      this.viewStateManager.setupBasicZoom();

      logger.log("SVG配置成功");
    } catch (error) {
      logger.error("配置SVG元素失败:", error);
      throw error;
    }
  }

  /**
   * 清理资源
   * 在可视化器销毁或者组件卸载时调用
   */
  cleanup(): void {
    logger.groupCollapsed("清理可视化器资源...");

    // 清理消息处理器
    this.messageHandler.cleanup();

    // 移除事件监听器
    window.removeEventListener("resize", () => this.updateContainerSize());

    // 清理其他资源...
    logger.groupEnd;
  }

  /**
   * 更新容器大小并重新渲染
   */
  updateContainerSize(): void {
    if (!this.container) return;

    // 获取主容器尺寸
    const mainContainer = this.container.closest(".main-container");

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
    if (
      Math.abs(width - oldWidth) > threshold ||
      Math.abs(height - oldHeight) > threshold
    ) {
      logger.log(`更新容器大小: ${width}x${height}`);

      // 应用尺寸
      this.container.style.width = `${width}px`;
      this.container.style.height = `${height}px`;

      // 通知 UI 管理器容器大小变化
      this.uiManager.handleResize(width, height);

      // 如果已有可视化，重新渲染
      if (this.nodes.length > 0) {
        this.renderVisualization({ restoreTransform: true });
      }
    } else {
      logger.log("容器大小变化不显著，跳过更新");
    }
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
      logger.log("最近已经刷新过，跳过此次刷新");
      return;
    }

    this.lastRefreshTime = now;
    logger.log("触发可视化刷新...");

    // 执行刷新操作
    setTimeout(async () => {
      try {
        // 修改：通过会话处理器刷新数据，而不是直接调用sessionServiceClient
        await this.sessionViewController.refreshData();
        this.refreshVisualization();
        logger.log("页面活动触发的刷新完成");
      } catch (err) {
        logger.error("触发刷新失败:", err);
      }
    }, 100);
  }

  /**
   * 刷新可视化
   * 处理外部请求刷新可视化的消息
   */
  refreshVisualization(
    data?: any,
    options: { restoreTransform?: boolean } = {}
  ): void {
    logger.log("执行刷新可视化...", data ? "使用提供的数据" : "使用现有数据");

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
        restoreTransform: options.restoreTransform === true,
      });

      // 更新URL
      this.updateUrl();

      // 更新状态栏
      this.updateStatusBar();

      logger.log("可视化刷新完成");
    } catch (error) {
      this.showError(
        "刷新失败: " + (error instanceof Error ? error.message : String(error))
      );
    }
  }
  /**
   * 处理筛选器变化
   */
  private handleFilterChange(filterId: string, checked: boolean): void {
    // 查找对应的筛选器配置
    const config = this.filterConfigs.find((f) => f.id === filterId);
    if (!config) {
      logger.warn(`未知筛选器ID: ${filterId}`);
      return;
    }

    // 更新筛选器状态
    config.enabled = checked;

    // 通知 UI 管理器更新筛选器 UI
    this.uiManager.updateFilters(this.filters);

    logger.log(`筛选器 ${filterId} (${config.property}) 已更改为 ${checked}`);

    // 使用完整的刷新流程
    this.refreshVisualization(undefined, { restoreTransform: true });
  }

  /**
   * 切换视图
   */
  switchView(view: "tree" | "timeline"): void {
    // 使用视图状态管理器切换视图
    this.viewStateManager.switchView(view);

    // 更新按钮状态
    this.updateViewButtonsState();

    try {
      // 重新初始化 SVG 结构
      const svg = this.uiManager.createSvgElement();
      if (svg) {
        // 配置SVG元素，添加D3需要的结构
        this.setupSvg(svg);
      } else {
        throw new Error("无法创建SVG元素");
      }

      // 重新渲染
      this.refreshVisualization(undefined, { restoreTransform: true });
    } catch (error) {
      logger.error("重新初始化视图失败:", error);
      this.showError("切换视图失败: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 渲染可视化
   */
  renderVisualization(options: { restoreTransform?: boolean } = {}): void {
    if (!this.container || !this.svg) {
      logger.error("无法渲染可视化：容器或SVG不存在");
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
      this.svg.selectAll("*").remove();

      // 创建基本SVG结构
      const mainGroup = this.svg.append("g").attr("class", "main-group");

      mainGroup.append("g").attr("class", "links-group");

      const nodesGroup = mainGroup.append("g").attr("class", "nodes-group");

      // 检查是否有数据可渲染
      const hasData = this.nodes && this.nodes.length > 0;

      logger.log(
        `开始渲染${this.currentView}视图, 节点数: ${
          hasData ? this.nodes.length : 0
        }, 边数: ${hasData ? this.edges.length : 0}, 尺寸: ${width}x${height}`
      );

      // 如果没有数据，创建一个会话节点
      if (!hasData) {
        // 创建一个会话节点
        const sessionNode = nodesGroup
          .append("g")
          .attr("class", "node session-node empty-session")
          .attr("transform", `translate(${width / 2}, ${height / 2})`);

        // 添加节点外圈
        sessionNode
          .append("circle")
          .attr("r", 40)
          .attr("class", "node-circle empty-node-circle");

        // 添加会话图标
        sessionNode
          .append("image")
          .attr("class", "empty-node-icon")
          .attr("x", -16) // 图标宽度的一半的负值，使其居中
          .attr("y", -16) // 图标高度的一半的负值，使其居中
          .attr("width", 32)
          .attr("height", 32)
          .attr("href", chrome.runtime.getURL("images/logo-48.png"));

        // 添加提示文字
        const sessionTitle = this.currentSession?.title || "当前会话";
        sessionNode
          .append("text")
          .attr("class", "node-label empty-node-label")
          .attr("dy", 70)
          .attr("text-anchor", "middle")
          .text(sessionTitle);

        // 添加无数据提示
        sessionNode
          .append("text")
          .attr("class", "empty-data-message")
          .attr("dy", 90)
          .attr("text-anchor", "middle")
          .text("没有打开的浏览记录");

        // 为空会话节点添加闪烁动画
        this.addEmptySessionAnimation(sessionNode);

        // 为会话节点添加点击事件，显示创建新会话选项
        sessionNode.on("click", () => {
          // 显示会话选项
          const sessionSelector = document.getElementById("session-selector");
          if (sessionSelector) {
            sessionSelector.click();
          }
        });

        // 添加简单的缩放功能
        this.viewStateManager.setupBasicZoom();
      } else {
        // 使用渲染器工厂创建相应的渲染器
        const renderer = RendererFactory.createRenderer(
          this.currentView as 'tree' | 'timeline',
          this
        );
        
        // 初始化渲染器
        renderer.initialize(
          this.svg,
          this.container,
          width,
          height
        );
        
        // 渲染视图
        renderer.render(this.nodes, this.edges, {
          restoreTransform: options.restoreTransform
        });
      }

      // 在可视化渲染后，尝试恢复视图状态
      if (options.restoreTransform) {
        // 尝试恢复视图缩放状态
        setTimeout(() => {
          this.viewStateManager.restoreViewState();
        }, 50);
      }

      // 更新状态栏
      this.updateStatusBar();

      logger.log("可视化渲染完成", {
        view: this.currentView,
        zoom: this.zoom ? "已设置" : "未设置",
        hasData,
      });
    } catch (error) {
      this.showError(
        "渲染失败: " + (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * 为空会话节点添加闪烁动画
   */
  private addEmptySessionAnimation(sessionNode: any): void {
    // 添加脉冲动画
    sessionNode
      .select(".node-circle")
      .append("animate")
      .attr("attributeName", "r")
      .attr("values", "40;43;40")
      .attr("dur", "2s")
      .attr("repeatCount", "indefinite");

    // 添加透明度变化
    sessionNode
      .select(".node-circle")
      .append("animate")
      .attr("attributeName", "opacity")
      .attr("values", "0.5;0.8;0.5")
      .attr("dur", "2s")
      .attr("repeatCount", "indefinite");
  }

  /**
   * 应用筛选器并刷新（实现Visualizer接口）
   */
  public applyFilters(): void {
    // 使用简化的状态对象，与原有方法兼容
    const filterStates = this.filters;
    
    logger.log("应用筛选器:", filterStates);
    
    // 使用 DataProcessor 进行筛选
    const result = this.dataProcessor.applyFilters(
      this.allNodes,
      this.allEdges,
      filterStates
    );
    
    // 更新节点和边
    this.nodes = result.nodes;
    this.edges = result.edges;
    
    logger.log(
      `筛选后数据：节点 ${this.nodes.length}/${this.allNodes.length}，边 ${this.edges.length}/${this.allEdges.length}`
    );
  }

  /**
   * 更新筛选器配置（实现Visualizer接口）
   */
  public updateFilter(filterId: string, value: boolean): void {
    logger.log(`更新筛选器: ${filterId} = ${value}`);
    
    // 查找对应的筛选器配置
    const filter = this.filterConfigs.find(f => f.id === filterId);
    if (!filter) {
      logger.warn(`未知筛选器ID: ${filterId}`);
      return;
    }
    
    // 直接更新筛选器状态
    filter.enabled = value;
    
    // 通知 UI 管理器更新筛选器 UI
    this.uiManager.updateFilters(this.filters);
  }

  /**
   * 更新URL以反映当前视图和筛选状态
   * 实现原本可能缺失的 updateUrl 方法
   */
  private updateUrl(): void {
    try {
      const url = new URL(window.location.href);

      // 更新视图参数
      url.searchParams.set("view", this.currentView);

      // 更新筛选器参数
      url.searchParams.set(
        "filter",
        JSON.stringify({
          reload: this.filters.reload,
          history: this.filters.history,
          closed: this.filters.closed,
          tracking: this.filters.showTracking,
          typeLink: this.filters.typeLink,
          typeAddress: this.filters.typeAddress,
          typeForm: this.filters.typeForm,
          typeJs: this.filters.typeJs,
        })
      );

      // 不触发页面刷新的情况下更新URL
      window.history.replaceState(null, "", url);

      logger.log("已更新URL以反映当前视图和筛选状态");
    } catch (error) {
      logger.warn("更新URL失败:", error);
    }
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
   * 使元素可拖拽
   */
  private makeDraggable(element: HTMLElement): void {
    // 状态变量
    let isDragging = false;
    let dragStartX = 0,
      dragStartY = 0;
    let originalLeft = 0,
      originalTop = 0;

    // 设置初始位置 - 放置在右上角
    element.style.position = "absolute";
    element.style.right = "auto";
    element.style.bottom = "auto";

    // 设置右上角位置
    const containerRect = this.container
      ? this.container.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };

    // 初始位置：右上角，距离右侧20px，距离顶部70px
    element.style.left = `${containerRect.width - 320}px`;
    element.style.top = "70px";

    // 创建拖拽手柄
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    element.appendChild(handle);

    // 标题也可以用来拖动
    const title = element.querySelector(".node-details-title");
    if (title) {
      (title as HTMLElement).style.cursor = "move";
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
      originalLeft = parseInt(element.style.left || "0", 10);
      originalTop = parseInt(element.style.top || "0", 10);

      // 添加拖动中的样式
      element.classList.add("dragging");

      // 添加文档级事件监听
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
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
      element.classList.remove("dragging");

      // 移除文档级事件监听
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
    };

    // 添加拖动开始事件监听
    handle.addEventListener("mousedown", onDragStart);
    if (title) {
      handle.addEventListener("mousedown", onDragStart);
    }
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
    
    logger.debug(`更新节点元信息: ${nodeId}`, metadata);
    
    // 找到对应节点
    let node: NavNode | undefined;
    
    // 先在节点映射中查找
    if (this.nodeMap && this.nodeMap.has(nodeId)) {
      node = this.nodeMap.get(nodeId);
    } 
    
    // 如果节点映射中没有，在所有节点中查找
    if (!node) {
      node = this.allNodes.find(n => n.id === nodeId);
    }
    
    // 如果找到了节点，更新元信息
    if (node) {
      // 更新节点的元信息
      let needVisualUpdate = false;
      
      // 更新标题
      if ('title' in metadata && metadata.title) {
        node.title = metadata.title;
        needVisualUpdate = true;
      }
      
      // 更新图标
      if ('favicon' in metadata && metadata.favicon) {
        node.favicon = metadata.favicon;
        needVisualUpdate = true;
      }
      
      // 如果需要更新视觉效果，尝试更新节点外观
      if (needVisualUpdate) {
        this.updateNodeVisual(nodeId);
      }
      
      logger.debug(`节点${nodeId}元信息已更新`);
    } else {
      logger.warn(`未找到节点: ${nodeId}`);
    }
  }

  /**
   * 更新节点视觉效果
   * @param nodeId 节点ID
   */
  private updateNodeVisual(nodeId: string): void {
    if (!this.svg) return;
    
    // 尝试更新节点文本
    const textElement = this.svg.select(`.node-text[data-node-id="${nodeId}"]`);
    if (textElement && !textElement.empty()) {
      const node = this.nodeMap.get(nodeId);
      if (node) {
        textElement.text(node.title || node.url || nodeId);
      }
    }
    
    // 尝试更新节点图标
    const iconElement = this.svg.select(`.node-icon[data-node-id="${nodeId}"]`);
    if (iconElement && !iconElement.empty()) {
      const node = this.nodeMap.get(nodeId);
      if (node && node.favicon) {
        iconElement.attr("href", node.favicon);
      }
    }
  }
  /**
   * 获取或创建节点ID
   * @param url 页面URL
   * @returns 节点ID
   */
  getOrCreateNodeId(url: string): string {
    // 从当前数据中查找URL对应的节点ID
    let nodeId: string | undefined = undefined;
    if (this.nodes) {
      const node = this.nodes.find((n) => n.url === url);
      nodeId = node?.id;
    }
    
    // 如果没找到，则生成新ID
    if (!nodeId) {
      nodeId = `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      logger.debug(`为URL创建新节点ID: ${url} -> ${nodeId}`);
    }
    
    return nodeId;
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
      await this.sessionViewController.refreshData();
      this.refreshVisualization();
      logger.log("页面加载后刷新可视化完成");
    } catch (error) {
      logger.error("页面加载后刷新可视化失败:", error);
      throw error;
    }
  }
  
  /**
   * 处理链接点击消息 - 委托给会话处理器
   */
  async handleLinkClicked(message: any): Promise<void> {
    try {
      await this.sessionViewController.refreshData();
      this.refreshVisualization();
      logger.log("基于链接点击刷新可视化完成");
    } catch (error) {
      logger.error("链接点击后刷新可视化失败:", error);
      throw error;
    }
  }
  
  /**
   * 处理表单提交消息 - 委托给会话处理器
   */
  async handleFormSubmitted(message: any): Promise<void> {
    try {
      await this.sessionViewController.refreshData();
      this.refreshVisualization();
      logger.log("基于表单提交刷新可视化完成");
    } catch (error) {
      logger.error("表单提交后刷新可视化失败:", error);
      throw error;
    }
  }
  
  /**
   * 处理JS导航消息 - 委托给会话处理器
   */
  async handleJsNavigation(message: any): Promise<void> {
    try {
      await this.sessionViewController.refreshData();
      this.refreshVisualization();
      logger.log("基于JS导航刷新可视化完成");
    } catch (error) {
      logger.error("JS导航后刷新可视化失败:", error);
      throw error;
    }
  }
  
  /**
   * 刷新数据 - 委托给会话处理器
   */
  async refreshData(): Promise<void> {
    try {
      await this.sessionViewController.refreshData();
      this.refreshVisualization();
      logger.log("刷新数据完成");
    } catch (error) {
      logger.error("刷新数据失败:", error);
      throw error;
    }
  }
}