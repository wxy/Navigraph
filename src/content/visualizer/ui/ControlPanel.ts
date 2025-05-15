import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js'; // 添加导入i18n
import type { Visualizer } from '../../types/navigation.js';
import { ViewSwitcher } from './ControlPanel/ViewSwitcher.js';
import { CalendarSessionSelector } from './ControlPanel/CalendarSessionSelector.js';
import { FilterPanel } from './ControlPanel/FilterPanel.js';

const logger = new Logger('ControlPanel');

/**
 * 控制面板组件
 * 侧边面板容器，容纳视图切换、会话选择和筛选面板等UI组件
 */
export class ControlPanel {
  private visualizer: Visualizer;
  private controlPanelElement: HTMLElement | null = null;
  private handleElement: HTMLElement | null = null;
  
  // 子组件
  private viewSwitcher: ViewSwitcher;
  private calendarSessionSelector: CalendarSessionSelector; 
  private filterPanel: FilterPanel;
  
  // 计时器变量
  private hoverTimer: number | null = null;
  private leaveTimer: number | null = null;
  
  /**
   * 构造函数
   * @param visualizer 可视化器实例
   */
  constructor(visualizer: Visualizer) { 
    this.visualizer = visualizer;
    
    // 一致地创建所有子组件，传入相同参数
    this.viewSwitcher = new ViewSwitcher(visualizer);
    this.calendarSessionSelector = new CalendarSessionSelector(visualizer);
    this.filterPanel = new FilterPanel(visualizer);
    
    logger.log(_('control_panel_created', '控制面板已创建'));
  }
  
  /**
   * 初始化控制面板
   * @param container 可视化容器元素
   */
  public initialize(container: HTMLElement): void {
    this.controlPanelElement = document.getElementById('control-panel');
    this.handleElement = document.getElementById('control-panel-handle');
    
    if (!this.controlPanelElement || !this.handleElement) {
      logger.error(_('control_panel_elements_not_found', '控制面板元素未找到'));
      return;
    }
    
    // 初始化子组件 - 不需要传入容器ID，使用各自内置的查找和初始化方法
    this.viewSwitcher.initialize();
    this.calendarSessionSelector.initialize(); 
    this.filterPanel.initialize();
    
    // 初始化控制面板交互行为
    this.initializeControlPanelInteraction(container);
    
    logger.log(_('control_panel_components_initialized', '控制面板及所有子组件已初始化'));
  }
  
  /**
   * 初始化控制面板交互
   * 包括面板的显示/隐藏逻辑
   */
  private initializeControlPanelInteraction(container: HTMLElement): void {
    if (!this.controlPanelElement || !this.handleElement) return;
    
    // 鼠标悬停在抓手上时，显示面板（延迟200ms，避免意外触发）
    this.handleElement.addEventListener('mouseenter', () => {
      // 清除任何现有的离开计时器
      if (this.leaveTimer) {
        clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
      }
      
      // 如果面板已显示，不需要再设置计时器
      if (this.controlPanelElement?.classList.contains('visible')) {
        return;
      }
      
      // 设置短暂延迟后显示面板
      this.hoverTimer = window.setTimeout(() => {
        this.controlPanelElement?.classList.add('visible');
        this.handleElement?.classList.add('panel-visible');
      }, 200);
    });
    
    // 鼠标离开抓手时，如果悬停计时器存在就取消它
    this.handleElement.addEventListener('mouseleave', () => {
      // 清除悬停计时器
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
      
      // 面板已显示情况下不自动隐藏，用户需要点击外部或抓手来隐藏
    });

    // 点击抓手切换控制面板可见性（面板显示时点击将隐藏）
    this.handleElement.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      
      // 如果面板已显示，则隐藏它；否则就保持显示
      if (this.controlPanelElement?.classList.contains('visible')) {
        this.controlPanelElement.classList.remove('visible');
        this.handleElement?.classList.remove('panel-visible');
      }
    });
    
    // 鼠标进入面板时清除任何可能的离开计时器
    this.controlPanelElement.addEventListener('mouseenter', () => {
      if (this.leaveTimer) {
        clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
      }
    });
    
    // 鼠标离开面板时，设置延迟后自动隐藏（可以通过用户移动到抓手或再次进入面板来取消）
    this.controlPanelElement.addEventListener('mouseleave', (e: MouseEvent) => {
      // 检查是否是移动到抓手上，如果是，不设置离开计时器
      const toElement = (e as any).relatedTarget;
      if (toElement === this.handleElement) {
        return;
      }
      
      // 设置离开计时器，延迟隐藏面板
      this.leaveTimer = window.setTimeout(() => {
        this.controlPanelElement?.classList.remove('visible');
        this.handleElement?.classList.remove('panel-visible');
      }, 500); // 给用户半秒钟的时间来回到面板
    });
    
    // 点击可视化区域关闭控制面板
    container.addEventListener('click', () => {
      if (this.controlPanelElement?.classList.contains('visible')) {
        this.controlPanelElement.classList.remove('visible');
        this.handleElement?.classList.remove('panel-visible');
      }
    });
    
    // 防止点击控制面板内部元素时关闭面板
    this.controlPanelElement.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
    });
    
    // 添加键盘快捷键 (Esc 关闭面板)
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.controlPanelElement?.classList.contains('visible')) {
        this.controlPanelElement.classList.remove('visible');
        this.handleElement?.classList.remove('panel-visible');
      }
    });
    
    // 记录初始状态
    if (this.controlPanelElement.classList.contains('visible')) {
      this.handleElement.classList.add('panel-visible');
    }
    
    logger.log(_('control_panel_interaction_initialized', '控制面板交互初始化完成'));
  }

  /**
   * 创建会话区域的标题栏
   */
  private createSessionAreaHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'section-header';
    
    const title = document.createElement('h3');
    title.textContent = _('control_panel_session_history', '会话历史');
    title.className = 'section-title';
    header.appendChild(title);
    
    return header;
  }

  /**
   * 创建会话区域
   */
  private createSessionArea(): HTMLElement {
    const sessionArea = document.createElement('div');
    sessionArea.className = 'control-panel-section session-area';
    
    // 添加标题栏
    const header = this.createSessionAreaHeader();
    sessionArea.appendChild(header); // 现在正确添加标题
    
    // 创建日历会话选择器容器
    const calendarSessionSelectorElement = document.createElement('div');
    calendarSessionSelectorElement.id = 'calendar-session-selector';
    calendarSessionSelectorElement.className = 'calendar-session-selector';
    
    // 确保日历容器有足够的高度和可视性
    calendarSessionSelectorElement.style.minHeight = '280px';
    
    sessionArea.appendChild(calendarSessionSelectorElement);
    
    return sessionArea;
  }

  /**
   * 创建控制面板内容
   */
  private createControlPanelContent(): void {
    if (!this.controlPanelElement) return;
    
    // 创建视图切换区域
    const viewSwitcherContainer = document.createElement('div');
    viewSwitcherContainer.className = 'control-panel-section';
    viewSwitcherContainer.id = 'view-switcher-container';
    this.controlPanelElement.appendChild(viewSwitcherContainer);
    
    // 创建日历会话选择区域 - 移除多余标题
    const calendarContainer = document.createElement('div');
    calendarContainer.className = 'control-panel-section';
    calendarContainer.id = 'calendar-session-selector';
    
    this.controlPanelElement.appendChild(calendarContainer);
    
    // 创建筛选器区域
    const filterContainer = document.createElement('div');
    filterContainer.className = 'control-panel-section';
    filterContainer.id = 'filter-panel-container';
    this.controlPanelElement.appendChild(filterContainer);
  }

  /**
   * 更新视图按钮状态
   */
  public updateViewButtonsState(currentView: string): void {
    this.viewSwitcher.updateButtonsState(currentView);
  }

  /**
   * 更新会话选择器
   * @param sessions 会话列表
   * @param currentSessionId 当前会话ID
   * @param latestSessionId 最新会话ID - 新增参数
   */
  public updateSessionSelector(sessions: any[], currentSessionId?: string, latestSessionId?: string): void {
    // 如果会话数量较多，使用优化的更新方式
    if (sessions.length > 0) {
      logger.log(_('control_panel_update_session_selector', '控制面板更新会话选择器，共 {0} 个会话'), sessions.length);
      
      // 使用requestAnimationFrame确保UI渲染优先
      requestAnimationFrame(() => {
        // 更新日历会话选择器，传递当前会话ID和最新会话ID
        this.calendarSessionSelector.update(sessions, currentSessionId, latestSessionId);
      });
    } else {
      // 无会话数据时直接更新，同样传递当前会话ID和最新会话ID
      this.calendarSessionSelector.update(sessions, currentSessionId, latestSessionId);
    }
  }

  /**
   * 更新筛选面板
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
   * 显示控制面板
   */
  public show(): void {
    if (this.controlPanelElement && this.handleElement) {
      this.controlPanelElement.classList.add('visible');
      this.handleElement.classList.add('panel-visible');
    }
  }
  
  /**
   * 隐藏控制面板
   */
  public hide(): void {
    if (this.controlPanelElement && this.handleElement) {
      this.controlPanelElement.classList.remove('visible');
      this.handleElement.classList.remove('panel-visible');
    }
  }

  /**
   * 处理窗口大小变化
   */
  public handleResize(width: number, height: number): void {
    // 调整控制面板位置
    // 例如，确保它始终在可见区域内
    if (this.controlPanelElement && this.controlPanelElement.classList.contains('visible')) {
      // 获取面板当前尺寸
      const panelRect = this.controlPanelElement.getBoundingClientRect();
      
      // 确保面板完全在可视范围内
      const maxX = width - panelRect.width;
      const maxY = height - panelRect.height;
      
      // 获取当前位置
      const currentLeft = parseInt(this.controlPanelElement.style.left || '0', 10);
      const currentTop = parseInt(this.controlPanelElement.style.top || '0', 10);
      
      // 调整位置确保在视窗内
      if (currentLeft > maxX) {
        this.controlPanelElement.style.left = `${maxX}px`;
      }
      
      if (currentTop > maxY) {
        this.controlPanelElement.style.top = `${maxY}px`;
      }
    }
  }
}