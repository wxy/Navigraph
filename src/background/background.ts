import { TabTracker } from './tab-manager.js';
import { NavigationStorage } from '../lib/storage';

/**
 * 主要的后台脚本，负责初始化跟踪器和处理消息
 */

// 创建并初始化标签页跟踪器
const tabTracker = new TabTracker();
console.log('Navigraph 扩展已启动');

// 使用tabTracker中的存储实例，而不是创建新实例
const storage = tabTracker.getStorage();

// 处理扩展安装或更新
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Navigraph 扩展首次安装');
    
    // 显示欢迎页面或教程
    chrome.tabs.create({
      url: chrome.runtime.getURL('dist/content/index.html'),
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

// 删除旧的重复监听器代码，保留这一个统一的监听器
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message);
  
  (async () => {
    try {
      // 获取导航树数据
      if (message.action === 'getNavigationTree') {
        await handleGetNavigationTree(sendResponse, message.options);
        return;
      }
      
      // 搜索导航记录
      if (message.action === 'searchNavigation') {
        await handleSearchRecords(message.query ? { url: message.query } : {}, sendResponse);
        return;
      }
      
      // 清除所有数据
      if (message.action === 'clearAllData') {
        await handleClearAllRecords(sendResponse);
        return;
      }
      
      // 获取会话列表
      if (message.action === 'getSessions') {
        console.log('处理getSessions请求...');
        
        // 确保存储已初始化
        if (!storage.isInitialized()) {
          console.log('存储尚未初始化，执行初始化...');
          await storage.initialize();
        }
        
        const sessions = await storage.querySessionsByTimeRange(
          Date.now() - 30 * 24 * 60 * 60 * 1000, // 30天内
          Date.now()
        );
        
        console.log(`找到${sessions.length}个会话`);
        sessions.sort((a, b) => b.startTime - a.startTime);
        
        sendResponse({
          success: true,
          data: sessions
        });
        return;
      }
      
      // 获取会话详情
      if (message.action === 'getSessionDetails') {
        console.log(`获取会话详情: ${message.sessionId}`);
        
        if (!message.sessionId) {
          console.error('请求中缺少sessionId');
          sendResponse({
            success: false,
            error: '会话ID不能为空'
          });
          return;
        }
        
        try {
          const sessionDetails = await storage.getSessionDetails(message.sessionId);
          console.log(`成功获取会话详情: ${sessionDetails ? '有数据' : '无数据'}`);
          
          if (!sessionDetails) {
            sendResponse({
              success: false,
              error: `未找到ID为${message.sessionId}的会话`
            });
            return;
          }
          
          sendResponse({
            success: true,
            data: sessionDetails
          });
        } catch (sessionError) {
          console.error('获取会话详情失败:', sessionError);
          sendResponse({
            success: false,
            error: sessionError instanceof Error ? sessionError.message : String(sessionError)
          });
        }
        return;
      }
      
/*      // 创建测试会话 (用于调试)
      if (message.action === 'createTestSession') {
        try {
          // 创建会话
          const sessionId = await storage.createSession();
          console.log(`创建测试会话: ${sessionId}`);
          
          // 创建测试记录 - 使用saveRecord而不是addRecord
          const record1 = await storage.saveRecord({
            url: 'https://example.com',
            title: '测试页面1',
            favicon: 'favicon.png',
            timestamp: Date.now(),
            tabId: 1,
            navigationType: 'initial',
            sessionId: sessionId // 确保记录关联到正确的会话
          });
          
          const record2 = await storage.saveRecord({
            url: 'https://example.com/page2',
            title: '测试页面2',
            favicon: 'favicon.png',
            timestamp: Date.now() + 1000,
            tabId: 1,
            navigationType: 'link_click',
            parentId: record1.id,
            sessionId: sessionId // 确保记录关联到正确的会话
          });
          
          // 添加导航边 - 使用saveEdge而不是addEdge
          await storage.saveEdge({
            sourceId: record1.id!,
            targetId: record2.id!,
            timestamp: Date.now() + 1000,
            action: 'link_click',
            sequence: 1,
            sessionId: sessionId // 确保边关联到正确的会话
          });
          
          console.log('测试数据已创建');
          
          sendResponse({
            success: true,
            message: '测试会话已创建',
            sessionId: sessionId
          });
        } catch (testError) {
          console.error('创建测试会话失败:', testError);
          sendResponse({
            success: false,
            error: testError instanceof Error ? testError.message : String(testError)
          });
        }
        return;
      }
      */
      // 未知操作
      sendResponse({
        success: false,
        error: '未知操作'
      });
      
    } catch (error) {
      console.error('处理消息失败:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();
  
  // 返回true表示将异步发送响应
  return true;
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
    const nodeCount = treeData.nodes.length;
    const edgeCount = treeData.edges.length;
    
    // 如果数据为空，记录特别调试信息
    if (nodeCount === 0) {
      console.warn('返回的导航树没有节点数据');
      const recordCount = await getRecordCount();
      console.log(`数据库中有 ${recordCount} 条记录`);
    } else {
      console.log(`导航树数据已准备好: ${nodeCount} 个节点, ${edgeCount} 条边`);
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
function markUpdatedNodes(treeData: { nodes: any[]; edges: any[] }, lastUpdateTime: number): void {
  // 遍历所有节点，标记新增或更新的
  for (const node of treeData.nodes) {
    if (node.timestamp > lastUpdateTime) {
      node.isUpdated = true;
    }
  }
  
  // 遍历所有边，标记新增或更新的
  for (const edge of treeData.edges) {
    if (edge.timestamp > lastUpdateTime) {
      edge.isUpdated = true;
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

// 初始化
(async function init() {
  try {
    console.log('导航图谱后台初始化开始...');
    await storage.initialize();
    
    // 创建初始会话（如果不存在）
    const currentSession = await storage.getCurrentSession();
    if (!currentSession) {
      console.log('创建初始会话...');
      await storage.createSession();
    }
    
    console.log('导航图谱后台初始化成功');
  } catch (error) {
    console.error('导航图谱后台初始化失败:', error);
  }
})();