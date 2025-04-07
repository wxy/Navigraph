/**
 * 渲染管理器
 * 负责协调和管理所有渲染相关操作
 */
import { Logger } from '../../../lib/utils/logger.js';
import { RendererFactory } from './RendererFactory.js';
import type { NavNode, NavLink, Visualizer } from '../../types/navigation.js';
import type { ViewStateManager } from '../state/ViewStateManager.js';
import type { UIManager } from '../ui/UIManager.js';
import type { SessionDetails } from '../../types/session.js';

const logger = new Logger('RenderingManager');

export class RenderingManager {
  private visualizer: Visualizer;
  private viewStateManager: ViewStateManager;
  private uiManager: UIManager;
  
  // 渲染属性
  private container: HTMLElement | null = null;
  private width: number = 0;
  private height: number = 0;
  
  /**
   * 构造函数
   */
  constructor(visualizer: Visualizer, viewStateManager: ViewStateManager, uiManager: UIManager) {
    this.visualizer = visualizer;
    this.viewStateManager = viewStateManager;
    this.uiManager = uiManager;
    logger.log('渲染管理器初始化');
  }
  
  /**
   * 初始化渲染管理器
   */
  initialize(container: HTMLElement): void {
    logger.log("初始化渲染管理器...");
    
    this.container = container;
    
    // 更新容器大小
    this.updateContainerSize();
    
    logger.log("渲染管理器初始化完成");
  }
  
  /**
   * 刷新可视化
   * @param data 新数据（可选）
   * @param options 选项
   */
  refreshVisualization(
    data?: any,
    options: { restoreTransform?: boolean } = {}
  ): void {
    logger.log("执行刷新可视化...", data ? "使用提供的数据" : "使用现有数据");

    try {
      // 如果提供了新数据，通知可视化器更新数据
      if (data) {
        if (data.nodes || data.edges || data.session) {
          this.visualizer.updateData(data);
        }
      }

      // 重新应用过滤器
      this.visualizer.applyFilters();

      // 重新渲染可视化
      this.renderVisualization({
        restoreTransform: options.restoreTransform === true,
      });

      // 更新URL和状态栏
      this.updateUrlAndUI();

      logger.log("可视化刷新完成");
    } catch (error) {
      this.uiManager.showError(
        "刷新失败: " + (error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 更新URL和UI状态
   */
  private updateUrlAndUI(): void {
    // 更新URL
    this.updateUrl();
    
    // 更新状态栏
    this.uiManager.updateStatusBar();
  }
  
  /**
   * 更新URL以反映当前视图和筛选状态
   */
  private updateUrl(): void {
    try {
      const url = new URL(window.location.href);

      // 更新视图参数
      url.searchParams.set("view", this.viewStateManager.currentView);

      // 更新筛选器参数
      const filterParam = this.visualizer.getFilterUrlParam();
      if (filterParam) {
        url.searchParams.set("filter", filterParam);
      }

      // 不触发页面刷新的情况下更新URL
      window.history.replaceState(null, "", url);

      logger.log("已更新URL以反映当前视图和筛选状态");
    } catch (error) {
      logger.warn("更新URL失败:", error);
    }
  }
  
  /**
   * 渲染可视化
   */
  renderVisualization(options: { restoreTransform?: boolean } = {}): void {
    if (!this.container || !this.viewStateManager.svg) {
      logger.error("无法渲染可视化：容器或SVG不存在");
      return;
    }

    try {
      // 确保尺寸是最新的
      this.updateContainerSize();
      
      const width = this.width;
      const height = this.height;
      
      // 获取SVG和数据引用
      const svg = this.viewStateManager.svg;
      const nodes = this.visualizer.nodes;
      const edges = this.visualizer.edges;
      const currentSession = this.visualizer.currentSession;

      // 清除现有可视化
      svg.selectAll("*").remove();

      // 创建基本SVG结构
      const mainGroup = svg.append("g").attr("class", "main-group");
      mainGroup.append("g").attr("class", "links-group");
      const nodesGroup = mainGroup.append("g").attr("class", "nodes-group");

      // 检查是否有数据可渲染
      const hasData = nodes && nodes.length > 0;

      logger.log(
        `开始渲染${this.viewStateManager.currentView}视图, 节点数: ${
          hasData ? nodes.length : 0
        }, 边数: ${hasData ? edges.length : 0}, 尺寸: ${width}x${height}`
      );

      // 如果没有数据，创建一个会话节点
      if (!hasData) {
        this.renderEmptySession(nodesGroup, width, height, currentSession);
      } else {
        // 使用渲染器工厂创建相应的渲染器
        const renderer = RendererFactory.createRenderer(
          this.viewStateManager.currentView as 'tree' | 'timeline',
          this.visualizer
        );
        
        // 初始化渲染器
        renderer.initialize(
          svg,
          this.container,
          width,
          height
        );
        
        // 渲染视图
        renderer.render(nodes, edges, {
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
      this.uiManager.updateStatusBar();

      logger.log("可视化渲染完成", {
        view: this.viewStateManager.currentView,
        zoom: this.viewStateManager.zoom ? "已设置" : "未设置",
        hasData,
      });
    } catch (error) {
      this.uiManager.showError(
        "渲染失败: " + (error instanceof Error ? error.message : String(error))
      );
    }
  }
  
  /**
   * 渲染空会话界面
   */
  private renderEmptySession(
    nodesGroup: any, 
    width: number, 
    height: number, 
    currentSession?: SessionDetails
  ): void {
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
    const sessionTitle = currentSession?.title || "当前会话";
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
   * 更新节点视觉效果
   * @param nodeId 节点ID
   * @param nodeMap 节点映射
   */
  updateNodeVisual(nodeId: string, nodeMap: Map<string, NavNode>): void {
    if (!this.viewStateManager.svg) return;
    
    const svg = this.viewStateManager.svg;
    
    // 尝试更新节点文本
    const textElement = svg.select(`.node-text[data-node-id="${nodeId}"]`);
    if (textElement && !textElement.empty()) {
      const node = nodeMap.get(nodeId);
      if (node) {
        textElement.text(node.title || node.url || nodeId);
      }
    }
    
    // 尝试更新节点图标
    const iconElement = svg.select(`.node-icon[data-node-id="${nodeId}"]`);
    if (iconElement && !iconElement.empty()) {
      const node = nodeMap.get(nodeId);
      if (node && node.favicon) {
        iconElement.attr("href", node.favicon);
      }
    }
  }
  
  /**
   * 配置SVG元素，添加D3所需结构
   * @param svgElement 由UIManager创建的原生SVG元素
   */
  setupSvg(svgElement: SVGElement): void {
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
        .attr("data-view", this.viewStateManager.currentView);
      
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
   * 更新容器大小
   */
  updateContainerSize(): boolean {
    if (!this.container) return false;

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

      // 保存尺寸
      this.width = width;
      this.height = height;

      // 通知 UI 管理器容器大小变化
      this.uiManager.handleResize(width, height);

      return true;
    } else {
      logger.log("容器大小变化不显著，跳过更新");
      return false;
    }
  }
  
  /**
   * 处理窗口大小变化
   */
  handleResize(): void {
    // 更新容器大小
    const sizeChanged = this.updateContainerSize();
    
    // 如果尺寸有显著变化且有数据，重新渲染
    if (sizeChanged && this.visualizer.nodes.length > 0) {
      this.renderVisualization({ restoreTransform: true });
    }
  }
  
  /**
   * 清理资源
   */
  cleanup(): void {
    logger.log("清理渲染管理器资源...");
    // 当前没有需要特别清理的资源
  }
}