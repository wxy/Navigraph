import { Logger } from "../../../lib/utils/logger.js";
import { BackgroundMessageService } from "../../messaging/bg-message-service.js";
import { SessionManager } from "../session-manager.js";
import {
  BackgroundMessages,
  BackgroundResponses,
} from "../../../types/messages/background.js";
import { i18n } from "../../../lib/utils/i18n-utils.js";

const logger = new Logger("SessionMessageHandler");

/**
 * 会话相关消息处理类
 */
export class SessionMessageHandler {
  private manager: SessionManager;

  constructor(manager: SessionManager) {
    this.manager = manager;
  }

  /**
   * 注册所有会话相关消息处理程序
   */
  public registerHandlers(messageService: BackgroundMessageService): void {
    logger.groupCollapsed(i18n('session_handler_registering', '注册会话相关消息处理程序'));

    // 只包含原始实现中存在的处理程序
    this.registerGetSessionsHandler(messageService);
    this.registerGetSessionDetailsHandler(messageService);
    this.registerGetCurrentSessionHandler(messageService);
    this.registerGetLatestSessionHandler(messageService);
    this.registerCreateSessionHandler(messageService);
    this.registerUpdateSessionHandler(messageService);
    this.registerDeleteSessionHandler(messageService);
    this.registerEndSessionHandler(messageService);
    this.registerSetCurrentSessionHandler(messageService);
    this.registerGetSessionStatsHandler(messageService);

    logger.groupEnd();
  }

  /**
   * 注册获取会话列表处理程序
   */
  private registerGetSessionsHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "getSessions",
      (
        message: BackgroundMessages.GetSessionsRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetSessionsResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        this.manager
          .getSessions(message.options)
          .then((sessions) => {
            // 格式化为前端期望的格式
            const formattedSessions = sessions.map((s) => ({
              id: s.id,
              title: s.title,
              startTime: s.startTime,
              endTime: s.endTime,
              isActive: s.isActive,
              nodeCount: s.nodeCount,
              recordCount: s.nodeCount, // 兼容旧代码
            }));

            ctx.success({
              sessions: formattedSessions,
            });
          })
          .catch((error) => {
            logger.error(
              i18n('session_handler_get_sessions_failed', '获取会话列表失败: {0}', error instanceof Error ? error.message : String(error))
            );
            ctx.error(
              i18n('session_handler_get_sessions_failed_message', '获取会话列表失败: {0}', error instanceof Error ? error.message : String(error)
              )
            );
          });

        return true; // 异步响应
      }
    );
  }

  /**
   * 注册获取会话详情处理程序
   */
  private registerGetSessionDetailsHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "getSessionDetails",
      (
        message: BackgroundMessages.GetSessionDetailsRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetSessionDetailsResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        if (!message.sessionId) {
          ctx.error(i18n('session_handler_id_empty', '会话ID不能为空'));
          return false;
        }

        this.manager
          .getSessionDetails(message.sessionId)
          .then((session) => {
            if (!session) {
              ctx.error(i18n('session_handler_session_not_found', '找不到会话: {0}'), message.sessionId);
              return;
            }

            ctx.success({ session });
          })
          .catch((error) => {
            logger.error(i18n('session_handler_get_details_failed', '获取会话 {0} 详情失败: {1}'), message.sessionId, error);
            ctx.error(i18n('session_handler_get_details_failed_message', '获取会话详情失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }

  /**
   * 注册获取当前会话处理程序
   */
  private registerGetCurrentSessionHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "getCurrentSession",
      (
        message: BackgroundMessages.GetCurrentSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetCurrentSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        this.manager
          .getCurrentSession()
          .then((session) => {
            if (!session) {
              ctx.success({ session: null, sessionId: null });
              return;
            }

            ctx.success({ session, sessionId: session.id });
          })
          .catch((error) => {
            logger.error(i18n('session_handler_get_current_failed', '获取当前会话失败: {0}'), error);
            ctx.error(i18n('session_handler_get_current_failed_message', '获取当前会话失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }

  /**
   * 注册获取最新活跃会话处理程序
   */
  private registerGetLatestSessionHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "getLatestSession",
      (
        message: BackgroundMessages.GetLatestSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetLatestSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        this.manager
          .getLatestSession()
          .then((session) => {
            if (!session) {
              ctx.success({ session: null, sessionId: null });
              return;
            }

            ctx.success({ session, sessionId: session.id });
          })
          .catch((error) => {
            logger.error(i18n('session_handler_get_latest_failed', '获取最新会话失败: {0}'), error);
            ctx.error(i18n('session_handler_get_latest_failed_message', '获取最新会话失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );

    logger.log(i18n('session_handler_latest_registered', '已注册获取最新活跃会话处理程序'));
  }
  /**
   * 注册创建会话处理程序
   */
  private registerCreateSessionHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "createSession",
      (
        message: BackgroundMessages.CreateSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.CreateSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        // 只传递options参数，不单独传递setAsLatest
        this.manager
          .createSession(message.options)
          .then((session) => {
            ctx.success({ session });
          })
          .catch((error) => {
            logger.error(i18n('session_handler_create_failed', '创建会话失败: {0}'), error);
            ctx.error(i18n('session_handler_create_failed_message', '创建会话失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }

  /**
   * 注册更新会话处理程序
   */
  private registerUpdateSessionHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "updateSession",
      (
        message: BackgroundMessages.UpdateSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.UpdateSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        if (!message.sessionId) {
          ctx.error(i18n('session_handler_id_empty', '会话ID不能为空'));
          return false;
        }

        if (!message.updates) {
          ctx.error(i18n('session_handler_update_data_empty', '更新数据不能为空'));
          return false;
        }

        this.manager
          .updateSession(message.sessionId, message.updates)
          .then((session) => {
            ctx.success({ session });
          })
          .catch((error) => {
            logger.error(i18n('session_handler_update_failed', '更新会话 {0} 失败: {1}'), message.sessionId, error);
            ctx.error(i18n('session_handler_update_failed_message', '更新会话失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }

  /**
   * 注册删除会话处理程序
   */
  private registerDeleteSessionHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "deleteSession",
      (
        message: BackgroundMessages.DeleteSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.DeleteSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        if (!message.sessionId) {
          ctx.error(i18n('session_handler_id_empty', '会话ID不能为空'));
          return false;
        }

        if (!message.confirm) {
          ctx.error(i18n('session_handler_confirm_delete_required', '需要确认删除操作'));
          return false;
        }

        this.manager
          .deleteSession(message.sessionId)
          .then(() => {
            ctx.success({ sessionId: message.sessionId });
          })
          .catch((error) => {
            logger.error(i18n('session_handler_delete_failed', '删除会话 {0} 失败: {1}'), message.sessionId, error);
            ctx.error(i18n('session_handler_delete_failed_message', '删除会话失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }

  /**
   * 注册结束会话处理程序
   */
  private registerEndSessionHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "endSession",
      (
        message: BackgroundMessages.EndSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: BackgroundResponses.EndSessionResponse) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        if (!message.sessionId) {
          ctx.error(i18n('session_handler_id_empty', '会话ID不能为空'));
          return false;
        }

        this.manager
          .endSession(message.sessionId)
          .then((session) => {
            ctx.success({ sessionId: message.sessionId, session });
          })
          .catch((error) => {
            logger.error(i18n('session_handler_end_failed', '结束会话 {0} 失败: {1}'), message.sessionId, error);
            ctx.error(i18n('session_handler_end_failed_message', '结束会话失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }

  /**
   * 注册设置当前会话处理程序
   */
  private registerSetCurrentSessionHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "setCurrentSession",
      (
        message: BackgroundMessages.SetCurrentSessionRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.SetCurrentSessionResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        // 设置当前会话
        this.manager.setCurrentSession(message.sessionId);

        // 如果ID为null，返回空会话
        if (!message.sessionId) {
          ctx.success({ sessionId: null, session: null });
          return false;
        }

        // 获取并返回会话详情
        this.manager
          .getSessionDetails(message.sessionId)
          .then((session) => {
            if (session) {
              ctx.success({ sessionId: message.sessionId, session });
            } else {
              ctx.error(i18n('session_handler_session_not_found', '找不到会话: {0}'), message.sessionId);
            }
          })
          .catch((error) => {
            logger.error(i18n('session_handler_set_current_failed', '设置当前会话失败: {0}'), error);
            ctx.error(i18n('session_handler_set_current_failed_message', '设置当前会话失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }

  /**
   * 注册获取会话统计信息处理程序
   */
  private registerGetSessionStatsHandler(
    messageService: BackgroundMessageService
  ): void {
    messageService.registerHandler(
      "getSessionStats",
      (
        message: BackgroundMessages.GetSessionStatsRequest,
        sender: chrome.runtime.MessageSender,
        sendResponse: (
          response: BackgroundResponses.GetSessionStatsResponse
        ) => void
      ) => {
        const ctx = messageService.createMessageContext(
          message,
          sender,
          sendResponse
        );
        if (!ctx) {
          logger.error(i18n('session_handler_context_failed', '创建消息上下文失败'));
          return false;
        }

        this.manager
          .getSessionStatistics(message.sessionId)
          .then((statistics) => {
            ctx.success({ statistics });
          })
          .catch((error) => {
            logger.error(i18n('session_handler_get_stats_failed', '获取会话统计信息失败: {0}'), error);
            ctx.error(i18n('session_handler_get_stats_failed_message', '获取会话统计信息失败: {0}'),
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }
}
