import { Logger } from '../../../../lib/utils/logger.js';
import { _, _Error } from '../../../../lib/utils/i18n.js'; // 添加导入i18n
import type { Visualizer } from '../../../types/navigation.js';

const logger = new Logger('ViewSwitcher');

/**
 * 视图切换器
 * 负责管理树形图和瀑布视图之间的切换
 */
export class ViewSwitcher {
  private visualizer: Visualizer;
  private treeViewButton: HTMLElement | null = null;
  private waterfallViewButton: HTMLElement | null = null;
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }
  
  /**
   * 初始化视图切换器
   */
  public initialize(): void {
    this.treeViewButton = document.getElementById('tree-view');
    this.waterfallViewButton = document.getElementById('waterfall-view');
    
    if (!this.treeViewButton || !this.waterfallViewButton) {
      logger.warn(_('view_switcher_buttons_not_found', '视图切换按钮未找到'));
      return;
    }
    
    // 添加事件监听
    this.treeViewButton.addEventListener('click', () => {
      this.switchView('tree');
    });
    
    this.waterfallViewButton.addEventListener('click', () => {
      this.switchView('waterfall');
    });
    
    // 初始设置激活的视图
    this.updateButtonsState(this.visualizer.currentView);
    
    logger.log(_('view_switcher_initialized', '视图切换器已初始化'));
  }
  
  /**
   * 切换视图
   * @param view 目标视图
   */
  private switchView(view: 'tree' | 'waterfall'): void {
    if (view === this.visualizer.currentView) {
      if (view === 'tree') {
        logger.log(_('view_already_tree', '已经是树形图视图，无需切换')); 
      } else if (view === 'waterfall') {
        logger.log(_('view_already_waterfall', '已经是瀑布视图，无需切换'));
      }
      return;
    } else if (view === 'tree') {
      logger.log(_('view_switching_to_tree', '切换到树形图视图'));
    } else if (view === 'waterfall') {
      logger.log(_('view_switching_to_waterfall', '切换到瀑布视图'));
    }
    
    // 调用可视化器的切换视图方法
    this.visualizer.switchView(view);
    
    // 更新按钮状态
    this.updateButtonsState(view);
  }
  
  /**
   * 更新视图按钮状态
   * @param currentView 当前视图
   */
  public updateButtonsState(currentView: string): void {
    if (!this.treeViewButton || !this.waterfallViewButton) {
      return;
    }
    
    // 移除所有按钮的激活状态
    this.treeViewButton.classList.remove('active');
    this.waterfallViewButton.classList.remove('active');
    
    // 根据当前视图设置激活状态
    if (currentView === 'tree') {
      this.treeViewButton.classList.add('active');
    } else if (currentView === 'waterfall') {
      this.waterfallViewButton.classList.add('active');
    }
    
    logger.debug(_('view_buttons_state_updated', '视图按钮状态已更新: {0}'), currentView);
  }
}