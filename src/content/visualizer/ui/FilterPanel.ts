import { Logger } from '../../../lib/utils/logger.js';
import type { Visualizer } from '../../types/navigation.js';

const logger = new Logger('FilterPanel');

/**
 * 过滤器配置定义
 */
export interface FilterDefinition {
  id: string;           // 过滤器ID
  label: string;        // 显示标签
  defaultValue: boolean; // 默认值
  description?: string; // 说明文本
}

/**
 * 筛选面板
 * 负责管理导航图可视化的筛选条件
 */
export class FilterPanel {
  private visualizer: Visualizer;
  private filterContainer: HTMLElement | null = null;
  
  // 默认过滤器定义
  private filterDefinitions: FilterDefinition[] = [
    {
      id: 'filter-reload',  // 修改为匹配 NavigationVisualizer 的 ID
      label: '显示刷新',
      defaultValue: true,
      description: '显示页面刷新操作'
    },
    {
      id: 'filter-history',  // 修改为匹配 NavigationVisualizer 的 ID
      label: '显示历史导航',
      defaultValue: true,
      description: '显示浏览器历史前进/后退操作'
    },
    {
      id: 'filter-closed',  // 修改为匹配 NavigationVisualizer 的 ID
      label: '显示已关闭页面',
      defaultValue: false,
      description: '显示已关闭的页面'
    },
    {
      id: 'filter-tracking',  // 修改为匹配 NavigationVisualizer 的 ID
      label: '显示跟踪页面',
      defaultValue: false,
      description: '显示分析和跟踪相关的请求'
    },
    {
      id: 'type-link',  // 修改为匹配 NavigationVisualizer 的 ID
      label: '显示链接点击',
      defaultValue: true,
      description: '显示由链接点击导致的导航'
    },
    {
      id: 'type-address',  // 修改为匹配 NavigationVisualizer 的 ID
      label: '显示地址栏输入',
      defaultValue: true,
      description: '显示由地址栏输入导致的导航'
    },
    {
      id: 'type-form',  // 修改为匹配 NavigationVisualizer 的 ID
      label: '显示表单提交',
      defaultValue: true,
      description: '显示由表单提交导致的导航'
    },
    {
      id: 'type-js',  // 修改为匹配 NavigationVisualizer 的 ID
      label: '显示JS导航',
      defaultValue: true,
      description: '显示由JavaScript导致的导航'
    }
  ];
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }
  
  /**
   * 初始化筛选面板
   */
  public initialize(): void {
    this.filterContainer = document.querySelector('.filters-panel');
    
    if (!this.filterContainer) {
      logger.warn('筛选器容器未找到');
      return;
    }
    
    // 添加事件监听器到现有筛选器
    this.attachEventListenersToExistingFilters();
    
    logger.log('筛选面板已初始化');
  }
  
/**
 * 为现有HTML中的筛选器添加事件监听器
 */
private attachEventListenersToExistingFilters(): void {
  // 直接使用filterDefinitions中的ID，它们现在与HTML元素ID匹配
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
      
      logger.debug(`为筛选器 ${filter.id} 添加了事件监听器，初始值: ${initialValue}`);
    } else {
      logger.warn(`筛选器元素 ${filter.id} 未找到`);
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
   * 创建筛选器UI
   */
  private createFilterUI(): void {
    if (!this.filterContainer) return;
    
    // 清空容器
    this.filterContainer.innerHTML = '';
    
    // 添加标题
    const headerElement = document.createElement('h3');
    headerElement.textContent = '筛选器';
    headerElement.className = 'filter-header';
    this.filterContainer.appendChild(headerElement);
    
    // 创建每个筛选选项
    this.filterDefinitions.forEach(filter => {
      const filterItem = this.createFilterItem(filter);
      this.filterContainer?.appendChild(filterItem);
    });
  }
  
  /**
   * 创建单个筛选器项
   */
  private createFilterItem(filter: FilterDefinition): HTMLElement {
    // 创建容器
    const filterItem = document.createElement('div');
    filterItem.className = 'filter-item';
    
    // 创建复选框
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `filter-${filter.id}`;
    checkbox.checked = this.getFilterValue(filter.id, filter.defaultValue);
    checkbox.addEventListener('change', () => {
      this.handleFilterChange(filter.id, checkbox.checked);
    });
    
    // 创建标签
    const label = document.createElement('label');
    label.htmlFor = `filter-${filter.id}`;
    label.textContent = filter.label;
    
    // 添加工具提示 (如果有描述)
    if (filter.description) {
      label.title = filter.description;
      label.classList.add('has-tooltip');
    }
    
    // 组装项目
    filterItem.appendChild(checkbox);
    filterItem.appendChild(label);
    
    return filterItem;
  }
  
  /**
   * 处理筛选器变更
   */
  private handleFilterChange(filterId: string, value: boolean): void {
    logger.log(`筛选器变更: ${filterId} = ${value}`);
    
  // 检查可视化器是否有handleFilterChange方法
  if (typeof (this.visualizer as any).handleFilterChange === 'function') {
    // 直接调用NavigationVisualizer的handleFilterChange方法
    (this.visualizer as any).handleFilterChange(filterId, value);
    logger.debug(`使用可视化器的handleFilterChange方法处理筛选器变化`);
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
    const currentFilters = this.visualizer.getFilters();
    if (currentFilters && filterId in currentFilters) {
      return (currentFilters as any)[filterId];
    }
    
    return defaultValue;
  }
  
  /**
   * 重置所有筛选器为默认值
   */
  public resetFilters(): void {
    logger.log('重置所有筛选器为默认值');
    
    // 映射筛选器ID
    const idMappings: Record<string, string> = {
      'type-link': 'typeLink',
      'type-address': 'typeAddress',
      'type-form': 'typeForm',
      'type-js': 'typeJs',
      'filter-reload': 'reload',
      'filter-history': 'history',
      'filter-closed': 'closed',
      'filter-tracking': 'showTracking'
    };
    
    // 重置每个筛选器
    Object.entries(idMappings).forEach(([htmlId, filterId]) => {
      const checkbox = document.getElementById(htmlId) as HTMLInputElement;
      if (checkbox) {
        const defaultValue = this.getDefaultValueForFilter(filterId);
        checkbox.checked = defaultValue;
        this.handleFilterChange(filterId, defaultValue);
        logger.debug(`筛选器 ${htmlId} 已重置为默认值: ${defaultValue}`);
      }
    });
    
    logger.log('所有筛选器已重置');
  }
  
  /**
   * 更新筛选器UI状态
   * @param filters 当前筛选器配置
   */
  public updateUI(filters: any): void {
    if (!filters) return;

    logger.log('更新筛选器UI状态');
    
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
          logger.debug(`筛选器 ${htmlId} 状态已更新为: ${checkbox.checked}`);
        }
      }
    });
  }
}