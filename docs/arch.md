# Navigraph 系统架构设计

## 1. 系统概述

Navigraph 是一个浏览器扩展，用于可视化用户的浏览历史和页面导航路径，帮助用户理解自己的浏览行为和信息流动模式。系统通过捕获用户浏览活动，组织成不同的会话，并以图形化方式展示导航关系。

### 1.1 核心功能

- 记录用户浏览活动和页面之间的导航关系
- 将浏览活动组织成不同会话
- 可视化展示页面导航树和关系图
- 支持多种会话管理模式
- 提供数据分析和导出功能

### 1.2 技术栈

- 前端: TypeScript, D3.js, CSS3
- 存储: IndexedDB, LocalStorage
- 浏览器扩展 API: Chrome Extensions API
- 构建工具: Webpack

## 2. 总体架构

Navigraph 采用分层架构，将系统划分为多个层次，每个层次有明确的职责边界。系统主要分为内容脚本层(Content Scripts)和后台脚本层(Background Scripts)两大部分，通过消息通信进行交互。

### 2.1 核心架构图

[核心架构图占位符]

### 2.2 分层设计

系统按照职责划分为以下几个层次：

1. **表示层**：负责用户界面和可视化展示
2. **业务逻辑层**：负责核心业务功能实现
3. **通信层**：负责不同组件之间的消息传递
4. **数据访问层**：负责数据的存储和检索

### 2.3 组件架构图

```
+---------------------------+        +----------------------------+
| 内容脚本层 (Content)      |        | 后台脚本层 (Background)    |
|---------------------------|        |----------------------------|
|                           |        |                            |
| ContentMessageService     |<------>| BackgroundMessageRouter    |
|   - sendMessage()         |        |   - handleMessage()        |
|   - registerHandler()     |        |   - routeMessage()         |
|                           |        |                            |
|                           |        |                            |
| NavigationVisualizer      |        | NavigationManager          |
|   - initialize()          |        |   - getNodeIdForTab()      |
|   - renderGraph()         |        |   - updatePageMetadata()   |
|                           |        |                            |
|                           |        |                            |
| SessionManager (Content)  |        | SessionManager (Background)|
|   - createNewSession()    |------->|   - createSession()        |
|   - loadSession()         |        |   - endSession()           |
|   - manageSessionsBySettings()     |   - setCurrentSession()    |
|                           |        |                            |
|                           |        |                            |
| NodeManager               |        | NavigationStorage          |
|   - processSessionData()  |        |   - getSessions()          |
|   - buildTree()           |        |   - getSession()           |
|   - convertToNode()       |        |   - saveSession()          |
|                           |        |   - getNavigationTree()    |
+---------------------------+        +----------------------------+
                                              |
                                              v
                                    +-------------------+
                                    |  本地存储         |
                                    |-------------------|
                                    | - IndexedDB       |
                                    | - LocalStorage    |
                                    +-------------------+
```

## 3. 主要组件说明

### 3.1 消息通信系统

#### 3.1.1 BackgroundMessageRouter

**职责**：后台脚本中的消息路由组件，负责接收来自内容脚本的消息，并将其分发到相应的处理程序。

**主要接口**：
- `handleMessage(message, sender, sendResponse)`: 处理收到的消息
- `routeMessage(ctx, message)`: 根据消息类型路由消息
- `routeSessionMessage(ctx, message)`: 处理会话相关消息
- `routeNavigationMessage(ctx, message)`: 处理导航相关消息

#### 3.1.2 ContentMessageService

**职责**：内容脚本中的消息服务，负责与后台脚本通信。

**主要接口**：
- `sendMessage(action, data)`: 向后台发送消息
- `registerHandler(action, handler)`: 注册消息处理函数
- `setupMessageListener()`: 设置消息监听器
- `setupPageActivityListeners()`: 设置页面活动监听

### 3.2 会话管理系统

#### 3.2.1 SessionManager (Background)

**职责**：在后台脚本中管理会话的创建、结束和管理。

**主要接口**：
- `createSession(title?)`: 创建新会话
- `endSession(sessionId)`: 结束会话
- `setCurrentSession(sessionId)`: 设置当前会话
- `handlePageActivity()`: 处理页面活动事件
- `manageSessionByMode(mode)`: 根据模式管理会话

#### 3.2.2 SessionManager (Content)

**职责**：在内容脚本中提供会话管理功能。

**主要接口**：
- `createNewSession(title?)`: 创建新会话
- `loadSession(sessionId)`: 加载会话详情
- `manageSessionsBySettings()`: 根据设置管理会话
- `manageDailySession()`: 管理每日工作模式会话
- `manageActivitySession()`: 管理活动感知模式会话
- `manageSmartSession()`: 管理智能模式会话

### 3.3 导航管理系统

#### 3.3.1 NavigationManager

**职责**：管理导航记录和页面元数据。

**主要接口**：
- `getNodeIdForTab(tabId, url)`: 获取标签页对应的节点ID
- `updatePageMetadata(tabId, metadata)`: 更新页面元数据
- `handleLinkClicked(tabId, linkInfo)`: 处理链接点击事件
- `handleFormSubmitted(tabId, formInfo)`: 处理表单提交事件
- `handleJsNavigation(tabId, data)`: 处理JavaScript导航事件

#### 3.3.2 NodeManager

**职责**：处理导航节点数据。

**主要接口**：
- `processSessionData(session)`: 处理会话数据
- `buildTree(nodes, edges)`: 构建导航树
- `convertToNavNode(record)`: 将数据记录转换为导航节点
- `convertToNavLink(edge)`: 将数据记录转换为导航连接

### 3.4 存储系统

#### 3.4.1 NavigationStorage

**职责**：提供数据持久化功能。

**主要接口**：
- `getSessions()`: 获取所有会话
- `getSession(sessionId)`: 获取特定会话
- `saveSession(session)`: 保存会话
- `getCurrentSessionId()`: 获取当前会话ID
- `setCurrentSession(sessionId)`: 设置当前会话
- `getNavigationTree()`: 获取导航树数据
- `clearAllRecords()`: 清除所有记录

### 3.5 可视化系统

#### 3.5.1 NavigationVisualizer

**职责**：负责导航数据的可视化展示。

**主要接口**：
- `initialize()`: 初始化可视化器
- `renderGraph(data)`: 渲染图形
- `updateLayout()`: 更新布局
- `applyFilters(filters)`: 应用过滤器

## 4. 数据流和关键流程

### 4.1 消息通信流程

```
+---------------+     +-----------------+     +----------------+
| 内容脚本      |     | 消息处理         |     | 业务逻辑处理    |
+---------------+     +-----------------+     +----------------+
| sendMessage() |---->| handleMessage() |---->| 会话管理        |
| 请求          |     | 消息路由         |     | 导航记录        |
|               |     |                 |     | 设置管理        |
|               |<----|                 |<----| 数据存储        |
| 响应处理      |     | 发送响应         |     |                |
+---------------+     +-----------------+     +----------------+
```

消息通信是系统的核心流程，内容脚本和后台脚本通过消息进行通信：

1. 内容脚本通过 `ContentMessageService.sendMessage()` 发送消息
2. 后台脚本的 `BackgroundMessageRouter.handleMessage()` 接收消息
3. 根据消息类型路由到相应的处理函数
4. 处理函数调用相应的业务逻辑
5. 处理完成后返回响应
6. 内容脚本接收响应并进行后续处理

### 4.2 会话管理流程

```
+-------------------+    +-----------------------+    +-------------------+
| 页面活动检测      |    | 会话模式判断           |    | 会话创建/管理     |
+-------------------+    +-----------------------+    +-------------------+
| - 页面获得焦点    |    | - 每日工作模式         |    | - 创建新会话      |
| - 用户点击        |--->| - 活动感知模式         |--->| - 结束当前会话    |
| - 页面可见性变化  |    | - 智能混合模式         |    | - 更新会话活动    |
| - 键盘输入        |    | - 手动模式             |    | - 加载会话数据    |
+-------------------+    +-----------------------+    +-------------------+
                                                             |
                                                             v
                                               +---------------------------+
                                               | 会话数据处理               |
                                               +---------------------------+
                                               | - 构建节点与连接           |
                                               | - 会话统计与分析           |
                                               | - 可视化图形更新           |
                                               +---------------------------+
```

会话管理是系统的核心业务流程：

1. 系统检测页面活动事件（焦点变化、可见性变化等）
2. 根据用户设置的会话模式决定如何管理会话
   - 每日工作模式：按日期自动创建会话
   - 活动感知模式：根据用户活动间隔创建会话
   - 智能混合模式：结合日期和活动模式
   - 手动模式：由用户手动创建和管理会话
3. 根据模式决定创建新会话、结束当前会话或更新活动时间
4. 处理会话数据，构建节点和连接
5. 更新可视化展示

### 4.3 导航记录流程

1. 用户在页面间导航（点击链接、提交表单、JS导航等）
2. 内容脚本捕获导航事件，发送消息到后台
3. 后台脚本接收消息，创建导航记录
4. 记录存储在当前会话中
5. 更新导航树数据
6. 内容脚本请求最新的导航树
7. 更新可视化展示

## 5. 关键对象模型

### 5.1 对象关系图

```
+---------------+     +-----------------+     +---------------+
| Session       |     | NavigationNode  |     | NavigationLink|
+---------------+     +-----------------+     +---------------+
| id            |     | id              |     | id            |
| title         |     | url             |     | source        |
| startTime     |     | title           |     | target        |
| endTime       |<--->| favicon         |<--->| type          |
| records       |     | timestamp       |     | timestamp     |
| lastActivity  |     | type            |     | action        |
+---------------+     +-----------------+     +---------------+
      |                      |                      |
      v                      v                      v
+---------------+     +-----------------+     +---------------+
| SessionManager|     | NodeManager     |     | VisualRenderer|
+---------------+     +-----------------+     +---------------+
| createSession |     | processData     |     | renderGraph   |
| endSession    |     | buildTree       |     | updateLayout  |
| manageByMode  |     | convertToNode   |     | applyFilters  |
+---------------+     +-----------------+     +---------------+
```

### 5.2 关键数据模型

#### 5.2.1 Session

```typescript
interface Session {
  id: string;                  // 会话唯一标识符
  title: string;               // 会话标题
  startTime: number;           // 开始时间戳
  endTime: number;             // 结束时间戳(0表示未结束)
  records: Record<string, any>; // 会话中的记录
  lastActivity?: number;       // 最后活动时间戳
}
```
#### 5.2.2 NavigationNode

```typescript
interface NavigationNode {
  id: string;           // 节点唯一标识符
  url: string;          // 页面URL
  title: string;        // 页面标题
  favicon: string;      // 页面图标
  timestamp: number;    // 创建时间戳
  type: string;         // 节点类型
  tabId?: number;       // 关联的标签页ID
  parentId?: string;    // 父节点ID
  referrer?: string;    // 引用页URL
  isClosed?: boolean;   // 是否已关闭
  children: NavigationNode[]; // 子节点
  depth: number;        // 在树中的深度
}
```

#### 5.2.3 NavigationLink

```typescript
interface NavigationLink {
  id: string;        // 连接唯一标识符
  source: string;    // 源节点ID
  target: string;    // 目标节点ID
  type: string;      // 连接类型
  timestamp: number; // 创建时间戳
  action: string;    // 导航动作类型
}
```

## 6. 设计原则与考量

### 6.1 关注点分离

系统设计遵循关注点分离原则，将不同职责划分到独立的组件：

- 通信层负责消息传递
- 业务逻辑层负责实际功能实现
- 数据访问层负责存储操作

### 6.2 单一职责原则

每个组件都有明确定义的单一职责：

- MessageRouter 仅负责消息路由
- SessionManager 仅负责会话管理
- NavigationStorage 仅负责数据访问

### 6.3 依赖注入

系统通过依赖注入解耦组件：

- NavigationManager 向各组件提供依赖
- 组件通过依赖注入获取所需服务

### 6.4 领域划分

- 后台脚本和内容脚本有明确的职责边界
- 共享核心领域模型（如 Session, NavigationNode）

## 7. 未来扩展考虑

### 7.1 可扩展性考虑

- 消息系统支持添加新的消息类型
- 会话管理支持新的会话模式
- 可视化系统支持多种展示方式

### 7.2 潜在扩展方向

- 多设备同步支持
- 高级数据分析功能
- 自定义可视化模板
- AI辅助的浏览模式分析

## 8. 总结

Navigraph 系统架构采用了分层设计，将系统分为内容脚本层和后台脚本层，通过消息通信进行交互。系统遵循关注点分离、单一职责和依赖注入等设计原则，使代码结构清晰、可维护性强。

核心功能包括会话管理、导航记录、数据存储和可视化展示，这些功能通过不同的组件协同工作，为用户提供完整的浏览历史可视化体验。系统的设计考虑了未来扩展的可能性，为添加新功能提供了灵活的架构基础。