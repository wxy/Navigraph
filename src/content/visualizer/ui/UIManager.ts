import { Logger } from '../../../lib/utils/logger.js';
import type { Visualizer, NavNode, NavLink } from '../../types/navigation.js';
import { StatusBar } from './StatusBar.js';
import { ViewSwitcher } from './ViewSwitcher.js';
import { SessionSelector } from './SessionSelector.js';
import { FilterPanel } from './FilterPanel.js';
import { NodeDetails } from './NodeDetails.js';
import { ErrorNotification } from './ErrorNotification.js';
import { ControlPanel } from './ControlPanel.js';
import { LoadingIndicator } from './LoadingIndicator.js';

const logger = new Logger('UIManager');

/**
 * UI管理器类
 * 负责协调所有UI组件，为主类提供简洁统一的界面
 */
export class UIManager {
  // 主可视化器引用
  private visualizer: Visualizer;

  // UI组件
  private statusBar: StatusBar;
  private viewSwitcher: ViewSwitcher;
  private sessionSelector: SessionSelector;
  private filterPanel: FilterPanel;
  private nodeDetails: NodeDetails;
  private errorNotification: ErrorNotification;
  private controlPanel: ControlPanel;
  private loadingIndicator: LoadingIndicator;

  // 容器元素
  private containerElement: HTMLElement | null = null;

  // 主视图容器
  private mainViewContainer: HTMLElement | null = null;

  // SVG元素
  private svgElement: SVGElement | null = null;

  /**
   * 构造函数
   * @param visualizer 可视化器实例
   */
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;

    // 初始化基本UI组件
    this.statusBar = new StatusBar(visualizer);
    this.viewSwitcher = new ViewSwitcher(visualizer);
    this.sessionSelector = new SessionSelector(visualizer);
    this.filterPanel = new FilterPanel(visualizer);
    this.nodeDetails = new NodeDetails(visualizer);
    this.errorNotification = new ErrorNotification();
    this.loadingIndicator = new LoadingIndicator();

    // 初始化控制面板，传入其包含的子组件
    this.controlPanel = new ControlPanel(
      visualizer,
      this.viewSwitcher,
      this.sessionSelector,
      this.filterPanel
    );

    logger.log("UI管理器已创建");
  }

  /**
   * 初始化UI管理器和所有组件
   * @param container 可选的主容器元素，如果不提供将自动创建
   * @returns 包含容器和SVG的对象
   */
  public initialize(container?: HTMLElement): {
    container: HTMLElement;
    svg: SVGElement | null;
  } {
    logger.log("初始化UI管理器");

    // 如果没有提供容器，创建一个
    if (!container) {
      container = this.createVisualizationContainer();
    }

    this.containerElement = container;

    // 创建主视图容器
    this.mainViewContainer = this.createMainViewContainer(container);

    // 初始化SVG并获取SVG元素
    const svg = this.createSvgElement();

    // 初始化各个UI组件
    this.initializeComponents();

    logger.log("UI管理器初始化完成");

    // 返回容器和SVG元素
    return { container, svg };
  }

  /**
   * 创建或查找可视化容器
   * @returns 可视化容器元素
   */
  private createVisualizationContainer(): HTMLElement {
    logger.log("创建/查找可视化容器");

    // 首先尝试查找现有容器
    let container = document.getElementById("visualization-container");

    // 如果找不到，创建新容器
    if (!container) {
      logger.warn("未找到可视化容器，创建新容器");
      container = document.createElement("div");
      container.id = "visualization-container";
      container.className = "visualization-container";

      // 设置基础样式
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.position = "relative";

      // 添加到应用容器或文档主体
      const appContainer = document.querySelector(".app-container");
      if (appContainer) {
        appContainer.appendChild(container);
      } else {
        document.body.appendChild(container);
      }
    }

    return container;
  }

  /**
   * 创建主视图容器
   * @param parentContainer 父容器元素
   * @returns 主视图容器元素
   */
  private createMainViewContainer(parentContainer: HTMLElement): HTMLElement {
    logger.log("创建主视图容器");

    // 创建主视图容器
    const mainViewContainer = document.createElement("div");
    mainViewContainer.className = "main-view-container";
    mainViewContainer.style.width = "100%";
    mainViewContainer.style.height = "100%";
    mainViewContainer.style.position = "relative";
    parentContainer.appendChild(mainViewContainer);

    return mainViewContainer;
  }

  /**
   * 创建SVG元素
   * @param container 可选的容器元素，如果不提供则使用 mainViewContainer
   * @returns 创建的SVG元素
   */
  public createSvgElement(container?: HTMLElement): SVGElement | null {
    // 使用提供的容器或默认的主视图容器
    const targetContainer = container || this.mainViewContainer;

    if (!targetContainer) {
      logger.error("无法创建SVG：目标容器不存在");
      return null;
    }

    logger.log("创建SVG元素");

    // 如果容器中已经存在SVG元素，先移除它
    const existingSvg = targetContainer.querySelector("svg");
    if (existingSvg) {
      existingSvg.remove();
    }

    // 创建SVG元素
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.id = "navigation-svg";

    // 添加到目标容器
    targetContainer.appendChild(svg);

    // 保存SVG引用
    this.svgElement = svg;

    return svg;
  }

  /**
   * 初始化所有UI组件
   */
  private initializeComponents(): void {
    logger.groupCollapsed("初始化UI组件");
    // 初始化各个组件
    this.statusBar.initialize();
    this.viewSwitcher.initialize();
    this.sessionSelector.initialize();
    this.filterPanel.initialize();
    this.nodeDetails.initialize();
    this.errorNotification.initialize();
    this.loadingIndicator.initialize();

    // 初始化控制面板（它包含视图切换、会话选择和筛选面板）
    if (this.containerElement) {
      this.controlPanel.initialize(this.containerElement);
    } else {
      logger.warn("容器元素不存在，控制面板无法初始化");
    }

    logger.groupEnd();
  }

  /**
   * 更新状态栏
   */
  public updateStatusBar(): void {
    // 状态栏直接从 visualizer 实例获取数据
    this.statusBar.update();
  }

  /**
   * 更新视图按钮状态
   * @param currentView 当前视图
   */
  public updateViewButtonsState(currentView: string): void {
    // ViewSwitcher 和 ControlPanel 中的切换按钮应该是独立的
    // 如果 ControlPanel 已经包含了 ViewSwitcher，就只需要调用一个
    this.viewSwitcher.updateButtonsState(currentView);

    // 如果控制面板有自己独立的视图按钮，再调用这个
    if (typeof this.controlPanel.updateViewButtonsState === "function") {
      this.controlPanel.updateViewButtonsState(currentView);
    }
  }

  /**
   * 更新会话选择器
   * @param sessions 会话列表
   * @param currentSessionId 当前会话ID
   */
  public updateSessionSelector(
    sessions: any[],
    currentSessionId?: string
  ): void {
    this.sessionSelector.update(sessions, currentSessionId);
  }

  /**
   * 更新筛选面板
   * @param filters 当前过滤器配置
   */
  public updateFilters(filters: any): void {
    this.filterPanel.updateUI(filters);
  }

  /**
   * 重置所有筛选器
   */
  public resetFilters(): void {
    this.filterPanel.resetFilters();
  }

  /**
   * 显示节点详情
   * @param node 节点数据
   */
  public showNodeDetails(node: NavNode): void {
    this.nodeDetails.show(node);
  }

  /**
   * 隐藏节点详情
   */
  public hideNodeDetails(): void {
    this.nodeDetails.hide();
  }

  /**
   * 显示错误通知
   * @param message 错误消息
   * @param duration 显示时间(毫秒)，默认5秒，0表示不自动关闭
   */
  public showError(message: string, duration: number = 5000): void {
    this.errorNotification.show(message, duration);
  }

  /**
   * 显示详细错误通知
   * @param title 错误标题
   * @param message 错误消息
   * @param stack 错误堆栈
   */
  public showDetailedError(
    title: string,
    message: string,
    stack?: string
  ): void {
    // 确保 ErrorNotification 类中有此方法
    if (typeof this.errorNotification.showDetailed === "function") {
      this.errorNotification.showDetailed(title, message, stack);
    } else {
      // 降级处理，如果没有详细错误方法
      this.errorNotification.show(`${title}: ${message}`, 0);
      logger.error(`${title}: ${message}`, stack);
    }
  }

  /**
   * 显示简短通知
   * @param message 通知消息
   * @param duration 显示时间(毫秒)，默认3秒
   */
  public showToast(message: string, duration: number = 3000): void {
    this.errorNotification.showToast(message, duration);
  }

  /**
   * 隐藏错误通知
   */
  public hideError(): void {
    this.errorNotification.hide();
  }

  /**
   * 隐藏所有错误通知
   */
  public hideAllErrors(): void {
    this.errorNotification.hideAll();
  }

  /**
   * 更新UI以反映会话加载状态
   * @param loading 是否正在加载
   */
  public setLoadingState(loading: boolean): void {
    if (loading) {
      this.loadingIndicator.show();
    } else {
      this.loadingIndicator.hide();
    }
  }

  /**
   * 处理容器大小变化
   * @param width 新的宽度
   * @param height 新的高度
   */
  public handleResize(width?: number, height?: number): void {
    if (!this.containerElement) return;

    // 如果没有提供宽高，从容器元素获取
    if (width === undefined || height === undefined) {
      const rect = this.containerElement.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    }

    logger.log(`UI管理器处理大小变化: ${width}x${height}`);

    // 通知各个需要响应大小变化的组件
    if (typeof this.controlPanel.handleResize === "function") {
      this.controlPanel.handleResize(width, height);
    }

    if (typeof this.statusBar.handleResize === "function") {
      this.statusBar.handleResize(width, height);
    }

    // 可能的节点详情面板位置调整
    if (
      this.nodeDetails.isVisible() &&
      typeof this.nodeDetails.adjustPosition === "function"
    ) {
      this.nodeDetails.adjustPosition();
    }
  }

  /**
   * 隐藏控制面板
   */
  public hideControlPanel(): void {
    // 委托给控制面板组件处理
    if (this.controlPanel && typeof this.controlPanel.hide === "function") {
      this.controlPanel.hide();
      logger.log("已隐藏控制面板");
    } else {
      logger.warn("无法隐藏控制面板：组件不可用或没有hide方法");
    }
  }

  /**
   * 显示控制面板
   */
  public showControlPanel(): void {
    if (this.controlPanel && typeof this.controlPanel.show === "function") {
      this.controlPanel.show();
      logger.log("已显示控制面板");
    } else {
      logger.warn("无法显示控制面板：组件不可用或没有show方法");
    }
  }

  /**
   * 获取主视图容器
   * @returns 主视图容器元素
   */
  public getMainViewContainer(): HTMLElement | null {
    return this.mainViewContainer;
  }

  /**
   * SVG初始化完成后的回调
   * @param svg SVG元素
   */
  public onSvgInitialized(svg: any): void {
    logger.log("SVG初始化完成通知已接收");
    // 可以在这里执行任何需要在SVG初始化后进行的UI操作
  }
}