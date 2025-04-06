import { Logger } from '../../../lib/utils/logger.js';

const logger = new Logger('LoadingIndicator');

/**
 * 加载指示器组件
 * 负责展示加载状态
 */
export class LoadingIndicator {
  private loadingElement: HTMLElement | null = null;
  private loadingOverlay: HTMLElement | null = null;
  private isVisible: boolean = false;
  private loadingTimeoutId: number | null = null;
  
  /**
   * 初始化加载指示器
   */
  public initialize(): void {
    // 查找或创建加载指示器元素
    this.loadingElement = document.getElementById('loading-indicator');
    this.loadingOverlay = document.getElementById('loading-overlay');
    
    // 如果元素不存在，需要创建它们
    if (!this.loadingElement) {
      this.createLoadingElements();
    }
    
    logger.log('加载指示器已初始化');
  }
  
  /**
   * 创建加载指示器元素
   */
  private createLoadingElements(): void {
    // 创建覆盖层
    this.loadingOverlay = document.createElement('div');
    this.loadingOverlay.id = 'loading-overlay';
    this.loadingOverlay.style.display = 'none';
    document.body.appendChild(this.loadingOverlay);
    
    // 创建加载指示器
    this.loadingElement = document.createElement('div');
    this.loadingElement.id = 'loading-indicator';
    this.loadingElement.style.display = 'none';
    
    // 添加加载动画
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    this.loadingElement.appendChild(spinner);
    
    // 添加加载文本
    const loadingText = document.createElement('div');
    loadingText.className = 'loading-text';
    loadingText.textContent = '加载中...';
    this.loadingElement.appendChild(loadingText);
    
    document.body.appendChild(this.loadingElement);
  }
  
  /**
   * 显示加载指示器
   * @param message 可选的加载消息
   * @param showOverlay 是否显示遮罩层
   */
  public show(message?: string, showOverlay: boolean = true): void {
    if (!this.loadingElement) {
      this.initialize();
    }
    
    // 如果已经在显示，先清除当前计时器
    if (this.loadingTimeoutId) {
      window.clearTimeout(this.loadingTimeoutId);
      this.loadingTimeoutId = null;
    }
    
    // 设置加载消息
    if (message) {
      const textElement = this.loadingElement?.querySelector('.loading-text');
      if (textElement) {
        textElement.textContent = message;
      }
    }
    
    // 显示加载指示器
    if (this.loadingElement) {
      this.loadingElement.style.display = 'flex';
    }
    
    // 显示遮罩层
    if (showOverlay && this.loadingOverlay) {
      this.loadingOverlay.style.display = 'block';
    }
    
    this.isVisible = true;
    
    logger.log(`显示加载指示器${message ? `: ${message}` : ''}`);
    
    // 设置安全超时，防止加载状态卡住
    this.loadingTimeoutId = window.setTimeout(() => {
      this.hide();
      logger.warn('加载超时，自动隐藏加载指示器');
    }, 30000); // 30秒超时
  }
  
  /**
   * 隐藏加载指示器
   */
  public hide(): void {
    // 隐藏加载指示器
    if (this.loadingElement) {
      this.loadingElement.style.display = 'none';
    }
    
    // 隐藏遮罩层
    if (this.loadingOverlay) {
      this.loadingOverlay.style.display = 'none';
    }
    
    // 清除超时计时器
    if (this.loadingTimeoutId) {
      window.clearTimeout(this.loadingTimeoutId);
      this.loadingTimeoutId = null;
    }
    
    this.isVisible = false;
    
    logger.log('隐藏加载指示器');
  }
  
  /**
   * 检查加载指示器是否可见
   */
  public isLoading(): boolean {
    return this.isVisible;
  }
}