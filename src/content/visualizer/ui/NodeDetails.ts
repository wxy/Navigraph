import { renderNodeDetails } from '../../../lib/graph/node-details.js';
import { Logger } from "../../../lib/utils/logger.js";
import { _ } from '../../../lib/utils/i18n.js';
import type { Visualizer, NavNode } from "../../types/navigation.js";

const logger = new Logger("NodeDetails");

/**
 * 节点详情面板
 * 负责展示节点的详细信息
 */
export class NodeDetails {
  private visualizer: Visualizer;
  private detailsContainer: HTMLElement | null = null;
  private panelVisible: boolean = false;
  private currentNode: NavNode | null = null;
  // 外部点击处理器引用（用于在点击面板外部时关闭面板）
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }

  /**
   * 初始化节点详情面板
   */
  public initialize(): void {
    // 移除任何可能存在的旧面板
    const existingPanel = document.getElementById("node-details");
    if (existingPanel && existingPanel.parentNode) {
      existingPanel.parentNode.removeChild(existingPanel);
    }

    // 默认不创建面板，而是在show方法中按需创建
    this.detailsContainer = null;
    this.panelVisible = false;

    logger.log(_('node_details_initialized', '节点详情面板已初始化'));
  }

  /**
   * 显示节点详情
   * @param node 要显示的节点
   */
  public show(node: NavNode): void {
    //logger.log(_('node_details_showing', '显示节点详情: {0}'), node);

    // 隐藏之前的面板
    this.hide();

    // 保存当前节点
    this.currentNode = node;

    // 创建详情面板
    this.detailsContainer = document.createElement("div");
    this.detailsContainer.className = "node-details-panel";

    // 添加关闭按钮
    const closeButton = document.createElement("button");
    closeButton.innerHTML = "&times;";
    closeButton.className = "node-details-close";
    closeButton.onclick = () => this.hide();
    this.detailsContainer.appendChild(closeButton);

    // 添加标题容器（同时作为拖动区域）
    const titleBar = document.createElement("div");
    titleBar.className = "node-details-titlebar";
    this.detailsContainer.appendChild(titleBar);

    // 添加拖动指示器
    const dragIndicator = document.createElement("div");
    dragIndicator.className = "drag-indicator";
    dragIndicator.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M2 5h12v1H2V5zm0 4h12v1H2V9z" fill="currentColor"/>
        </svg>
    `;
    titleBar.appendChild(dragIndicator);

    this.detailsContainer.append(renderNodeDetails(node, this.visualizer.isTrackingPage(node)));

    // 添加到DOM
    document.body.appendChild(this.detailsContainer);

    // 设置初始位置
    this.setInitialPosition();

    // 添加点击面板外部关闭的处理器
    this.outsideClickHandler = (e: MouseEvent) => {
      try {
        if (!this.detailsContainer) return;
        const target = e.target as Node;
        if (!this.detailsContainer.contains(target)) {
          // 点击在面板外部，关闭面板
          this.hide();
        }
      } catch (err) {
        // 忽略任何错误
      }
    };
    // 使用捕获阶段以确保在其他处理器之前生效
    document.addEventListener('mousedown', this.outsideClickHandler, true);

    // 添加拖拽功能
    this.makeDraggable(this.detailsContainer, titleBar);

    // 更新状态
    this.panelVisible = true;

    logger.log(_('node_details_shown', '显示节点详情: {0}'), node.id);
  }

  /**
   * 隐藏节点详情面板
   */
  public hide(): void {
    if (this.detailsContainer) {
      // 如果元素在DOM中，从DOM移除
      if (this.detailsContainer.parentElement) {
        this.detailsContainer.parentElement.removeChild(this.detailsContainer);
      }
      this.detailsContainer = null;
      this.panelVisible = false; // 使用正确的变量名
      this.currentNode = null;

      // 移除外部点击处理器
      if (this.outsideClickHandler) {
        try { document.removeEventListener('mousedown', this.outsideClickHandler, true); } catch (e) {}
        this.outsideClickHandler = null;
      }

      logger.log(_('node_details_hidden', '隐藏节点详情面板'));
    }
  }

  /**
   * 使元素可拖拽
   * @param element 要使可拖拽的元素
   * @param handleElement 拖动把手元素，默认为元素本身
   */
  private makeDraggable(
    element?: HTMLElement,
    handleElement?: HTMLElement
  ): void {
    // 如果没有传入元素，使用当前详情容器
    const targetElement = element || this.detailsContainer;
    if (!targetElement) return;

    // 使用传入的手柄元素或查找/创建一个
    const handle =
      handleElement ||
      (targetElement.querySelector(".node-details-titlebar") as HTMLElement);
    if (!handle) {
      // 如果没有找到拖动把手，退出函数
      logger.warn(_('content_drag_handle_missing', '找不到拖动把手，无法使元素可拖拽'));
      return;
    }

    // 为拖动把手添加明显的视觉样式
    handle.classList.add("draggable-handle");
    handle.title = _('content_drag_panel', '拖动移动此面板'); // 添加工具提示

    let isDragging = false;
    let startX = 0,
      startY = 0;
    let initialLeft = 0,
      initialTop = 0;

    const onDragStart = (e: MouseEvent): void => {
      e.preventDefault();

      isDragging = true;
      targetElement.classList.add("dragging");

      startX = e.clientX;
      startY = e.clientY;

      const rect = targetElement.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
    };

    const onDragMove = (e: MouseEvent): void => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      targetElement.style.left = `${initialLeft + deltaX}px`;
      targetElement.style.top = `${initialTop + deltaY}px`;
    };

    const onDragEnd = (): void => {
      isDragging = false;
      targetElement.classList.remove("dragging");

      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
    };

    handle.addEventListener("mousedown", onDragStart);
  }

  /**
   * 如果节点详情面板应该是对话框样式，可以使用这个函数
   */
  private createAsDialog(): void {
    if (!this.detailsContainer) return;

    // 替换类名
    this.detailsContainer.className = "node-details-dialog";

    // 使用dialog元素的特性
    if (window.HTMLDialogElement) {
      const dialog = document.createElement("dialog");
      dialog.className = "node-details-dialog-container";

      // 移动内容到dialog
      while (this.detailsContainer.firstChild) {
        dialog.appendChild(this.detailsContainer.firstChild);
      }

      // 替换容器
      document.body.appendChild(dialog);
      this.detailsContainer = dialog;

      // 打开dialog
      (this.detailsContainer as HTMLDialogElement).showModal();
    }
  }

  /**
   * 判断面板是否可见
   */
  public isVisible(): boolean {
    return this.panelVisible;
  }

  /**
   * 获取当前显示的节点
   */
  public getCurrentNode(): NavNode | null {
    return this.currentNode;
  }

  /**
   * 设置面板初始位置
   */
  private setInitialPosition(): void {
    if (!this.detailsContainer) return;

    // 获取视窗尺寸
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // 计算面板尺寸
    const panelWidth = this.detailsContainer.offsetWidth || 300;
    const panelHeight = this.detailsContainer.offsetHeight || 400;

    // 默认位置：右侧，垂直居中
    const left = windowWidth - panelWidth - 20;
    const top = Math.max(20, (windowHeight - panelHeight) / 2);

    // 应用位置
    this.detailsContainer.style.left = `${left}px`;
    this.detailsContainer.style.top = `${top}px`;

    logger.log(_('node_details_initial_position_set', '设置节点详情面板初始位置'));
  }

  /**
   * 调整节点详情面板位置
   */
  public adjustPosition(): void {
    if (!this.detailsContainer) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 获取面板尺寸
    const rect = this.detailsContainer.getBoundingClientRect();

    // 确保面板在视窗内
    const maxX = viewportWidth - rect.width;
    const maxY = viewportHeight - rect.height;

    // 获取当前位置
    const currentLeft = parseInt(this.detailsContainer.style.left || "0", 10);
    const currentTop = parseInt(this.detailsContainer.style.top || "0", 10);

    // 调整位置
    if (currentLeft > maxX) {
      this.detailsContainer.style.left = `${maxX}px`;
    }

    if (currentTop > maxY) {
      this.detailsContainer.style.top = `${maxY}px`;
    }
  }
}
