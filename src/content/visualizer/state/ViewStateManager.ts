/**
 * 视图状态管理器 - 处理视图类型和缩放状态
 */
import { Logger } from '../../../lib/utils/logger.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';
import type { Visualizer } from '../../types/navigation.js';

const d3 = window.d3;
const logger = new Logger('ViewStateManager');

export class ViewStateManager {
  // 依赖对象
  private visualizer: Visualizer;
  
  // 视图类型
  private _currentView: string = 'tree';
  
  // D3相关
  private _svg: any = null;
  private _zoom: any = null;
  private _currentTransform?: { x: number; y: number; k: number };
  private _isRestoringTransform: boolean = false;
  
  // 各视图的缩放状态
  private _treeZoom: any = null;      // 树形视图的缩放状态
  private _timelineZoom: any = null;  // 时间线视图的缩放状态
  
  private onZoomChangeCallback?: () => void;

  /**
   * 构造函数
   */
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
    logger.log('view_state_manager_init');
  }
  
  /**
   * 获取/设置当前视图
   */
  get currentView(): string {
    return this._currentView;
  }
  
  set currentView(view: string) {
    this._currentView = view;
    logger.log('view_switched', view);
  }
  
  /**
   * 获取/设置当前SVG
   */
  get svg(): any {
    return this._svg;
  }
  
  set svg(value: any) {
    this._svg = value;
  }
  
  /**
   * 获取/设置缩放对象
   */
  get zoom(): any {
    return this._zoom;
  }
  
  set zoom(value: any) {
    this._zoom = value;
  }
  
  /**
   * 获取/设置当前变换
   */
  get currentTransform(): any {
    return this._currentTransform;
  }
  
  set currentTransform(value: any) {
    this._currentTransform = value;
  }
  
  /**
   * 设置基本缩放功能
   */
  setupBasicZoom(): void {
    if (!this._svg) {
      logger.warn('content_zoom_setup_failed_no_svg');
      return;
    }

    try {
      const zoom = d3
        .zoom()
        .scaleExtent([0.5, 2])
        .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          this._svg.select(".main-group").attr("transform", event.transform);

          // 保存当前变换
          this._currentTransform = event.transform;

          // 通过回调通知外部
          if (this.onZoomChangeCallback) {
            this.onZoomChangeCallback();
          }
        });

      this._svg.call(zoom);
      this._zoom = zoom;
      
      logger.debug('basic_zoom_setup_complete');
    } catch (error) {
      logger.error('content_zoom_setup_failed', error);
    }
  }
  /**
   * 设置缩放变化回调
   */
  setOnZoomChangeCallback(callback: () => void): void {
    this.onZoomChangeCallback = callback;
  }
  
  /**
   * 切换视图
   */
  switchView(view: "tree" | "timeline"): void {
    if (this._currentView === view) return;

    const previousView = this._currentView;
    logger.log('view_switching', previousView, view);

    try {
      // 保存当前视图的缩放状态
      this.saveCurrentViewState();
      
      // 更新当前视图
      this._currentView = view;

      // 重置缩放状态
      this._zoom = null;

      // 清除 SVG 内容
      if (this._svg) {
        this._svg.selectAll("*").remove();
      }
      
      logger.log('view_switched_need_reinit');
      
      // 返回视图已切换，但不做实际渲染（由调用者处理）
    } catch (error) {
      logger.error("content_view_switch_failed", error);

      // 恢复到先前的视图
      this._currentView = previousView;
    }
  }
  
  /**
   * 保存当前视图状态
   */
  saveCurrentViewState(): void {
    if (this._currentTransform) {
      if (this._currentView === 'tree') {
        this._treeZoom = this._currentTransform;
        logger.debug('tree_view_zoom_state_saved', this._treeZoom);
      } else if (this._currentView === 'timeline') {
        this._timelineZoom = this._currentTransform;
        logger.debug('timeline_view_zoom_state_saved', this._timelineZoom);
      }
    }
  }
  
  /**
   * 恢复特定视图的变换状态
   */
  restoreViewState(): boolean {
    // 获取当前视图类型对应的缩放状态
    const savedTransform = this._currentView === 'tree' ? this._treeZoom : this._timelineZoom;
    
    if (savedTransform && this._zoom) {
      logger.log('view_zoom_state_restoring', this._currentView);
      this.applyTransform(savedTransform);
      return true;
    }
    
    return false;
  }
  
  /**
   * 应用变换状态
   */
  applyTransform(transform: any): void {
    if (!transform || !this._svg || !this._zoom) {
      logger.warn('content_transform_apply_failed_missing_components');
      return;
    }

    this._isRestoringTransform = true;

    try {
      this._svg.call(this._zoom.transform, transform);
      setTimeout(() => {
        this._isRestoringTransform = false;
      }, 100);
      logger.debug('transform_state_applied');
    } catch (e) {
      logger.warn("content_transform_apply_failed", e);
      this._isRestoringTransform = false;
    }
  }
  
  /**
   * 初始化视图状态
   */
  initialize(svg: any): void {
    this._svg = svg;
    this.setupBasicZoom();
    logger.log('view_state_initialized');
  }
}