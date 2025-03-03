import { TabTracker } from './tab-manager.js';

/**
 * 主要的后台脚本，负责初始化跟踪器和处理消息
 */

// 创建并初始化标签页跟踪器
const tabTracker = new TabTracker();
console.log('Navigraph 扩展已启动');

// 处理扩展安装或更新
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Navigraph 扩展首次安装');
    
    // 显示欢迎页面或教程
    chrome.tabs.create({
      url: chrome.runtime.getURL('welcome.html'),
      active: true
    });
  } else if (details.reason === 'update') {
    console.log(`Navigraph 扩展已更新到版本 ${chrome.runtime.getManifest().version}`);
  }
});

// 处理扩展图标点击事件
chrome.action.onClicked.addListener(async () => {
  console.log('扩展图标被点击');
  
  try {
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 检查是否已经打开了导航树页面
    const indexUrl = chrome.runtime.getURL('dist/content/index.html');
    const existingTab = tabs.find(tab => tab.url?.startsWith(indexUrl));
    
    if (existingTab && existingTab.id) {
      // 如果已经打开，切换到该标签页
      console.log('导航树页面已打开，切换到该标签页');
      await chrome.tabs.update(existingTab.id, { active: true });
      
      // 如果标签页在其他窗口，则聚焦该窗口
      if (existingTab.windowId) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
      }
    } else {
      // 如果没有打开，创建新标签页
      console.log('创建新导航树页面');
      await chrome.tabs.create({ url: indexUrl });
    }
  } catch (error) {
    console.error('打开导航树页面失败:', error);
  }
});

// 处理来自弹出窗口的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到消息:', request, '来自:', sender);
  
  // 防止消息处理超时，返回true表示会异步响应
  let willHandleAsyncResponse = false;
  
  try {
    // 获取导航树数据
    if (request.action === 'getNavigationTree') {
      willHandleAsyncResponse = true;
      handleGetNavigationTree(sendResponse, request.options);
    } else if (request.action === 'searchNavigation') {
      willHandleAsyncResponse = true;
      handleSearchRecords(request.query ? { url: request.query } : {}, sendResponse);
    } else if (request.action === 'clearAllData') {
      willHandleAsyncResponse = true;
      handleClearAllRecords(sendResponse);
    }
    
    // ... 其他处理保持不变 ...
  } catch (error) {
    // ... 错误处理保持不变 ...
  }
  
  return willHandleAsyncResponse;
});

/**
 * 处理获取导航树数据请求
 */
async function handleGetNavigationTree(sendResponse: (response: any) => void, options: any = {}): Promise<void> {
  try {
    console.log('获取导航树数据...', options);
    
    // 获取导航树
    const treeData = await tabTracker.getStorage().getNavigationTree();
    
    // 检查是否需要提供上次更新时间（用于增量更新）
    if (options && options.lastUpdate) {
      // 如果客户端提供了上次更新时间，标记在此时间后更新的节点
      const lastUpdateTime = parseInt(options.lastUpdate);
      if (!isNaN(lastUpdateTime)) {
        markUpdatedNodes(treeData, lastUpdateTime);
      }
    }
    
    // 记录调试信息
    const dayCount = Object.keys(treeData.days || {}).length;
    
    // 如果数据为空，记录特别调试信息
    if (dayCount === 0) {
      console.warn('返回的导航树没有日期数据');
      const recordCount = await getRecordCount();
      console.log(`数据库中有 ${recordCount} 条记录`);
    } else {
      console.log(`导航树数据已准备好: ${dayCount} 天的数据`);
    }
    
    // 发送响应
    sendResponse({
      success: true,
      data: treeData,
      timestamp: Date.now() // 添加当前时间戳，客户端用于增量更新
    });
  } catch (error) {
    console.error('获取导航树失败:', error);
    sendResponse({
      success: false,
      error: String(error)
    });
  }
}

/**
 * 标记指定时间后更新的节点
 */
function markUpdatedNodes(treeData: any, lastUpdateTime: number): void {
  // 遍历所有日期和节点，标记新增或更新的
  for (const date in treeData.days) {
    const dateData = treeData.days[date];
    
    // 如果整个日期是新的（时间戳大于上次更新时间）
    const dateTimestamp = new Date(date).getTime();
    if (dateTimestamp > lastUpdateTime) {
      dateData.isNew = true;
      continue; // 跳过，因为整个日期都是新的
    }
    
    // 检查各个节点
    for (const nodeId in dateData.nodes) {
      const node = dateData.nodes[nodeId];
      if (node.record.timestamp > lastUpdateTime) {
        node.isUpdated = true;
      }
    }
  }
}

/**
 * 处理清空所有记录请求
 */
async function handleClearAllRecords(sendResponse: (response: any) => void): Promise<void> {
  try {
    console.log('清空所有导航记录...');
    
    // 清空所有记录
    const success = await tabTracker.getStorage().clearAllRecords();
    
    // 发送响应
    sendResponse({
      success: success
    });
  } catch (error) {
    console.error('清空记录失败:', error);
    sendResponse({
      success: false,
      error: String(error)
    });
  }
}

/**
 * 处理搜索记录请求
 */
async function handleSearchRecords(
  criteria: { url?: string; tabId?: number; timeRange?: [number, number] },
  sendResponse: (response: any) => void
): Promise<void> {
  try {
    console.log('搜索记录:', criteria);
    
    // 搜索记录
    const records = await tabTracker.getStorage().findRecords(criteria);
    
    // 发送响应
    sendResponse({
      success: true,
      data: records
    });
  } catch (error) {
    console.error('搜索记录失败:', error);
    sendResponse({
      success: false,
      error: String(error)
    });
  }
}

/**
 * 处理保存测试记录请求
 */
async function handleSaveTestRecord(record: any, sendResponse: (response: any) => void): Promise<void> {
  try {
    console.log('保存测试记录:', record);
    
    // 保存测试记录
    const recordId = await tabTracker.getStorage().saveRecord(record);
    
    // 发送响应
    sendResponse({
      success: true,
      recordId: recordId
    });
  } catch (error) {
    console.error('保存测试记录失败:', error);
    sendResponse({
      success: false,
      error: String(error)
    });
  }
}

/**
 * 辅助函数: 获取记录总数
 */
async function getRecordCount(): Promise<number> {
  try {
    const allRecords = await tabTracker.getStorage().getAllRecords();
    return allRecords.length;
  } catch (error) {
    console.error('获取记录总数失败:', error);
    return -1;
  }
}

// 导出tabTracker以供测试使用
export { tabTracker };