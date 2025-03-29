/**
 * 消息系统入口
 * 导出所有消息相关的工具和服务
 */

// 导出基础类型
export * from '../../types/messages/common.js';
export * from '../../types/messages/index.js';

// 导出核心工具
export * from './base-service.js';
export * from './sender.js';
export * from './handlers.js'; // 添加这一行，导出处理程序辅助函数

// 这些导出应该放到最后，避免循环依赖
// 如果这些模块确实需要在这里导出，取消注释
// export * from '../../background/messaging/bg-message-service.js';
// export * from '../../content/messaging/content-message-service.js';