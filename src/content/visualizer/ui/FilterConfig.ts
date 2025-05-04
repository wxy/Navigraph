import { i18n } from '../../../lib/utils/i18n-utils.js';

/**
 * 筛选器配置项定义
 */
export interface FilterConfig {
  id: string;        // HTML元素ID
  text: string;      // 显示文本
  property: string;  // 属性名（用于状态和筛选）
  defaultValue: boolean; // 默认值
  description?: string;  // 描述提示
  enabled: boolean;  // 当前状态
}

/**
 * 筛选器状态接口
 * 明确定义所有可能的筛选器状态属性
 */
export interface FilterStates {
  reload: boolean;
  history: boolean;
  closed: boolean;
  showTracking: boolean;
  typeLink: boolean;
  typeAddress: boolean;
  typeForm: boolean;
  typeJs: boolean;
}

/**
 * 获取初始筛选器配置
 */
export function getInitialFilters(): FilterConfig[] {
  return [
    {
      id: "filter-reload",
      text: i18n("filter_show_reload"),
      property: "reload",
      defaultValue: true,
      description: i18n("filter_show_reload_desc"),
      enabled: true
    },
    {
      id: "filter-history",
      text: i18n("filter_show_history"),
      property: "history",
      defaultValue: true,
      description: i18n("filter_show_history_desc"),
      enabled: true
    },
    {
      id: "filter-closed",
      text: i18n("filter_show_closed"),
      property: "closed",
      defaultValue: false,
      description: i18n("filter_show_closed_desc"),
      enabled: false
    },
    {
      id: "filter-tracking",
      text: i18n("filter_show_tracking"),
      property: "showTracking",
      defaultValue: false,
      description: i18n("filter_show_tracking_desc"),
      enabled: false
    },
    {
      id: "type-link",
      text: i18n("filter_type_link"),
      property: "typeLink",
      defaultValue: true,
      description: i18n("filter_type_link_desc"),
      enabled: true
    },
    {
      id: "type-address",
      text: i18n("filter_type_address"),
      property: "typeAddress",
      defaultValue: true,
      description: i18n("filter_type_address_desc"),
      enabled: true
    },
    {
      id: "type-form",
      text: i18n("filter_type_form"),
      property: "typeForm",
      defaultValue: true,
      description: i18n("filter_type_form_desc"),
      enabled: true
    },
    { 
      id: "type-js", 
      text: i18n("filter_type_js"), 
      property: "typeJs", 
      defaultValue: true, 
      description: i18n("filter_type_js_desc"), 
      enabled: true 
    },
  ];
}

/**
 * 从筛选器配置中提取筛选状态
 * 返回明确的 FilterStates 类型
 */
export function extractFilterStates(filters: FilterConfig[]): FilterStates {
  // 创建符合 FilterStates 接口的初始对象
  const states: FilterStates = {
    reload: false,
    history: false,
    closed: false,
    showTracking: false,
    typeLink: false,
    typeAddress: false,
    typeForm: false,
    typeJs: false
  };
  
  // 从筛选器配置中填充状态
  filters.forEach(filter => {
    // 使用类型断言确保属性访问安全
    if (filter.property in states) {
      (states as any)[filter.property] = filter.enabled;
    }
  });
  
  return states;
}
