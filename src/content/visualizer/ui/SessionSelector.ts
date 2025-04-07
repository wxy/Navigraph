import { Logger } from '../../../lib/utils/logger.js';
import type { Visualizer } from '../../types/navigation.js';
import type { BrowsingSession } from '../../types/session.js';
import { sessionServiceClient } from '../../core/session-service-client.js';

const logger = new Logger('SessionSelector');

/**
 * 会话选择器
 * 负责管理会话的选择和切换
 */
export class SessionSelector {
  private visualizer: Visualizer;
  private selectorElement: HTMLSelectElement | null = null;
  private currentSessionId: string | null = null;
  
  constructor(visualizer: Visualizer) {
    this.visualizer = visualizer;
  }
  
  /**
   * 初始化会话选择器
   */
  public initialize(): void {
    this.selectorElement = document.getElementById('session-selector') as HTMLSelectElement;
    
    if (!this.selectorElement) {
      logger.warn('会话选择器元素未找到');
      return;
    }
    
    // 添加会话选择事件监听
    this.selectorElement.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement;
      const selectedSessionId = target.value;
      
      if (selectedSessionId !== this.currentSessionId) {
        logger.log(`选择会话: ${selectedSessionId}`);
        this.selectSession(selectedSessionId);
      }
    });
    
    logger.log('会话选择器已初始化');
  }
  
  /**
   * 选择会话
   * @param sessionId 会话ID
   */
  private selectSession(sessionId: string): void {
    if (!sessionId) {
      logger.warn('会话ID为空，无法选择');
      return;
    }
    
    // 更新当前会话ID
    this.currentSessionId = sessionId;
    
    // 调用会话管理器的获取会话方法
    sessionServiceClient.loadSession(sessionId)
      .then(() => {
        logger.log('会话加载完成');
      })
      .catch(error => {
        logger.error('加载会话失败:', error);
      });
  }
  
  /**
   * 更新会话选择器
   * @param sessions 会话列表
   * @param currentSessionId 当前选中的会话ID
   */
  public update(sessions: BrowsingSession[] = [], currentSessionId?: string): void {
    if (!this.selectorElement) {
      return;
    }
    
    // 清空现有选项
    this.selectorElement.innerHTML = '';
    
    if (sessions.length === 0) {
      // 添加提示选项
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '没有可用会话';
      option.disabled = true;
      this.selectorElement.appendChild(option);
      
      logger.log('会话列表为空');
      return;
    }
    
    // 添加新选项
    sessions.forEach(session => {
      const option = document.createElement('option');
      option.value = session.id;
      
      // 格式化会话名称：添加时间信息
      const date = new Date(session.startTime);
      const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      
      option.textContent = `${session.title || '未命名会话'}`;
      this.selectorElement?.appendChild(option);
    });
    
    // 设置当前选中的会话
    if (currentSessionId) {
      this.selectorElement.value = currentSessionId;
      this.currentSessionId = currentSessionId;
    } else if (sessions.length > 0) {
      // 如果没有指定当前会话，默认选择第一个
      this.selectorElement.value = sessions[0].id;
      this.currentSessionId = sessions[0].id;
    }
    
    logger.log(`会话选择器已更新，共${sessions.length}个会话`);
  }
}