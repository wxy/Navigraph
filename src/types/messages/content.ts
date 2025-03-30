import { BaseMessage, BaseResponse } from './common.js';

export namespace ContentMessages {
  /**
   * 更新UI请求
   */
  export interface UpdateUIRequest extends BaseMessage {
    action: 'updateUI';
    target: 'content';
    data: any; // UI更新数据
  }

  /**
   * 显示通知请求
   */
  export interface ShowNotificationRequest extends BaseMessage {
    action: 'showNotification';
    target: 'content';
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
  }

  /**
   * 刷新可视化器请求
   * 用于刷新可视化界面（替代之前的updateUI）
   */
  export interface RefreshVisualizerRequest extends BaseMessage {
    action: 'refreshVisualizer';
    target: 'content';
    data?: any; // 可选的更新数据
  }
  
  /**
   * 页面活动请求
   */
  export interface PageActivityRequest extends BaseMessage {
    action: 'pageActivity';
    target: 'content';
    source?: string;
    timestamp?: number;
  }

  /**
   * 请求节点ID请求
   * 内部使用，用于获取当前页面节点ID
   */
  export interface RequestNodeIdRequest extends BaseMessage {
    action: 'requestNodeId';
    target: 'content';
  }
}

export namespace ContentResponses {
  /**
   * 更新UI响应
   */
  export interface UpdateUIResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 显示通知响应
   */
  export interface ShowNotificationResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 刷新可视化器响应
   */
  export interface RefreshVisualizerResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }
  
  /**
   * 页面活动响应
   */
  export interface PageActivityResponse extends BaseResponse {
    // 基本的成功/失败信息已包含在BaseResponse中
  }

  /**
   * 请求节点ID响应
   */
  export interface RequestNodeIdResponse extends BaseResponse {
    nodeId: string | null;
  }
}

/**
 * 内容脚本API消息映射
 */
export interface ContentAPI {
  updateUI: {
    request: ContentMessages.UpdateUIRequest;
    response: ContentResponses.UpdateUIResponse;
  };
  
  showNotification: {
    request: ContentMessages.ShowNotificationRequest;
    response: ContentResponses.ShowNotificationResponse;
  };
  
  refreshVisualizer: {
    request: ContentMessages.RefreshVisualizerRequest;
    response: ContentResponses.RefreshVisualizerResponse;
  };
  
  pageActivity: {
    request: ContentMessages.PageActivityRequest;
    response: ContentResponses.PageActivityResponse;
  };

  requestNodeId: {
    request: ContentMessages.RequestNodeIdRequest;
    response: ContentResponses.RequestNodeIdResponse;
  };
}