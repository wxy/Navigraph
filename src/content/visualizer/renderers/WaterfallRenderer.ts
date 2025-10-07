import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { NavNode, NavLink, Visualizer } from '../../types/navigation.js';
import { BaseRenderer } from './BaseRenderer.js';

const d3 = window.d3;
const logger = new Logger('WaterfallRenderer');

export class WaterfallRenderer implements BaseRenderer {
  private visualizer: Visualizer;
  private svg: any = null;
  private container: HTMLElement | null = null;
  private width: number = 0;
  private height: number = 0;
  private focusController: WaterfallFocusController | null = null;
  private focusConfig: any = null; // 观察区域配置
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
    logger.log(_('waterfall_renderer_created', '瀑布视图渲染器已创建'));
  }
  
  initialize(svg: any, container: HTMLElement, width: number, height: number): void {
    this.svg = svg;
    this.container = container;
    this.width = width;
    this.height = height;
    
    logger.log(_('waterfall_renderer_initialized', '瀑布视图渲染器已初始化，尺寸: {0}x{1}'), width, height);
  }
  
  render(nodes: NavNode[], edges: NavLink[], options: { restoreTransform?: boolean } = {}): void {
    if (!this.svg || !this.container) {
      logger.error(_('waterfall_renderer_cannot_render', '瀑布渲染器无法渲染：SVG或容器未初始化'));
      return;
    }
    
    logger.log(_('waterfall_renderer_render_start', '开始渲染瀑布视图，节点数: {0}，边数: {1}'), nodes.length, edges.length);
    
    try {
      // 调用瀑布布局渲染函数
      renderWaterfallLayout(
        this.container,
        this.svg,
        nodes,
        edges,
        this.width,
        this.height,
        this.visualizer,
        this  // 传递renderer实例
      );
      
      // Phase 2.2: 渲染观察区域时间轴配置
      this.renderTimelineControls(nodes);
      
    } catch (error) {
      logger.error(_('waterfall_renderer_render_error', '瀑布视图渲染失败: {0}'), error);
      throw error;
    }
  }
  
  /**
   * Phase 2.2: 渲染时间轴控制器
   */
  private renderTimelineControls(nodes: NavNode[]): void {
    if (!this.container || !nodes || nodes.length === 0) {
      return;
    }
    
    // 计算时间配置（每次都重新计算，确保响应数据变化）
    const timestamps = nodes.map(n => n.timestamp).filter(t => isFinite(t));
    if (timestamps.length === 0) {
      console.warn('No valid timestamps found for timeline controls');
      return;
    }
    
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const timeRange = maxTime - minTime;
    
    console.log('🔄 时间轴配置更新:', {
      nodeCount: nodes.length,
      timestampCount: timestamps.length,
      minTime: new Date(minTime),
      maxTime: new Date(maxTime),
      timeRange: timeRange / (1000 * 60), // 分钟
      source: '筛选条件变化触发重新计算'
    });
    
    // 如果时间范围太小，使用默认值
    const effectiveTimeRange = timeRange > 0 ? timeRange : 3600000; // 1小时默认
    const effectiveMinTime = timeRange > 0 ? minTime : Date.now() - 1800000; // 30分钟前
    const effectiveMaxTime = timeRange > 0 ? maxTime : Date.now() + 1800000; // 30分钟后
    
    const focusConfig = {
      center: effectiveMaxTime - (effectiveTimeRange * 0.1),
      width: effectiveTimeRange * 0.6,
      minTime: effectiveMinTime,
      maxTime: effectiveMaxTime,
      containerWidth: Math.max(this.width - 200, 400), // 最小宽度400px
      // 添加更新标识，用于检测配置变化
      lastUpdateTime: Date.now(),
      dataHash: this.calculateDataHash(nodes)
    };
    
    // 检查是否需要更新观察窗口
    const shouldUpdateFocusWindow = !this.focusConfig || 
      this.focusConfig.dataHash !== focusConfig.dataHash ||
      Math.abs(this.focusConfig.minTime - focusConfig.minTime) > 1000 ||
      Math.abs(this.focusConfig.maxTime - focusConfig.maxTime) > 1000;
    
    if (shouldUpdateFocusWindow) {
      console.log('✅ 观察窗口配置已更新，将重新渲染');
    }
    
    // 将观察区域配置存储为实例属性，供后续在时间轴上渲染时使用
    this.focusConfig = focusConfig;
  }
  
  /**
   * 计算数据哈希值，用于检测数据变化
   */
  private calculateDataHash(nodes: NavNode[]): string {
    const key = nodes.length + '_' + 
      nodes.map(n => n.id + '_' + n.timestamp).join('|').substring(0, 100);
    return btoa(key).substring(0, 16); // 简单哈希
  }
  
  cleanup(): void {
    if (this.svg) {
      this.svg.selectAll("*").remove();
    }
    
    this.svg = null;
    this.container = null;
    
    logger.log(_('waterfall_renderer_cleaned_up', '瀑布视图渲染器已清理'));
  }
  
  /**
   * 渲染非均匀时间轴（Phase 2.2 - 观察区域滑动控制）
   */
  renderNonUniformTimeAxis(containerElement: HTMLElement, focusConfig: {center: number, width: number, minTime: number, maxTime: number, containerWidth: number}): void {
    const container = d3.select(containerElement);
    
    // 清除现有时间轴
    container.select('.waterfall-timeline').remove();
    
    // 创建时间轴控制面板
    const timelinePanel = container.append('div')
      .attr('class', 'waterfall-timeline')
      .style('position', 'absolute')
      .style('top', '20px')  // 距离顶部20px，更靠近顶部
      .style('left', '50px')  // 距离左侧50px
      .style('width', `${focusConfig.containerWidth - 100}px`)  // 减去左右边距
      .style('height', '80px')  // 增加高度
      .style('background', 'rgba(255, 255, 255, 0.98)')
      .style('border', '1px solid #ccc')
      .style('border-radius', '6px')
      .style('box-shadow', '0 4px 12px rgba(0,0,0,0.15)')
      .style('z-index', '1000')
      .style('padding', '12px')
      .style('pointer-events', 'all');
    
    // 添加标题
    timelinePanel.append('div')
      .style('font-size', '13px')
      .style('font-weight', 'bold')
      .style('color', '#2c3e50')
      .style('margin-bottom', '10px')
      .text('观察区域时间轴控制');
    
    // 创建观察区域控制器 - 直接传递面板容器
    this.focusController = new WaterfallFocusController({
      container: timelinePanel.node(),
      minTime: focusConfig.minTime,
      maxTime: focusConfig.maxTime,
      center: focusConfig.center,
      width: focusConfig.width,
      containerWidth: focusConfig.containerWidth - 24, // 减去padding
      onUpdate: (newCenter: number) => {
        // 回调函数：当观察中心变化时重新渲染
        logger.log(_('waterfall_focus_center_changed', '观察中心已更改为: {0}'), newCenter);
      }
    });
    
    this.focusController.render();
    
    logger.log(_('waterfall_non_uniform_timeline_rendered', '非均匀时间轴已渲染'));
  }
}

/**
 * 非均匀时间轴映射系统（重新设计）
 * 观察窗口内完整显示，外部按距离压缩
 */
class NonUniformTimeMapper {
  private focusCenter!: number;
  private focusWidth!: number;
  private totalTimeRange: number;
  private minTime: number;
  private maxTime: number;
  private screenWidth: number;
  private detailScreenRatio: number = 0.7; // 详细显示区域占屏幕比例
  private isFullScale: boolean = false; // 是否全比例显示
  
  constructor(minTime: number, maxTime: number, screenWidth: number, initialFocusCenter?: number) {
    this.minTime = minTime;
    this.maxTime = maxTime;
    this.totalTimeRange = maxTime - minTime;
    this.screenWidth = screenWidth;
    
    // 根据时间范围决定观察窗口策略
    this.calculateOptimalFocusWindow(initialFocusCenter);
  }
  
  /**
   * 计算最优观察窗口配置
   */
  private calculateOptimalFocusWindow(initialFocusCenter?: number): void {
    // 默认使用非均匀显示模式，具体是否使用全比例模式由外部的checkIfFullScaleNeeded决定
    // 这里只负责设置基本的窗口参数
    
    if (this.totalTimeRange <= 0) {
      // 边界情况：没有时间范围
      this.isFullScale = true;
      this.focusWidth = 0;
      this.focusCenter = this.minTime;
      return;
    }
    
    // 初始设置为非均匀模式（可能会被forceFullScale()覆盖）
    this.isFullScale = false;
    
    // 观察窗口宽度：确保能显示足够的细节，但不超过总时间范围
    const minFocusWidth = this.totalTimeRange * 0.2; // 至少20%
    const maxFocusWidth = this.totalTimeRange * 0.8; // 最多80%
    this.focusWidth = Math.min(maxFocusWidth, Math.max(minFocusWidth, this.totalTimeRange * 0.4));
    
    // 初始观察中心在最新时间（最左侧）
    this.focusCenter = initialFocusCenter || (this.maxTime - this.focusWidth / 2);
    
    // 确保观察中心在有效范围内
    const halfWidth = this.focusWidth / 2;
    this.focusCenter = Math.max(
      this.minTime + halfWidth,
      Math.min(this.maxTime - halfWidth, this.focusCenter)
    );
  }
  
  /**
   * 将时间戳映射到屏幕X坐标
   */
  timeToX(timestamp: number): number {
    if (this.isFullScale) {
      // 全比例模式：线性映射
      const ratio = (timestamp - this.minTime) / this.totalTimeRange;
      return ratio * this.screenWidth;
    }
    
    const focusStart = this.focusCenter - this.focusWidth / 2;
    const focusEnd = this.focusCenter + this.focusWidth / 2;
    
    // 详细显示区域占屏幕70%，压缩区域占30%
    const detailScreenWidth = this.screenWidth * this.detailScreenRatio;
    const compressedScreenWidth = this.screenWidth * (1 - this.detailScreenRatio);
    
    if (timestamp >= focusStart && timestamp <= focusEnd) {
      // 观察窗口内：线性映射到详细显示区域
      const ratio = (timestamp - focusStart) / this.focusWidth;
      const leftCompressedWidth = compressedScreenWidth / 2;
      return leftCompressedWidth + ratio * detailScreenWidth;
    } else if (timestamp < focusStart) {
      // 观察窗口左侧：压缩映射
      const leftCompressedWidth = compressedScreenWidth / 2;
      const timeBeforeFocus = focusStart - this.minTime;
      
      if (timeBeforeFocus <= 0) return 0;
      
      const distanceFromFocus = focusStart - timestamp;
      const ratio = Math.min(1, distanceFromFocus / timeBeforeFocus);
      
      // 使用平方根压缩：保证远处不会过度压缩
      const compressRatio = 1 - Math.sqrt(ratio);
      return leftCompressedWidth * compressRatio;
    } else {
      // 观察窗口右侧：压缩映射
      const rightCompressedWidth = compressedScreenWidth / 2;
      const timeAfterFocus = this.maxTime - focusEnd;
      
      if (timeAfterFocus <= 0) return this.screenWidth;
      
      const distanceFromFocus = timestamp - focusEnd;
      const ratio = Math.min(1, distanceFromFocus / timeAfterFocus);
      
      // 使用平方根压缩
      const compressRatio = Math.sqrt(ratio);
      const detailEndX = compressedScreenWidth / 2 + detailScreenWidth;
      return detailEndX + rightCompressedWidth * compressRatio;
    }
  }
  
  /**
   * 将屏幕X坐标映射回时间戳
   */
  xToTime(x: number): number {
    if (this.isFullScale) {
      const ratio = x / this.screenWidth;
      return this.minTime + ratio * this.totalTimeRange;
    }
    
    const detailScreenWidth = this.screenWidth * this.detailScreenRatio;
    const compressedScreenWidth = this.screenWidth * (1 - this.detailScreenRatio);
    const leftCompressedWidth = compressedScreenWidth / 2;
    const detailStartX = leftCompressedWidth;
    const detailEndX = detailStartX + detailScreenWidth;
    
    if (x >= detailStartX && x <= detailEndX) {
      // 详细显示区域
      const ratio = (x - detailStartX) / detailScreenWidth;
      return this.focusCenter - this.focusWidth / 2 + ratio * this.focusWidth;
    } else if (x < detailStartX) {
      // 左侧压缩区域
      const ratio = x / leftCompressedWidth;
      const expandedRatio = 1 - ratio * ratio; // 平方根的逆运算
      const timeBeforeFocus = this.focusCenter - this.focusWidth / 2 - this.minTime;
      return this.minTime + timeBeforeFocus * (1 - expandedRatio);
    } else {
      // 右侧压缩区域
      const rightCompressedWidth = compressedScreenWidth / 2;
      const ratio = (x - detailEndX) / rightCompressedWidth;
      const expandedRatio = ratio * ratio; // 平方根的逆运算
      const timeAfterFocus = this.maxTime - (this.focusCenter + this.focusWidth / 2);
      return this.focusCenter + this.focusWidth / 2 + timeAfterFocus * expandedRatio;
    }
  }
  
  /**
   * 更新观察中心
   */
  updateFocusCenter(newCenter: number): boolean {
    if (this.isFullScale) return false; // 全比例模式不允许移动
    
    const halfWidth = this.focusWidth / 2;
    const clampedCenter = Math.max(
      this.minTime + halfWidth,
      Math.min(this.maxTime - halfWidth, newCenter)
    );
    
    if (Math.abs(clampedCenter - this.focusCenter) > 1000) { // 避免微小变化
      this.focusCenter = clampedCenter;
      return true;
    }
    return false;
  }
  
  /**
   * 强制设置为全比例模式
   */
  public forceFullScale(): void {
    this.isFullScale = true;
    this.focusWidth = this.totalTimeRange;
    this.focusCenter = this.minTime + this.totalTimeRange / 2;
  }
  
  /**
   * 获取观察窗口的屏幕坐标范围
   */
  getFocusScreenBounds(): { startX: number, endX: number, centerX: number, isFullScale: boolean } {
    if (this.isFullScale) {
      return {
        startX: 0,
        endX: this.screenWidth,
        centerX: this.screenWidth / 2,
        isFullScale: true
      };
    }
    
    // 计算理想的观察窗口宽度（70%屏幕宽度）
    const idealDetailScreenWidth = this.screenWidth * this.detailScreenRatio;
    
    // 但是要确保观察窗口不超出屏幕宽度
    const maxPossibleWidth = this.screenWidth;
    const actualDetailScreenWidth = Math.min(idealDetailScreenWidth, maxPossibleWidth);
    
    const compressedScreenWidth = this.screenWidth - actualDetailScreenWidth;
    const startX = compressedScreenWidth / 2;
    const endX = startX + actualDetailScreenWidth;
    
    // 确保边界在有效范围内
    const clampedStartX = Math.max(0, Math.min(startX, this.screenWidth));
    const clampedEndX = Math.max(clampedStartX, Math.min(endX, this.screenWidth));
    
    return {
      startX: clampedStartX,
      endX: clampedEndX,
      centerX: (clampedStartX + clampedEndX) / 2,
      isFullScale: false
    };
  }
  
  /**
   * 判断时间戳是否在观察窗口内
   */
  isInFocusWindow(timestamp: number): boolean {
    const focusStart = this.focusCenter - this.focusWidth / 2;
    const focusEnd = this.focusCenter + this.focusWidth / 2;
    return timestamp >= focusStart && timestamp <= focusEnd;
  }
  
  /**
   * 获取时间戳相对于观察窗口的缩放因子
   */
  getScaleFactor(timestamp: number): number {
    if (this.isFullScale || this.isInFocusWindow(timestamp)) {
      return 1.0; // 全比例或观察窗口内正常大小
    }
    
    const focusStart = this.focusCenter - this.focusWidth / 2;
    const focusEnd = this.focusCenter + this.focusWidth / 2;
    
    let distance: number;
    let maxDistance: number;
    
    if (timestamp < focusStart) {
      distance = focusStart - timestamp;
      maxDistance = this.focusCenter - this.focusWidth / 2 - this.minTime;
    } else {
      distance = timestamp - focusEnd;
      maxDistance = this.maxTime - (this.focusCenter + this.focusWidth / 2);
    }
    
    if (maxDistance <= 0) return 1.0;
    
    const distanceRatio = Math.min(1, distance / maxDistance);
    return Math.max(0.4, 1 - distanceRatio * 0.6); // 最小缩放到40%
  }
}

/**
 * 在时间轴上渲染观察区域指示器
 */
function renderFocusAreaOnTimeAxis(mainGroup: any, focusConfig: any, layoutData: WaterfallLayoutData, width: number, height: number): void {
  console.log('🎯 === 重构版本：renderFocusAreaOnTimeAxis ===');
  console.log('输入参数验证:', { 
    width, 
    height, 
    hasFocusConfig: !!focusConfig,
    hasLayoutData: !!layoutData,
    focusCenter: focusConfig ? new Date(focusConfig.center) : null,
    focusWidth: focusConfig ? focusConfig.width : null
  });
  
  // 🔧 重要：参数验证
  if (!focusConfig) {
    console.error('❌ focusConfig 参数为空，无法渲染观察窗口');
    return;
  }
  
  if (!layoutData || !layoutData.timeAxisData) {
    console.error('❌ layoutData 或 timeAxisData 为空，无法渲染观察窗口');
    return;
  }
  
  // 获取时间轴组 - 适应新的分组结构
  let timeAxisGroup = mainGroup.select('.waterfall-time-axis-group .waterfall-time-axis');
  if (timeAxisGroup.empty()) {
    console.warn('⚠️ 在分组结构中未找到时间轴，尝试直接查找');
    timeAxisGroup = mainGroup.select('.waterfall-time-axis');
    if (timeAxisGroup.empty()) {
      console.warn('⚠️ 直接查找时间轴也失败，使用时间轴组作为容器');
      timeAxisGroup = mainGroup.select('.waterfall-time-axis-group');
      if (timeAxisGroup.empty()) {
        console.error('❌ 完全找不到时间轴组，无法渲染观察窗口');
        console.log('🔍 调试：主组内容:', mainGroup.selectAll('*').nodes().map((n: any) => n.className || n.tagName));
        return;
      } else {
        console.log('✅ 使用时间轴组容器渲染观察窗口');
      }
    } else {
      console.log('✅ 找到时间轴（直接查找）');
    }
  } else {
    console.log('✅ 找到时间轴（分组结构）');
  }
  
  // 🔧 重要：使用专门的覆盖层组来渲染观察窗口，而不是时间轴组
  const focusOverlayGroup = mainGroup.select('.waterfall-focus-overlay-group');
  if (focusOverlayGroup.empty()) {
    console.error('❌ 找不到观察窗口覆盖层组，无法渲染观察窗口');
    return;
  }
  
  console.log('✅ 找到观察窗口覆盖层组');
  
  // 清除之前的观察窗口（从覆盖层组中清除）
  focusOverlayGroup.selectAll('.focus-window-overlay').remove();
  
  // 也确保从其他可能的位置清除旧的观察窗口
  mainGroup.selectAll('.focus-window-overlay').remove();
  
  // 时间轴的基本参数（直接从layoutData获取准确值）
  const timeAxisStartX = layoutData.timeAxisData.startX;
  const timeAxisEndX = layoutData.timeAxisData.endX;
  const timeAxisWidth = timeAxisEndX - timeAxisStartX;
  const timeAxisY = layoutData.timeAxisData.y;
  
  console.log('� 时间轴参数:', {
    startX: timeAxisStartX,
    endX: timeAxisEndX,
    width: timeAxisWidth,
    y: timeAxisY
  });
  
  // 观察窗口的基本参数
  const focusWindowHeight = 16;
  const focusWindowY = timeAxisY - 6; // 稍微向上偏移，覆盖时间轴
  
  // 遮罩覆盖的区域（完全覆盖时间轴标签和线条）
  const maskAreaY = timeAxisY - 12; // 向上扩展覆盖标签
  const maskAreaHeight = 30; // 足够覆盖标签和线条
  
  // 🎯 重新设计：基于布局状态计算观察窗口
  console.log('🎯 === 重新设计观察窗口计算 ===');
  
  // 1. 确定屏幕布局参数（观察窗口 = 70%正常显示区域）
  const screenWidth = timeAxisWidth;
  const detailScreenRatio = 0.7; // 70%用于正常显示
  const detailScreenWidth = screenWidth * detailScreenRatio;
  const compressedScreenWidth = screenWidth * (1 - detailScreenRatio);
  
  // 2. 计算详细显示区域的屏幕位置（居中显示）
  const detailAreaStartX = timeAxisStartX + compressedScreenWidth / 2;
  const detailAreaEndX = detailAreaStartX + detailScreenWidth;
  
  // 3. 观察窗口 = 详细显示区域
  let windowStartX = detailAreaStartX;
  let windowEndX = detailAreaEndX;
  let windowWidth = windowEndX - windowStartX;
  
  console.log('📏 重新设计的观察窗口:', {
    屏幕总宽度: screenWidth,
    详细显示比例: detailScreenRatio,
    详细显示宽度: detailScreenWidth,
    压缩显示宽度: compressedScreenWidth,
    观察窗口起点: windowStartX,
    观察窗口终点: windowEndX,
    观察窗口宽度: windowWidth
  });
  
  // 基于时间标签重新计算观察窗口位置，避免机械居左
  const timeSlots = layoutData.timeSlots;
  
  console.log('时间标签分析:', {
    timeSlotCount: timeSlots.length,
    firstSlot: timeSlots.length > 0 ? new Date(timeSlots[0].timestamp) : null,
    lastSlot: timeSlots.length > 0 ? new Date(timeSlots[timeSlots.length - 1].timestamp) : null
  });
  
  // 🔧 定义焦点时间变量（在整个函数中使用）
  const focusStartTime = focusConfig.center - focusConfig.width / 2;
  const focusEndTime = focusConfig.center + focusConfig.width / 2;
  const totalTimeRange = focusConfig.maxTime - focusConfig.minTime;
  
  // 🔧 添加回退机制：如果没有时间标签，使用简单的时间比例映射
  if (!timeSlots || timeSlots.length === 0) {
    console.warn('⚠️ 没有时间标签，使用简单时间比例映射');
    
    // 简单的时间比例映射（回退机制）
    const focusStartRatio = Math.max(0, Math.min(1, (focusConfig.maxTime - focusEndTime) / totalTimeRange));
    const focusEndRatio = Math.max(0, Math.min(1, (focusConfig.maxTime - focusStartTime) / totalTimeRange));
    
    const focusWindowStartX = timeAxisStartX + focusStartRatio * timeAxisWidth;
    const focusWindowEndX = timeAxisStartX + focusEndRatio * timeAxisWidth;
    const focusWindowWidth = focusWindowEndX - focusWindowStartX;
    
    console.log('📍 简单映射结果:', {
      focusStartRatio: focusStartRatio,
      focusEndRatio: focusEndRatio,
      startX: focusWindowStartX,
      endX: focusWindowEndX,
      width: focusWindowWidth
    });
    
    // 直接跳转到渲染部分
    if (focusWindowWidth > 0) {
      console.log('✅ 使用简单映射渲染观察窗口');
      
      // 🔧 重要：在专门的覆盖层组中创建观察窗口
      const focusWindowGroup = focusOverlayGroup.append('g')
        .attr('class', 'focus-window-overlay');
      
      // 直接渲染简单的观察窗口
      createFocusWindow(focusWindowGroup, focusWindowStartX, focusWindowWidth, focusWindowY, focusWindowHeight, maskAreaY, maskAreaHeight, timeAxisStartX, timeAxisWidth);
      return;
    } else {
      console.error('❌ 简单映射也无法创建有效观察窗口');
      return;
    }
  }
  
  // 找到观察焦点对应的时间标签索引
  let startSlotIndex = -1;
  let endSlotIndex = -1;
  
  console.log('🔍 开始查找时间标签索引:', {
    focusStartTime: new Date(focusStartTime),
    focusEndTime: new Date(focusEndTime),
    timeSlotCount: timeSlots.length
  });
  
  // 找到包含焦点起始时间的时间槽
  for (let i = 0; i < timeSlots.length; i++) {
    const slotTime = timeSlots[i].timestamp;
    if (slotTime <= focusStartTime) {
      startSlotIndex = i;
    }
    if (slotTime <= focusEndTime && endSlotIndex === -1) {
      endSlotIndex = i + 1; // 关键：终止位置是下一个时间标签，以囊括该时间区段
    }
  }
  
  console.log('🎯 初始索引查找结果:', {
    startSlotIndex: startSlotIndex,
    endSlotIndex: endSlotIndex
  });
  
  // 🔧 重要修复：处理找不到匹配时间标签的情况
  if (startSlotIndex === -1) {
    // 如果找不到起始时间标签，使用第一个时间标签
    startSlotIndex = 0;
    console.log('⚠️ 未找到起始时间标签，使用第一个标签');
  }
  
  if (endSlotIndex === -1) {
    // 如果找不到结束时间标签，使用最后一个标签
    endSlotIndex = timeSlots.length;
    console.log('⚠️ 未找到结束时间标签，使用最后一个标签');
  }
  
  // 边界处理：确保索引在有效范围内
  startSlotIndex = Math.max(0, Math.min(startSlotIndex, timeSlots.length - 1));
  endSlotIndex = Math.max(startSlotIndex + 1, Math.min(endSlotIndex, timeSlots.length));
  
  // 🔧 修复：确保观察窗口有最小宽度
  if (endSlotIndex <= startSlotIndex) {
    endSlotIndex = Math.min(startSlotIndex + 2, timeSlots.length);
    console.log('🔧 修正结束索引以确保最小宽度:', endSlotIndex);
  }
  
  console.log('✅ 最终索引:', {
    startSlotIndex: startSlotIndex,
    endSlotIndex: endSlotIndex,
    indexRange: endSlotIndex - startSlotIndex
  });
  
  // 基于时间标签位置计算像素位置（避免机械居左）
  // 🔧 修复：处理只有1个时间标签的情况
  const effectiveSlotCount = Math.max(timeSlots.length - 1, 1);
  const startSlotRatio = timeSlots.length > 0 ? startSlotIndex / effectiveSlotCount : 0;
  const endSlotRatio = timeSlots.length > 0 ? Math.min(endSlotIndex / effectiveSlotCount, 1) : 1;
  
  console.log('📊 比例计算:', {
    effectiveSlotCount: effectiveSlotCount,
    startSlotRatio: startSlotRatio,
    endSlotRatio: endSlotRatio
  });
  
  // 重要：Navigraph时间轴是反向的（最新时间在左边，最旧时间在右边）
  // 所以需要反向映射索引到位置
  const focusStartRatio = 1 - endSlotRatio;   // 反向：end对应start
  const focusEndRatio = 1 - startSlotRatio;   // 反向：start对应end
  
  const focusWindowStartX = timeAxisStartX + focusStartRatio * timeAxisWidth;
  const focusWindowEndX = timeAxisStartX + focusEndRatio * timeAxisWidth;
  const focusWindowWidth = focusWindowEndX - focusWindowStartX;
  
  console.log('🎯 观察窗口位置计算:', {
    timeAxisStartX: timeAxisStartX,
    timeAxisWidth: timeAxisWidth,
    focusStartRatio: focusStartRatio,
    focusEndRatio: focusEndRatio,
    focusWindowStartX: focusWindowStartX,
    focusWindowEndX: focusWindowEndX,
    focusWindowWidth: focusWindowWidth
  });
  
  // 🔧 重要：检查观察窗口尺寸有效性
  if (windowWidth <= 0) {
    console.error('❌ 观察窗口宽度无效:', windowWidth);
    console.error('� 调试信息:', {
      focusConfig,
      timeSlots: timeSlots.map(slot => ({
        timestamp: new Date(slot.timestamp),
        x: slot.x
      })),
      计算的索引: { startSlotIndex, endSlotIndex },
      计算的比例: { focusStartRatio, focusEndRatio }
    });
    
    // 🔧 即使计算失败，也要渲染一个基本的观察窗口
    console.log('🔧 使用回退方案：渲染默认观察窗口');
    const fallbackWidth = Math.min(100, timeAxisWidth * 0.2);
    const fallbackStartX = timeAxisStartX + (timeAxisWidth - fallbackWidth) * 0.1; // 靠左10%位置
    
    // 🔧 重要：在专门的覆盖层组中创建观察窗口
    const focusWindowGroup = focusOverlayGroup.append('g')
      .attr('class', 'focus-window-overlay');
    
    // 使用回退参数创建观察窗口
    createFocusWindow(focusWindowGroup, fallbackStartX, fallbackWidth, focusWindowY, focusWindowHeight, maskAreaY, maskAreaHeight, timeAxisStartX, timeAxisWidth);
    return;
  }
  
  console.log('基于时间标签的观察窗口定位:', {
    startSlotIndex: startSlotIndex,
    endSlotIndex: endSlotIndex,
    startSlotTime: timeSlots[startSlotIndex] ? new Date(timeSlots[startSlotIndex].timestamp) : null,
    endSlotTime: timeSlots[endSlotIndex] ? new Date(timeSlots[endSlotIndex].timestamp) : null,
    startSlotRatio: startSlotRatio,
    endSlotRatio: endSlotRatio,
    focusStartRatio: focusStartRatio,
    focusEndRatio: focusEndRatio,
    startX: focusWindowStartX,
    endX: focusWindowEndX,
    width: focusWindowWidth
  });
  
  console.log('� 观察窗口像素位置:', {
    startX: focusWindowStartX,
    endX: focusWindowEndX,
    width: focusWindowWidth,
    startRatio: focusStartRatio,
    endRatio: focusEndRatio
  });
  
  // 🔧 重要：在专门的覆盖层组中创建观察窗口
  const focusWindowGroup = focusOverlayGroup.append('g')
    .attr('class', 'focus-window-overlay');
  
  // 创建遮罩定义
  const defs = focusWindowGroup.append('defs');
  const mask = defs.append('mask')
    .attr('id', 'focus-area-mask');
  
  // 白色背景 - 完全覆盖时间轴区域
  mask.append('rect')
    .attr('x', timeAxisStartX)
    .attr('y', maskAreaY)
    .attr('width', timeAxisWidth)
    .attr('height', maskAreaHeight)
    .attr('fill', 'white');
  
  // 黑色观察窗口 - 在这个区域内透明
  const capsuleRadius = focusWindowHeight / 2;
  mask.append('rect')
    .attr('x', focusWindowStartX)
    .attr('y', focusWindowY)
    .attr('width', focusWindowWidth)
    .attr('height', focusWindowHeight)
    .attr('rx', capsuleRadius)
    .attr('ry', capsuleRadius)
    .attr('fill', 'black');
  
  // 创建半透明遮蔽层
  focusWindowGroup.append('rect')
    .attr('class', 'focus-mask-overlay')
    .attr('x', timeAxisStartX)
    .attr('y', maskAreaY)
    .attr('width', timeAxisWidth)
    .attr('height', maskAreaHeight)
    .attr('mask', 'url(#focus-area-mask)')
    .style('fill', 'rgba(0, 0, 0, 0.4)')
    .style('pointer-events', 'none');
  
  // 创建观察窗口边框
  const focusWindow = focusWindowGroup.append('rect')
    .attr('class', 'focus-window-border')
    .attr('x', focusWindowStartX)
    .attr('y', focusWindowY)
    .attr('width', focusWindowWidth)
    .attr('height', focusWindowHeight)
    .attr('rx', capsuleRadius)
    .attr('ry', capsuleRadius)
    .style('fill', 'none')
    .style('stroke', '#4285f4')
    .style('stroke-width', 2)
    .style('cursor', 'grab');
  
  // 添加拖拽功能
  addFocusWindowDragBehavior(focusWindow, focusConfig, layoutData, {
    timeAxisStartX,
    timeAxisWidth,
    totalTimeRange,
    focusWindowY,
    focusWindowHeight,
    capsuleRadius
  });
  
  console.log('✅ 观察窗口渲染完成');
}

/**
 * 添加观察窗口拖拽行为
 */
function addFocusWindowDragBehavior(focusWindow: any, focusConfig: any, layoutData: WaterfallLayoutData, params: any) {
  let isDragging = false;
  let dragStartX = 0;
  let initialCenterTime = 0;
  
  focusWindow
    .on('mousedown', function(this: any, event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      isDragging = true;
      dragStartX = event.clientX;
      initialCenterTime = focusConfig.center;
      
      d3.select(this)
        .style('cursor', 'grabbing')
        .style('stroke-width', 3);
      
      console.log('� 开始拖拽，初始中心:', new Date(initialCenterTime));
    });
  
  d3.select(window)
    .on('mousemove.focus-drag', function(event: MouseEvent) {
      if (!isDragging) return;
      
      const deltaX = event.clientX - dragStartX;
      const deltaTimeRatio = deltaX / params.timeAxisWidth;
      const deltaTime = deltaTimeRatio * params.totalTimeRange;
      // 反向时间轴：向右拖拽应该是向过去移动（增加时间）
      const newCenterTime = initialCenterTime - deltaTime;
      
      // 限制在有效范围内
      const halfWidth = focusConfig.width / 2;
      const constrainedCenter = Math.max(
        focusConfig.minTime + halfWidth,
        Math.min(focusConfig.maxTime - halfWidth, newCenterTime)
      );
      
      if (constrainedCenter !== focusConfig.center) {
        focusConfig.center = constrainedCenter;
        
        // 重新计算位置（考虑反向时间轴）
        const focusStartTime = constrainedCenter - halfWidth;
        const focusEndTime = constrainedCenter + halfWidth;
        // 反向映射：最新时间在左边
        const focusStartRatio = (focusConfig.maxTime - focusEndTime) / params.totalTimeRange;
        const newStartX = params.timeAxisStartX + focusStartRatio * params.timeAxisWidth;
        
        // 更新观察窗口位置
        focusWindow.attr('x', newStartX);
        
        // 更新遮罩
        d3.select('#focus-area-mask rect:last-child').attr('x', newStartX);
        
        console.log('拖拽更新 (反向时间轴):', {
          newCenter: new Date(constrainedCenter),
          newStartX: newStartX,
          focusStartRatio: focusStartRatio
        });
        
        // 触发更新回调
        if (focusConfig.onUpdate) {
          focusConfig.onUpdate(constrainedCenter);
        }
      }
    })
    .on('mouseup.focus-drag', function() {
      if (isDragging) {
        isDragging = false;
        focusWindow
          .style('cursor', 'grab')
          .style('stroke-width', 2);
        
        console.log('✋ 拖拽结束');
      }
    });
}

function checkIfFullScaleNeeded(layoutData: WaterfallLayoutData, width: number): boolean {
  // 检查节点的总宽度是否能在可用空间内完整显示
  const availableWidth = width - 200; // 总可用宽度（减去边距）
  
  // 计算所有时间槽的总宽度需求
  let totalRequiredWidth = 0;
  let totalNodes = 0;
  
  layoutData.timeSlots.forEach(slot => {
    const nodesInSlot = slot.urls.length;
    totalNodes += nodesInSlot;
    
    // 每个节点的最小宽度需求：30px（节点宽度）+ 5px（间距）
    const minSlotWidth = Math.max(60, nodesInSlot * 35); // 增加单个节点的空间需求
    totalRequiredWidth += minSlotWidth;
  });
  
  // 如果总需求宽度小于可用宽度的90%，使用全比例模式
  // 这样可以确保有足够空间显示所有节点
  const shouldUseFullScale = totalRequiredWidth <= availableWidth * 0.9;
  
  console.log('Full scale check (updated):', {
    totalRequiredWidth,
    availableWidth,
    utilizationRatio: totalRequiredWidth / availableWidth,
    shouldUseFullScale,
    timeSlots: layoutData.timeSlots.length,
    totalNodes: totalNodes,
    avgNodesPerSlot: totalNodes / Math.max(1, layoutData.timeSlots.length)
  });
  
  return shouldUseFullScale;
}

/**
 * 瀑布布局渲染函数
 */
function renderWaterfallLayout(
  container: HTMLElement,
  svg: any,
  nodes: NavNode[],
  edges: NavLink[],
  width: number,
  height: number,
  visualizer: Visualizer,
  renderer?: WaterfallRenderer
): void {
  logger.log(_('waterfall_layout_start', '开始渲染瀑布布局'));
  
  try {
    // 清除现有内容
    svg.selectAll("*").remove();
    
    // 创建主组
    const mainGroup = svg.append('g').attr('class', 'waterfall-main-group');
    
    // Phase 2.2: 支持动态观察区域的瀑布布局
    renderDynamicWaterfallLayout(container, mainGroup, nodes, edges, width, height, visualizer);
    
    logger.log(_('waterfall_layout_complete', '瀑布布局渲染完成'));
  } catch (error) {
    logger.error(_('waterfall_layout_error', '瀑布布局渲染失败: {0}'), error);
    throw new _Error('waterfall_layout_render_failed', '瀑布布局渲染失败', error);
  }
}

// Phase 2.2: 全局观察区域控制器
let globalFocusController: WaterfallFocusController | null = null;

/**
 * Phase 2.2: 支持动态观察区域的瀑布布局渲染
 */
function renderDynamicWaterfallLayout(
  container: HTMLElement,
  mainGroup: any,
  nodes: NavNode[],
  edges: NavLink[],
  width: number,
  height: number,
  visualizer: Visualizer
): void {
  // 初始布局计算
  let layoutData = calculateWaterfallLayout(nodes, edges, width, height);
  
  // 创建观察区域控制器配置
  // 添加保护性检查
  if (!nodes || nodes.length === 0) {
    console.warn('❌ No nodes available for waterfall layout');
    return;
  }
  
  const timestamps = nodes.map(n => n.timestamp).filter(t => isFinite(t));
  if (timestamps.length === 0) {
    console.warn('❌ No valid timestamps found in nodes');
    return;
  }
  
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const timeRange = maxTime - minTime;
  
  console.log('⏰ 时间范围分析:', {
    nodeCount: nodes.length,
    validTimestampCount: timestamps.length,
    minTime: new Date(minTime),
    maxTime: new Date(maxTime),
    timeRange: timeRange / (1000 * 60) // 分钟
  });
  
  // 🔧 修复：直接使用布局数据中的时间轴信息，确保一致性
  const timeAxisData = layoutData.timeAxisData;
  const timeSlots = layoutData.timeSlots;
  
  // 从布局数据获取真实的时间范围（对齐后的）
  let alignedMinTime, alignedMaxTime;
  if (timeSlots.length > 0) {
    // 时间槽是按倒序排列的（最新在前）
    alignedMaxTime = timeSlots[0].timestamp;
    alignedMinTime = timeSlots[timeSlots.length - 1].timestamp - (5 * 60 * 1000); // 减去一个槽间隔
  } else {
    // 回退到节点时间范围
    const effectiveTimeRange = timeRange > 0 ? timeRange : 3600000; // 1小时默认
    alignedMinTime = timeRange > 0 ? minTime : Date.now() - 1800000; // 30分钟前
    alignedMaxTime = timeRange > 0 ? maxTime : Date.now() + 1800000; // 30分钟后
  }
  
  const alignedTimeRange = alignedMaxTime - alignedMinTime;

  const focusConfig: FocusAreaConfig = {
    center: alignedMaxTime - (alignedTimeRange * 0.1), // 使用对齐后的时间
    width: alignedTimeRange * 0.6,                     // 使用对齐后的时间范围
    minTime: alignedMinTime,                           // 使用对齐后的最小时间
    maxTime: alignedMaxTime,                           // 使用对齐后的最大时间
    containerWidth: Math.max(width - 200, 400), // 最小宽度400px
    onUpdate: (newCenter: number) => {
      console.log('🔄 观察中心更新:', new Date(newCenter));
      // 重新计算布局
      layoutData = recalculateLayout(nodes, edges, width, height, newCenter, focusConfig.width);
      // 重新渲染节点
      updateNodeRendering(mainGroup, layoutData, visualizer);
    }
  };  console.log('🎯 观察区域配置生成:', {
    center: new Date(focusConfig.center),
    width: focusConfig.width / (1000 * 60), // 分钟
    minTime: new Date(focusConfig.minTime),
    maxTime: new Date(focusConfig.maxTime),
    containerWidth: focusConfig.containerWidth
  });
  
  // 🔧 创建合理的SVG分组结构，避免元素混乱
  console.log('🏗️ 创建SVG分组结构');
  const timeAxisGroup = mainGroup.append('g')
    .attr('class', 'waterfall-time-axis-group')
    .attr('data-layer', 'time-axis');
    
  const connectionGroup = mainGroup.append('g')
    .attr('class', 'waterfall-connections-group')
    .attr('data-layer', 'connections');
    
  const nodeGroup = mainGroup.append('g')
    .attr('class', 'waterfall-nodes-group')
    .attr('data-layer', 'nodes');
    
  const focusOverlayGroup = mainGroup.append('g')
    .attr('class', 'waterfall-focus-overlay-group')
    .attr('data-layer', 'focus-overlay');
  
  // 初始渲染 - 使用分组结构
  console.log('🎨 开始分层渲染');
  renderTimeAxis(timeAxisGroup, layoutData, width, height);
  renderUrlConnections(connectionGroup, layoutData);
  renderUrlNodes(nodeGroup, layoutData, visualizer);
  
  // Phase 2.2: 在时间轴组上添加观察区域指示器（正确的组）
  console.log('🎯 渲染观察区域指示器');
  renderFocusAreaOnTimeAxis(mainGroup, focusConfig, layoutData, width, height);
  
  logger.log(_('waterfall_dynamic_layout_complete', '动态瀑布布局渲染完成'));
}

/**
 * Phase 2.2: 重新计算布局（使用新的观察中心）
 */
function recalculateLayout(
  nodes: NavNode[],
  edges: NavLink[],
  width: number,
  height: number,
  newFocusCenter: number,
  focusWidth: number
): WaterfallLayoutData {
  // 复制原有的布局计算逻辑，但使用新的观察中心
  const sortedNodes = [...nodes].sort((a, b) => b.timestamp - a.timestamp);
  
  if (sortedNodes.length === 0) {
    return {
      timeSlots: [],
      urlNodes: [],
      timeAxisData: {
        startX: 100,
        endX: width - 100,
        y: height - 100,
        timeSlots: []
      }
    };
  }
  
  // 重新计算观察区域和渲染级别
  const config = {
    leftMargin: 100,
    rightMargin: 100,
    topMargin: 80,
    bottomMargin: 120,
    timeSlotWidth: 160,
    nodeHeight: 40,
    nodeSpacing: 15,
    maxNodesPerColumn: 6
  };
  
  // 计算时间范围
  const maxTime = Math.max(...sortedNodes.map(n => n.timestamp));
  const minTime = Math.min(...sortedNodes.map(n => n.timestamp));
  const fiveMinutes = 5 * 60 * 1000;
  const alignedMaxTime = Math.ceil(maxTime / fiveMinutes) * fiveMinutes;
  const alignedMinTime = Math.floor(minTime / fiveMinutes) * fiveMinutes;
  const timeRange = alignedMaxTime - alignedMinTime;
  const availableWidth = width - config.leftMargin - config.rightMargin;
  const maxSlots = Math.floor(availableWidth / config.timeSlotWidth);
  const timeBasedSlots = Math.ceil(timeRange / fiveMinutes);
  const numSlots = Math.min(maxSlots, Math.max(timeBasedSlots, 4));
  const slotInterval = fiveMinutes;
  
  // 使用新的观察中心
  const focusCenter = newFocusCenter;
  
  const timeSlots: TimeSlotData[] = [];
  const urlNodes: UrlNodeData[] = [];
  
  // 创建时间槽
  for (let i = 0; i < numSlots; i++) {
    const slotTime = alignedMaxTime - (i * slotInterval);
    const x = config.leftMargin + (i * config.timeSlotWidth);
    if (x > width - config.rightMargin) break;
    
    timeSlots.push({
      timestamp: slotTime,
      x: x,
      urls: []
    });
  }
  
  // 重新分配节点并计算渲染级别
  let globalNodeIndex = 0;
  timeSlots.forEach(timeSlot => {
    const slotNodes = sortedNodes.filter(node => 
      node.timestamp <= timeSlot.timestamp && 
      node.timestamp > timeSlot.timestamp - slotInterval
    );
    
    slotNodes.forEach((node, nodeIndex) => {
      if (globalNodeIndex >= config.maxNodesPerColumn * timeSlots.length) return;
      
      const y = config.topMargin + (nodeIndex * (config.nodeHeight + config.nodeSpacing));
      if (y > height - config.bottomMargin) return;
      
      const domain = node.url ? new URL(node.url).hostname : 'unknown';
      const tabId = node.tabId || 0;
      const isFirstInTab = !urlNodes.some(existing => 
        existing.tabId === tabId && existing.timestamp < node.timestamp
      );
      const title = node.title || node.url || _('unnamed_node', '未命名节点');
      
      // Phase 2.2: 使用新的观察中心计算渲染级别
      const distanceFromFocus = Math.abs(node.timestamp - newFocusCenter);
      const normalizedDistance = Math.min(distanceFromFocus / (focusWidth / 2), 1);
      
      // 检查是否应该使用全比例模式（所有节点显示为完整）
      const shouldUseFullScale = checkIfFullScaleNeeded({ 
        timeSlots: timeSlots.map(slot => ({ timestamp: slot.timestamp, x: slot.x, urls: [] })),
        urlNodes: [],
        timeAxisData: { startX: 100, endX: width - 100, y: height - 100, timeSlots: [] }
      }, width);
      
      let renderLevel: 'full' | 'short' | 'icon' | 'bar' = 'full';
      if (!shouldUseFullScale) {
        // 只有在非全比例模式下才使用距离渲染级别
        if (normalizedDistance > 0.7) {
          renderLevel = 'bar';
        } else if (normalizedDistance > 0.5) {
          renderLevel = 'icon';
        } else if (normalizedDistance > 0.3) {
          renderLevel = 'short';
        }
      }
      
      const urlData: UrlNodeData = {
        id: node.id,
        url: node.url || '',
        title: title,
        x: timeSlot.x,
        y: y,
        tabId: tabId,
        timestamp: node.timestamp,
        isFirstInTab: isFirstInTab,
        domain: domain,
        node: node,
        renderLevel: renderLevel,
        distanceFromFocus: normalizedDistance
      };
      
      timeSlot.urls.push(urlData);
      urlNodes.push(urlData);
      globalNodeIndex++;
    });
  });
  
  // 时间轴数据
  const timeAxisData: TimeAxisData = {
    startX: 0,
    endX: width,
    y: height - 40,
    timeSlots: timeSlots.map(slot => ({
      x: slot.x,
      timestamp: slot.timestamp,
      label: new Date(slot.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }))
  };
  
  return {
    timeSlots: timeSlots,
    urlNodes: urlNodes,
    timeAxisData: timeAxisData
  };
}

/**
 * Phase 2.2: 更新节点渲染（不重新创建时间轴）
 */
function updateNodeRendering(
  mainGroup: any,
  layoutData: WaterfallLayoutData,
  visualizer: Visualizer
): void {
  // 移除现有的节点和连接线
  mainGroup.select('.waterfall-url-nodes').remove();
  mainGroup.select('.waterfall-url-connections').remove();
  
  // 重新渲染节点和连接线
  renderUrlNodes(mainGroup, layoutData, visualizer);
  renderUrlConnections(mainGroup, layoutData);
}

// 数据接口定义
interface UrlNodeData {
  id: string;
  url: string;
  title: string;
  x: number;
  y: number;
  tabId: number;
  timestamp: number;
  isFirstInTab: boolean;
  domain: string;
  node: NavNode; // 保存原始节点数据
  renderLevel?: 'full' | 'short' | 'icon' | 'bar'; // 节点渲染级别
  distanceFromFocus?: number; // 距离观察中心的距离比例 0-1
}

interface TimeSlotData {
  timestamp: number;
  x: number;
  urls: UrlNodeData[];
}

interface TimeAxisData {
  startX: number;
  endX: number;
  y: number;
  timeSlots: {
    x: number;
    timestamp: number;
    label: string;
  }[];
}

// Phase 2.2: 观察区域控制器配置接口
interface FocusAreaConfig {
  center: number;        // 观察中心时间戳
  width: number;         // 观察区域宽度（毫秒）
  minTime: number;       // 最小时间
  maxTime: number;       // 最大时间
  containerWidth: number; // 容器宽度
  onUpdate: (newCenter: number) => void; // 更新回调
}

// Phase 2.2: 观察区域控制器接口
interface FocusAreaController {
  container: HTMLElement; // 容器元素
  center: number;        // 观察中心时间戳
  width: number;         // 观察区域宽度（毫秒）
  minTime: number;       // 最小时间
  maxTime: number;       // 最大时间
  containerWidth: number; // 容器宽度
  onUpdate: (newCenter: number) => void; // 更新回调
}

interface WaterfallLayoutData {
  timeSlots: TimeSlotData[];
  urlNodes: UrlNodeData[];
  timeAxisData: TimeAxisData;
}

/**
 * 计算瀑布布局
 */
function calculateWaterfallLayout(nodes: NavNode[], edges: NavLink[], width: number, height: number): WaterfallLayoutData {
  logger.log(_('waterfall_layout_calculation_start', '开始计算瀑布布局: {0} 个节点'), nodes.length);
  
  // 过滤有效的导航节点（排除根节点）
  const sortedNodes = nodes
    .filter(node => node.id !== 'session-root' && node.url && node.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序排列（最新的在左边）
  
  if (sortedNodes.length === 0) {
    return {
      timeSlots: [],
      urlNodes: [],
      timeAxisData: {
        startX: 100,
        endX: width - 100,
        y: height - 100,
        timeSlots: []
      }
    };
  }
  
  // 配置参数 - 增加时间槽和节点宽度
  const config = {
    leftMargin: 100,
    rightMargin: 100,
    topMargin: 80,
    bottomMargin: 120,
    timeSlotWidth: 160,  // 增加时间槽宽度从120到160
    nodeHeight: 40,      // 保持节点高度40
    nodeSpacing: 15,     // 保持节点间距15
    maxNodesPerColumn: 6 // 保持每列最大节点数6
  };
  
  // 计算时间范围
  const maxTime = Math.max(...sortedNodes.map(n => n.timestamp));
  const minTime = Math.min(...sortedNodes.map(n => n.timestamp));
  
  // 计算时间槽 - 使用5分钟间隔，对齐到5分钟边界
  const fiveMinutes = 5 * 60 * 1000; // 5分钟的毫秒数
  
  // 将最大时间向上取整到下一个5分钟边界
  const alignedMaxTime = Math.ceil(maxTime / fiveMinutes) * fiveMinutes;
  // 将最小时间向下取整到前一个5分钟边界  
  const alignedMinTime = Math.floor(minTime / fiveMinutes) * fiveMinutes;
  
  const timeRange = alignedMaxTime - alignedMinTime;
  const availableWidth = width - config.leftMargin - config.rightMargin;
  const maxSlots = Math.floor(availableWidth / config.timeSlotWidth);
  
  // 根据对齐的时间范围计算槽数
  const timeBasedSlots = Math.ceil(timeRange / fiveMinutes);
  const numSlots = Math.min(maxSlots, Math.max(timeBasedSlots, 4)); // 至少4个槽，最多受宽度限制
  const slotInterval = fiveMinutes; // 固定5分钟间隔
  
  // Phase 2.1: 定义观察区域配置 - 修正观察中心位置
  const focusCenter = alignedMaxTime - (timeRange * 0.1); // 观察中心在距离最新时间10%的位置，更靠近最新时间
  const focusWidth = timeRange * 0.6; // 观察区域覆盖60%的时间范围，确保最新节点在观察区域内
  
  const timeSlots: TimeSlotData[] = [];
  const urlNodes: UrlNodeData[] = [];
  
  // 创建时间槽 - 从对齐的最新时间开始
  for (let i = 0; i < numSlots; i++) {
    const slotTime = alignedMaxTime - (i * slotInterval);
    const x = config.leftMargin + (i * config.timeSlotWidth);
    
    if (x > width - config.rightMargin) break;
    
    timeSlots.push({
      timestamp: slotTime,
      x: x,
      urls: []
    });
  }
  
  // 为每个时间槽分配URL节点
  let globalNodeIndex = 0;
  
  timeSlots.forEach(timeSlot => {
    // 找到属于该时间槽的节点
    const slotNodes = sortedNodes.filter(node => 
      node.timestamp <= timeSlot.timestamp && 
      node.timestamp > timeSlot.timestamp - slotInterval
    );
    
    slotNodes.forEach((node, nodeIndex) => {
      if (globalNodeIndex >= config.maxNodesPerColumn * timeSlots.length) return;
      
      const y = config.topMargin + (nodeIndex * (config.nodeHeight + config.nodeSpacing));
      if (y > height - config.bottomMargin) return;
      
      // 获取域名
      const domain = node.url ? new URL(node.url).hostname : 'unknown';
      
      // 检查是否是该标签页的第一个节点
      const tabId = node.tabId || 0;
      const isFirstInTab = !urlNodes.some(existing => 
        existing.tabId === tabId && existing.timestamp < node.timestamp
      );
      
      // 使用与其他视图相同的标题处理逻辑
      const title = node.title || node.url || _('unnamed_node', '未命名节点');
      
      // Phase 2.1: 计算节点渲染级别
      const distanceFromFocus = Math.abs(node.timestamp - focusCenter);
      const normalizedDistance = Math.min(distanceFromFocus / (focusWidth / 2), 1);
      
      // 检查是否应该使用全比例模式（所有节点显示为完整）
      const shouldUseFullScale = checkIfFullScaleNeeded({ 
        timeSlots: timeSlots.map(slot => ({ timestamp: slot.timestamp, x: slot.x, urls: [] })),
        urlNodes: [],
        timeAxisData: { startX: 100, endX: width - 100, y: height - 100, timeSlots: [] }
      }, width);
      
      // 根据距离确定渲染级别 - 调整阈值确保最新节点显示完整
      let renderLevel: 'full' | 'short' | 'icon' | 'bar' = 'full';
      if (!shouldUseFullScale) {
        // 只有在非全比例模式下才使用距离渲染级别
        if (normalizedDistance > 0.7) {
          renderLevel = 'bar';
        } else if (normalizedDistance > 0.5) {
          renderLevel = 'icon';
        } else if (normalizedDistance > 0.3) {
          renderLevel = 'short';
        }
      }
      
      const urlData: UrlNodeData = {
        id: node.id,
        url: node.url || '',
        title: title,
        x: timeSlot.x,
        y: y,
        tabId: tabId,
        timestamp: node.timestamp,
        isFirstInTab: isFirstInTab,
        domain: domain,
        node: node, // 保存原始节点数据
        renderLevel: renderLevel,
        distanceFromFocus: normalizedDistance
      };
      
      timeSlot.urls.push(urlData);
      urlNodes.push(urlData);
      globalNodeIndex++;
    });
  });
  
  // 时间轴数据 - 移到底部并占满宽度
  const timeAxisData: TimeAxisData = {
    startX: 0,  // 从最左边开始
    endX: width, // 到最右边结束
    y: height - 40, // 移到底部，留40px边距
    timeSlots: timeSlots.map(slot => ({
      x: slot.x,
      timestamp: slot.timestamp,
      label: new Date(slot.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }))
  };
  
  logger.log(_('waterfall_layout_calculation_complete', '瀑布布局计算完成，时间槽: {0}，URL节点: {1}'), 
    timeSlots.length, urlNodes.length);
  
  return {
    timeSlots,
    urlNodes,
    timeAxisData
  };
}

/**
 * 渲染时间轴（从右到左）
 */
function renderTimeAxis(mainGroup: any, layoutData: WaterfallLayoutData, width: number, height: number): void {
  const axisGroup = mainGroup.append('g').attr('class', 'waterfall-time-axis');
  
  // 🔧 创建时间轴的子分组结构
  const backgroundGroup = axisGroup.append('g').attr('class', 'time-axis-backgrounds');
  const scaleGroup = axisGroup.append('g').attr('class', 'time-axis-scales');
  const labelGroup = axisGroup.append('g').attr('class', 'time-axis-labels');
  
  console.log('🏗️ 创建时间轴分组结构:', {
    backgroundGroup: !!backgroundGroup,
    scaleGroup: !!scaleGroup,
    labelGroup: !!labelGroup
  });
  
  // 添加时间条带背景 - 条带边界与5分钟时间线对齐
  const stripHeight = height - 100; // 从顶部到时间轴上方的高度
  const slotWidth = 160; // 更新时间槽宽度，与config.timeSlotWidth一致
  
  // 重新计算条带，让条带边界与时间线对齐
  for (let i = 0; i < layoutData.timeAxisData.timeSlots.length; i++) {
    const slot = layoutData.timeAxisData.timeSlots[i];
    
    // 条带的左边界应该是前一个时间点，右边界是当前时间点
    // 对于第一个条带，从当前时间点向左延伸一个槽宽
    // 对于后续条带，从前一个时间点到当前时间点
    let stripX: number;
    let stripWidth: number;
    
    if (i === 0) {
      // 第一个条带：从当前时间点向左延伸
      stripX = slot.x - slotWidth;
      stripWidth = slotWidth;
    } else {
      // 后续条带：从前一个时间点到当前时间点
      const prevSlot = layoutData.timeAxisData.timeSlots[i - 1];
      stripX = prevSlot.x;
      stripWidth = slot.x - prevSlot.x;
    }
    
    // 交替明暗条带 - 边界与时间线对齐 - 使用背景分组
    backgroundGroup.append('rect')
      .attr('x', stripX)
      .attr('y', 60)  // 从导航栏下方开始
      .attr('width', stripWidth)
      .attr('height', stripHeight)
      .attr('fill', i % 2 === 0 ? '#f0f2f5' : '#ffffff')  // 更明显的灰白对比
      .attr('opacity', 0.8)  // 增加不透明度
      .attr('class', `time-strip time-strip-${i}`)
      .attr('data-time', new Date(slot.timestamp).toISOString()); // 添加时间数据便于调试
  }
  
  // 添加最后一个条带（最右边的时间段）- 使用背景分组
  if (layoutData.timeAxisData.timeSlots.length > 0) {
    const lastSlot = layoutData.timeAxisData.timeSlots[layoutData.timeAxisData.timeSlots.length - 1];
    const lastStripIndex = layoutData.timeAxisData.timeSlots.length;
    
    backgroundGroup.append('rect')
      .attr('x', lastSlot.x)
      .attr('y', 60)
      .attr('width', slotWidth)
      .attr('height', stripHeight)
      .attr('fill', lastStripIndex % 2 === 0 ? '#f0f2f5' : '#ffffff')
      .attr('opacity', 0.8)
      .attr('class', `time-strip time-strip-${lastStripIndex}`)
      .attr('data-time', 'future');
  }
  
  // 绘制时间轴背景 - 使用浅色主题匹配 - 使用背景分组
  backgroundGroup.append('rect')
    .attr('class', 'waterfall-time-axis-background')
    .attr('x', 0)
    .attr('y', layoutData.timeAxisData.y - 20)
    .attr('width', width)  // 占满整个宽度
    .attr('height', 50)
    .attr('fill', '#f8f9fa')  // 浅灰色背景，匹配主题
    .attr('stroke', '#dee2e6')  // 添加边框
    .attr('stroke-width', 1);
  
  // 绘制主轴线 - 使用刻度分组
  scaleGroup.append('line')
    .attr('x1', layoutData.timeAxisData.startX + 20)
    .attr('y1', layoutData.timeAxisData.y)
    .attr('x2', layoutData.timeAxisData.endX - 20)
    .attr('y2', layoutData.timeAxisData.y)
    .style('stroke', '#6c757d')  // 深灰色轴线
    .style('stroke-width', 2);
  
  // 添加箭头指向过去（右侧）- 使用刻度分组
  scaleGroup.append('polygon')
    .attr('points', `${layoutData.timeAxisData.endX - 30},${layoutData.timeAxisData.y-6} ${layoutData.timeAxisData.endX - 30},${layoutData.timeAxisData.y+6} ${layoutData.timeAxisData.endX - 18},${layoutData.timeAxisData.y}`)
    .style('fill', '#6c757d');
  
  // 时间标签 - 使用标签分组
  labelGroup.append('text')
    .attr('x', 30)
    .attr('y', layoutData.timeAxisData.y - 25)
    .attr('text-anchor', 'start')
    .style('font-size', '14px')
    .style('font-weight', 'bold')
    .style('fill', '#495057')  // 深灰色文字
    .text(_('waterfall_timeline_now', '现在'));
  
  labelGroup.append('text')
    .attr('x', width - 30)
    .attr('y', layoutData.timeAxisData.y - 25)
    .attr('text-anchor', 'end')
    .style('font-size', '14px')
    .style('font-weight', 'bold')
    .style('fill', '#495057')  // 深灰色文字
    .text(_('waterfall_timeline_past', '过去'));
  
  // 时间刻度
  layoutData.timeAxisData.timeSlots.forEach(slot => {
    // 主刻度线 - 使用刻度分组
    scaleGroup.append('line')
      .attr('x1', slot.x)
      .attr('y1', layoutData.timeAxisData.y - 8)
      .attr('x2', slot.x)
      .attr('y2', layoutData.timeAxisData.y + 8)
      .style('stroke', '#6c757d')
      .style('stroke-width', 2);
    
    // 时间标签 - 使用标签分组
    labelGroup.append('text')
      .attr('x', slot.x)
      .attr('y', layoutData.timeAxisData.y + 25)
      .attr('text-anchor', 'middle')
      .style('font-size', '11px')
      .style('font-weight', 'normal')
      .style('fill', '#6c757d')  // 深灰色文字
      .text(slot.label);
  });
}

/**
 * 渲染URL节点
 */
function renderUrlNodes(mainGroup: any, layoutData: WaterfallLayoutData, visualizer: Visualizer): void {
  const nodeGroup = mainGroup.append('g').attr('class', 'waterfall-url-nodes');
  
  layoutData.urlNodes.forEach(urlNode => {
    const node = nodeGroup.append('g')
      .attr('class', `url-node ${urlNode.isFirstInTab ? 'first-in-tab' : 'continuation'} render-${urlNode.renderLevel || 'full'}`)
      .attr('transform', `translate(${urlNode.x}, ${urlNode.y})`);
    
    // Phase 2.1: 根据渲染级别选择不同的渲染方式
    const renderLevel = urlNode.renderLevel || 'full';
    switch (renderLevel) {
      case 'full':
        renderFullNode(node, urlNode);
        break;
      case 'short':
        renderShortNode(node, urlNode);
        break;
      case 'icon':
        renderIconNode(node, urlNode);
        break;
      case 'bar':
        renderBarNode(node, urlNode);
        break;
      default:
        renderFullNode(node, urlNode);
        break;
    }
    
    // 添加点击事件处理
    node.style('cursor', 'pointer')
      .on('click', () => {
        if (visualizer && visualizer.showNodeDetails) {
          visualizer.showNodeDetails(urlNode.node);
        }
      });
  });
}

/**
 * 渲染URL之间的连接线
 */
function renderUrlConnections(mainGroup: any, layoutData: WaterfallLayoutData): void {
  const connectionGroup = mainGroup.append('g').attr('class', 'waterfall-url-connections');
  
  // 按标签页分组URL，绘制同一标签页内URL之间的连接线
  const urlsByTab = new Map<number, UrlNodeData[]>();
  layoutData.urlNodes.forEach(urlNode => {
    if (!urlsByTab.has(urlNode.tabId)) {
      urlsByTab.set(urlNode.tabId, []);
    }
    urlsByTab.get(urlNode.tabId)!.push(urlNode);
  });
  
  urlsByTab.forEach(urls => {
    // 按时间排序
    const sortedUrls = urls.sort((a, b) => a.timestamp - b.timestamp);
    
    for (let i = 0; i < sortedUrls.length - 1; i++) {
      const fromUrl = sortedUrls[i];
      const toUrl = sortedUrls[i + 1];
      
      // Phase 2.1: 绘制连接线 - 根据节点渲染级别计算连接点位置
      const fromCenter = getNodeCenter(fromUrl);
      const toCenter = getNodeCenter(toUrl);
      
      connectionGroup.append('line')
        .attr('x1', fromUrl.x + fromCenter.x)
        .attr('y1', fromUrl.y + fromCenter.y)
        .attr('x2', toUrl.x + toCenter.x)
        .attr('y2', toUrl.y + toCenter.y)
        .style('stroke', '#36a2eb')
        .style('stroke-width', 2)
        .style('stroke-dasharray', '4,4')
        .style('opacity', 0.8)
        .attr('class', 'url-connection');
    }
  });
}

// Phase 2.1: 辅助函数 - 根据渲染级别计算节点中心位置
function getNodeCenter(urlNode: UrlNodeData): { x: number; y: number } {
  const renderLevel = urlNode.renderLevel || 'full';
  
  switch (renderLevel) {
    case 'full':
      return { x: 80, y: 17.5 }; // 130px宽，15px偏移，中心在80px
    case 'short':
      return { x: 80, y: 15 };   // 100px宽，30px偏移，中心在80px
    case 'icon':
      return { x: 80, y: 17.5 }; // 圆形图标中心在80px
    case 'bar':
      return { x: 80, y: 17.5 }; // 竖条中心在80px
    default:
      return { x: 80, y: 17.5 };
  }
}

// Phase 2.1: 不同级别的节点渲染函数

/**
 * 渲染完整节点（观察区域内）
 */
function renderFullNode(node: any, urlNode: UrlNodeData): void {
  // 完整尺寸的节点背景
  node.append('rect')
    .attr('width', 130)
    .attr('height', 35)
    .attr('rx', 6)
    .attr('x', 15)
    .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#e8f0fe')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#4285f4')
    .style('stroke-width', 1);
  
  // 域名图标/标识
  node.append('circle')
    .attr('cx', 27)
    .attr('cy', 17.5)
    .attr('r', 8)
    .style('fill', urlNode.isFirstInTab ? '#ffffff' : '#4285f4')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
    .style('stroke-width', 1);
  
  // 优先显示 favicon
  if (urlNode.node.favicon) {
    renderFavicon(node, urlNode, 21, 11.5, 12, 12);
  } else {
    renderFallbackIcon(node, urlNode, 27, 21);
  }
  
  // 完整标题文本
  const titleText = urlNode.title.length > 16 ? urlNode.title.substring(0, 16) + '...' : urlNode.title;
  node.append('text')
    .attr('x', 43)
    .attr('y', 21)
    .style('font-size', '12px')
    .style('fill', urlNode.isFirstInTab ? 'white' : '#1a73e8')
    .text(titleText);
  
  // 悬停信息
  node.append('title')
    .text(`${urlNode.title}\n${urlNode.url}\nTab: ${urlNode.tabId}\nTime: ${new Date(urlNode.timestamp).toLocaleString('zh-CN')}`);
}

/**
 * 渲染短标题节点
 */
function renderShortNode(node: any, urlNode: UrlNodeData): void {
  // 较小的节点背景
  node.append('rect')
    .attr('width', 100)
    .attr('height', 30)
    .attr('rx', 5)
    .attr('x', 30)
    .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#e8f0fe')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#4285f4')
    .style('stroke-width', 1);
  
  // 较小的图标
  node.append('circle')
    .attr('cx', 40)
    .attr('cy', 15)
    .attr('r', 6)
    .style('fill', urlNode.isFirstInTab ? '#ffffff' : '#4285f4')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
    .style('stroke-width', 1);
  
  // Favicon 或后备图标
  if (urlNode.node.favicon) {
    renderFavicon(node, urlNode, 36, 11, 8, 8);
  } else {
    renderFallbackIcon(node, urlNode, 40, 18, '8px');
  }
  
  // 短标题
  const shortTitle = urlNode.title.length > 8 ? urlNode.title.substring(0, 8) + '...' : urlNode.title;
  node.append('text')
    .attr('x', 52)
    .attr('y', 18)
    .style('font-size', '10px')
    .style('fill', urlNode.isFirstInTab ? 'white' : '#1a73e8')
    .text(shortTitle);
  
  // 悬停信息
  node.append('title')
    .text(`${urlNode.title}\n${urlNode.url}`);
}

/**
 * 渲染仅图标节点
 */
function renderIconNode(node: any, urlNode: UrlNodeData): void {
  // 圆形图标背景
  node.append('circle')
    .attr('cx', 80)
    .attr('cy', 17.5)
    .attr('r', 12)
    .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#e8f0fe')
    .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#4285f4')
    .style('stroke-width', 1);
  
  // Favicon 或后备图标
  if (urlNode.node.favicon) {
    renderFavicon(node, urlNode, 76, 13.5, 8, 8);
  } else {
    renderFallbackIcon(node, urlNode, 80, 21, '8px');
  }
  
  // 悬停信息
  node.append('title')
    .text(`${urlNode.title}\n${urlNode.url}`);
}

/**
 * 渲染竖条节点
 */
function renderBarNode(node: any, urlNode: UrlNodeData): void {
  // 竖条
  node.append('rect')
    .attr('width', 4)
    .attr('height', 35)
    .attr('x', 78)
    .attr('y', 0)
    .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#dee2e6')
    .style('opacity', 0.8);
  
  // 悬停信息
  node.append('title')
    .text(`${urlNode.title}\n${urlNode.url}`);
}

/**
 * 渲染 Favicon 图标
 */
function renderFavicon(node: any, urlNode: UrlNodeData, x: number, y: number, width: number, height: number): void {
  node.append('image')
    .attr('xlink:href', urlNode.node.favicon)
    .attr('x', x)
    .attr('y', y)
    .attr('width', width)
    .attr('height', height)
    .style('clip-path', `circle(${width/2}px at ${width/2}px ${height/2}px)`)
    .on('error', function(this: SVGImageElement) {
      d3.select(this).remove();
      renderFallbackIcon(node, urlNode, x + width/2, y + height - 2);
    });
}

/**
 * 渲染后备图标文字
 */
function renderFallbackIcon(node: any, urlNode: UrlNodeData, x: number, y: number, fontSize: string = '10px'): void {
  const fallbackText = urlNode.isFirstInTab && urlNode.domain !== 'unknown' 
    ? urlNode.domain.charAt(0).toUpperCase() 
    : (urlNode.tabId === 0 ? 'M' : `${urlNode.tabId}`);
  
  node.append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', 'middle')
    .style('font-size', fontSize)
    .style('font-weight', 'bold')
    .style('fill', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
    .text(fallbackText);
}

// Phase 2.2: 观察区域控制器类
class WaterfallFocusController {
  private config: FocusAreaController;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private initialCenter: number = 0;
  
  constructor(config: FocusAreaController) {
    this.config = config;
  }
  
  /**
   * 在时间轴上渲染观察区域控制器
   */
  renderFocusIndicator(axisGroup: any): void {
    const indicatorGroup = axisGroup.append('g')
      .attr('class', 'focus-area-indicator');
    
    // 计算观察区域在时间轴上的位置
    const focusAreaRect = this.calculateFocusAreaRect();
    
    console.log('Focus area rect:', focusAreaRect); // 调试信息
    
    // 绘制观察区域背景
    indicatorGroup.append('rect')
      .attr('class', 'focus-area-background')
      .attr('x', focusAreaRect.x)
      .attr('y', -15) // 调整为合适的正值
      .attr('width', focusAreaRect.width)
      .attr('height', 30)
      .style('fill', 'rgba(66, 133, 244, 0.1)')
      .style('stroke', '#4285f4')
      .style('stroke-width', 2)
      .style('stroke-dasharray', '5,5');
    
    // 绘制观察中心指示器
    const centerIndicator = indicatorGroup.append('g')
      .attr('class', 'focus-center-indicator')
      .style('cursor', 'grab');
    
    // 中心线
    centerIndicator.append('line')
      .attr('x1', focusAreaRect.centerX)
      .attr('y1', -20)
      .attr('x2', focusAreaRect.centerX)
      .attr('y2', 20)
      .style('stroke', '#1a73e8')
      .style('stroke-width', 3);
    
    // 中心圆点（拖拽手柄）
    centerIndicator.append('circle')
      .attr('class', 'focus-center')
      .attr('cx', focusAreaRect.centerX)
      .attr('cy', 0)
      .attr('r', 8)
      .style('fill', '#4285f4')
      .style('stroke', '#ffffff')
      .style('stroke-width', 2);
    
    // 添加文本标签
    indicatorGroup.append('text')
      .attr('x', focusAreaRect.centerX)
      .attr('y', -25)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', 'bold')
      .attr('fill', '#4285f4')
      .text('观察中心');
  }
  
  /**
   * 计算观察区域在时间轴上的位置
   */
  private calculateFocusAreaRect(): {x: number, width: number, centerX: number} {
    // 添加保护性检查
    const timeRange = this.config.maxTime - this.config.minTime;
    const containerWidth = this.config.containerWidth || 800; // 默认宽度
    
    // 检查时间范围是否有效
    if (!timeRange || timeRange <= 0 || !isFinite(timeRange)) {
      console.warn('Invalid time range:', { timeRange, minTime: this.config.minTime, maxTime: this.config.maxTime });
      return { x: 0, width: containerWidth * 0.6, centerX: containerWidth * 0.5 };
    }
    
    // 检查容器宽度是否有效
    if (!containerWidth || containerWidth <= 0 || !isFinite(containerWidth)) {
      console.warn('Invalid container width:', containerWidth);
      return { x: 0, width: 480, centerX: 400 }; // 使用固定值
    }
    
    const pixelPerMs = containerWidth / timeRange;
    
    // 检查center和width是否有效
    const center = isFinite(this.config.center) ? this.config.center : (this.config.minTime + this.config.maxTime) / 2;
    const width = isFinite(this.config.width) ? this.config.width : timeRange * 0.6;
    
    const centerOffset = (center - this.config.minTime) * pixelPerMs;
    const areaWidth = width * pixelPerMs;
    
    const result = {
      x: centerOffset - areaWidth / 2,
      width: areaWidth,
      centerX: centerOffset
    };
    
    // 最终检查结果是否有效
    if (!isFinite(result.x) || !isFinite(result.width) || !isFinite(result.centerX)) {
      console.warn('Invalid calculation result:', result, {
        timeRange, containerWidth, pixelPerMs, center, width
      });
      return { x: 0, width: containerWidth * 0.6, centerX: containerWidth * 0.5 };
    }
    
    return result;
  }
  
    /**
   * 计算观察区域在时间轴上的位置
   */
  
  /**
   * 更新观察中心位置
   */
  updateFocusCenter(newCenter: number): void {
    this.config.center = newCenter;
    this.config.onUpdate(newCenter);
  }
  
  /**
   * 渲染观察区域控制界面
   */
  render(): void {
    const container = d3.select(this.config.container);
    
    // 清除现有SVG避免重复
    container.select('svg').remove();
    
    // 创建SVG时间轴
    const svg = container.append('svg')
      .attr('width', '100%')
      .attr('height', '60px')
      .style('display', 'block');
    
    // 创建时间轴背景
    const axisGroup = svg.append('g')
      .attr('class', 'timeline-axis')
      .attr('transform', 'translate(0, 30)'); // 移动到SVG中心位置
    
    // 绘制时间刻度
    this.renderTimeScale(axisGroup);
    
    // 绘制观察区域指示器
    this.renderFocusIndicator(axisGroup);
    
    // 添加交互事件
    this.addInteractionEvents(axisGroup);
  }
  
  /**
   * 渲染时间刻度
   */
  private renderTimeScale(axisGroup: any): void {
    const timeRange = this.config.maxTime - this.config.minTime;
    const containerWidth = this.config.containerWidth || 800;
    const tickCount = 10; // 主要刻度数量
    
    // 添加保护性检查
    if (!timeRange || timeRange <= 0 || !isFinite(timeRange)) {
      console.warn('Invalid time range for time scale:', { timeRange, minTime: this.config.minTime, maxTime: this.config.maxTime });
      return;
    }
    
    if (!containerWidth || containerWidth <= 0 || !isFinite(containerWidth)) {
      console.warn('Invalid container width for time scale:', containerWidth);
      return;
    }
    
    // 创建时间刻度
    for (let i = 0; i <= tickCount; i++) {
      const time = this.config.minTime + (timeRange * i / tickCount);
      const x = (i / tickCount) * containerWidth;
      
      // 确保计算结果有效
      if (!isFinite(time) || !isFinite(x)) {
        console.warn('Invalid tick calculation:', { i, time, x });
        continue;
      }
      
      // 绘制刻度线
      axisGroup.append('line')
        .attr('x1', x)
        .attr('y1', 40)
        .attr('x2', x)
        .attr('y2', 50)
        .attr('stroke', '#6c757d')
        .attr('stroke-width', 1);
      
      // 绘制时间标签
      axisGroup.append('text')
        .attr('x', x)
        .attr('y', 35)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#6c757d')
        .text(this.formatTime(time));
    }
  }
  
  /**
   * 格式化时间显示
   */
  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  }
  
  /**
   * 添加交互事件
   */
  private addInteractionEvents(axisGroup: any): void {
    const self = this;
    const centerIndicator = axisGroup.select('.focus-center');
    
    // 拖拽开始
    centerIndicator.on('mousedown', function(event: MouseEvent) {
      event.preventDefault();
      self.isDragging = true;
      centerIndicator.style('cursor', 'grabbing');
    });
    
    // 拖拽过程
    d3.select(window).on('mousemove.focus-drag', function(event: MouseEvent) {
      if (!self.isDragging) return;
      
      const containerRect = self.config.container.getBoundingClientRect();
      const mouseX = event.clientX - containerRect.left;
      const relativeX = Math.max(0, Math.min(self.config.containerWidth, mouseX));
      
      const timeRange = self.config.maxTime - self.config.minTime;
      const newCenter = self.config.minTime + (relativeX / self.config.containerWidth) * timeRange;
      
      // 限制观察中心在有效范围内
      const constrainedCenter = Math.max(
        self.config.minTime + self.config.width / 2,
        Math.min(
          self.config.maxTime - self.config.width / 2,
          newCenter
        )
      );
      
      // 更新观察中心
      self.updateFocusCenter(constrainedCenter);
    });
    
    // 拖拽结束
    d3.select(window).on('mouseup.focus-drag', function() {
      if (self.isDragging) {
        self.isDragging = false;
        centerIndicator.style('cursor', 'grab');
      }
    });
  }
  
  /**
   * 获取当前观察区域配置
   */
  getFocusConfig(): {center: number, width: number} {
    return {
      center: this.config.center,
      width: this.config.width
    };
  }
}

/**
 * 创建观察窗口的辅助函数
 */
function createFocusWindow(
  focusWindowGroup: any,
  startX: number,
  width: number,
  windowY: number,
  windowHeight: number,
  maskAreaY: number,
  maskAreaHeight: number,
  timeAxisStartX: number,
  timeAxisWidth: number
): void {
  console.log('🔧 创建观察窗口:', {
    startX: startX,
    width: width,
    windowY: windowY,
    windowHeight: windowHeight
  });
  
  // 创建遮罩定义
  const defs = focusWindowGroup.append('defs');
  const mask = defs.append('mask')
    .attr('id', 'focus-area-mask');
  
  // 白色背景 - 完全覆盖时间轴区域
  mask.append('rect')
    .attr('x', timeAxisStartX)
    .attr('y', maskAreaY)
    .attr('width', timeAxisWidth)
    .attr('height', maskAreaHeight)
    .attr('fill', 'white');
  
  // 黑色观察窗口 - 在这个区域内透明
  const capsuleRadius = windowHeight / 2;
  mask.append('rect')
    .attr('x', startX)
    .attr('y', windowY)
    .attr('width', width)
    .attr('height', windowHeight)
    .attr('rx', capsuleRadius)
    .attr('ry', capsuleRadius)
    .attr('fill', 'black');
  
  // 创建半透明遮蔽层
  focusWindowGroup.append('rect')
    .attr('class', 'focus-mask-overlay')
    .attr('x', timeAxisStartX)
    .attr('y', maskAreaY)
    .attr('width', timeAxisWidth)
    .attr('height', maskAreaHeight)
    .attr('mask', 'url(#focus-area-mask)')
    .style('fill', 'rgba(0, 0, 0, 0.4)')
    .style('pointer-events', 'none');
  
  // 创建观察窗口边框
  const focusWindow = focusWindowGroup.append('rect')
    .attr('class', 'focus-window-border')
    .attr('x', startX)
    .attr('y', windowY)
    .attr('width', width)
    .attr('height', windowHeight)
    .attr('rx', capsuleRadius)
    .attr('ry', capsuleRadius)
    .style('fill', 'none')
    .style('stroke', '#4285f4')
    .style('stroke-width', 2)
    .style('cursor', 'grab');
  
  console.log('✅ 观察窗口创建完成');
}