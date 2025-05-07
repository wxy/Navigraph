import { Logger } from '../../../../lib/utils/logger.js';
import { i18n } from '../../../../lib/utils/i18n-utils.js'; // 添加导入i18n
import type { Visualizer } from '../../../types/navigation.js';

const logger = new Logger('FilterPanel');

/**
 * 过滤器配置定义 - 简化后
 */
export interface FilterDefinition {
  id: string;           // 过滤器ID
  defaultValue: boolean; // 默认值
}

/**
 * 筛选面板
 * 负责管理导航图可视化的筛选条件
 */
export class FilterPanel {
  private visualizer: Visualizer;
  private filterContainer: HTMLElement | null = null;
  
  // 修改过滤器定义数组
  private filterDefinitions: FilterDefinition[] = [
    {
      id: 'filter-reload',
      defaultValue: true
    },
    {
      id: 'filter-history',
      defaultValue: true
    },
    {
      id: 'filter-closed',
      defaultValue: false
    },
    {
      id: 'filter-tracking',
      defaultValue: false
    },
    {
      id: 'type-link',
      defaultValue: true
    },
    {
      id: 'type-address',
      defaultValue: true
    },
    {
      id: 'type-form',
      defaultValue: true
    },
    {
      id: 'type-js',
      defaultValue: true
    }
  ];
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }
  
  /**
   * 初始化筛选面板
   */
  public initialize(): void {
    this.filterContainer = document.getElementById('filter-panel-container');
    
    if (!this.filterContainer) {
      logger.warn('filter_panel_container_not_found');
      return;
    }
    
    // 添加事件监听器到现有筛选器
    this.attachEventListenersToExistingFilters();
    
    logger.log('filter_panel_initialized');
  }
  
  /**
   * 为现有HTML中的筛选器添加事件监听器
   */
  private attachEventListenersToExistingFilters(): void {
    // 直接使用filterDefinitions中的ID，它们与HTML元素ID一致
    this.filterDefinitions.forEach(filter => {
      const checkbox = document.getElementById(filter.id) as HTMLInputElement;
      if (checkbox) {
        // 获取初始值
        const initialValue = this.getFilterValue(
          filter.id, 
          filter.defaultValue
        );
        
        // 设置初始状态
        checkbox.checked = initialValue;
        
        // 添加事件监听器
        checkbox.addEventListener('change', () => {
          this.handleFilterChange(filter.id, checkbox.checked);
        });
        
        logger.debug('filter_listener_added', filter.id, initialValue);
      } else {
        logger.warn('filter_element_not_found', filter.id);
      }
    });
  }
  
  /**
   * 获取指定筛选器的默认值
   */
  private getDefaultValueForFilter(filterId: string): boolean {
    const filterDef = this.filterDefinitions.find(def => def.id === filterId);
    return filterDef ? filterDef.defaultValue : true; // 默认为true
  }
  
  /**
   * 处理筛选器变更
   */
  private handleFilterChange(filterId: string, value: boolean): void {
    logger.log('filter_change', filterId, value);
    
    // 检查可视化器是否有handleFilterChange方法
    if (typeof (this.visualizer as any).handleFilterChange === 'function') {
      // 直接调用NavigationVisualizer的handleFilterChange方法
      (this.visualizer as any).handleFilterChange(filterId, value);
      logger.debug('filter_using_visualizer_handler');
    } else {
      // 否则使用默认实现
      // 更新可视化器的筛选器配置
      this.visualizer.updateFilter(filterId, value);
      
      // 应用筛选器并刷新可视化
      this.visualizer.applyFilters();
    }
  }
  
  /**
   * 获取筛选器值
   */
  private getFilterValue(filterId: string, defaultValue: boolean): boolean {
    // 尝试从可视化器获取当前值
    const currentFilters = this.visualizer.filters;
    if (currentFilters && filterId in currentFilters) {
      return (currentFilters as any)[filterId];
    }
    
    return defaultValue;
  }
  
  /**
   * 重置所有筛选器为默认值
   */
  public resetFilters(): void {
    this.filterDefinitions.forEach(filter => {
      // 修复：直接使用 filter.id 而不是 `filter-${filter.id}`
      const checkbox = document.getElementById(filter.id) as HTMLInputElement;
      if (checkbox) {
        // 使用默认值设置复选框状态
        checkbox.checked = filter.defaultValue;
        
        // 向可视化器通知筛选器变化
        this.handleFilterChange(filter.id, filter.defaultValue);
      } else {
        logger.warn('filter_reset_element_not_found', filter.id);
      }
    });
    
    // 更新UI状态
    this.updateUI(this.visualizer.filters);
    
    logger.log('filter_all_reset_to_default');
  }
  
  /**
   * 更新筛选器UI状态
   * @param filters 当前筛选器配置
   */
  public updateUI(filters: any): void {
    if (!filters) return;

    logger.log('filter_ui_updating');
    
    // 映射筛选器ID
    const idMappings: Record<string, string> = {
      // 导航类型
      'typeLink': 'type-link',
      'typeAddress': 'type-address',
      'typeForm': 'type-form',
      'typeJs': 'type-js',
      
      // 导航行为
      'reload': 'filter-reload',
      'history': 'filter-history',
      
      // 页面状态
      'closed': 'filter-closed',
      'showTracking': 'filter-tracking'
    };
    
    // 更新每个筛选器状态
    Object.entries(filters).forEach(([filterId, value]) => {
      const htmlId = idMappings[filterId];
      if (htmlId) {
        const checkbox = document.getElementById(htmlId) as HTMLInputElement;
        if (checkbox) {
          checkbox.checked = !!value;
          logger.debug('filter_status_updated', htmlId, checkbox.checked);
        }
      }
    });
  }
}