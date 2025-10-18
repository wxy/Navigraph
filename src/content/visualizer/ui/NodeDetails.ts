import { Logger } from "../../../lib/utils/logger.js";
import { _, _Error } from '../../../lib/utils/i18n.js';
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
    logger.log(_('node_details_showing', '显示节点详情: {0}'), node);

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

    // 添加标题
    const title = document.createElement("h3");
    title.textContent = node.title || _('content_unnamed_page', '无标题');
    title.className = "node-details-title";
    this.detailsContainer.appendChild(title);

    // 创建内容表格
    const content = document.createElement("div");
    const table = document.createElement("table");
    table.className = "details-table";

  // 添加基本信息
  if (node.url) this.addUrlRow(table, node.url);
    if (node.type)
      this.addTableRow(table, _('content_type_label', '类型'), this.formatNavigationType(node.type));
    if (node.timestamp)
      this.addTableRow(table, _('content_time_label', '时间'), this.formatTimestamp(node.timestamp));
    this.addTableRow(
      table, 
      _('content_status_label', '状态'), 
      node.isClosed ? _('content_status_closed', '已关闭') : _('content_status_active', '活跃')
    );
    if (this.visualizer.isTrackingPage(node))
      this.addTableRow(table, _('content_tracking_page_label', '跟踪页面'), _('content_yes', '是'));
      
    // 添加打开时长信息（如果有）
    if (node.visitDuration) {
      this.addTableRow(table, _('content_duration_label', '时长'), this.formatDuration(node.visitDuration));
    } else if (!node.isClosed && node.timestamp) {
      // 如果页面还打开着，计算从打开到现在的时间
      const duration = Date.now() - node.timestamp;
      this.addTableRow(table, _('content_duration_label', '时长'), this.formatDuration(duration) + " ..." );
    }
    
    // 添加打开次数（如果有）
    if (node.visitCount) {
      this.addTableRow(table, _('content_count_label', '次数'), node.visitCount.toString());
    }

    // 添加 SPA 请求合并计数（显示为简短标签“请求”）
    if ((node as any).spaRequestCount) {
      this.addTableRow(table, _('content_spa_request_count', '请求'), (node as any).spaRequestCount.toString());
    }

    // 添加技术详情(可折叠)
    const techDetailsRow = document.createElement("tr");
    const techDetailsCell = document.createElement("td");
    techDetailsCell.colSpan = 2;

    const techDetails = document.createElement("details");
    techDetails.className = "technical-details";

    const summary = document.createElement("summary");
    summary.textContent = _('content_technical_details', '技术详情');
    techDetails.appendChild(summary);

    const techTable = document.createElement("table");
    techTable.className = "tech-details-table";

    // 添加技术详情内容
    if (node.tabId) this.addTableRow(techTable, _('content_tab_id_label', '标签ID'), node.tabId);
    this.addTableRow(techTable, _('content_node_id_label', '节点ID'), node.id);
    if (node.parentId) this.addTableRow(techTable, _('content_parent_id_label', '父节点ID'), node.parentId);
    if (node.referrer) this.addTableRow(techTable, _('content_referrer_label', '引用来源'), node.referrer);

    techDetails.appendChild(techTable);
    techDetailsCell.appendChild(techDetails);
    techDetailsRow.appendChild(techDetailsCell);
    table.appendChild(techDetailsRow);

    content.appendChild(table);
    this.detailsContainer.appendChild(content);

    // 添加到DOM
    document.body.appendChild(this.detailsContainer);

    // 设置初始位置
    this.setInitialPosition();

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

      logger.log(_('node_details_hidden', '隐藏节点详情面板'));
    }
  }

  /**
   * 添加表格行
   */
  private addTableRow(
    table: HTMLTableElement,
    label: string,
    value: string
  ): void {
    const row = document.createElement("tr");
  
    const labelCell = document.createElement("td");
    labelCell.className = "detail-label";
    labelCell.textContent = label;
  
  const valueCell = document.createElement("td");
  valueCell.className = "detail-value";
  
    // 对于URL，创建可点击链接
    if (label === _('content_url_label', 'URL')) {
  const link = document.createElement("a");
  link.href = value;
  link.target = "_blank";
  link.textContent = value;
  valueCell.appendChild(link);
    } else {
      valueCell.textContent = value;
    }
  
    row.appendChild(labelCell);
    row.appendChild(valueCell);
    table.appendChild(row);
  }

  /**
   * 为 URL 创建专门的行：显示截断文本，但链接 href 保持完整，鼠标悬停显示完整 URL
   */
  private addUrlRow(table: HTMLTableElement, url: string): void {
    const row = document.createElement("tr");
    const labelCell = document.createElement("td");
    labelCell.className = "detail-label";
    labelCell.textContent = _('content_url_label', 'URL');

  const valueCell = document.createElement("td");
  valueCell.className = "detail-value break-all";

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = this.formatUrl(url); // 显示截断版本
    link.title = url; // 悬停时显示完整 URL
    link.style.wordBreak = "break-all";

    valueCell.appendChild(link);
    row.appendChild(labelCell);
    row.appendChild(valueCell);
    table.appendChild(row);
  }

  /**
   * 更强大的URL格式化，处理特殊情况
   */
  private formatUrl(url: string): string {
    // 处理非常长的URL
    const maxLength = 50;

    try {
      const urlObj = new URL(url);

      // 显示域名+路径，截断查询参数
      if (urlObj.search && url.length > maxLength) {
        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
        if (baseUrl.length > maxLength - 3) {
          return baseUrl.substring(0, maxLength - 3) + "...";
        }
        return `${baseUrl}?...`;
      }

      // 常规截断
      if (url.length <= maxLength) return url;
      return url.substring(0, maxLength - 3) + "...";
    } catch (e) {
      // URL解析失败，使用简单截断
      if (url.length <= maxLength) return url;
      return url.substring(0, maxLength - 3) + "...";
    }
  }

  /**
   * 格式化导航类型
   */
  private formatNavigationType(type: string): string {
    const typeMap: Record<string, string> = {
      initial: _('content_nav_type_initial', '外部打开'),
      link_click: _('content_nav_type_link_click', '链接点击'),
      address_bar: _('content_nav_type_address_bar', '地址栏输入'),
      form_submit: _('content_nav_type_form_submit', '表单提交'),
      history_back: _('content_nav_type_history_back', '历史后退'),
      history_forward: _('content_nav_type_history_forward', '历史前进'),
      reload: _('content_nav_type_reload', '页面刷新'),
      javascript: _('content_nav_type_javascript', 'JavaScript导航'),
      redirect: _('content_nav_type_redirect', '重定向'),
    };
  
    return typeMap[type] || type;
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  /**
   * 格式化时长（毫秒转为人类可读格式）
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}${_('content_unit_millisecond', '毫秒')}`;
    
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / (1000 * 60)) % 60;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    
    let result = '';
    
    if (days > 0) {
      result += days + _('content_unit_day', '天');
    }
    
    if (hours > 0 || days > 0) {
      result += hours + _('content_unit_hour', '小时');
    }
    
    if (minutes > 0 || hours > 0 || days > 0) {
      result += minutes + _('content_unit_minute', '分钟');
    }
    
    result += seconds + _('content_unit_second', '秒');
    
    return result;
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
