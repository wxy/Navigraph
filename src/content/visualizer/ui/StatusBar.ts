import { Logger } from "../../../lib/utils/logger.js";
import { i18n } from '../../../lib/utils/i18n-utils.js';
import type { Visualizer } from "../../types/navigation.js";

const logger = new Logger("StatusBar");

/**
 * 状态栏组件
 */
export class StatusBar {
  private visualizer: Visualizer;
  private statusBarElement: HTMLElement | null = null;

  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }

  /**
   * 初始化状态栏
   */
  public initialize(): void {
    // 使用正确的选择器查找 Windows 风格状态栏
    this.statusBarElement = document.querySelector(".windows-status-bar");

    if (!this.statusBarElement) {
      logger.warn(i18n('status_bar_element_not_found', '状态栏元素未找到'));
      return;
    }

    // 不需要修改 HTML 结构，因为元素已经存在
    // 仅需记录初始化成功
    logger.log(i18n('status_bar_initialized', '状态栏已初始化'));
  }

  /**
   * 更新状态栏
   */
  public update(): void {
    if (!this.statusBarElement) return;

    // 在处理前添加更详细的日志，帮助定位问题
    logger.debug(i18n('status_bar_update_start', '开始更新状态栏'));

    try {
      // 获取当前状态数据 - 使用可视化器的属性
      const nodeCount = this.visualizer.nodes?.length || 0;
      const edgeCount = this.visualizer.edges?.length || 0;
      const currentView = this.visualizer.currentView;

      // 获取当前会话信息和总节点数
      const visualizer = this.visualizer as any;
      const currentSession = visualizer.currentSession;
      const allNodesCount = visualizer.allNodes?.length || 0;

      // 打印详细日志以帮助诊断问题
      logger.debug(i18n('status_bar_data_retrieved', '状态栏数据获取: {0}'), {
        session: currentSession ? "retrieved" : "not_retrieved",
        nodeCount,
        edgeCount,
        allNodesCount,
        viewType: currentView,
      });

      // 更新节点计数
      const nodeCountElement = document.getElementById("status-nodes");
      if (nodeCountElement) {
        nodeCountElement.textContent = i18n('content_nodes_count', '节点: {0}', nodeCount.toString());
      }

      // 更新已过滤节点计数
      const filteredElement = document.getElementById("status-filtered");
      if (filteredElement) {
        const filteredCount = Math.max(0, allNodesCount - nodeCount);
        filteredElement.textContent = i18n('content_hidden_count', '已隐藏: {0}', filteredCount.toString());
      }

      // 更新会话日期
      const dateElement = document.getElementById("status-date");
      if (dateElement && currentSession?.startTime) {
        const date = new Date(currentSession.startTime);
        const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
        dateElement.textContent = i18n('content_session_date_label', '日期: {0}', formattedDate);
      }

      // 更新会话时长
      const durationElement = document.getElementById("status-duration");
      if (durationElement && currentSession?.startTime) {
        const startTime = new Date(currentSession.startTime).getTime();
        const endTime = currentSession.endTime
          ? new Date(currentSession.endTime).getTime()
          : Date.now();
        const durationMs = endTime - startTime;

        // 格式化时长
        const durationText = this.formatDuration(durationMs);
        
        durationElement.textContent = i18n('content_session_duration_label', '时长: {0}', durationText);
      }

      // 更新视图类型
      const viewElement = document.getElementById("status-view");
      if (viewElement) {
        const viewTypeName = currentView === "tree" ? 
          i18n('content_view_tree', '树形图') : 
          i18n('content_view_timeline', '时间线');
        
        viewElement.textContent = i18n('content_view_label', '视图: {0}', viewTypeName);
      }
      
      // 缩放信息更新
      const zoomElement = document.getElementById("status-zoom");
      if (zoomElement) {
        // 尝试从可视化器获取当前缩放级别
        const zoom = visualizer.currentTransform?.k || 1;
        zoomElement.textContent = i18n('content_zoom_label', '缩放: {0}%', (100 * zoom).toFixed(0));
      }
      logger.debug(i18n('status_bar_update_complete', '状态栏更新完成'));
    } catch (error) {
      logger.error(i18n('status_bar_update_failed', '状态栏更新过程中出错: {0}'), error);
    }
  }

  /**
   * 处理容器大小变化
   */
  public handleResize(width: number, height: number): void {
    if (!this.statusBarElement) return;

    logger.log(i18n('status_bar_handle_resize', '状态栏处理大小变化: {0}x{1}'), `${width}`, `${height}`);

    // 调整状态栏宽度与容器一致
    this.statusBarElement.style.width = `${width}px`;

    // 根据宽度调整显示内容 - 使用正确的选择器
    if (width < 500) {
      // 在窄屏幕上隐藏一些状态单元格
      const dateElement = document.getElementById("status-date");
      if (dateElement) dateElement.style.display = "none";

      const durationElement = document.getElementById("status-duration");
      if (durationElement) durationElement.style.display = "none";
    } else {
      // 在宽屏幕上显示所有状态
      const dateElement = document.getElementById("status-date");
      if (dateElement) dateElement.style.display = "";

      const durationElement = document.getElementById("status-duration");
      if (durationElement) durationElement.style.display = "";
    }

    // 确保状态栏可见
    this.statusBarElement.style.display = "flex";
  }

  private formatDuration(ms: number): string {
    if (!ms || ms <= 0) {
      return i18n('content_duration_zero_minutes', '0 分钟');
    }
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return i18n('content_duration_hours', '{0} 小时', String(hours));
    } else {
      return i18n('content_duration_minutes', '{0} 分钟', String(minutes));
    }
  }
}
