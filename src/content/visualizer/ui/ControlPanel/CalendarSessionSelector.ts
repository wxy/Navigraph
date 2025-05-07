import { Logger } from '../../../../lib/utils/logger.js';
import { i18n } from '../../../../lib/utils/i18n-utils.js'; // 新增 i18n 引入
import type { Visualizer } from '../../../types/navigation.js';
import type { BrowsingSession } from '../../../types/session.js';
import { sessionServiceClient } from '../../../core/session-service-client.js';

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
  private selectedSessionId: string | null = null; // 当前会话ID
  private latestSessionId: string | null = null;   // 最新会话ID - 新增
  private isLoading: boolean = false;
  private lastUpdateHash: string | null = null;
  
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
   * 获取本地化的月份名称列表
   */
  private getMonthNames(): string[] {
    return [
      i18n("calendar_month_jan"),
      i18n("calendar_month_feb"),
      i18n("calendar_month_mar"),
      i18n("calendar_month_apr"),
      i18n("calendar_month_may"),
      i18n("calendar_month_jun"),
      i18n("calendar_month_jul"),
      i18n("calendar_month_aug"),
      i18n("calendar_month_sep"),
      i18n("calendar_month_oct"),
      i18n("calendar_month_nov"),
      i18n("calendar_month_dec")
    ];
  }
  
  /**
   * 初始化日历会话选择器
   * @param containerId 容器元素ID或容器元素
   */
  public initialize(): void {
    this.container = document.getElementById('calendar-session-selector');
    
    if (!this.container) {
      logger.error('calendar_selector_container_not_found');
      return;
    }
    
    // 创建日历结构
    this.createCalendarStructure();
    
    // 渲染日历天数
    this.renderCalendarDays();
    
    // 设置事件监听器
    this.setupEventListeners();
    
    logger.log('calendar_session_selector_initialized');
  }
  
  /**
   * 创建日历基础结构
   */
  private createCalendarStructure(): void {
    if (!this.container) return;
    
    // 清空容器
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    
    // 创建日历头部
    const calendarHeader = document.createElement('div');
    calendarHeader.className = 'calendar-header';
    
    // 创建上个月按钮
    const prevButton = document.createElement('button');
    prevButton.className = 'month-nav prev';
    prevButton.title = i18n('calendar_prev_month');
    prevButton.textContent = '◀';
    calendarHeader.appendChild(prevButton);
    
    // 创建月份标题
    const monthTitle = document.createElement('h3');
    monthTitle.className = 'current-month';
    monthTitle.textContent = i18n('calendar_month_year', `${this.currentYear}`, this.getMonthNames()[this.currentMonth]);
    calendarHeader.appendChild(monthTitle);
    
    // 创建下个月按钮
    const nextButton = document.createElement('button');
    nextButton.className = 'month-nav next';
    nextButton.title = i18n('calendar_next_month');
    nextButton.textContent = '▶';
    calendarHeader.appendChild(nextButton);
    
    // 添加日历头部到容器
    this.container.appendChild(calendarHeader);
    
    // 创建日历网格
    const calendarGrid = document.createElement('div');
    calendarGrid.className = 'calendar-grid';
    
    // 添加星期标题
    const weekdays = [
      i18n("calendar_sunday"),
      i18n("calendar_monday"), 
      i18n("calendar_tuesday"),
      i18n("calendar_wednesday"),
      i18n("calendar_thursday"),
      i18n("calendar_friday"),
      i18n("calendar_saturday")
    ];
    weekdays.forEach(day => {
      const weekday = document.createElement('div');
      weekday.className = 'weekday';
      weekday.textContent = day;
      calendarGrid.appendChild(weekday);
    });
    
    // 添加日历网格到容器
    this.container.appendChild(calendarGrid);
    
    // 创建加载指示器
    const loadingElement = document.createElement('div');
    loadingElement.className = 'calendar-loading';
    loadingElement.style.display = this.isLoading ? 'flex' : 'none';
    
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    loadingElement.appendChild(spinner);
    
    const loadingText = document.createElement('span');
    loadingText.textContent = i18n('calendar_loading_data');
    loadingElement.appendChild(loadingText);
    
    // 添加加载指示器到容器
    this.container.appendChild(loadingElement);
    
    // 创建会话列表容器
    this.createSessionListContainer();
  }
  
  /**
   * 创建会话列表容器
   */
  private createSessionListContainer(): void {
    if (!this.container) return;
    
    // 如果已经存在就不再创建
    if (document.getElementById('session-list-container')) return;
    
    // 创建会话列表容器
    const listContainer = document.createElement('div');
    listContainer.className = 'session-list-container';
    listContainer.id = 'session-list-container';
    listContainer.style.display = 'none';
    
    // 创建标题区域
    const header = document.createElement('div');
    header.className = 'session-list-header';
    
    const title = document.createElement('h4');
    title.className = 'session-list-title';
    title.textContent = i18n('calendar_select_session');
    header.appendChild(title);
    
    const closeButton = document.createElement('button');
    closeButton.className = 'session-list-close';
    closeButton.id = 'session-list-close';
    closeButton.innerHTML = '&times;';
    header.appendChild(closeButton);
    
    listContainer.appendChild(header);
    
    // 创建会话列表
    const sessionList = document.createElement('div');
    sessionList.className = 'session-list';
    sessionList.id = 'session-list';
    
    listContainer.appendChild(sessionList);
    
    // 添加会话列表容器到日历容器
    this.container.appendChild(listContainer);
  }
  
  /**
   * 更新日历选择器
   * @param sessionList 会话列表
   * @param currentSessionId 当前选中的会话ID
   * @param latestSessionId 最新活跃的会话ID
   */
  public update(sessionList: any[] = [], currentSessionId?: string, latestSessionId?: string): void {
    if (!this.container) {
      logger.warn('calendar_container_not_exists');
      return;
    }
    
    // 创建当前更新的哈希值，包含最新会话ID
    const updateHash = `${sessionList.length}-${currentSessionId || 'null'}-${latestSessionId || 'null'}-${sessionList.map(s => s.id).join(',')}`;
    
    // 如果与上次更新相同，跳过更新
    if (this.lastUpdateHash === updateHash) {
      logger.debug('calendar_skip_duplicate_update');
      return;
    }
    
    this.lastUpdateHash = updateHash;
    
    logger.log('calendar_update', sessionList.length);
    
    // 显示加载指示器
    this.setLoading(true);
    
    requestAnimationFrame(() => {
      this.sessions = sessionList;
      this.selectedSessionId = currentSessionId || null;
      this.latestSessionId = latestSessionId || null; // 保存最新会话ID
      
      // 如果有当前选中会话，定位到会话所在月份
      if (currentSessionId) {
        const selectedSession = sessionList.find(s => s.id === currentSessionId);
        if (selectedSession) {
          const sessionDate = new Date(selectedSession.startTime);
          this.currentMonth = sessionDate.getMonth();
          this.currentYear = sessionDate.getFullYear();
        }
      }
      
      // 强制确保日历结构存在
      if (!this.container?.querySelector('.calendar-grid')) {
        logger.warn('calendar_grid_missing');
        this.createCalendarStructure();
      }
      
      this.renderCalendarDays();
      this.setLoading(false); // 隐藏加载指示器
      
      logger.log('calendar_update_complete');
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
      monthHeader.textContent = i18n('calendar_month_year', `${this.currentYear}`, this.getMonthNames()[this.currentMonth]);
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
      
      // 最新会话日期 - 新增
      if (this.isLatestDate(date)) {
        className += ' latest-day';
      }

      // 创建并添加单元格
      const cell = this.createDayCell(day, className.trim(), dateStr);
      
      // 为开始日添加会话ID数据 - 保留原有代码
      if (sessionsByDate[dateStr]?.startSessionId) {
        cell.dataset.sessionId = sessionsByDate[dateStr].startSessionId;
      }
      
      // 新增：添加会话ID数组数据
      if (sessionsByDate[dateStr]?.startSessionIds && sessionsByDate[dateStr]?.startSessionIds.length > 0) {
        cell.dataset.sessionIds = JSON.stringify(sessionsByDate[dateStr].startSessionIds);
        
        // 如果有多个会话，添加多会话指示器
        if (sessionsByDate[dateStr].startSessionIds.length > 1) {
          const multiIndicator = document.createElement('span');
          multiIndicator.className = 'multi-session-indicator';
          multiIndicator.textContent = sessionsByDate[dateStr].startSessionIds.length.toString();
          cell.appendChild(multiIndicator);
        }
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
    
    logger.log('calendar_days_rendered', daysInMonth);
  }
  /**
   * 判断日期是否为最新会话的开始日期
   */
  private isLatestDate(date: Date): boolean {
    if (!this.latestSessionId) return false;
    
    const latestSession = this.sessions.find(s => s.id === this.latestSessionId);
    if (!latestSession) return false;
    
    const sessionDate = new Date(latestSession.startTime);
    return this.dateToString(date) === this.dateToString(sessionDate);
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
    
    // 为会话开始日添加视觉指示
    if (className.includes('session-start')) {
      const indicator = document.createElement('div');
      indicator.className = 'session-indicator';
  
      // 为不同类型的会话添加不同的视觉效果
      if (className.includes('selected-day') && className.includes('latest-day')) {
        // 当前会话和最新会话是同一个
        indicator.classList.add('current-latest-indicator');
      } else if (className.includes('selected-day')) {
        // 仅当前会话
        indicator.classList.add('current-indicator');
      } else if (className.includes('latest-day')) {
        // 仅最新会话
        indicator.classList.add('latest-indicator'); 
      }
      
      if (className.includes('latest-day') && className.includes('selected-day')) {
        cell.title = i18n('calendar_current_and_latest_session');
      } else if (className.includes('latest-day')) {
        cell.title = i18n('calendar_latest_session');
      } else if (className.includes('selected-day')) {
        cell.title = i18n('calendar_current_session');
      }
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
    startSessionId?: string,  // 保留原有字段
    startSessionIds: string[] // 新字段：存储所有会话ID数组
  }> {
    const result: Record<string, {
      hasStart: boolean,
      hasContinue: boolean,
      startSessionId?: string,
      startSessionIds: string[]
    }> = {};
    
    // 如果没有会话，返回空结果
    if (!this.sessions || this.sessions.length === 0) {
      return result;
    }
    
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
        result[startDateStr] = { 
          hasStart: false, 
          hasContinue: false,
          startSessionIds: [] 
        };
      }
      
      // 标记为开始日，并存储会话ID
      result[startDateStr].hasStart = true;
      
      // 保存第一个会话ID作为兼容旧代码的startSessionId
      if (!result[startDateStr].startSessionId) {
        result[startDateStr].startSessionId = session.id;
      }
      
      // 所有会话ID存入数组
      result[startDateStr].startSessionIds.push(session.id);
      
      // 以下代码保持不变，处理会话持续日期
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
              result[dateStr] = { hasStart: false, hasContinue: false, startSessionIds: [] };
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
    
    // 检查是否有多个会话
    const sessionIdsStr = cell.dataset.sessionIds;
    if (sessionIdsStr) {
      try {
        const sessionIds = JSON.parse(sessionIdsStr);
        
        if (Array.isArray(sessionIds) && sessionIds.length > 1) {
          // 多个会话，显示选择列表
          this.showSessionList(sessionIds, cell.dataset.date);
          return;
        } else if (Array.isArray(sessionIds) && sessionIds.length === 1) {
          // 单个会话，直接选择
          this.selectSession(sessionIds[0]);
          return;
        }
      } catch (e) {
        logger.error('calendar_parse_sessions_error', e);
        const sessionId = cell.dataset.sessionId;
        if (sessionId) {
          this.selectSession(sessionId);
        }
      }
    }
    
    // 降级到原有逻辑
    const sessionId = cell.dataset.sessionId;
    if (sessionId) {
      this.selectSession(sessionId);
    }
  }

  /**
   * 显示指定日期的会话列表
   */
  private showSessionList(sessionIds: string[], dateStr?: string): void {
    // 获取列表容器
    const listContainer = document.getElementById('session-list-container');
    const sessionList = document.getElementById('session-list');
    if (!listContainer || !sessionList) {
      logger.error('calendar_session_list_container_missing');
      return;
    }
    
    // 清空现有内容
    while (sessionList.firstChild) {
      sessionList.removeChild(sessionList.firstChild);
    }
    
    // 如果有日期，更新标题
    if (dateStr) {
      const date = new Date(dateStr);
      const title = listContainer.querySelector('.session-list-title');
      if (title && date instanceof Date && !isNaN(date.getTime())) {
        title.textContent = i18n('calendar_sessions_for_date', `${date.getFullYear()}`, `${date.getMonth() + 1}`, `${date.getDate()}`);
      }
    }
    
    // 为每个会话创建列表项
    for (const sessionId of sessionIds) {
      const session = this.sessions.find(s => s.id === sessionId);
      if (!session) continue;
      
      // 创建列表项容器
      const item = document.createElement('div');
      item.className = 'session-list-item';
      item.dataset.sessionId = sessionId;
      
      // 格式化会话时间
      const startTime = new Date(session.startTime);
      const timeStr = startTime.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // 创建时间元素
      const timeElement = document.createElement('div');
      timeElement.className = 'session-time';
      timeElement.textContent = timeStr;
      item.appendChild(timeElement);
      
      // 创建详情容器
      const infoElement = document.createElement('div');
      infoElement.className = 'session-info';
      
      // 计算会话时长
      let durationStr = i18n('calendar_session_in_progress');
      if (session.endTime) {
        const endTime = new Date(session.endTime);
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationMin = Math.floor(durationMs / 60000);
        
        if (durationMin < 1) {
          durationStr = i18n('calendar_duration_less_than_minute');
        } else if (durationMin < 60) {
          durationStr = i18n('calendar_duration_minutes', `${durationMin}`);
        } else {
          const hours = Math.floor(durationMin / 60);
          const mins = durationMin % 60;
          durationStr = mins > 0 ? 
            i18n('calendar_duration_hours_minutes', `${hours}`, `${mins}`) :
            i18n('calendar_duration_hours', `${hours}`);
        }
      }
      
      // 添加持续时间
      const durationElement = document.createElement('span');
      durationElement.className = 'session-duration';
      durationElement.textContent = durationStr;
      infoElement.appendChild(durationElement);
      
      item.appendChild(infoElement);
      
      // 添加点击事件
      item.addEventListener('click', () => {
        this.selectSession(sessionId);
        listContainer.style.display = 'none';
      });
      
      // 添加到列表中
      sessionList.appendChild(item);
    }
    
    // 显示列表容器
    listContainer.style.display = 'block';
    
    // 添加关闭按钮事件
    const closeButton = document.getElementById('session-list-close');
    if (closeButton) {
        // 移除旧的事件监听（如果有）
        closeButton.removeEventListener('click', () => {});
        // 添加新的事件监听
        closeButton.addEventListener('click', () => {
          listContainer.style.display = 'none';
        });
      }
    
    // 添加点击外部关闭功能
    setTimeout(() => {
      const handleOutsideClick = (e: MouseEvent) => {
        if (!listContainer.contains(e.target as Node) && 
            !(e.target as Element).closest('.day-cell.session-start')) {
          listContainer.style.display = 'none';
          document.removeEventListener('click', handleOutsideClick);
        }
      };
      document.addEventListener('click', handleOutsideClick);
    }, 10);
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
        logger.log('calendar_session_selected', sessionId);
        this.renderCalendarDays(); // 更新选中状态
      })
      .catch(error => {
        logger.error('calendar_load_session_failed', error);
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
    logger.log('calendar_disposed');
  }
}