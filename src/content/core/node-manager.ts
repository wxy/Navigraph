/**
 * 节点管理模块
 * 负责处理节点和边的数据转换与关系管理
 */
import type { SessionDetails, NodeRecord, EdgeRecord } from '../types/session.js';
import type { NavNode, NavLink } from '../types/navigation.js';

export class NodeManager {
  private nodes: NavNode[] = [];
  private edges: NavLink[] = [];
  private nodeMap: Map<string, NavNode> = new Map();

  /**
   * 将NodeRecord转换为NavNode
   */
  private convertToNavNode(record: NodeRecord): NavNode {
    return {
      id: record.id,
      timestamp: record.timestamp,
      type: record.navigationType || 'unknown',
      title: record.title || this.extractTitle(record.url),
      url: record.url,
      favicon: record.favicon,
      isClosed: record.isClosed || false,
      // 额外属性使用索引签名添加
      tabId: record.tabId,
      parentId: record.parentId === record.id ? null : record.parentId,
      referrer: record.referrer || '',
      // 内部使用的额外属性
      children: [] as NavNode[],
      depth: 0,
      // 其他属性...
    };
  }

  /**
   * 将EdgeRecord转换为NavLink
   */
  private convertToNavLink(edge: EdgeRecord): NavLink {
    return {
      source: edge.sourceId,
      target: edge.targetId,
      type: edge.action || 'unknown',
      // 额外属性使用索引签名添加
      id: edge.id,
      timestamp: edge.timestamp,
      action: edge.action
    };
  }

  /**
   * 从会话数据构建节点和边
   */
  processSessionData(session: SessionDetails): void {
    if (!session) return;
    
    console.log('开始处理会话数据...');
    
    try {
      // 记录存储
      const records = session.records || {};
      const recordIds = Object.keys(records);
      
      console.log(`处理${recordIds.length}条记录`);
      
      // 转换为节点数组
      this.nodes = recordIds.map(id => this.convertToNavNode(records[id]));
      
      // 重建父子关系
      this.reconstructParentChildRelationships();
      
      // 计算节点深度
      this.calculateNodeDepths();
      
      // 获取所有边
      const edgeMap = session.edges || {};
      const edgeIds = Object.keys(edgeMap);
      
      console.log(`处理${edgeIds.length}条边`);
      
      // 转换为边数组
      this.edges = edgeIds.map(id => this.convertToNavLink(edgeMap[id]));
      
      // 构建节点映射表
      this.buildNodeMap();

      // 添加基于重构的父子关系创建附加边
      this.enhanceEdgesFromParentChildRelationships();
      
      console.log('会话数据处理完成');
      console.log('节点:', this.nodes.length);
      console.log('边:', this.edges.length);
    } catch (error) {
      console.error('处理会话数据失败:', error);
      this.nodes = [];
      this.edges = [];
      this.nodeMap.clear();
    }
  }

  /**
   * 构建节点ID到节点对象的映射表，优化查询性能
   */
  private buildNodeMap(): void {
    this.nodeMap.clear();
    if (this.nodes && this.nodes.length) {
      this.nodes.forEach(node => {
        this.nodeMap.set(node.id, node);
      });
    }
    console.log(`已建立${this.nodeMap.size}个节点的索引`);
  }

  /**
   * 重建父子关系
   */
  private reconstructParentChildRelationships(): void {
    console.log('开始重建父子关系...');
    
    // 创建节点ID映射，便于快速查找
    const nodesById: {[key: string]: NavNode} = {};
    this.nodes.forEach(node => {
      nodesById[node.id] = node;
    });
    
    // 按标签页和时间排序
    const nodesByTabId: {[key: string]: NavNode[]} = {};
    this.nodes.forEach(node => {
      const tabId = node.tabId as string | undefined;
      if (!tabId) return;
      
      if (!nodesByTabId[tabId]) {
        nodesByTabId[tabId] = [];
      }
      nodesByTabId[tabId].push(node);
    });
    
    // 对每个标签页的节点按时间排序
    Object.keys(nodesByTabId).forEach(tabId => {
      nodesByTabId[tabId].sort((a, b) => a.timestamp - b.timestamp);
    });
    
    let assignedCount = 0;
    
    // 首先按照时间顺序处理所有节点 - 模拟实际导航序列
    const sortedNodes = [...this.nodes].sort((a, b) => a.timestamp - b.timestamp);
    
    // 跟踪每个标签页当前活跃的节点
    const activeNodesByTabId: {[key: string]: NavNode} = {};
    
    // 遍历所有节点，按时间顺序模拟导航过程
    sortedNodes.forEach(node => {
      // 如果已有有效的父节点引用，保留它
      const parentId = node.parentId as string | null | undefined;
      if (parentId && nodesById[parentId] && parentId !== node.id) {
        assignedCount++;
        return;
      }
      
      // 自循环检测 - 将自引用修正为根节点
      if (node.parentId === node.id) {
        console.log(`节点 ${node.id} 是自循环，修正为根节点`);
        node.parentId = null;
        return;
      }
      
      // 获取导航类型
      const navigationType = node.type;
      
      // 根据导航类型确定父节点
      switch(navigationType) {
        case 'link_click':
          // 链接点击通常来自同一标签页的前一个节点
          const tabId = node.tabId as string | undefined;
          if (!tabId) break;
          
          const sameTabNodes = nodesByTabId[tabId] || [];
          const nodeIndex = sameTabNodes.findIndex(n => n.id === node.id);
          
          // 如果在同一标签页中有前一个节点，将其设为父节点
          if (nodeIndex > 0) {
            node.parentId = sameTabNodes[nodeIndex - 1].id;
            assignedCount++;
          }
          break;
          
        case 'address_bar':
          // 地址栏输入通常是新的导航序列，可能没有父节点
          // 但如果是在现有标签页中输入，可能与前一页有关
          const nodeTabId = node.tabId as string | undefined;
          if (nodeTabId && activeNodesByTabId[nodeTabId]) {
            node.parentId = activeNodesByTabId[nodeTabId].id;
            assignedCount++;
          } else {
            node.parentId = null; // 新标签页的第一次导航
          }
          break;
          
        case 'form_submit':
          // 表单提交通常来自同一标签页的前一个节点
          const formTabId = node.tabId as string | undefined;
          if (formTabId && activeNodesByTabId[formTabId]) {
            node.parentId = activeNodesByTabId[formTabId].id;
            assignedCount++;
          }
          break;
          
        case 'history_back':
        case 'history_forward':
          // 历史导航指向同一标签页中的某个节点
          // 这种情况较复杂，暂时保持当前处理方式
          break;
          
        case 'reload':
          // 刷新操作应该保持当前节点，不改变父子关系
          // 已在上面处理了自循环情况
          break;
          
        default:
          // 对于其他类型，查找直接的导航关系
          // 用边信息补充 - 这是原始记录的实际导航关系
          if (this.edges) {
            const directEdges = this.edges.filter(e => 
              (e.target === node.id) && 
              (e.type !== 'generated') // 跳过推断生成的边
            );
            
            if (directEdges.length > 0) {
              // 优先使用最近的边
              directEdges.sort((a, b) => {
                const aTime = a.timestamp || 0;
                const bTime = b.timestamp || 0;
                return bTime - aTime;
              });
              node.parentId = directEdges[0].source;
              assignedCount++;
            }
          }
          break;
      }
      
      // 更新当前标签页的活跃节点
      const nodeTabId = node.tabId as string | undefined;
      if (nodeTabId) {
        activeNodesByTabId[nodeTabId] = node;
      }
    });
    
    // 重新构建子节点引用
    this.nodes.forEach(node => {
      (node as any).children = [];
    });
    
    // 填充子节点数组
    this.nodes.forEach(node => {
      const parentId = node.parentId as string | undefined;
      if (parentId && nodesById[parentId]) {
        (nodesById[parentId] as any).children.push(node);
      }
    });
    
    console.log(`父子关系重建完成: ${assignedCount}/${this.nodes.length} 节点有父节点`);
  }
  
  /**
   * 计算节点深度
   */
  private calculateNodeDepths(): void {
    try {
      // 首先找出所有根节点
      const rootNodes = this.nodes.filter(node => !node.parentId);
      
      if (rootNodes.length === 0) {
        console.warn('没有找到根节点，设置所有节点深度为0');
        this.nodes.forEach(node => (node as any).depth = 0);
        return;
      }
      
      // 为每个根节点及其子节点计算深度
      rootNodes.forEach(rootNode => {
        (rootNode as any).depth = 0;
        this.calculateChildDepths(rootNode, 1);
      });
    } catch (error) {
      console.error('计算节点深度失败:', error);
      // 出错时确保所有节点至少有深度值
      this.nodes.forEach(node => {
        if (typeof (node as any).depth === 'undefined') (node as any).depth = 0;
      });
    }
  }
  
  /**
   * 递归计算子节点深度
   */
  private calculateChildDepths(parentNode: NavNode, depth: number): void {
    if (!parentNode || !parentNode.id) return;
    
    // 找出父节点的所有直接子节点
    const childNodes = this.nodes.filter(node => 
      node.parentId === parentNode.id && node.id !== parentNode.id
    );
    
    // 设置子节点深度并递归处理
    childNodes.forEach(childNode => {
      (childNode as any).depth = depth;
      // 防止循环引用导致栈溢出
      if (childNode.id !== parentNode.id) {
        this.calculateChildDepths(childNode, depth + 1);
      }
    });
  }
  
  /**
   * 根据重构的父子关系增强边集合
   */
  private enhanceEdgesFromParentChildRelationships(): void {
    // 创建现有边的映射
    const existingEdgeMap: {[key: string]: boolean} = {};
    this.edges.forEach(edge => {
      const source = edge.source;
      const target = edge.target;
      const key = `${source}#${target}`;
      existingEdgeMap[key] = true;
    });
    
    // 为缺失的父子关系创建新边
    const newEdges: NavLink[] = [];
    this.nodes.forEach(node => {
      const parentId = node.parentId as string | undefined;
      if (parentId) {
        const source = parentId;
        const target = node.id;
        const key = `${source}#${target}`;
        
        // 如果这个关系的边不存在，添加一个新的
        if (!existingEdgeMap[key] && this.nodeMap.has(source)) {
          newEdges.push({
            source: source,
            target: target,
            type: node.type || 'unknown',
            // 额外属性
            id: `generated-${key}`,
            timestamp: node.timestamp,
            action: node.type || 'unknown',
            generated: true // 标记为生成的边
          });
        }
      }
    });
    
    if (newEdges.length > 0) {
      console.log(`添加了${newEdges.length}条生成的边`);
      this.edges = [...this.edges, ...newEdges];
    }
  }
    
  /**
   * 从URL中提取标题
   * 当节点没有原始标题时，尝试从URL中提取有意义的信息作为标题
   */
  private extractTitle(url: string): string {
    try {
      if (!url) return '未知页面';
      
      // 解析URL
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (e) {
        // 处理无效URL
        return url.substring(0, 30);
      }
      
      // 获取不带www的主机名
      const hostname = parsedUrl.hostname.replace(/^www\./, '');
      
      // 如果URL只有域名，直接返回
      if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
        return hostname;
      }
      
      // 尝试从路径中提取有意义的信息
      const pathSegments = parsedUrl.pathname.split('/').filter(segment => segment);
      
      // 如果路径为空，返回域名
      if (pathSegments.length === 0) {
        return hostname;
      }
      
      // 获取最后一个路径段，通常包含页面名称
      let lastSegment = pathSegments[pathSegments.length - 1];
      
      // 清理最后一个段中的文件扩展名和其他内容
      lastSegment = lastSegment
        .replace(/\.(html|htm|php|aspx|jsp|asp)$/, '')  // 移除文件扩展名
        .replace(/[-_]/g, ' ')  // 将连字符和下划线替换为空格
        .replace(/\b\w/g, c => c.toUpperCase());  // 首字母大写
      
      // 如果段为空或只有数字，使用上一级路径
      if (lastSegment.length === 0 || /^\d+$/.test(lastSegment)) {
        if (pathSegments.length > 1) {
          lastSegment = pathSegments[pathSegments.length - 2]
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        }
      }
      
      // 组合域名和路径段以创建描述性标题
      if (lastSegment && lastSegment.length > 0 && lastSegment !== 'Index') {
        return `${hostname} › ${lastSegment}`;
      } else {
        return hostname;
      }
    } catch (error) {
      console.error('提取标题失败:', error);
      return url.substring(0, 30) || '未知页面';
    }
  }
  
  /**
   * 获取所有节点
   */
  getNodes(): NavNode[] {
    return this.nodes;
  }
  
  /**
   * 获取所有边
   */
  getEdges(): NavLink[] {
    return this.edges;
  }
  
  /**
   * 获取节点映射表
   */
  getNodeMap(): Map<string, NavNode> {
    return this.nodeMap;
  }

  /**
   * 根据ID获取节点
   */
  getNodeById(id: string): NavNode | undefined {
    return this.nodeMap.get(id);
  }
}

// 导出默认实例
export const nodeManager = new NodeManager();