/**
 * 筛选器管理器
 * 负责管理筛选器配置和状态，以及应用筛选器逻辑
 */
import { Logger } from '../../../lib/utils/logger.js';
import { i18n } from '../../../lib/utils/i18n-utils.js';
import { 
  FilterConfig, 
  FilterStates, 
  getInitialFilters, 
  extractFilterStates 
} from '../ui/FilterConfig.js';
import type { DataProcessor } from '../DataProcessor.js';
import type { NavNode, NavLink } from '../../types/navigation.js';
import type { UIManager } from '../ui/UIManager.js';
import type { NavigationVisualizer } from '../../core/navigation-visualizer.js';

const logger = new Logger('FilterManager');

/**
 * 筛选器管理器
 * 负责管理筛选器配置和状态，以及应用筛选逻辑
 */
export class FilterManager {
  private filterConfigs: FilterConfig[] = getInitialFilters();
  private dataProcessor: DataProcessor;
  private uiManager: UIManager;
  private visualizer: NavigationVisualizer;
  
  /**
   * 获取当前筛选器状态
   */
  get filters(): FilterStates {
    return extractFilterStates(this.filterConfigs);
  }
  
  /**
   * 构造函数
   */
  constructor(visualizer: NavigationVisualizer, dataProcessor: DataProcessor, uiManager: UIManager) {
    this.visualizer = visualizer;
    this.dataProcessor = dataProcessor;
    this.uiManager = uiManager;
    logger.log('filter_manager_init');
  }
  
  /**
   * 初始化筛选器
   */
  initialize(): void {
    logger.log("filter_init_start");
    
    // 可以从URL参数或其他来源加载筛选器配置
    this.loadFilterConfigFromUrl();
    
    // 更新UI
    this.updateFilterUI();
    
    logger.log("filter_init_complete");
  }
  
  /**
   * 从URL参数加载筛选器配置
   */
  private loadFilterConfigFromUrl(): void {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const filterParam = urlParams.get('filter');
      
      if (filterParam) {
        const filterValues = JSON.parse(filterParam);
        
        logger.log("filter_load_from_url", filterValues);
        
        // 更新筛选器配置
        for (const config of this.filterConfigs) {
          if (config.property === 'reload') config.enabled = filterValues.reload ?? config.enabled;
          if (config.property === 'history') config.enabled = filterValues.history ?? config.enabled;
          if (config.property === 'closed') config.enabled = filterValues.closed ?? config.enabled;
          if (config.property === 'showTracking') config.enabled = filterValues.tracking ?? config.enabled;
          if (config.property === 'typeLink') config.enabled = filterValues.typeLink ?? config.enabled;
          if (config.property === 'typeAddress') config.enabled = filterValues.typeAddress ?? config.enabled;
          if (config.property === 'typeForm') config.enabled = filterValues.typeForm ?? config.enabled;
          if (config.property === 'typeJs') config.enabled = filterValues.typeJs ?? config.enabled;
        }
      }
    } catch (error) {
      logger.warn("content_filter_url_load_failed", error);
    }
  }
  
  /**
   * 更新筛选器UI
   */
  updateFilterUI(): void {
    this.uiManager.updateFilters(this.filters);
  }
  
  /**
   * 应用筛选器
   * @param allNodes 所有节点
   * @param allEdges 所有边
   * @returns 筛选后的节点和边
   */
  applyFilters(allNodes: NavNode[], allEdges: NavLink[]): { nodes: NavNode[], edges: NavLink[] } {
    logger.log("filter_applying", this.filters);
    
    const result = this.dataProcessor.applyFilters(
      allNodes,
      allEdges,
      this.filters
    );
    
    logger.log("filter_result_stats", result.nodes.length, allNodes.length, result.edges.length, allEdges.length);
    
    return result;
  }
  
  /**
   * 更新筛选器
   * @param filterId 筛选器ID
   * @param value 新值
   */
  updateFilter(filterId: string, value: boolean): void {
    logger.log('filter_update', filterId, value);
    
    // 查找对应的筛选器配置
    const filter = this.filterConfigs.find(f => f.id === filterId);
    if (!filter) {
      logger.warn("content_filter_unknown_id", filterId);
      return;
    }
    
    // 更新筛选器状态
    filter.enabled = value;
    
    // 更新UI
    this.updateFilterUI();
  }
  
  /**
   * 处理筛选器变化
   * @param filterId 筛选器ID
   * @param checked 是否选中
   */
  handleFilterChange(filterId: string, checked: boolean): void {
    // 更新筛选器
    this.updateFilter(filterId, checked);
    
    // 查找对应的筛选器配置用于日志记录
    const config = this.filterConfigs.find((f) => f.id === filterId);
    if (config) {
      logger.log('filter_changed', filterId, config.property, checked);
    }
    
    // 触发可视化刷新
    this.visualizer.refreshVisualization(undefined, { restoreTransform: true });
  }
  
  /**
   * 重置所有筛选器为默认值
   */
  resetFilters(): void {
    logger.log("filter_reset_start");
    
    // 重置为初始配置
    this.filterConfigs = getInitialFilters();
    
    // 更新UI
    this.updateFilterUI();
    
    // 触发可视化刷新
    this.visualizer.refreshVisualization(undefined, { restoreTransform: true });
    
    logger.log("filter_reset_complete");
  }
  
  /**
   * 获取筛选器配置的序列化表示，用于URL参数
   */
  getFilterUrlParam(): string {
    const filterValues = {
      reload: this.filters.reload,
      history: this.filters.history,
      closed: this.filters.closed,
      tracking: this.filters.showTracking,
      typeLink: this.filters.typeLink,
      typeAddress: this.filters.typeAddress,
      typeForm: this.filters.typeForm,
      typeJs: this.filters.typeJs,
    };
    
    return JSON.stringify(filterValues);
  }
  
  /**
   * 清理筛选器资源
   */
  cleanup(): void {
    logger.log("filter_cleanup");
    // 目前没有需要清理的资源
  }
}