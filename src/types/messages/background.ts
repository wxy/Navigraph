import { BaseMessage, BaseResponse } from './common.js';
import { BrowsingSession } from '../session-types.js';
// 添加这些新的类型定义
import { 
    SessionQueryOptions,
    SessionCreationOptions, 
    SessionUpdateOptions,
    SessionStatistics 
  } from '../../types/session-types.js';
  
export namespace BackgroundMessages {
  /**
   * 获取标签页ID请求
   */
  export interface GetTabIdRequest extends BaseMessage {
    action: 'getTabId';
    target: 'background';
  }

  /**
   * 获取节点ID请求
   */
  export interface GetNodeIdRequest extends BaseMessage {
    action: 'getNodeId';
    target: 'background';
    tabId: number;
    url: string;
    referrer: string; // 改为必需，处理程序中提供默认值 ''
    timestamp: number; // 改为必需，处理程序中提供默认值 Date.now()
  }

  /**
   * 页面加载完成请求
   */
  export interface PageLoadedRequest extends BaseMessage {
    action: 'pageLoaded';
    target: 'background';
    pageInfo: {
      url: string;
      title: string;
      referrer: string; // 改为必需，处理程序中提供默认值 ''
      loadTime: number; // 改为必需，处理程序中提供默认值 0
      timestamp: number; // 改为必需，处理程序中提供默认值 Date.now()
    };
  }

  /**
   * 页面标题更新请求
   * nodeId 必须保持可选，因为可能需要通过 tabId 和 URL 查找
   */
  export interface PageTitleUpdatedRequest extends BaseMessage {
    action: 'pageTitleUpdated';
    target: 'background';
    nodeId?: string;
    title: string;
  }

  /**
   * 网站图标更新请求
   * nodeId 必须保持可选，因为可能需要通过 tabId 和 URL 查找
   */
  export interface FaviconUpdatedRequest extends BaseMessage {
    action: 'faviconUpdated';
    target: 'background';
    nodeId?: string;
    faviconUrl: string;
  }

  /**
   * 页面活动请求
   */
  export interface PageActivityRequest extends BaseMessage {
    action: 'pageActivity';
    target: 'background';
    source: string;
    timestamp: number; // 改为必需，处理程序中提供默认值 Date.now()
  }

  /**
   * 链接点击请求
   */
  export interface LinkClickedRequest extends BaseMessage {
    action: 'linkClicked';
    target: 'background';
    linkInfo: {
      sourcePageId: string;
      sourceUrl: string;
      targetUrl: string;
      anchorText: string; // 改为必需，处理程序中提供默认值 ''
      isNewTab: boolean; // 改为必需，处理程序中提供默认值 false
      timestamp: number; // 改为必需，处理程序中提供默认值 Date.now()
    };
  }

  /**
   * 表单提交请求
   */
  export interface FormSubmittedRequest extends BaseMessage {
    action: 'formSubmitted';
    target: 'background';
    formInfo: {
      sourcePageId: string;
      sourceUrl: string;
      formAction: string;
      formMethod: string;
      formData: Record<string, string>; // 改为必需，处理程序中提供默认值 {}
      timestamp: number; // 改为必需，处理程序中提供默认值 Date.now()
    };
  }

  /**
   * 获取历史记录请求
   * filter 和 limit 应保持可选，因为它们是过滤条件
   */
  export interface GetHistoryRequest extends BaseMessage {
    action: 'getHistory';
    target: 'background';
    filter?: string;
    limit?: number;
  }

  /**
   * 获取图形数据请求
   * nodeId 和 depth 应保持可选，因为它们是过滤条件
   */
  export interface GetGraphDataRequest extends BaseMessage {
    action: 'getGraphData';
    target: 'background';
    nodeId?: string;
    depth?: number;
  }

  /**
   * 保存设置请求
   */
  export interface SaveSettingsRequest extends BaseMessage {
    action: 'saveSettings';
    target: 'background';
    settings: Record<string, any>; // 更具体的类型，而不是just any
  }

  /**
   * 加载设置请求
   */
  export interface LoadSettingsRequest extends BaseMessage {
    action: 'loadSettings';
    target: 'background';
  }

  /**
   * 重置设置请求
   */
  export interface ResetSettingsRequest extends BaseMessage {
    action: 'resetSettings';
    target: 'background';
  }

  /**
   * 获取设置请求
   */
  export interface GetSettingsRequest extends BaseMessage {
    action: 'getSettings';
    target: 'background';
  }

  /**
   * JavaScript导航请求
   */
  export interface JsNavigationRequest extends BaseMessage {
    action: 'jsNavigation';
    target: 'background';
    sourcePageId: string;
    sourceUrl: string;
    targetUrl: string;
    timestamp: number; // 改为必需，处理程序中提供默认值 Date.now()
  }

  /**
   * 获取会话列表请求
   */
  export interface GetSessionsRequest extends BaseMessage {
    action: 'getSessions';
    target: 'background';
    options?: SessionQueryOptions;
  }

  /**
   * 获取会话详情请求
   */
  export interface GetSessionDetailsRequest extends BaseMessage {
    action: 'getSessionDetails';
    target: 'background';
    sessionId: string;
  }

  /**
   * 创建会话请求
   */
  export interface CreateSessionRequest extends BaseMessage {
    action: 'createSession';
    target: 'background';
    options?: SessionCreationOptions;
  }

  /**
   * 更新会话请求
   */
  export interface UpdateSessionRequest extends BaseMessage {
    action: 'updateSession';
    target: 'background';
    sessionId: string;
    updates: SessionUpdateOptions;
  }

  /**
   * 结束会话请求
   */
  export interface EndSessionRequest extends BaseMessage {
    action: 'endSession';
    target: 'background';
    sessionId: string;
  }

  /**
   * 设置当前会话请求
   */
  export interface SetCurrentSessionRequest extends BaseMessage {
    action: 'setCurrentSession';
    target: 'background';
    sessionId: string;
  }

  /**
   * 获取当前会话请求
   */
  export interface GetCurrentSessionRequest extends BaseMessage {
    action: 'getCurrentSession';
    target: 'background';
  }

  /**
   * 删除会话请求
   */
  export interface DeleteSessionRequest extends BaseMessage {
    action: 'deleteSession';
    target: 'background';
    sessionId: string;
    confirm: boolean; // 安全措施，要求显式确认删除
  }

  /**
   * 获取会话统计信息请求
   */
  export interface GetSessionStatsRequest extends BaseMessage {
    action: 'getSessionStats';
    target: 'background';
    sessionId: string;
  }

  /**
   * 活动标记请求
   */
  export interface MarkSessionActivityRequest extends BaseMessage {
    action: 'markSessionActivity';
  }
}

// 对应的响应类型（省略实现细节）
export namespace BackgroundResponses {
  export interface GetTabIdResponse extends BaseResponse {
    tabId?: number;
  }

  export interface GetNodeIdResponse extends BaseResponse {
    nodeId?: string;
  }

  /**
   * JavaScript导航响应
   */
  export interface JsNavigationResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 加载设置响应
   */
  export interface LoadSettingsResponse extends BaseResponse {
    settings?: any; // NavigraphSettings
  }

  /**
   * 保存设置响应
   */
  export interface SaveSettingsResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 重置设置响应
   */
  export interface ResetSettingsResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 获取设置响应
   */
  export interface GetSettingsResponse extends BaseResponse {
    settings: Record<string, any>; // 不使用可选参数，确保始终有值
  }

  /**
   * 页面活动响应
   */
  export interface PageActivityResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 获取历史响应
   */
  export interface GetHistoryResponse extends BaseResponse {
    history?: any[];
  }

  /**
   * 获取图形数据响应
   */
  export interface GetGraphDataResponse extends BaseResponse {
    graphData?: any;
  }

  /**
   * 表单提交响应
   */
  export interface FormSubmittedResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 链接点击响应
   */
  export interface LinkClickedResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 页面加载响应
   */
  export interface PageLoadedResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 页面标题更新响应
   */
  export interface PageTitleUpdatedResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 网站图标更新响应
   */
  export interface FaviconUpdatedResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 获取会话列表响应
   */
  export interface GetSessionsResponse extends BaseResponse {
    sessions: Array<{
      id: string;
      title: string;
      startTime: number;
      endTime?: number;
      isActive: boolean;
      nodeCount: number;
      recordCount: number; // 兼容旧代码
    }>;
  }

  /**
   * 获取会话详情响应
   */
  export interface GetSessionDetailsResponse extends BaseResponse {
    session?: BrowsingSession;
  }

  /**
   * 创建会话响应
   */
  export interface CreateSessionResponse extends BaseResponse {
    session: BrowsingSession;
  }

  /**
   * 更新会话响应
   */
  export interface UpdateSessionResponse extends BaseResponse {
    session: BrowsingSession;
  }

  /**
   * 结束会话响应
   */
  export interface EndSessionResponse extends BaseResponse {
    sessionId: string;
    session?: BrowsingSession;
  }

  /**
   * 设置当前会话响应
   */
  export interface SetCurrentSessionResponse extends BaseResponse {
    sessionId: string;
    session?: BrowsingSession;
  }

  /**
   * 获取当前会话响应
   */
  export interface GetCurrentSessionResponse extends BaseResponse {
    sessionId: string | null;
    session?: BrowsingSession;
  }

  /**
   * 删除会话响应
   */
  export interface DeleteSessionResponse extends BaseResponse {
    sessionId: string;
  }

  /**
   * 获取会话统计信息响应
   */
  export interface GetSessionStatsResponse extends BaseResponse {
    sessionId: string;
    statistics: SessionStatistics;
  }

  /**
   * 活动标记响应
   */
  export interface MarkSessionActivityResponse extends BaseResponse {
    // 无额外字段
  }
}

/**
 * 后台API消息映射
 */
export interface BackgroundAPI {
  getTabId: {
    request: BackgroundMessages.GetTabIdRequest;
    response: BackgroundResponses.GetTabIdResponse;
  };

  getNodeId: {
    request: BackgroundMessages.GetNodeIdRequest;
    response: BackgroundResponses.GetNodeIdResponse;
  };

  jsNavigation: {
    request: BackgroundMessages.JsNavigationRequest;
    response: BackgroundResponses.JsNavigationResponse;
  };

  loadSettings: {
    request: BackgroundMessages.LoadSettingsRequest;
    response: BackgroundResponses.LoadSettingsResponse;
  };

  saveSettings: {
    request: BackgroundMessages.SaveSettingsRequest;
    response: BackgroundResponses.SaveSettingsResponse;
  };

  resetSettings: {
    request: BackgroundMessages.ResetSettingsRequest;
    response: BackgroundResponses.ResetSettingsResponse;
  };

  getSettings: {
    request: BackgroundMessages.GetSettingsRequest;
    response: BackgroundResponses.GetSettingsResponse;
  };

  pageLoaded: {
    request: BackgroundMessages.PageLoadedRequest;
    response: BackgroundResponses.PageLoadedResponse;
  };

  pageTitleUpdated: {
    request: BackgroundMessages.PageTitleUpdatedRequest;
    response: BackgroundResponses.PageTitleUpdatedResponse;
  };

  faviconUpdated: {
    request: BackgroundMessages.FaviconUpdatedRequest;
    response: BackgroundResponses.FaviconUpdatedResponse;
  };

  pageActivity: {
    request: BackgroundMessages.PageActivityRequest;
    response: BackgroundResponses.PageActivityResponse;
  };

  linkClicked: {
    request: BackgroundMessages.LinkClickedRequest;
    response: BackgroundResponses.LinkClickedResponse;
  };

  formSubmitted: {
    request: BackgroundMessages.FormSubmittedRequest;
    response: BackgroundResponses.FormSubmittedResponse;
  };

  getHistory: {
    request: BackgroundMessages.GetHistoryRequest;
    response: BackgroundResponses.GetHistoryResponse;
  };

  getGraphData: {
    request: BackgroundMessages.GetGraphDataRequest;
    response: BackgroundResponses.GetGraphDataResponse;
  };

  getSessions: {
    request: BackgroundMessages.GetSessionsRequest;
    response: BackgroundResponses.GetSessionsResponse;
  };

  getSessionDetails: {
    request: BackgroundMessages.GetSessionDetailsRequest;
    response: BackgroundResponses.GetSessionDetailsResponse;
  };

  createSession: {
    request: BackgroundMessages.CreateSessionRequest;
    response: BackgroundResponses.CreateSessionResponse;
  };

  updateSession: {
    request: BackgroundMessages.UpdateSessionRequest;
    response: BackgroundResponses.UpdateSessionResponse;
  };

  endSession: {
    request: BackgroundMessages.EndSessionRequest;
    response: BackgroundResponses.EndSessionResponse;
  };

  setCurrentSession: {
    request: BackgroundMessages.SetCurrentSessionRequest;
    response: BackgroundResponses.SetCurrentSessionResponse;
  };

  getCurrentSession: {
    request: BackgroundMessages.GetCurrentSessionRequest;
    response: BackgroundResponses.GetCurrentSessionResponse;
  };

  deleteSession: {
    request: BackgroundMessages.DeleteSessionRequest;
    response: BackgroundResponses.DeleteSessionResponse;
  };

  getSessionStats: {
    request: BackgroundMessages.GetSessionStatsRequest;
    response: BackgroundResponses.GetSessionStatsResponse;
  };

  markSessionActivity: {
    request: BackgroundMessages.MarkSessionActivityRequest;
    response: BackgroundResponses.MarkSessionActivityResponse;
  };
}

// 更新总类型
export type BackgroundRequest = 
  | BackgroundMessages.GetSessionsRequest
  | BackgroundMessages.GetTabIdRequest
  | BackgroundMessages.GetNodeIdRequest
  | BackgroundMessages.JsNavigationRequest
  | BackgroundMessages.LoadSettingsRequest
  | BackgroundMessages.SaveSettingsRequest
  | BackgroundMessages.ResetSettingsRequest
  | BackgroundMessages.GetSettingsRequest
  | BackgroundMessages.PageLoadedRequest
  | BackgroundMessages.PageTitleUpdatedRequest
  | BackgroundMessages.PageActivityRequest
  | BackgroundMessages.LinkClickedRequest
  | BackgroundMessages.FormSubmittedRequest
  | BackgroundMessages.GetHistoryRequest
  | BackgroundMessages.GetGraphDataRequest
  | BackgroundMessages.GetSessionDetailsRequest
  | BackgroundMessages.CreateSessionRequest
  | BackgroundMessages.UpdateSessionRequest
  | BackgroundMessages.EndSessionRequest
  | BackgroundMessages.SetCurrentSessionRequest
  | BackgroundMessages.GetCurrentSessionRequest
  | BackgroundMessages.DeleteSessionRequest
  | BackgroundMessages.GetSessionStatsRequest
  | BackgroundMessages.MarkSessionActivityRequest;

export type BackgroundResponse =
  | BackgroundResponses.GetSessionsResponse
  | BackgroundResponses.GetTabIdResponse
  | BackgroundResponses.GetNodeIdResponse
  | BackgroundResponses.JsNavigationResponse
  | BackgroundResponses.LoadSettingsResponse
  | BackgroundResponses.SaveSettingsResponse
  | BackgroundResponses.ResetSettingsResponse
  | BackgroundResponses.GetSettingsResponse
  | BackgroundResponses.PageLoadedResponse
  | BackgroundResponses.PageTitleUpdatedResponse
  | BackgroundResponses.PageActivityResponse
  | BackgroundResponses.LinkClickedResponse
  | BackgroundResponses.FormSubmittedResponse
  | BackgroundResponses.GetHistoryResponse
  | BackgroundResponses.GetGraphDataResponse
  | BackgroundResponses.GetSessionDetailsResponse
  | BackgroundResponses.CreateSessionResponse
  | BackgroundResponses.UpdateSessionResponse
  | BackgroundResponses.EndSessionResponse
  | BackgroundResponses.SetCurrentSessionResponse
  | BackgroundResponses.GetCurrentSessionResponse
  | BackgroundResponses.DeleteSessionResponse
  | BackgroundResponses.GetSessionStatsResponse
  | BackgroundResponses.MarkSessionActivityResponse;