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
    logger.groupCollapsed(i18n("session_handler_registering"));

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
          logger.error("session_handler_context_failed");
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
              i18n("session_handler_get_sessions_failed",
                error instanceof Error ? error.message : String(error))
            );
            ctx.error(
              i18n("session_handler_get_sessions_failed_message",
                error instanceof Error ? error.message : String(error)
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
          logger.error("session_handler_context_failed");
          return false;
        }

        if (!message.sessionId) {
          ctx.error("session_handler_id_empty");
          return false;
        }

        this.manager
          .getSessionDetails(message.sessionId)
          .then((session) => {
            if (!session) {
              ctx.error("session_handler_session_not_found", message.sessionId);
              return;
            }

            ctx.success({ session });
          })
          .catch((error) => {
            logger.error("session_handler_get_details_failed", message.sessionId, error);
            ctx.error(
              "session_handler_get_details_failed_message",
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
          logger.error("session_handler_context_failed");
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
            logger.error("session_handler_get_current_failed", error);
            ctx.error(
              "session_handler_get_current_failed_message",
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
          logger.error("session_handler_context_failed");
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
            logger.error("session_handler_get_latest_failed", error);
            ctx.error(
              "session_handler_get_latest_failed_message",
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );

    logger.log("session_handler_latest_registered");
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
          logger.error("session_handler_context_failed");
          return false;
        }

        // 只传递options参数，不单独传递setAsLatest
        this.manager
          .createSession(message.options)
          .then((session) => {
            ctx.success({ session });
          })
          .catch((error) => {
            logger.error("session_handler_create_failed", error);
            ctx.error(
              "session_handler_create_failed_message",
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
          logger.error("session_handler_context_failed");
          return false;
        }

        if (!message.sessionId) {
          ctx.error("session_handler_id_empty");
          return false;
        }

        if (!message.updates) {
          ctx.error("session_handler_update_data_empty");
          return false;
        }

        this.manager
          .updateSession(message.sessionId, message.updates)
          .then((session) => {
            ctx.success({ session });
          })
          .catch((error) => {
            logger.error("session_handler_update_failed", message.sessionId, error);
            ctx.error(
              "session_handler_update_failed_message",
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
          logger.error("session_handler_context_failed");
          return false;
        }

        if (!message.sessionId) {
          ctx.error("session_handler_id_empty");
          return false;
        }

        if (!message.confirm) {
          ctx.error("session_handler_confirm_delete_required");
          return false;
        }

        this.manager
          .deleteSession(message.sessionId)
          .then(() => {
            ctx.success({ sessionId: message.sessionId });
          })
          .catch((error) => {
            logger.error("session_handler_delete_failed", message.sessionId, error);
            ctx.error(
              "session_handler_delete_failed_message",
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
          logger.error("session_handler_context_failed");
          return false;
        }

        if (!message.sessionId) {
          ctx.error("session_handler_id_empty");
          return false;
        }

        this.manager
          .endSession(message.sessionId)
          .then((session) => {
            ctx.success({ sessionId: message.sessionId, session });
          })
          .catch((error) => {
            logger.error("session_handler_end_failed", message.sessionId, error);
            ctx.error(
              "session_handler_end_failed_message",
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
          logger.error("session_handler_context_failed");
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
              ctx.error("session_handler_session_not_found", message.sessionId);
            }
          })
          .catch((error) => {
            logger.error("session_handler_set_current_failed", error);
            ctx.error(
              "session_handler_set_current_failed_message",
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
          logger.error("session_handler_context_failed");
          return false;
        }

        this.manager
          .getSessionStatistics(message.sessionId)
          .then((statistics) => {
            ctx.success({ statistics });
          })
          .catch((error) => {
            logger.error("session_handler_get_stats_failed", error);
            ctx.error(
              "session_handler_get_stats_failed_message",
              error instanceof Error ? error.message : String(error)
            );
          });

        return true; // 异步响应
      }
    );
  }
}
