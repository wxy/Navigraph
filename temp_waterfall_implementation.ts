// 这是一个临时文件，用于构建完整的瀑布视图实现

// 数据接口定义
interface UrlNodeData {
  id: string;
  url: string;
  title: string;
  x: number;
  y: number;
  tabId: number;
  timestamp: number;
  isFirstInTab: boolean;
  domain: string;
  node: NavNode; // 保存原始节点数据
}

interface TimeSlotData {
  timestamp: number;
  x: number;
  urls: UrlNodeData[];
}

interface TimeAxisData {
  startX: number;
  endX: number;
  y: number;
  timeSlots: {
    x: number;
    timestamp: number;
    label: string;
  }[];
}

interface WaterfallLayoutData {
  timeSlots: TimeSlotData[];
  urlNodes: UrlNodeData[];
  timeAxisData: TimeAxisData;
}

// 布局计算函数
function calculateWaterfallLayout(nodes: NavNode[], edges: NavLink[], width: number, height: number): WaterfallLayoutData {
  logger.log(_('waterfall_layout_calculation_start', '开始计算瀑布布局: {0} 个节点'), nodes.length);
  
  // 过滤有效的导航节点（排除根节点）
  const sortedNodes = nodes
    .filter(node => node.id !== 'session-root' && node.url && node.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序排列（最新的在左边）
  
  if (sortedNodes.length === 0) {
    return {
      timeSlots: [],
      urlNodes: [],
      timeAxisData: {
        startX: 100,
        endX: width - 100,
        y: height - 100,
        timeSlots: []
      }
    };
  }
  
  // 配置参数
  const config = {
    leftMargin: 100,
    rightMargin: 100,
    topMargin: 80,
    bottomMargin: 120,
    timeSlotWidth: 120,
    nodeHeight: 30,
    nodeSpacing: 10,
    maxNodesPerColumn: 8
  };
  
  // 计算时间范围
  const maxTime = Math.max(...sortedNodes.map(n => n.timestamp));
  const minTime = Math.min(...sortedNodes.map(n => n.timestamp));
  const timeRange = maxTime - minTime || 3600000; // 至少1小时范围
  
  // 计算时间槽
  const availableWidth = width - config.leftMargin - config.rightMargin;
  const maxSlots = Math.floor(availableWidth / config.timeSlotWidth);
  const numSlots = Math.min(maxSlots, 10); // 最多10个时间槽
  const slotInterval = timeRange / numSlots;
  
  const timeSlots: TimeSlotData[] = [];
  const urlNodes: UrlNodeData[] = [];
  
  // 创建时间槽
  for (let i = 0; i < numSlots; i++) {
    const slotTime = maxTime - (i * slotInterval);
    const x = config.leftMargin + (i * config.timeSlotWidth);
    
    if (x > width - config.rightMargin) break;
    
    timeSlots.push({
      timestamp: slotTime,
      x: x,
      urls: []
    });
  }
  
  // 为每个时间槽分配URL节点
  let globalNodeIndex = 0;
  
  timeSlots.forEach(timeSlot => {
    // 找到属于该时间槽的节点
    const slotNodes = sortedNodes.filter(node => 
      node.timestamp <= timeSlot.timestamp && 
      node.timestamp > timeSlot.timestamp - slotInterval
    );
    
    slotNodes.forEach((node, nodeIndex) => {
      if (globalNodeIndex >= config.maxNodesPerColumn * timeSlots.length) return;
      
      const y = config.topMargin + (nodeIndex * (config.nodeHeight + config.nodeSpacing));
      if (y > height - config.bottomMargin) return;
      
      // 获取域名
      const domain = node.url ? new URL(node.url).hostname : 'unknown';
      
      // 检查是否是该标签页的第一个节点
      const tabId = node.tabId || 0;
      const isFirstInTab = !urlNodes.some(existing => 
        existing.tabId === tabId && existing.timestamp < node.timestamp
      );
      
      // 使用与其他视图相同的标题处理逻辑
      const title = node.title || node.url || _('unnamed_node', '未命名节点');
      
      const urlData: UrlNodeData = {
        id: node.id,
        url: node.url || '',
        title: title,
        x: timeSlot.x,
        y: y,
        tabId: tabId,
        timestamp: node.timestamp,
        isFirstInTab: isFirstInTab,
        domain: domain,
        node: node // 保存原始节点数据
      };
      
      timeSlot.urls.push(urlData);
      urlNodes.push(urlData);
      globalNodeIndex++;
    });
  });
  
  // 时间轴数据
  const timeAxisData: TimeAxisData = {
    startX: config.leftMargin,
    endX: Math.min(width - config.rightMargin, config.leftMargin + (timeSlots.length * config.timeSlotWidth)),
    y: height - config.bottomMargin + 20,
    timeSlots: timeSlots.map(slot => ({
      x: slot.x,
      timestamp: slot.timestamp,
      label: new Date(slot.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }))
  };
  
  logger.log(_('waterfall_layout_calculation_complete', '瀑布布局计算完成，时间槽: {0}，URL节点: {1}'), 
    timeSlots.length, urlNodes.length);
  
  return {
    timeSlots,
    urlNodes,
    timeAxisData
  };
}

// 渲染函数们
function renderTimeAxis(mainGroup: any, layoutData: WaterfallLayoutData, width: number, height: number): void {
  const axisGroup = mainGroup.append('g').attr('class', 'waterfall-time-axis');
  
  // 绘制主轴线
  axisGroup.append('line')
    .attr('x1', layoutData.timeAxisData.startX)
    .attr('y1', layoutData.timeAxisData.y)
    .attr('x2', layoutData.timeAxisData.endX)
    .attr('y2', layoutData.timeAxisData.y)
    .style('stroke', '#ddd')
    .style('stroke-width', 2);
  
  // 添加箭头指向过去（右侧）
  axisGroup.append('polygon')
    .attr('points', `${layoutData.timeAxisData.endX},${layoutData.timeAxisData.y-5} ${layoutData.timeAxisData.endX},${layoutData.timeAxisData.y+5} ${layoutData.timeAxisData.endX+10},${layoutData.timeAxisData.y}`)
    .style('fill', '#ddd');
  
  // 时间标签
  axisGroup.append('text')
    .attr('x', layoutData.timeAxisData.startX - 10)
    .attr('y', layoutData.timeAxisData.y - 10)
    .attr('text-anchor', 'end')
    .style('font-size', '12px')
    .style('fill', '#666')
    .text(_('waterfall_timeline_now', '现在'));
  
  axisGroup.append('text')
    .attr('x', layoutData.timeAxisData.endX + 15)
    .attr('y', layoutData.timeAxisData.y - 10)
    .attr('text-anchor', 'start')
    .style('font-size', '12px')
    .style('fill', '#666')
    .text(_('waterfall_timeline_past', '过去'));
  
  // 时间刻度
  layoutData.timeAxisData.timeSlots.forEach(slot => {
    axisGroup.append('line')
      .attr('x1', slot.x)
      .attr('y1', layoutData.timeAxisData.y - 5)
      .attr('x2', slot.x)
      .attr('y2', layoutData.timeAxisData.y + 5)
      .style('stroke', '#ddd')
      .style('stroke-width', 1);
    
    axisGroup.append('text')
      .attr('x', slot.x)
      .attr('y', layoutData.timeAxisData.y + 20)
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('fill', '#999')
      .text(slot.label);
  });
}

function renderUrlNodes(mainGroup: any, layoutData: WaterfallLayoutData, visualizer: Visualizer): void {
  const nodeGroup = mainGroup.append('g').attr('class', 'waterfall-url-nodes');
  
  layoutData.urlNodes.forEach(urlNode => {
    const node = nodeGroup.append('g')
      .attr('class', `url-node ${urlNode.isFirstInTab ? 'first-in-tab' : 'continuation'}`)
      .attr('transform', `translate(${urlNode.x}, ${urlNode.y})`);
    
    // URL节点背景
    node.append('rect')
      .attr('width', 100)
      .attr('height', 25)
      .attr('rx', 4)
      .style('fill', urlNode.isFirstInTab ? '#4285f4' : '#e8f0fe')
      .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#4285f4')
      .style('stroke-width', 1);
    
    // 域名图标/标识
    node.append('circle')
      .attr('cx', 8)
      .attr('cy', 12.5)
      .attr('r', 6)
      .style('fill', urlNode.isFirstInTab ? '#ffffff' : '#4285f4')
      .style('stroke', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
      .style('stroke-width', 1);
    
    // 域名首字母或标签页标识（在圆圈中）
    const displayText = urlNode.isFirstInTab && urlNode.domain !== 'unknown' 
      ? urlNode.domain.charAt(0).toUpperCase() 
      : (urlNode.tabId === 0 ? 'M' : `${urlNode.tabId}`);
    
    node.append('text')
      .attr('x', 8)
      .attr('y', 15)
      .attr('text-anchor', 'middle')
      .style('font-size', '8px')
      .style('font-weight', 'bold')
      .style('fill', urlNode.isFirstInTab ? '#1a73e8' : '#ffffff')
      .text(displayText);
    
    // 页面标题文本 - 关键：使用 urlNode.title，这来自于 node.title || node.url
    const titleText = urlNode.title.length > 12 ? urlNode.title.substring(0, 12) + '...' : urlNode.title;
    node.append('text')
      .attr('x', 18)
      .attr('y', 16)
      .style('font-size', '10px')
      .style('fill', urlNode.isFirstInTab ? 'white' : '#1a73e8')
      .text(titleText);
    
    // 鼠标悬停显示完整信息
    node.append('title')
      .text(`${urlNode.title}\n${urlNode.url}\n${new Date(urlNode.timestamp).toLocaleString()}\n标签页: ${urlNode.tabId}`);
    
    // 点击事件
    node.style('cursor', 'pointer')
      .on('click', function() {
        // 显示节点详情 - 传递原始节点数据
        if (visualizer && typeof visualizer.showNodeDetails === 'function') {
          visualizer.showNodeDetails(urlNode.node);
        }
      });
  });
}

function renderUrlConnections(mainGroup: any, layoutData: WaterfallLayoutData): void {
  const connectionGroup = mainGroup.append('g').attr('class', 'waterfall-url-connections');
  
  // 按标签页分组URL，绘制同一标签页内URL之间的连接线
  const urlsByTab = new Map<number, UrlNodeData[]>();
  layoutData.urlNodes.forEach(urlNode => {
    if (!urlsByTab.has(urlNode.tabId)) {
      urlsByTab.set(urlNode.tabId, []);
    }
    urlsByTab.get(urlNode.tabId)!.push(urlNode);
  });
  
  urlsByTab.forEach(urls => {
    // 按时间排序
    const sortedUrls = urls.sort((a, b) => a.timestamp - b.timestamp);
    
    for (let i = 0; i < sortedUrls.length - 1; i++) {
      const fromUrl = sortedUrls[i];
      const toUrl = sortedUrls[i + 1];
      
      // 绘制连接线
      connectionGroup.append('line')
        .attr('x1', fromUrl.x)
        .attr('y1', fromUrl.y + 12.5)
        .attr('x2', toUrl.x)
        .attr('y2', toUrl.y + 12.5)
        .style('stroke', '#36a2eb')
        .style('stroke-width', 1.5)
        .style('stroke-dasharray', '3,3')
        .style('opacity', 0.7)
        .attr('class', 'url-connection');
    }
  });
}
