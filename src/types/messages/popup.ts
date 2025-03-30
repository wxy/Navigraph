import { BaseMessage, BaseResponse } from './common.js';

export namespace PopupMessages {
  /**
   * 获取统计数据请求
   */
  export interface GetStatsRequest extends BaseMessage {
    action: 'getStats';
    target: 'background'; // 由后台处理
    period?: 'day' | 'week' | 'month' | 'all';
  }

  /**
   * 更新弹出窗口数据请求
   */
  export interface UpdatePopupDataRequest extends BaseMessage {
    action: 'updatePopupData';
    target: 'popup';
    data: any; // PopupData
  }

  // 可以在这里添加更多弹出窗口消息类型
}

export namespace PopupResponses {
  /**
   * 获取统计数据响应
   */
  export interface GetStatsResponse extends BaseResponse {
    stats?: {
      visitedPages: number;
      totalTime: number;
      topDomains: Array<{domain: string, visits: number}>;
    };
  }

  /**
   * 更新弹出窗口数据响应
   */
  export interface UpdatePopupDataResponse extends BaseResponse {
    // 成功/失败信息已包含在BaseResponse中
  }

  // 可以在这里添加更多弹出窗口响应类型
}

/**
 * 弹出窗口API消息映射
 */
export interface PopupAPI {
  getStats: {
    request: PopupMessages.GetStatsRequest;
    response: PopupResponses.GetStatsResponse;
  };

  updatePopupData: {
    request: PopupMessages.UpdatePopupDataRequest;
    response: PopupResponses.UpdatePopupDataResponse;
  };

  // 添加其他弹出窗口API...
}