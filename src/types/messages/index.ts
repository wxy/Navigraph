/**
 * 导出所有消息类型
 */

export * from './common.js';
export * from './background.js';
export * from './content.js';
export * from './popup.js';
export * from './options.js';
export * from './types.js'; // 这一行会导出包含PrefixedAction和FindActionWithTarget在内的所有类型

// 重新导出常用的API接口，方便使用
export type { BackgroundAPI } from './background.js';
export type { ContentAPI } from './content.js';
export type { PopupAPI } from './popup.js';
export type { OptionsAPI } from './options.js';