/**
 * 渲染器基础接口
 * 定义所有可视化渲染器必须实现的方法
 */
import { NavNode, NavLink, Visualizer } from '../../types/navigation.js';

export interface BaseRenderer {
  /**
   * 初始化渲染器
   * @param svg SVG元素或选择器
   * @param container 容器元素
   * @param width 视图宽度
   * @param height 视图高度
   */
  initialize(svg: any, container: HTMLElement, width: number, height: number): void;
  
  /**
   * 渲染可视化视图
   * @param nodes 节点数据
   * @param edges 边数据
   * @param options 渲染选项
   */
  render(nodes: NavNode[], edges: NavLink[], options?: any): void;
  
  /**
   * 清理资源
   */
  cleanup(): void;
}