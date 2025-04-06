import { Logger } from '../../../lib/utils/logger.js';
import type { Visualizer } from '../../types/navigation.js';
import { BaseRenderer } from './BaseRenderer.js';
import { TreeRenderer } from './TreeRenderer.js';
import { TimelineRenderer } from './TimelineRenderer.js';

const logger = new Logger('RendererFactory');

/**
 * 渲染器工厂类
 * 负责创建不同类型的渲染器
 */
export class RendererFactory {
  /**
   * 创建渲染器
   * @param type 渲染器类型
   * @param visualizer 可视化器实例
   * @returns 对应类型的渲染器实例
   */
  static createRenderer(type: 'tree' | 'timeline', visualizer: Visualizer): BaseRenderer {
    logger.log(`创建渲染器: ${type}`);
    
    switch(type) {
      case 'tree':
        return new TreeRenderer(visualizer);
      case 'timeline':
        return new TimelineRenderer(visualizer);
      default:
        logger.error(`不支持的渲染器类型: ${type}`);
        return new TreeRenderer(visualizer); // 默认返回树形图渲染器
    }
  }
}