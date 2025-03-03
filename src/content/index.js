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
      
      if (diagnosticResult.maxDepth > 3) {
        console.warn(`树包含超过3层的深度！最大深度: ${diagnosticResult.maxDepth}`);
      }
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
 * 递归渲染节点及其子节点
 */
function renderNodeAndChildren(nodeId, nodesMap, parentContainer, recursionDepth = 0) {
  // 防止递归过深（可选，仅用于安全检查）
  if (recursionDepth > 20) {
    console.warn(`递归过深(${recursionDepth})，跳过节点 ${nodeId} 的渲染`);
    return;
  }
  
  const node = nodesMap[nodeId];
  if (!node) {
    console.warn(`节点 ${nodeId} 不存在`);
    return;
  }
  
  // 记录实际渲染深度，用于调试
  const actualDepth = recursionDepth;
  console.log(`渲染节点: ${nodeId}, 计算深度: ${node.depth}, 实际渲染深度: ${actualDepth}`);
  
  // 创建节点元素
  const nodeItem = document.createElement('li');
  nodeItem.className = 'navigation-node';
  nodeItem.dataset.nodeId = nodeId;
  nodeItem.dataset.depth = node.depth; // 使用计算的深度，不是递归深度
  
  // 决定节点显示类型
  const hasChildren = node.children && node.children.length > 0;
  const nodeTitle = document.createElement('div');
  
  nodeTitle.className = hasChildren ? 'node-title expandable' : 'node-title';
  
  // 如果有子节点，添加展开/折叠图标
  if (hasChildren) {
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'toggle-icon';
    toggleIcon.textContent = '▼'; // 默认展开
    nodeTitle.appendChild(toggleIcon);
  }
  
  // 添加页面图标 - 修改这里，不使用内联事件
  const faviconImg = document.createElement('img');
  faviconImg.className = 'favicon';
  faviconImg.src = node.record.favicon || '../../images/logo-16.png';
  faviconImg.addEventListener('error', function() {
    this.src = '../../images/logo-16.png';
  });
  nodeTitle.appendChild(faviconImg);
  
  // 添加页面标题
  const pageTitle = document.createElement('span');
  pageTitle.className = 'page-title';
  pageTitle.textContent = sanitizeHTML(node.record.title || node.record.url);
  nodeTitle.appendChild(pageTitle);
  
  // 添加点击事件
  nodeTitle.addEventListener('click', function(e) {
    // 不冒泡到展开/折叠事件
    if (!e.target.classList.contains('toggle-icon')) {
      if (node.record && node.record.url) {
        // 根据点击方式决定如何打开链接
        const isNewTab = e.ctrlKey || e.metaKey || e.which === 2; // Ctrl/Cmd键或中键点击
        
        // 记录父节点关系
        chrome.runtime.sendMessage({
          action: 'recordParentNode',
          parentNodeId: nodeId,
          parentUrl: node.record.url,
          parentTitle: node.record.title || node.record.url,
          openInNewTab: isNewTab
        }, function(response) {
          console.log('记录父节点关系响应:', response);
          
          // 根据打开方式创建新标签或导航当前标签
          if (isNewTab) {
            // 在新标签页打开
            chrome.tabs.create({ url: node.record.url });
          } else {
            // 在当前标签页打开
            chrome.tabs.update({ url: node.record.url });
          }
        });
      }
    }
  });
  
  nodeItem.appendChild(nodeTitle);
  
  // 如果有子节点，创建子节点容器并递归渲染
  if (hasChildren) {
    const childrenContainer = document.createElement('ul');
    childrenContainer.className = 'node-children';
    
    // 避免子节点中包含自身，导致无限递归
    const validChildren = node.children.filter(childId => {
      if (childId === nodeId) {
        console.error(`发现循环引用: 节点 ${nodeId} 将自身列为子节点`);
        return false;
      }
      return true;
    });
    
    // 递归渲染所有子节点，传递增加的递归深度
    validChildren.forEach(childId => {
      renderNodeAndChildren(childId, nodesMap, childrenContainer, recursionDepth + 1);
    });
    
    if (validChildren.length > 0) {
      nodeItem.appendChild(childrenContainer);
    } else if (hasChildren) {
      // 原本有子节点但都被过滤掉了
      nodeTitle.classList.remove('expandable');
    }
  }
  
  // 添加到父容器
  parentContainer.appendChild(nodeItem);
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
}

/**
 * 添加展开/折叠事件监听器
 */
function addToggleListeners() {
  document.querySelectorAll('.expandable').forEach(element => {
    element.addEventListener('click', function(e) {
      // 只有当点击的是标题或折叠图标时才触发
      if (e.target === this || e.target.classList.contains('toggle-icon')) {
        const childList = this.nextElementSibling;
        if (childList && childList.tagName === 'UL') {
          // 切换显示状态
          childList.classList.toggle('hidden');
          
          // 切换图标
          const toggleIcon = this.querySelector('.toggle-icon');
          if (toggleIcon) {
            toggleIcon.textContent = childList.classList.contains('hidden') ? '▶' : '▼';
          }
        }
      }
    });
  });
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
  console.log(`最大深度: ${maxDepth}`);
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