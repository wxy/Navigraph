import { Logger } from '../../../lib/utils/logger.js';
import { SessionManager } from '../session-manager.js';
import { SessionStrategy } from './session-strategy.js';
import { DailySessionStrategy } from './daily-session.js';
// 导入其他策略...

const logger = new Logger('SessionStrategyFactory');

/**
 * 会话策略工厂
 * 管理和提供不同的会话策略
 */
export class SessionStrategyFactory {
  private manager: SessionManager;
  private strategies: Map<string, SessionStrategy> = new Map();
  private activeStrategyType: string = 'daily'; // 默认策略
  
  constructor(manager: SessionManager) {
    this.manager = manager;
    this.initializeStrategies();
  }
  
  /**
   * 初始化所有支持的策略
   */
  private initializeStrategies(): void {
    // 添加每日会话策略
    const dailyStrategy = new DailySessionStrategy(this.manager);
    this.strategies.set(dailyStrategy.getType(), dailyStrategy);
    
    // 添加其他策略...
    
    logger.log(`已初始化${this.strategies.size}个会话策略`);
  }
  
  /**
   * 设置活跃策略
   */
  public setActiveStrategy(strategyType: string): void {
    if (this.activeStrategyType === strategyType) return;
    
    if (this.strategies.has(strategyType)) {
      const oldType = this.activeStrategyType;
      this.activeStrategyType = strategyType;
      logger.log(`会话策略已从${oldType}切换为${strategyType}`);
    } else {
      logger.warn(`未找到策略类型: ${strategyType}，保持当前策略: ${this.activeStrategyType}`);
    }
  }
  
  /**
   * 获取当前活跃策略
   */
  public getActiveStrategy(): SessionStrategy {
    const strategy = this.strategies.get(this.activeStrategyType);
    if (!strategy) {
      // 回退到默认策略
      return this.strategies.get('daily')!;
    }
    return strategy;
  }
}