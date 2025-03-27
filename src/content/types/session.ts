/**
 * 会话类型定义
 * 前端使用的会话类型，与后端保持一致
 */

// 直接重新导出后端定义的类型
// 只导出需要的后端类型
import {
  BrowsingSession,
  SessionSummary,
  NavNode,
  NavLink
} from '../../types/session-types';

// 导出会话类型
export type Session = SessionSummary;
export type SessionDetails = BrowsingSession;

// 导出节点类型
export type NodeRecord = NavNode;
export type EdgeRecord = NavLink;

// 为确保接口一致性，重新导出原始类型
export {
  BrowsingSession,
  NavNode,
  NavLink
};
