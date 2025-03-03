// 全局变量
let treeData = null;
let lastUpdateTimestamp = null;

// 页面元素引用
const treeContainer = document.getElementById('tree-container');
const searchInput = document.getElementById('search');
const refreshButton = document.getElementById('refresh-button');
const clearDataButton = document.getElementById('clear-data');

// 页面加载后初始化
document.addEventListener('DOMContentLoaded', function() {
  console.log('导航历史页面已加载');
  
  // 绑定事件监听
  initEventListeners();
  
  // 加载导航树数据
  loadNavigationTree();
  
  // 设置自动更新（每分钟）
  setInterval(() => {
    console.log('执行自动更新...');
    loadNavigationTree(true); // true表示增量更新，减少重绘
  }, 60000);
  
  // 初始化搜索功能
  initSearch();
});

/**
 * 初始化事件监听器
 */
function initEventListeners() {
  // 刷新按钮
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      loadNavigationTree(false); // false表示完全刷新
    });
  }
  
  // 清除数据按钮
  if (clearDataButton) {
    clearDataButton.addEventListener('click', () => {
      if (confirm('确定要清除所有导航历史记录吗？此操作无法撤销。')) {
        clearNavigationData();
      }
    });
  }
  
  // 搜索输入
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        searchNavigationHistory(query);
      } else if (treeData) {
        renderNavigationTree(treeData);
      }
    }, 300));
  }
}

/**
 * 初始化搜索功能
 */
function initSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;
  
  searchInput.addEventListener('input', debounce(function() {
    const query = this.value.toLowerCase().trim();
    searchNodes(query);
  }, 300));
}

/**
 * 搜索节点
 */
function searchNodes(query) {
  if (!window.treeData) return;
  
  // 清除之前的高亮
  document.querySelectorAll('.navigation-node.highlight').forEach(node => {
    node.classList.remove('highlight');
  });
  
  if (!query) return;
  
  let matchCount = 0;
  
  // 遍历所有节点进行搜索
  for (const date in window.treeData.days) {
    const nodes = window.treeData.days[date].nodes;
    for (const nodeId in nodes) {
      const node = nodes[nodeId];
      const title = node.record.title?.toLowerCase() || '';
      const url = node.record.url.toLowerCase();
      
      if (title.includes(query) || url.includes(query)) {
        // 找到匹配，高亮节点并展开父节点
        matchCount++;
        const nodeElement = document.querySelector(`.navigation-node[data-node-id="${nodeId}"]`);
        if (nodeElement) {
          nodeElement.classList.add('highlight');
          ensureNodeVisible(nodeElement);
        }
      }
    }
  }
  
  showToast(`找到 ${matchCount} 个匹配结果`);
}

/**
 * 确保节点可见（展开所有父节点）
 */
function ensureNodeVisible(nodeElement) {
  // 查找所有父节点
  let parent = nodeElement.parentElement;
  while (parent) {
    if (parent.classList.contains('node-children')) {
      // 找到父节点容器，展开它
      parent.classList.remove('collapsed');
      parent.classList.add('expanded');
      
      // 更新父节点的展开图标
      const parentNodeItem = parent.parentElement;
      if (parentNodeItem) {
        const toggleIcon = parentNodeItem.querySelector('.toggle-icon');
        if (toggleIcon) toggleIcon.textContent = '▼';
      }
    }
    parent = parent.parentElement;
  }
  
  // 滚动到可见区域
  nodeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * 从后台加载导航树数据
 */
function loadNavigationTree(updateOnly = false) {
  if (!updateOnly) {
    showLoading();
    hideError();
  }
  
  console.log('请求导航树数据...');
  
  // 添加上次更新时间参数，用于增量更新
  const options = {};
  if (updateOnly && lastUpdateTimestamp) {
    options.lastUpdate = lastUpdateTimestamp;
  }
  
  chrome.runtime.sendMessage({ 
    action: 'getNavigationTree',
    options: options
  }, function(response) {
    if (!updateOnly) {
      hideLoading();
    }
    
    console.log('收到导航树响应:', response);
    
    // 更新时间戳
    if (response && response.success && response.timestamp) {
      lastUpdateTimestamp = response.timestamp;
    }
    
    // 检查响应
    if (!response) {
      showError('没有收到响应数据');
      return;
    }
    
    if (response.success === false) {
      showError(response.error || '获取数据失败');
      return;
    }
    
    if (response.success && response.data) {
      const newTreeData = response.data;
      
      // 执行基本验证
      let totalNodes = 0;
      let visibleNodes = 0;
      let missingParentNodes = 0;
      
      // 检查节点是否可访问
      for (const date in newTreeData.days) {
        const dayData = newTreeData.days[date];
        const allNodesInDay = Object.keys(dayData.nodes).length;
        const rootNodesInDay = dayData.rootNodeIds.length;
        totalNodes += allNodesInDay;
        visibleNodes += rootNodesInDay;
        
        // 检查是否有"孤立"节点（没有父节点但也不是根节点）
        let orphanNodes = 0;
        let childNodesCount = 0;
        
        // 统计所有直接子节点
        for (const nodeId in dayData.nodes) {
          const node = dayData.nodes[nodeId];
          childNodesCount += node.children ? node.children.length : 0;
        }
        
        // 计算孤立节点（不是根节点也不是任何节点的子节点）
        const nodeIds = Object.keys(dayData.nodes);
        const childrenSet = new Set();
        
        // 收集所有子节点ID
        for (const nodeId in dayData.nodes) {
          const node = dayData.nodes[nodeId];
          if (node.children) {
            node.children.forEach(id => childrenSet.add(id));
          }
        }
        
        // 检查孤立节点
        nodeIds.forEach(id => {
          if (!dayData.rootNodeIds.includes(id) && !childrenSet.has(id)) {
            orphanNodes++;
            
            // 修复：将孤立节点添加到根节点列表
            console.warn(`发现孤立节点 ${id}，添加到根节点列表`);
            dayData.rootNodeIds.push(id);
            visibleNodes++;
          }
        });
        
        console.log(`日期 ${date}: 总节点数 ${allNodesInDay}，` +
                    `根节点数 ${rootNodesInDay}，` +
                    `子节点数 ${childNodesCount}，` +
                    `孤立节点数 ${orphanNodes}，` +
                    `修复后可见节点数 ${dayData.rootNodeIds.length}`);
        
        // 检查是否有断开的父子链接
        for (const nodeId in dayData.nodes) {
          const node = dayData.nodes[nodeId];
          if (node.children) {
            node.children.forEach(childId => {
              if (!dayData.nodes[childId]) {
                missingParentNodes++;
                console.warn(`节点 ${nodeId} 引用了不存在的子节点 ${childId}`);
              }
            });
          }
        }
      }
      
      console.log(`总节点数: ${totalNodes}, 可见节点数: ${visibleNodes}, 丢失父节点的引用: ${missingParentNodes}`);
      
      // 继续处理树数据
      if (updateOnly && treeData) {
        updateNavigationTree(newTreeData);
      } else {
        treeData = newTreeData;
        renderNavigationTree(newTreeData);
      }
      
      // 运行诊断
      const diagnosticResult = diagnosticTree(response.data);
      console.log(`树结构深度分析: 最大深度为 ${diagnosticResult.maxDepth} 层`);
    } else {
      // ...错误处理...
    }
  });
}

/**
 * 渲染完整的导航树
 */
function renderNavigationTree(treeData) {
  console.log('开始渲染导航树');
  
  // 添加树结构诊断信息
  let totalRootNodes = 0;
  let totalNodes = 0;
  let totalDays = Object.keys(treeData.days).length;
  
  for (const date in treeData.days) {
    const dayData = treeData.days[date];
    totalRootNodes += dayData.rootNodeIds.length;
    totalNodes += Object.keys(dayData.nodes).length;
  }
  
  console.log(`树诊断: ${totalDays}天, ${totalNodes}个总节点, ${totalRootNodes}个根节点`);
  
  // 清空容器
  treeContainer.innerHTML = '';
  
  // 获取所有日期并排序（从新到旧）
  const dates = Object.keys(treeData.days).sort((a, b) => b.localeCompare(a));
  
  if (dates.length === 0) {
    showNoData();
    return;
  }
  
  // 创建树根容器
  const rootElement = document.createElement('ul');
  rootElement.className = 'tree-root';
  
  // 渲染每个日期
  dates.forEach(date => {
    const dateData = treeData.days[date];
    const dateElement = renderDateGroup(date, dateData);
    if (dateElement) {
      rootElement.appendChild(dateElement);
    }
  });
  
  // 添加到DOM
  treeContainer.appendChild(rootElement);
  
  // 添加展开/折叠事件处理
  addToggleListeners();
  
  // 添加节点点击详情事件
  addNodeDetailListeners();
  
  console.log('导航树渲染完成');
}

/**
 * 渲染日期分组
 */
function renderDateGroup(date, dateData) {
  // 格式化日期显示
  const formattedDate = formatDate(date);
  
  // 检查该日期是否有根节点
  if (!dateData.rootNodeIds || dateData.rootNodeIds.length === 0) {
    console.warn(`日期 ${date} 没有根节点`);
    return null;
  }
  
  // 创建日期节点
  const dateItem = document.createElement('li');
  dateItem.className = 'date-group';
  dateItem.dataset.date = date;
  
  // 创建日期标题
  const dateTitle = document.createElement('div');
  dateTitle.className = 'date-title expandable';
  dateTitle.innerHTML = `<span class="toggle-icon">▼</span> ${formattedDate}`;
  dateItem.appendChild(dateTitle);
  
  // 创建节点容器
  const nodesContainer = document.createElement('ul');
  nodesContainer.className = 'node-list';
  
  // 渲染所有根节点及其子节点
  let renderedNodeCount = 0;
  dateData.rootNodeIds.forEach(rootNodeId => {
    if (dateData.nodes[rootNodeId]) {
      renderNodeAndChildren(rootNodeId, dateData.nodes, nodesContainer);
      renderedNodeCount++;
    }
  });
  
  console.log(`日期 ${date}: 成功渲染了 ${renderedNodeCount} 个根节点`);
  
  dateItem.appendChild(nodesContainer);
  return dateItem;
}

/**
 * 渲染节点及其子节点
 */
function renderNodeAndChildren(nodeId, nodesMap, parentContainer, recursionDepth = 0) {
  // 防止递归过深
  if (recursionDepth > 20) {
    console.warn(`递归过深(${recursionDepth})，跳过节点 ${nodeId} 的渲染`);
    return;
  }
  
  const node = nodesMap[nodeId];
  if (!node) {
    console.warn(`节点 ${nodeId} 不存在`);
    return;
  }
  
  try {
    // 创建节点元素
    const nodeItem = document.createElement('li');
    nodeItem.className = 'navigation-node';
    nodeItem.dataset.nodeId = nodeId;
    nodeItem.dataset.depth = node.depth || 0;
    
    // 根据深度调整样式
    nodeItem.style.paddingLeft = `${node.depth * 5}px`;
    
    // 创建节点标题容器
    const nodeTitle = document.createElement('div');
    nodeTitle.className = node.children && node.children.length ? 'node-title expandable' : 'node-title';
    
    // 添加深度指示器 - 可视化节点深度
    for (let i = 0; i < node.depth; i++) {
      const depthIndicator = document.createElement('span');
      depthIndicator.className = 'depth-indicator';
      depthIndicator.textContent = '│';
      nodeTitle.appendChild(depthIndicator);
    }
    
    // 创建节点内容div - 包含所有信息元素
    const contentDiv = document.createElement('div');
    contentDiv.className = 'node-content';
    
    // 创建网站图标
    if (node.record && node.record.favicon) {
      const faviconImg = document.createElement('img');
      faviconImg.className = 'favicon';
      faviconImg.src = node.record.favicon;
      faviconImg.onerror = function() {
        // 图标加载失败时使用默认图标
        this.src = '../../images/default-favicon.png';
        this.onerror = null;
      };
      contentDiv.appendChild(faviconImg);
    }
    
    // 添加页面标题
    const pageTitle = document.createElement('span');
    pageTitle.className = 'page-title';
    pageTitle.textContent = sanitizeHTML(node.record.title || node.record.url);
    contentDiv.appendChild(pageTitle);
    
    // 添加打开方式和导航类型指示器
    const metaInfo = document.createElement('div');
    metaInfo.className = 'meta-info';
    
    if (node.record.navigationType) {
      const navType = document.createElement('span');
      navType.className = 'nav-type';
      navType.textContent = getNavigationTypeLabel(node.record.navigationType);
      navType.title = '导航类型';
      metaInfo.appendChild(navType);
    }
    
    if (node.record.openTarget && node.record.openTarget !== 'same_tab') {
      const openTarget = document.createElement('span');
      openTarget.className = 'open-target';
      openTarget.textContent = getOpenTargetLabel(node.record.openTarget);
      openTarget.title = '打开位置';
      metaInfo.appendChild(openTarget);
    }
    
    contentDiv.appendChild(metaInfo);
    
    // 添加扩展/折叠图标
    if (node.children && node.children.length) {
      const toggleIcon = document.createElement('span');
      toggleIcon.className = 'toggle-icon';
      toggleIcon.textContent = '▶';
      nodeTitle.appendChild(toggleIcon);
    }
    
    // 组装节点标题
    nodeTitle.appendChild(contentDiv);
    nodeItem.appendChild(nodeTitle);
    
    // 添加子节点容器
    if (node.children && node.children.length) {
      const childrenContainer = document.createElement('ul');
      childrenContainer.className = 'node-children';
      childrenContainer.dataset.parentId = nodeId;
      
      // 默认展开浅层节点
      if (node.depth < 1) {
        childrenContainer.classList.add('expanded');
      } else {
        childrenContainer.classList.add('collapsed');
      }
      
      // 递归渲染子节点
      node.children.forEach(childId => {
        if (childId === nodeId) {
          console.error(`发现循环引用: 节点 ${nodeId} 将自身作为子节点`);
          return;
        }
        renderNodeAndChildren(childId, nodesMap, childrenContainer, recursionDepth + 1);
      });
      
      nodeItem.appendChild(childrenContainer);
    }
    
    // 将完整节点添加到父容器
    parentContainer.appendChild(nodeItem);
    
  } catch (error) {
    console.error(`渲染节点 ${nodeId} 时出错:`, error);
    
    // 备用渲染 - 如果正常渲染失败，使用简化版本
    try {
      const fallbackNode = document.createElement('li');
      fallbackNode.className = 'navigation-node error';
      fallbackNode.textContent = `[渲染错误] ${node.record.title || node.record.url || nodeId}`;
      parentContainer.appendChild(fallbackNode);
    } catch (fallbackError) {
      console.error('备用渲染也失败:', fallbackError);
    }
  }
}

/**
 * 增量更新导航树 - 只更新变化的部分
 */
function updateNavigationTree(newTreeData) {
  console.log('执行增量更新');
  
  if (!treeData || !treeData.days) {
    // 如果没有现有数据，执行完整渲染
    treeData = newTreeData;
    renderNavigationTree(newTreeData);
    return;
  }
  
  // 更新现有树数据
  treeData = newTreeData;
  
  // 找出新增的日期和节点
  const dates = Object.keys(newTreeData.days).sort((a, b) => b.localeCompare(a));
  const treeRoot = document.querySelector('.tree-root');
  
  if (!treeRoot) {
    // 如果DOM中没有树结构，执行完整渲染
    renderNavigationTree(newTreeData);
    return;
  }
  
  // 检查每个日期
  dates.forEach(date => {
    const dateData = newTreeData.days[date];
    const existingDateElement = document.querySelector(`.date-group[data-date="${date}"]`);
    
    if (!existingDateElement) {
      // 如果是新日期，添加到树顶部
      const dateElement = renderDateGroup(date, dateData);
      if (dateElement) {
        if (treeRoot.firstChild) {
          treeRoot.insertBefore(dateElement, treeRoot.firstChild);
          dateElement.classList.add('fade-in');
        } else {
          treeRoot.appendChild(dateElement);
        }
      }
    } else {
      // 现有日期，检查新节点
      // 这里可以进一步优化，只更新变化的节点
      // 简单起见，我们暂时更新整个日期组
      const newDateElement = renderDateGroup(date, dateData);
      if (newDateElement) {
        existingDateElement.parentNode.replaceChild(newDateElement, existingDateElement);
        newDateElement.classList.add('updating');
      }
    }
  });
  
  // 添加展开/折叠事件处理
  addToggleListeners();
  
  // 添加节点点击详情事件
  addNodeDetailListeners();
}

/**
 * 添加展开/折叠事件监听器
 */
function addToggleListeners() {
  document.querySelectorAll('.expandable').forEach(element => {
    element.addEventListener('click', function(e) {
      // 只有当点击的是标题或折叠图标时才触发
      if (e.target === this || 
          e.target.classList.contains('toggle-icon') || 
          e.target.closest('.node-title') === this) {
        
        const nodeItem = this.closest('.navigation-node');
        const childList = nodeItem.querySelector('.node-children');
        
        if (childList) {
          // 切换折叠状态
          const wasCollapsed = childList.classList.contains('collapsed');
          childList.classList.toggle('collapsed');
          childList.classList.toggle('expanded');
          
          // 切换图标
          const toggleIcon = this.querySelector('.toggle-icon');
          if (toggleIcon) {
            toggleIcon.textContent = wasCollapsed ? '▼' : '▶';
            toggleIcon.style.transform = wasCollapsed ? 'rotate(0deg)' : 'rotate(0deg)';
          }
          
          // 记录状态
          const nodeId = nodeItem.dataset.nodeId;
          if (nodeId) {
            saveNodeExpandState(nodeId, wasCollapsed);
          }
        }
      }
    });
  });
}

/**
 * 保存节点展开状态
 */
function saveNodeExpandState(nodeId, isExpanded) {
  try {
    const expandStates = JSON.parse(localStorage.getItem('nodeExpandStates') || '{}');
    expandStates[nodeId] = isExpanded;
    localStorage.setItem('nodeExpandStates', JSON.stringify(expandStates));
  } catch (e) {
    console.error('保存节点状态失败:', e);
  }
}

/**
 * 应用保存的节点展开状态
 */
function applyNodeExpandStates() {
  try {
    const expandStates = JSON.parse(localStorage.getItem('nodeExpandStates') || '{}');
    
    Object.entries(expandStates).forEach(([nodeId, isExpanded]) => {
      const nodeItem = document.querySelector(`.navigation-node[data-node-id="${nodeId}"]`);
      if (nodeItem) {
        const childList = nodeItem.querySelector('.node-children');
        const toggleIcon = nodeItem.querySelector('.toggle-icon');
        
        if (childList) {
          if (isExpanded) {
            childList.classList.add('expanded');
            childList.classList.remove('collapsed');
            if (toggleIcon) toggleIcon.textContent = '▼';
          } else {
            childList.classList.add('collapsed');
            childList.classList.remove('expanded');
            if (toggleIcon) toggleIcon.textContent = '▶';
          }
        }
      }
    });
  } catch (e) {
    console.error('应用节点状态失败:', e);
  }
}

/**
 * 搜索导航历史
 */
function searchNavigationHistory(query) {
  console.log(`搜索导航历史: ${query}`);
  
  chrome.runtime.sendMessage({ 
    action: 'searchNavigation', 
    query: query 
  }, function(response) {
    if (!response) {
      showError('搜索时没有收到响应');
      return;
    }
    
    if (response.success === false) {
      showError(response.error || '搜索失败');
      return;
    }
    
    console.log(`搜索结果: ${response.data.length} 条记录`);
    
    if (response.data.length === 0) {
      // 显示无结果信息
      treeContainer.innerHTML = `<div class="no-results">没有找到匹配 "${sanitizeHTML(query)}" 的结果</div>`;
      return;
    }
    
    // 渲染搜索结果
    renderSearchResults(response.data);
  });
}

/**
 * 渲染搜索结果
 */
function renderSearchResults(records) {
  // 清空容器
  treeContainer.innerHTML = '';
  
  // 创建结果列表
  const resultList = document.createElement('ul');
  resultList.className = 'search-results';
  
  // 渲染每个结果
  records.forEach(record => {
    const resultItem = renderSearchResult(record);
    resultList.appendChild(resultItem);
  });
  
  treeContainer.appendChild(resultList);
}

/**
 * 渲染搜索结果
 */
function renderSearchResult(record) {
  const resultItem = document.createElement('li');
  resultItem.className = 'search-result-item';
  
  // 创建标题元素
  const titleDiv = document.createElement('div');
  titleDiv.className = 'result-title';
  
  // 添加网站图标
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = record.favicon || '../../images/logo-16.png';
  favicon.addEventListener('error', function() {
    this.src = '../../images/logo-16.png';
  });
  titleDiv.appendChild(favicon);
  
  // 添加标题文本
  const titleText = document.createElement('span');
  titleText.textContent = record.title || record.url;
  titleDiv.appendChild(titleText);
  
  resultItem.appendChild(titleDiv);
  
  // ... 剩余的渲染代码 ...
  
  return resultItem;
}

/**
 * 清除所有导航数据
 */
function clearNavigationData() {
  showLoading();
  
  chrome.runtime.sendMessage({ action: 'clearAllData' }, function(response) {
    hideLoading();
    
    if (!response) {
      showError('清除数据时没有收到响应');
      return;
    }
    
    if (response.success === false) {
      showError(response.error || '清除数据失败');
      return;
    }
    
    // 更新界面
    treeData = null;
    treeContainer.innerHTML = '';
    showNoData();
    
    alert('所有导航历史记录已清除');
  });
}

/**
 * 显示加载状态
 */
function showLoading() {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.style.display = 'flex';
  }
  
  hideError();
  hideNoData();
}

/**
 * 隐藏加载状态
 */
function hideLoading() {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.style.display = 'none';
  }
}

/**
 * 显示错误信息
 */
function showError(message) {
  const errorContainer = document.getElementById('error-container');
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
  }
  
  hideLoading();
  hideNoData();
}

/**
 * 隐藏错误信息
 */
function hideError() {
  const errorContainer = document.getElementById('error-container');
  if (errorContainer) {
    errorContainer.style.display = 'none';
  }
}

/**
 * 显示无数据信息
 */
function showNoData() {
  const noData = document.getElementById('no-data');
  if (noData) {
    noData.style.display = 'block';
  }
  
  hideLoading();
  hideError();
}

/**
 * 隐藏无数据信息
 */
function hideNoData() {
  const noData = document.getElementById('no-data');
  if (noData) {
    noData.style.display = 'none';
  }
}

/**
 * 防抖函数
 */
function debounce(func, wait) {
  let timeout;
  return function() {
    const context = this;
    const args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

/**
 * 格式化日期
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * HTML安全过滤
 */
function sanitizeHTML(text) {
  if (!text) return '';
  const element = document.createElement('div');
  element.innerText = text;
  return element.innerHTML;
}

/**
 * 检查树结构是否有重复节点
 */
function validateTree(treeData) {
  console.log("验证树结构...");
  
  let allNodeIds = new Set();
  let rootNodeIds = new Set();
  let childNodeIds = new Set();
  
  // 遍历所有日期的数据
  for (const date in treeData.days) {
    const dayData = treeData.days[date];
    
    // 收集所有根节点ID
    dayData.rootNodeIds.forEach(id => {
      rootNodeIds.add(id);
      allNodeIds.add(id);
    });
    
    // 收集所有子节点ID
    for (const nodeId in dayData.nodes) {
      const node = dayData.nodes[nodeId];
      if (node.children) {
        node.children.forEach(childId => {
          childNodeIds.add(childId);
          allNodeIds.add(childId);
        });
      }
    }
  }
  
  // 检查有多少根节点同时也是子节点
  const overlap = new Set([...rootNodeIds].filter(id => childNodeIds.has(id)));
  
  if (overlap.size > 0) {
    console.error(`发现 ${overlap.size} 个既是根节点又是子节点的重复节点`);
    console.log('重复节点列表:', Array.from(overlap));
    return false;
  } else {
    console.log('树结构验证通过，没有重复节点');
    return true;
  }
}

/**
 * 诊断树结构
 */
function diagnosticTree(treeData) {
  let maxDepth = 0;
  let depthCounts = {};
  let totalNodes = 0;
  let rootNodes = 0;
  let orphanNodes = 0;
  
  // 分析树结构
  for (const date in treeData.days) {
    const dayData = treeData.days[date];
    
    rootNodes += dayData.rootNodeIds.length;
    totalNodes += Object.keys(dayData.nodes).length;
    
    // 检查每个节点
    for (const nodeId in dayData.nodes) {
      const node = dayData.nodes[nodeId];
      const depth = node.depth || 0;
      
      // 记录最大深度
      if (depth > maxDepth) maxDepth = depth;
      
      // 记录每个深度的节点数
      depthCounts[depth] = (depthCounts[depth] || 0) + 1;
      
      // 检查是否为孤立节点（既不是根节点也不是子节点）
      if (!dayData.rootNodeIds.includes(nodeId)) {
        let isChild = false;
        for (const otherNodeId in dayData.nodes) {
          if (otherNodeId !== nodeId) {
            const otherNode = dayData.nodes[otherNodeId];
            if (otherNode.children && otherNode.children.includes(nodeId)) {
              isChild = true;
              break;
            }
          }
        }
        if (!isChild) {
          orphanNodes++;
        }
      }
    }
  }
  
  // 输出诊断信息
  console.log('树结构诊断:');
  console.log(`总节点数: ${totalNodes}`);
  console.log(`根节点数: ${rootNodes}`);
  console.log(`树形结构深度: ${maxDepth}层`); // 更改措辞，避免暗示有深度限制
  console.log(`孤立节点数: ${orphanNodes}`);
  console.log('深度分布:', depthCounts);
  
  return {
    totalNodes,
    rootNodes,
    maxDepth,
    orphanNodes,
    depthCounts
  };
}

/**
 * 查找深层节点
 */
function findDeepNodes() {
  const deepNodes = document.querySelectorAll('.navigation-node[data-depth="3"], .navigation-node[data-depth="4"], .navigation-node[data-depth="5"]');
  console.log(`找到 ${deepNodes.length} 个深度大于2的节点:`);
  
  deepNodes.forEach((node, index) => {
    const nodeId = node.dataset.nodeId;
    const depth = node.dataset.depth;
    const title = node.querySelector('.page-title')?.textContent || '无标题';
    
    console.log(`${index+1}. 节点ID: ${nodeId}, 深度: ${depth}, 标题: "${title}"`);
    
    // 高亮显示这个节点，便于视觉识别
    node.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  
  return deepNodes.length > 0;
}

/**
 * 查看节点的父子链
 * 该函数可以在控制台中调用
 */
function traceNodeChain(nodeId) {
  if (!treeData) {
    console.error('树数据未加载');
    return;
  }
  
  // 查找节点
  let targetNode = null;
  let targetDate = null;
  let targetNodes = null;
  
  for (const date in treeData.days) {
    const nodes = treeData.days[date].nodes;
    if (nodes[nodeId]) {
      targetNode = nodes[nodeId];
      targetDate = date;
      targetNodes = nodes;
      break;
    }
  }
  
  if (!targetNode) {
    console.error(`未找到节点 ${nodeId}`);
    return;
  }
  
  // 打印节点信息
  console.log('节点信息:', {
    id: nodeId,
    title: targetNode.record.title,
    url: targetNode.record.url,
    depth: targetNode.depth,
    date: targetDate,
    timestamp: targetNode.record.timestamp,
    方法: targetNode.record.method,
    子节点数: targetNode.children?.length || 0
  });
  
  // 查找并高亮父链
  let parentChain = [];
  let currentId = nodeId;
  let currentDepth = targetNode.depth;
  
  // 向上查找父节点链
  while (currentDepth > 0) {
    let found = false;
    
    for (const id in targetNodes) {
      const node = targetNodes[id];
      if (node.children && node.children.includes(currentId)) {
        parentChain.unshift({
          id: id,
          title: node.record.title,
          depth: node.depth
        });
        currentId = id;
        currentDepth = node.depth;
        found = true;
        break;
      }
    }
    
    if (!found) break;
  }
  
  console.log('父节点链:', parentChain);
  
  // 高亮显示
  document.querySelectorAll('.highlight-chain').forEach(el => {
    el.classList.remove('highlight-chain');
  });
  
  // 高亮当前节点
  const targetElement = document.querySelector(`.navigation-node[data-node-id="${nodeId}"]`);
  if (targetElement) {
    targetElement.classList.add('highlight-chain');
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  // 高亮父链
  parentChain.forEach(parent => {
    const parentElement = document.querySelector(`.navigation-node[data-node-id="${parent.id}"]`);
    if (parentElement) {
      parentElement.classList.add('highlight-chain');
    }
  });
  
  return {
    node: targetNode,
    parentChain
  };
}

/**
 * 渲染节点标题
 */
function renderNodeTitle(node) {
  const nodeTitle = document.createElement('div');
  nodeTitle.className = 'node-title';
  
  // 添加导航类型图标
  const typeIcon = document.createElement('span');
  typeIcon.className = `nav-type-icon ${node.record.navigationType}`;
  typeIcon.title = getNavigationTypeLabel(node.record.navigationType);
  nodeTitle.appendChild(typeIcon);
  
  // 如果不是在当前标签页打开，添加打开位置图标
  if (node.record.openTarget !== 'same_tab') {
    const targetIcon = document.createElement('span');
    targetIcon.className = `open-target-icon ${node.record.openTarget}`;
    targetIcon.title = getOpenTargetLabel(node.record.openTarget);
    nodeTitle.appendChild(targetIcon);
  }
  
  // 添加网站图标
  // ...剩余代码
}

// 获取导航类型的可读标签
function getNavigationTypeLabel(type) {
  const labels = {
    'link_click': '链接点击',
    'address_bar': '地址栏输入',
    'form_submit': '表单提交',
    'history_back': '后退',
    'history_forward': '前进',
    'reload': '重新加载',
    'javascript': 'JavaScript导航',
    'initial': '初始加载'
  };
  return labels[type] || type;
}

// 获取打开位置的可读标签
function getOpenTargetLabel(target) {
  const labels = {
    'same_tab': '当前标签页',
    'new_tab': '新标签页',
    'new_window': '新窗口',
    'popup': '弹出窗口'
  };
  return labels[target] || target;
}

// 添加到页面中，帮助诊断树形结构
window.analyzeTreeDepth = function() {
  if (!window.treeData || !window.treeData.days) {
    console.error('树数据未加载');
    return;
  }
  
  const depthCounts = {};
  let maxDepth = 0;
  
  for (const date in window.treeData.days) {
    const nodes = window.treeData.days[date].nodes;
    
    for (const nodeId in nodes) {
      const node = nodes[nodeId];
      const depth = node.depth || 0;
      
      depthCounts[depth] = (depthCounts[depth] || 0) + 1;
      if (depth > maxDepth) maxDepth = depth;
    }
  }
  
  console.log('树深度分析:');
  console.log(`最大深度: ${maxDepth}`);
  console.log('各层节点数:', depthCounts);
  
  // 查找并显示几个较深的节点
  if (maxDepth > 1) {
    const deepNodes = [];
    for (const date in window.treeData.days) {
      const nodes = window.treeData.days[date].nodes;
      for (const nodeId in nodes) {
        const node = nodes[nodeId];
        if (node.depth > 1) {
          deepNodes.push({
            id: nodeId,
            title: node.record.title,
            depth: node.depth,
            children: node.children?.length || 0
          });
        }
      }
    }
    
    console.log('深层节点示例 (最多显示5个):', deepNodes.slice(0, 5));
  }
  
  return { maxDepth, depthCounts };
};

// 添加到您现有的 analyzeTreeDepth 函数中
window.validateTreeStructure = function() {
  if (!window.treeData || !window.treeData.days) {
    console.error('树数据未加载');
    return;
  }
  
  const issues = [];
  const allNodeIds = new Set();
  const childrenMap = new Map();
  const parentMap = new Map();
  
  for (const date in window.treeData.days) {
    const nodes = window.treeData.days[date].nodes;
    
    // 收集所有节点ID
    for (const nodeId in nodes) {
      allNodeIds.add(nodeId);
      
      // 记录每个节点的子节点
      const node = nodes[nodeId];
      if (node.children && node.children.length) {
        childrenMap.set(nodeId, node.children);
        
        // 检查子节点是否存在
        node.children.forEach(childId => {
          if (!nodes[childId]) {
            issues.push(`节点 ${nodeId} 引用了不存在的子节点 ${childId}`);
          } else {
            // 记录父节点关系
            parentMap.set(childId, nodeId);
          }
        });
      }
    }
    
    // 检查节点深度是否正确
    for (const nodeId in nodes) {
      const node = nodes[nodeId];
      
      // 计算预期深度 - 通过向上查找父节点链
      let expectedDepth = 0;
      let currentId = nodeId;
      let visited = new Set();
      
      while (parentMap.has(currentId)) {
        expectedDepth++;
        currentId = parentMap.get(currentId);
        
        // 检测循环
        if (visited.has(currentId)) {
          issues.push(`发现循环引用: 节点 ${nodeId} 的父链中有循环`);
          break;
        }
        visited.add(currentId);
      }
      
      // 比较实际深度与预期深度
      if (node.depth !== expectedDepth) {
        issues.push(`节点 ${nodeId} 深度不正确: 当前=${node.depth}, 预期=${expectedDepth}`);
      }
    }
    
    // 检查根节点
    const rootNodeIds = window.treeData.days[date].rootNodeIds || [];
    rootNodeIds.forEach(rootId => {
      if (parentMap.has(rootId)) {
        issues.push(`根节点 ${rootId} 同时也是其他节点的子节点`);
      }
    });
    
    // 检查是否有孤立节点(没有子节点也不是其他节点的子节点)
    for (const nodeId in nodes) {
      const node = nodes[nodeId];
      if ((!node.children || node.children.length === 0) && !parentMap.has(nodeId) && !rootNodeIds.includes(nodeId)) {
        issues.push(`发现孤立节点 ${nodeId}: ${node.record.title}`);
      }
    }
  }
  
  if (issues.length > 0) {
    console.error(`发现 ${issues.length} 个树结构问题:`);
    issues.forEach((issue, i) => console.error(`${i + 1}. ${issue}`));
    return false;
  } else {
    console.log('树结构验证通过，父子层级关系正确');
    return true;
  }
};

// 为树的诊断添加自动调用
document.addEventListener('DOMContentLoaded', function() {
  // 在树加载完成后自动运行诊断
  setTimeout(() => {
    if (window.treeData) {
      console.log('自动运行树结构分析:');
      window.analyzeTreeDepth();
      window.validateTreeStructure();
    }
  }, 3000); // 等待树数据加载
});

/**
 * 添加节点点击详情事件
 */
function addNodeDetailListeners() {
  document.querySelectorAll('.navigation-node').forEach(node => {
    node.querySelector('.page-title')?.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      const nodeId = node.dataset.nodeId;
      if (nodeId) {
        showNodeDetails(nodeId);
      }
    });
    
    // 添加右键菜单
    node.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      const nodeId = node.dataset.nodeId;
      if (nodeId) {
        showNodeContextMenu(e, nodeId);
      }
    });
  });
}

/**
 * 显示节点详情
 */
function showNodeDetails(nodeId) {
  try {
    const node = findNodeById(nodeId);
    if (!node) return;
    
    const record = node.record;
    
    // 创建或更新详情面板
    let detailPanel = document.getElementById('node-detail-panel');
    if (!detailPanel) {
      detailPanel = document.createElement('div');
      detailPanel.id = 'node-detail-panel';
      document.body.appendChild(detailPanel);
    }
    
    // 组装详情内容
    detailPanel.innerHTML = `
      <div class="detail-header">
        <h3>页面详情</h3>
        <button class="close-button">×</button>
      </div>
      <div class="detail-content">
        <div class="detail-item">
          <strong>标题:</strong> ${sanitizeHTML(record.title || '无标题')}
        </div>
        <div class="detail-item">
          <strong>URL:</strong> 
          <a href="${record.url}" target="_blank">${sanitizeHTML(record.url)}</a>
        </div>
        <div class="detail-item">
          <strong>时间:</strong> ${new Date(record.timestamp).toLocaleString()}
        </div>
        <div class="detail-item">
          <strong>导航类型:</strong> ${getNavigationTypeLabel(record.navigationType)}
        </div>
        <div class="detail-item">
          <strong>打开位置:</strong> ${getOpenTargetLabel(record.openTarget)}
        </div>
        <div class="detail-item">
          <strong>来源页面:</strong> ${record.referrer ? sanitizeHTML(record.referrer) : '无'}
        </div>
        <div class="detail-item">
          <strong>加载时间:</strong> ${record.loadTime ? `${record.loadTime}ms` : '未记录'}
        </div>
        <div class="detail-item">
          <strong>节点ID:</strong> ${nodeId}
        </div>
        <div class="detail-item">
          <strong>深度:</strong> ${node.depth}
        </div>
        <div class="detail-item">
          <strong>子节点数:</strong> ${node.children?.length || 0}
        </div>
      </div>
      <div class="detail-actions">
        <button class="action-button visit-button">访问页面</button>
        <button class="action-button copy-url-button">复制URL</button>
        <button class="action-button show-parent-button">显示父节点</button>
      </div>
    `;
    
    // 显示面板
    detailPanel.style.display = 'block';
    
    // 添加按钮事件处理
    detailPanel.querySelector('.close-button').addEventListener('click', () => {
      detailPanel.style.display = 'none';
    });
    
    detailPanel.querySelector('.visit-button').addEventListener('click', () => {
      window.open(record.url, '_blank');
    });
    
    detailPanel.querySelector('.copy-url-button').addEventListener('click', () => {
      navigator.clipboard.writeText(record.url).then(() => {
        showToast('URL已复制到剪贴板');
      });
    });
    
    detailPanel.querySelector('.show-parent-button').addEventListener('click', () => {
      const parentNodeId = findParentNodeId(nodeId);
      if (parentNodeId) {
        highlightNode(parentNodeId);
        showNodeDetails(parentNodeId);
      } else {
        showToast('此节点没有父节点');
      }
    });
  } catch (error) {
    console.error('显示节点详情失败:', error);
  }
}

/**
 * 显示提示消息
 */
function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * 主初始化函数 - 添加新功能初始化
 */
async function initNavigationUI() {
  try {
    // ... 现有初始化代码 ...
    
    // 添加展开/折叠事件监听器
    addToggleListeners();
    
    // 添加节点详情事件监听器
    addNodeDetailListeners();
    
    // 初始化搜索功能
    initSearch();
    
    // 应用保存的节点展开状态
    applyNodeExpandStates();
    
    // ... 其他代码 ...
    
    console.log('导航UI初始化完成');
  } catch (error) {
    console.error('初始化导航UI失败:', error);
    showErrorMessage('导航历史加载失败');
  }
}