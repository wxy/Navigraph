/**
 * 渲染器工厂
 * 根据视图类型创建相应的渲染器
 */
import { Logger } from '../../../lib/utils/logger.js';
import { _, _Error } from '../../../lib/utils/i18n.js';
import { Visualizer } from '../../types/navigation.js';
import { BaseRenderer } from './BaseRenderer.js';
import { TreeRenderer } from './TreeRenderer.js';
import { TimelineRenderer } from './TimelineRenderer.js';

const logger = new Logger('RendererFactory');

export class RendererFactory {
  /**
   * 创建渲染器
   * @param viewType 视图类型
   * @param visualizer 可视化器实例
   * @returns 相应类型的渲染器
   */
  static createRenderer(viewType: 'tree' | 'timeline', visualizer: Visualizer): BaseRenderer {
    logger.log(_('renderer_factory_create_renderer', '创建 {0} 渲染器'));
    
    switch (viewType) {
      case 'tree':
        return new TreeRenderer(visualizer);
      case 'timeline':
        return new TimelineRenderer(visualizer);
      default:
        logger.warn(_('renderer_factory_unknown_type', '未知视图类型: {0}，使用默认树形渲染器'));
        return new TreeRenderer(visualizer);
    }
  }
}