/**
 * 导出所有消息类型
 */

export * from './common.js';
export * from './background.js';
export * from './content.js';
export * from './popup.js';
export * from './options.js';
export * from './types.js';

// 重新导出常用的API接口，方便使用
export type { BackgroundAPI } from './background.js';
export type { ContentAPI } from './content.js';
export type { PopupAPI } from './popup.js';
export type { OptionsAPI } from './options.js';

/**
 * 自定义类型帮助器，将target和action转换为RequestResponseMap的键
 */
export type PrefixedAction<T extends MessageTarget, A extends string> = 
  `${T}.${A}` extends keyof RequestResponseMap ? `${T}.${A}` : never;

/**
 * 查找不带前缀的动作对应的完整键名
 */
export type FindActionWithTarget<A extends string> = 
  {[K in keyof RequestResponseMap]: K extends `${infer T}.${A}` ? K : never}[keyof RequestResponseMap];