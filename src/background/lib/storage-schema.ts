/**
 * 存储架构定义
 * 定义IndexedDB数据库的结构、表和索引
 */

/**
 * 存储架构配置
 * Navigraph应用的数据库架构具体配置
 */

import { DatabaseSchema } from '../../types/storage-types';

/**
 * Navigraph 存储架构
 */
export const StorageSchema: DatabaseSchema = {
  name: 'NavigraphDB',
  version: 1,
  stores: [
    // 导航节点存储
    {
      name: 'nodes',
      keyPath: 'id',
      autoIncrement: false,
      indices: [
        { name: 'url', keyPath: 'url', unique: false },
        { name: 'tabId', keyPath: 'tabId', unique: false },
        { name: 'timestamp', keyPath: 'timestamp', unique: false },
        { name: 'sessionId', keyPath: 'sessionId', unique: false },
        { name: 'type', keyPath: 'type', unique: false }
      ]
    },
    // 导航边存储
    {
      name: 'edges',
      keyPath: 'id',
      autoIncrement: false,
      indices: [
        { name: 'source', keyPath: 'source', unique: false },
        { name: 'target', keyPath: 'target', unique: false },
        { name: 'timestamp', keyPath: 'timestamp', unique: false },
        { name: 'sessionId', keyPath: 'sessionId', unique: false },
        { name: 'type', keyPath: 'type', unique: false }
      ]
    },
    // 会话存储
    {
      name: 'sessions',
      keyPath: 'id',
      autoIncrement: false,
      indices: [
        { name: 'startTime', keyPath: 'startTime', unique: false },
        { name: 'endTime', keyPath: 'endTime', unique: false },
        { name: 'isActive', keyPath: 'isActive', unique: false }
      ]
    },
    // 设置存储
    {
      name: 'settings',
      keyPath: 'key',
      autoIncrement: false,
      indices: []
    }
  ]
};