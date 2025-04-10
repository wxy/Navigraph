import { Logger } from '../../../lib/utils/logger.js';
import type { Visualizer } from '../../types/navigation.js';
import type { BrowsingSession } from '../../types/session.js';
import { sessionServiceClient } from '../../core/session-service-client.js';

const logger = new Logger('CalendarSessionSelector');

/**
 * 日历会话选择器
 * 轻量级月历形式的会话选择控件
 * 提供简洁的日历界面，以可视化方式显示会话日期分布
 * 并支持从会话开始日选择会话
 */
export class CalendarSessionSelector {
  private visualizer: Visualizer;
  private container: HTMLElement | null = null;
  private currentMonth: number = new Date().getMonth();
  private currentYear: number = new Date().getFullYear();
  private sessions: BrowsingSession[] = [];
  private selectedSessionId: string | null = null;
  private monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  private isLoading: boolean = false;
  
  // 绑定this的事件处理函数
  private boundHandleCellClick = this.handleCellClick.bind(this);
  private boundHandlePrevMonth = () => this.navigateMonth(-1);
  private boundHandleNextMonth = () => this.navigateMonth(1);
  
  /**
   * 构造函数
   * @param visualizer 可视化器实例
   */
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }
  
  /**
   * 初始化日历选择器
   * @param containerId 容器元素ID
   */
  public initialize(containerId: string = 'calendar-session-selector'): void {
    this.container = document.getElementById(containerId);
    
    if (!this.container) {
      logger.error(`日历选择器容器 #${containerId} 未找到`);
      return;
    }
    
    // 调试信息
    logger.log(`找到日历选择器容器，尺寸: ${this.container.offsetWidth}x${this.container.offsetHeight}`);
    
    this.createCalendarStructure();
    this.renderCalendarDays();
    this.setupEventListeners();
    
    logger.log('日历会话选择器已初始化');
  }
  
  /**
   * 创建日历基础结构
   */
  private createCalendarStructure(): void {
    if (!this.container) return;
    
    // 创建基础HTML结构，添加加载指示器
    this.container.innerHTML = `
      <div class="calendar-header">
        <button class="month-nav prev" title="上个月">◀</button>
        <h3 class="current-month">${this.currentYear}年${this.monthNames[this.currentMonth]}</h3>
        <button class="month-nav next" title="下个月">▶</button>
      </div>
      
      <div class="calendar-grid">
        <div class="weekday">日</div>
        <div class="weekday">一</div>
        <div class="weekday">二</div>
        <div class="weekday">三</div>
        <div class="weekday">四</div>
        <div class="weekday">五</div>
        <div class="weekday">六</div>
      </div>
      
      <div class="calendar-loading" style="${this.isLoading ? '' : 'display:none;'}">
        <div class="spinner"></div>
        <span>加载会话数据...</span>
      </div>
    `;
  }
  
  /**
   * 更新日历选择器
   * @param sessions 会话列表
   * @param currentSessionId 当前选中的会话ID
   */
  public update(sessions: BrowsingSession[] = [], currentSessionId?: string): void {
    if (!this.container) {
      logger.warn('日历容器不存在，无法更新');
      return;
    }
    
    // 显示加载指示器
    this.setLoading(true);
    
    // 使用requestAnimationFrame确保UI先更新
    requestAnimationFrame(() => {
      // 处理会话数据（异步）
      setTimeout(() => {
        logger.log(`更新日历选择器，会话数量: ${sessions.length}`);
        this.sessions = sessions;
        this.selectedSessionId = currentSessionId || null;
        
        // 如果有当前选中会话，定位到会话所在月份
        if (currentSessionId) {
          const selectedSession = sessions.find(s => s.id === currentSessionId);
          if (selectedSession) {
            const sessionDate = new Date(selectedSession.startTime);
            this.currentMonth = sessionDate.getMonth();
            this.currentYear = sessionDate.getFullYear();
          }
        }
        
        // 强制确保日历结构存在
        if (!this.container?.querySelector('.calendar-grid')) {
          logger.warn('日历网格不存在，重新创建结构');
          this.createCalendarStructure();
        }
        
        this.renderCalendarDays();
        this.setLoading(false); // 隐藏加载指示器
        
        logger.log('日历会话选择器更新完成');
      }, 0);
    });
  }
  
  /**
   * 渲染日历天数
   */
  private renderCalendarDays(): void {
    const calendarGrid = this.container?.querySelector('.calendar-grid');
    if (!calendarGrid) return;
    
    // 更新月份标题
    const monthHeader = this.container?.querySelector('.current-month');
    if (monthHeader) {
      monthHeader.textContent = `${this.currentYear}年${this.monthNames[this.currentMonth]}`;
    }
    
    // 移除旧的日期单元格
    const existingCells = calendarGrid.querySelectorAll('.day-cell');
    existingCells.forEach(cell => cell.remove());
    
    // 计算日历参数
    const firstDay = new Date(this.currentYear, this.currentMonth, 1);
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const firstWeekday = firstDay.getDay();
    
    // 分析会话数据
    const sessionsByDate = this.analyzeSessionDates();
    
    // 使用DocumentFragment提高性能
    const fragment = document.createDocumentFragment();
    
    // 生成上个月填充日期
    const prevMonthDays = firstWeekday;
    const prevMonthLastDate = new Date(this.currentYear, this.currentMonth, 0).getDate();
    for (let i = prevMonthDays - 1; i >= 0; i--) {
      const dayNumber = prevMonthLastDate - i;
      const cell = this.createDayCell(dayNumber, 'other-month');
      fragment.appendChild(cell);
    }
    
    // 生成当月日期
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
      // 创建日期字符串
      const date = new Date(this.currentYear, this.currentMonth, day);
      const dateStr = this.formatDate(date);
      
      // 确定单元格类名
      let className = '';
      
      // 当前日期高亮
      if (today.getDate() === day && 
          today.getMonth() === this.currentMonth && 
          today.getFullYear() === this.currentYear) {
        className += ' current-day';
      }
      
      // 会话开始日
      if (sessionsByDate[dateStr]?.hasStart) {
        className += ' session-start';
      }
      
      // 会话持续日
      if (sessionsByDate[dateStr]?.hasContinue) {
        className += ' session-continue';
      }
      
      // 选中日期
      if (this.isSelectedDate(date)) {
        className += ' selected-day';
      }
      
      // 创建并添加单元格
      const cell = this.createDayCell(day, className.trim(), dateStr);
      
      // 为开始日添加会话ID数据
      if (sessionsByDate[dateStr]?.startSessionId) {
        cell.dataset.sessionId = sessionsByDate[dateStr].startSessionId;
      }
      
      fragment.appendChild(cell);
    }
    
    // 填充下个月的日期
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const nextMonthDays = totalCells - (firstWeekday + daysInMonth);
    for (let i = 1; i <= nextMonthDays; i++) {
      const cell = this.createDayCell(i, 'other-month');
      fragment.appendChild(cell);
    }
    
    // 一次性添加所有单元格到网格
    calendarGrid.appendChild(fragment);
    
    logger.log(`日历天数渲染完成，本月共${daysInMonth}天`);
  }
  
  /**
   * 创建单个日期单元格
   */
  private createDayCell(dayNumber: number, className: string = '', dateStr?: string): HTMLElement {
    const cell = document.createElement('div');
    cell.className = `day-cell${className ? ' ' + className : ''}`;
    if (dateStr) {
      cell.dataset.date = dateStr;
    }
    
    const numberDiv = document.createElement('div');
    numberDiv.className = 'day-number';
    numberDiv.textContent = String(dayNumber);
    cell.appendChild(numberDiv);
    
    // 为会话开始日添加额外的视觉指示
    if (className.includes('session-start')) {
      const indicator = document.createElement('div');
      indicator.className = 'session-indicator';
      cell.appendChild(indicator);
    }
    
    return cell;
  }
  
  /**
   * 分析会话日期
   * 返回包含每个日期会话状态的对象
   */
  private analyzeSessionDates(): Record<string, {
    hasStart: boolean,
    hasContinue: boolean,
    startSessionId?: string
  }> {
    // 创建日期索引Map，比Object性能更好
    const result: Record<string, {
      hasStart: boolean,
      hasContinue: boolean,
      startSessionId?: string
    }> = {};
    
    // 如果会话太多，限制处理数量
    const maxSessions = 500; // 设置合理的最大值以避免性能问题
    const sessionsToProcess = this.sessions.length > maxSessions ? 
      this.sessions.slice(0, maxSessions) : this.sessions;
    
    // 优化：预先计算当前显示月份的开始和结束日期
    const monthStart = new Date(this.currentYear, this.currentMonth, 1);
    const monthEnd = new Date(this.currentYear, this.currentMonth + 1, 0);
    
    // 添加前后一个月的缓冲，以处理跨月会话
    const processStart = new Date(monthStart);
    processStart.setMonth(processStart.getMonth() - 1);
    const processEnd = new Date(monthEnd);
    processEnd.setMonth(processEnd.getMonth() + 1);
    
    // 只处理当前显示月份（含缓冲）相关的会话
    for (const session of sessionsToProcess) {
      const startDate = new Date(session.startTime);
      
      // 如果会话开始日期远超出显示范围，跳过
      if (startDate > processEnd || (session.endTime && new Date(session.endTime) < processStart)) {
        continue;
      }
      
      // 处理开始日期
      const startDateStr = this.formatDate(startDate);
      
      if (!result[startDateStr]) {
        result[startDateStr] = { hasStart: false, hasContinue: false };
      }
      
      // 标记为开始日，并存储会话ID
      result[startDateStr].hasStart = true;
      result[startDateStr].startSessionId = session.id;
      
      // 如果有结束时间且不同于开始日期，处理跨天
      if (session.endTime) {
        const endDate = new Date(session.endTime);
        
        if (this.dateToString(endDate) !== this.dateToString(startDate)) {
          // 使用优化的日期范围迭代
          const currentDate = new Date(startDate);
          currentDate.setDate(currentDate.getDate() + 1); // 从第二天开始
          
          const maxDays = 60; // 防止无限循环
          let dayCount = 0;
          
          while (currentDate <= endDate && dayCount < maxDays) {
            const dateStr = this.formatDate(currentDate);
            
            if (!result[dateStr]) {
              result[dateStr] = { hasStart: false, hasContinue: false };
            }
            
            // 标记为持续日
            result[dateStr].hasContinue = true;
            
            // 移至下一天
            currentDate.setDate(currentDate.getDate() + 1);
            dayCount++;
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * 判断日期是否为当前选中会话的开始日期
   */
  private isSelectedDate(date: Date): boolean {
    if (!this.selectedSessionId) return false;
    
    const selectedSession = this.sessions.find(s => s.id === this.selectedSessionId);
    if (!selectedSession) return false;
    
    const sessionDate = new Date(selectedSession.startTime);
    return this.dateToString(date) === this.dateToString(sessionDate);
  }
  
  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    if (!this.container) return;
    
    // 先移除可能存在的旧事件监听器
    this.removeEventListeners();
    
    // 月份导航
    const prevButton = this.container.querySelector('.month-nav.prev');
    const nextButton = this.container.querySelector('.month-nav.next');
    
    if (prevButton) {
      prevButton.addEventListener('click', this.boundHandlePrevMonth);
    }
    
    if (nextButton) {
      nextButton.addEventListener('click', this.boundHandleNextMonth);
    }
    
    // 日期单元格点击 - 使用事件委托
    const grid = this.container.querySelector('.calendar-grid') as HTMLElement;
    if (grid) {
      grid.addEventListener('click', this.boundHandleCellClick);
    }
  }
  
  /**
   * 移除事件监听器
   */
  private removeEventListeners(): void {
    if (!this.container) return;
    
    // 月份导航
    const prevButton = this.container.querySelector('.month-nav.prev');
    const nextButton = this.container.querySelector('.month-nav.next');
    
    if (prevButton) {
      prevButton.removeEventListener('click', this.boundHandlePrevMonth);
    }
    
    if (nextButton) {
      nextButton.removeEventListener('click', this.boundHandleNextMonth);
    }
    
    // 日期单元格点击
    const grid = this.container.querySelector('.calendar-grid') as HTMLElement;
    if (grid) {
      grid.removeEventListener('click', this.boundHandleCellClick);
    }
  }
  
  /**
   * 处理日期单元格点击
   */
  private handleCellClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const cell = target.closest('.day-cell') as HTMLElement;
    
    // 如果没有点击到单元格或不是会话开始日，忽略
    if (!cell || !cell.classList.contains('session-start')) return;
    
    const sessionId = cell.dataset.sessionId;
    if (sessionId) {
      this.selectSession(sessionId);
    }
  }
  
  /**
   * 月份导航
   */
  private navigateMonth(delta: number): void {
    this.currentMonth += delta;
    
    if (this.currentMonth > 11) {
      this.currentMonth = 0;
      this.currentYear++;
    } else if (this.currentMonth < 0) {
      this.currentMonth = 11;
      this.currentYear--;
    }
    
    this.renderCalendarDays();
  }
  
  /**
   * 选择会话
   */
  private selectSession(sessionId: string): void {
    this.selectedSessionId = sessionId;
    
    // 调用会话服务加载选中会话
    sessionServiceClient.loadSession(sessionId)
      .then(() => {
        logger.log(`会话已选择: ${sessionId}`);
        this.renderCalendarDays(); // 更新选中状态
      })
      .catch(error => {
        logger.error('加载会话失败:', error);
      });
  }
  
  /**
   * 设置加载状态
   */
  private setLoading(loading: boolean): void {
    this.isLoading = loading;
    
    const loadingElement = this.container?.querySelector('.calendar-loading') as HTMLElement;
    if (loadingElement) {
      loadingElement.style.display = loading ? 'flex' : 'none';
    }
  }
  
  /**
   * 格式化日期为字符串 (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  
  /**
   * 将日期转为年月日字符串（用于比较）
   */
  private dateToString(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }
  
  /**
   * 清理资源，移除事件监听器
   * 在组件销毁前调用
   */
  public dispose(): void {
    this.removeEventListeners();
    logger.log('日历会话选择器资源已清理');
  }
}