/**
 * 存储相关通用类型定义
 */

/**
 * 存储表定义接口
 */
export interface StoreDefinition {
  name: string;                 // 存储表名称
  keyPath: string;              // 主键路径
  autoIncrement: boolean;       // 是否自动递增
  indices?: IndexDefinition[];  // 索引定义
}

/**
 * 索引定义接口
 */
export interface IndexDefinition {
  name: string;           // 索引名称
  keyPath: string;        // 索引键路径
  unique: boolean;        // 是否唯一
  multiEntry?: boolean;   // 是否多条目
}

/**
 * 数据库架构定义接口
 */
export interface DatabaseSchema {
  name: string;              // 数据库名称
  version: number;           // 数据库版本
  stores: StoreDefinition[]; // 存储表定义
}