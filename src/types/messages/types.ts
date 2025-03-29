import type { 
  BackgroundMessages,
  BackgroundResponses,
  BackgroundAPI
} from './background.js';

import type {
  ContentMessages,
  ContentResponses,
  ContentAPI
} from './content.js';

import type {
  PopupMessages,
  PopupResponses,
  PopupAPI
} from './popup.js';

import type {
  OptionsMessages,
  OptionsResponses,
  OptionsAPI
} from './options.js';

import { MessageTarget } from './common.js';

/**
 * 所有消息类型的映射
 */
export interface RequestResponseMap extends
  MessageMapByTarget<'background', BackgroundAPI>,
  MessageMapByTarget<'content', ContentAPI>,
  MessageMapByTarget<'popup', PopupAPI>,
  MessageMapByTarget<'options', OptionsAPI> {
  // 可以在这里添加任何额外的消息类型
}

/**
 * 按目标分组的消息映射助手类型
 * 添加前缀，避免不同目标间的命名冲突
 */
type MessageMapByTarget<T extends MessageTarget, API extends Record<string, any>> = {
  [K in keyof API as `${T}.${string & K}`]: {
    request: Omit<API[K]['request'], 'target'> & { target: T };
    response: API[K]['response'];
  };
};