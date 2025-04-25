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
| ContentMessageService     |<------>| BackgroundMessageService   |
|   - sendMessage()         |        |   - registerHandler()      |
|   - registerHandler()     |        |   - createMessageContext() |
|                           |        |                            |
|                           |        |                            |
| NavigationVisualizer      |        | NavigationManager          |
|   - initialize()          |        |   - handleNavigationCommitted() |
|   - refreshVisualization()|        |   - handleRegularNavigation()  |
|   - initDebugTools()      |        |   - trackNavigation()      |
|                           |        |                            |
| SessionServiceClient      |        | BackgroundSessionManager   |
|   - loadCurrentSession()  |------->|   - createSession()        |
|   - loadLatestSession()   |        |   - markSessionActivity()  |
|   - getSessionList()      |        |   - checkDayTransition()   |
|                           |        |                            |
| NodeManager               |        | SessionEventEmitter        |
|   - processSessionData()  |        |   - emitSessionCreated()   |
|   - processRecordsToNodes()|       |   - emitSessionActivated() |
|                           |        |                            |
| RenderingManager          |        | NodeTracker                |
|   - renderTree()          |        |   - trackNavigation()      |
|   - renderEmptySession()  |        |   - updateNode()           |
+---------------------------+        +----------------------------+
      |                                         |
      v                                         v
+-------------------+               +----------------------+
| 调试工具 (Dev)    |               | 环境配置系统         |
|-------------------|               |----------------------|
| DebugTools        |               | Environment          |
|   - checkData()   |               |   - isDev()          |
|   - checkDOM()    |               |   - isProd()         |
+-------------------+               +----------------------+
```

## 3. 主要组件说明

### 3.1 消息通信系统

#### 3.1.1 BackgroundMessageRouter

**职责**：后台脚本中的消息路由组件，负责接收来自内容脚本的消息，并将其分发到相应的处理程序。

**主要接口**：

- `registerHandler(action, handler)`: 注册消息处理函数
- `createMessageContext(message, sender, sendResponse)`: 创建消息上下文
- `handleMessage(message, sender, sendResponse)`: 处理收到的消息

#### 3.1.2 ContentMessageService

**职责**：内容脚本中的消息服务，负责与后台脚本通信。

**主要接口**：

- `sendMessage(action, data)`: 向后台发送消息
- `registerHandler(action, handler)`: 注册消息处理函数

### 3.2 会话管理系统

#### 3.2.1 BackgroundSessionManager

**职责**：在后台脚本中管理会话的创建、结束和管理，处理跨日转换和活动检测。

**主要接口**：

- `createSession(options?)`: 创建新会话
- `markSessionActivity()`: 标记会话活动，检查是否需要创建新会话
- `checkDayTransition()`: 检查是否跨越了工作日边界并需要创建新会话
- `getSessionDetails(sessionId)`: 获取会话详细信息，包括节点和边
- `getSessionNavigationData(sessionId)`: 获取会话导航数据
- `getLatestSession()`: 获取最新活跃会话

#### 3.2.2 SessionServiceClient

**职责**：在内容脚本中提供会话管理功能，处理会话加载和缓存。

**主要接口**：

- `loadCurrentSession()`: 加载当前会话
- `loadLatestSession()`: 加载最新活跃会话
- `loadSessionList()`: 加载会话列表
- `onSessionLoaded(callback)`: 注册会话加载监听器

#### 3.2.3 SessionViewController

**职责**：管理会话UI状态和视图更新。

**主要接口**：

- `initialize()`: 初始化会话控制器
- `loadCurrentSession()`: 加载当前会话
- `handleSessionLoaded(session)`: 处理会话加载完成事件
- `handleSessionSelected(sessionId)`: 处理会话选择

### 3.3 导航管理系统

#### 3.3.1 NavigationManager

**职责**：管理导航记录和节点/边关系，协调相关子组件。

**主要接口**：

- `initialize()`: 初始化导航管理器
- `queryNodes(queryParams)`: 查询符合条件的节点
- `updateNode(nodeId, updates)`: 更新节点状态
- `closeNodesForTab(tabId, sessionId)`: 关闭与标签页关联的节点
- `getSessionGraph(sessionId)`: 获取会话的完整图形数据

#### 3.3.2 NodeTracker

职责：追踪导航节点创建和更新。

主要接口：

- `trackNavigation(details, metadata?)`: 跟踪导航事件
- `updateNode(nodeId, updates)`: 更新节点信息
- `queryNodes(queryParams)`: 查询节点

#### 3.3.3 EdgeTracker

**职责**：管理导航边的创建和查询。

**主要接口**：

- `trackEdge(sourceId, targetId, type)`: 记录导航边
- `getEdgesForSession(sessionId)`: 获取会话的所有边

### 3.4 存储系统

#### 3.4.1 NavigationStorage

**职责**：提供数据持久化功能。

**主要接口**：

- `saveNode(node)`: 保存导航节点
- `getNode(nodeId)`: 获取导航节点
- `updateNode(nodeId, updates)`: 更新节点信息
- `saveEdge(edge)`: 保存导航边
- `getSessionGraph(sessionId)`: 获取会话的完整导航图谱
- `queryNodes(conditions)`: 根据条件查询节点
- `queryEdges(conditions)`: 根据条件查询边

#### 3.4.2 SessionStorage

**职责**：提供会话数据存储和访问功能。

**主要接口**：

- `createSession(session)`: 创建新会话
- `getSession(sessionId)`: 获取特定会话
- `updateSession(sessionId, updates)`: 更新会话信息
- `getCurrentSession()`: 获取当前会话
- `setCurrentSession(sessionId)`: 设置当前会话

### 3.5 可视化系统 (新增)

#### 3.5.1 RenderingManager

**职责**：协调不同渲染器，管理可视化的整体呈现。

**主要接口**：

- `renderVisualization(nodes, edges)`: 渲染可视化图形
- `switchRenderer(rendererType)`: 切换渲染器类型
- `renderEmptySession(session)`: 渲染空会话提示

#### 3.5.2 TreeRenderer

**职责**：将节点和边渲染为树状结构。

**主要接口**：

- `renderTreeLayout(nodes, edges, width, height)`: 渲染树形布局
- `updateTreeLayout(nodes, edges)`: 更新树形布局

#### 3.5.3 NodeManager (Content)

**职责**：处理会话数据，构建内容脚本端的节点和边数据结构。

**主要接口**：

- `processSessionData(session)`: 处理会话数据，构建节点和边
- `processRecordsToNodes(session)`: 将会话记录转换为节点
- `processEdges(session)`: 处理会话边数据

### 3.6 调试与环境系统 (新增)

#### 3.6.1 DebugTools

**职责**：提供开发阶段的调试功能。

**主要接口**：

- `checkData()`: 检查数据状态
- `checkDOM()`: 检查DOM状态
- `setupStorageListener()`: 设置存储变化监听器以接收调试命令

#### 3.6.2 Environment

**职责**：环境配置和检测，区分开发和生产环境。

**主要接口**：

- `isDev()`: 检查是否为开发环境
- `isProd()`: 检查是否为生产环境

#### 3.6.3 Logger

**职责**：提供分级日志记录功能，根据环境调整日志输出级别。

**主要接口**：

- `log()`: 记录普通日志 (仅开发环境)
- `debug()`: 记录调试日志 (仅开发环境)
- `warn()`: 记录警告信息
- `error()`: 记录错误信息

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
| - 用户点击        |--->| - 空闲时间检测         |--->| - 标记活动时间    |
| - 页面可见性变化  |    | - 工作日边界检查       |    | - 检查跨日转换    |
| - 键盘输入        |    |                       |    | - 关闭标签页节点  |
+-------------------+    +-----------------------+    +-------------------+
                                                             |
                                                             v
                               +------------------------------------+
                               | 会话事件系统                       |
                               +------------------------------------+
                               | SessionEventEmitter                |
                               | - emitSessionCreated               |
                               | - emitSessionActivated             |
                               | - emitSessionUpdated               |
                               | - emitSessionViewed                |
                               +------------------------------------+
```

关键更新：

1. **每日会话模式的工作日检测**:
   - 系统检查当前日期与会话日期是否跨越了工作日边界
   - 如果跨越工作日且空闲时间超过配置的阈值，创建新会话

2. **空闲时间监测**:
   - 使用配置的 `idleTimeoutMinutes` 判断空闲时间
   - 只有当空闲时间超过阈值，才检查是否需要创建新会话

3. **会话事件通知系统**:
   - 会话状态变化时通过 `SessionEventEmitter` 发出事件
   - 其他组件可以订阅这些事件以响应会话变化

### 4.3 导航记录流程

```
+------------------+     +--------------------+     +------------------+
| 用户交互事件     |     | 导航数据处理        |     | 数据存储和管理    |
+------------------+     +--------------------+     +------------------+
| - 链接点击       |     | - 创建导航节点      |     | - 保存节点       |
| - 表单提交       |---->| - 确定导航类型      |---->| - 创建关系边     |
| - 地址栏输入     |     | - 处理导航关系      |     | - 更新会话数据   |
| - JS导航         |     | - 收集元数据        |     | - 缓存管理       |
| - 历史导航       |     | - 处理父子关系      |     | - 数据组织       |
+------------------+     +--------------------+     +------------------+
                                                            |
                                                            v
                              +--------------------------------------------------+
                              | 可视化处理                                       |
                              +--------------------------------------------------+
                              | - 构建节点和边可视化对象                          |
                              | - 应用布局算法                                   |
                              | - 添加交互行为                                   |
                              | - 应用过滤规则                                   |
                              | - 更新视图和状态                                 |
                              +--------------------------------------------------+
```

详细流程说明：

1. 链接点击流程：
  - 内容脚本通过事件监听器检测到链接点击
  - 调用 `sendLinkClick()` 发送链接信息到后台
  - 后台的 `handleLinkClicked()` 方法处理信息，创建待处理导航记录
  - 当导航提交时，与待处理记录匹配并创建节点和边
2. 表单提交流程：
  - 内容脚本通过 `sendFormSubmit()` 发送表单信息到后台
  - 后台的 `handleFormSubmitted()` 方法处理表单信息
  - 创建待处理导航记录并等待导航提交
  - 导航提交后创建节点和边，建立关系
3. 导航提交流程：
  浏览器API触发导航提交事件
  `handleNavigationCommitted()` 处理事件
  根据过渡类型和限定词确定导航类型和打开目标
  调用 `handleRegularNavigation()` 处理实际导航
  创建或更新节点，建立导航关系

## 5. 关键对象模型

### 5.1 对象关系图

```
+---------------+     +-----------------+     +---------------+
| Session       |     | NavNode         |     | NavLink       |
+---------------+     +-----------------+     +---------------+
| id            |     | id              |     | id            |
| title         |     | url             |     | source        |
| startTime     |     | title           |     | target        |
| endTime       |<--->| favicon         |<--->| type          |
| records       |     | timestamp       |     | timestamp     |
| lastActivity  |     | isClosed        |     | sessionId     |
| isActive      |     | closeTime       |     |               |
+---------------+     +-----------------+     +---------------+
      |                      |                      |
      |                      |                      |
      v                      v                      v
+---------------------+  +----------------------+  +-------------------+
| BackgroundSessionMgr|  | NodeTracker          |  | RenderingManager  |
+---------------------+  +----------------------+  +-------------------+
| markSessionActivity |  | trackNavigation      |  | renderTree        |
| checkDayTransition  |  | updateNode           |  | renderForce       |
| getSessionGraph     |  | queryNodes           |  | applyFilters      |
+---------------------+  +----------------------+  +-------------------+
      |                      |                      |
      v                      v                      v
+---------------------+  +----------------------+  +-------------------+
| SessionServiceClient|  | NodeManager(Content) |  | DebugTools        |
+---------------------+  +----------------------+  +-------------------+
| loadCurrentSession  |  | processSessionData   |  | checkData         |
| loadLatestSession   |  | processRecordsToNodes|  | checkDOM          |
| loadSessionList     |  | getNodes/getEdges    |  | handleDebugCommand|
+---------------------+  +----------------------+  +-------------------+
```

### 5.2 关键数据模型

#### 5.2.1 BrowsingSession

```typescript
interface BrowsingSession {
  id: string;                  // 会话唯一标识符 (现在使用日期格式: "session-YYYYMMDD-HHMMSS-XXX")
  title: string;               // 会话标题
  startTime: number;           // 开始时间戳
  endTime: number | null;      // 结束时间戳(null表示未结束)
  lastActivity: number;        // 最后活动时间
  nodeCount: number;           // 节点数量
  isActive: boolean;           // 会话是否活跃
  records?: Record<string, NavNode>; // 会话中的节点记录
  edges?: Record<string, NavLink>;   // 会话中的边记录
  rootIds?: string[];          // 根节点ID列表
}
```

#### 5.2.2 NavNode

```typescript
interface NavNode {
  id: string;           // 节点唯一标识符
  sessionId: string;    // 所属会话ID
  url: string;          // 页面URL
  title: string;        // 页面标题
  favicon: string;      // 页面图标
  timestamp: number;    // 创建时间戳
  type: NavigationType; // 节点类型
  tabId: number;        // 关联的标签页ID
  parentId?: string;    // 父节点ID
  isClosed: boolean;    // 是否已关闭
  closeTime?: number;   // 关闭时间
  isSelfLoop?: boolean; // 是否存在自循环
}
```

#### 5.2.3 SessionEvent

```typescript
interface SessionEvent {
  type: SessionEventType;     // 事件类型
  sessionId: string;          // 相关会话ID
  timestamp: number;          // 事件时间戳
  data?: any;                 // 事件相关数据
}

enum SessionEventType {
  Created = 'session.created',
  Updated = 'session.updated',
  Activated = 'session.activated',
  Deactivated = 'session.deactivated',
  Viewed = 'session:viewed',
  Ended = 'session.ended',
  Deleted = 'session.deleted'
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

### 6.5 环境感知设计

系统实现了环境感知设计，通过版本号区分开发和生产环境：

- 版本号格式用于区分环境：开发版本以0.开头 (如0.1.0.1)，生产版本不以0开头 (如1.0.1)
- 根据环境自动调整功能和日志行为
- 生产环境中禁用调试工具和非关键日志

### 6.6 日志分级策略

新的日志系统采用分级策略，根据环境自动调整：

- 开发环境：显示所有级别 (DEBUG, INFO, WARN, ERROR)
- 生产环境：仅显示警告和错误 (WARN, ERROR)
- 支持按模块配置日志级别
- 提供丰富的格式化选项和上下文信息

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

Navigraph 系统架构采用了分层设计，通过内容脚本和后台脚本的协作，实现了完整的浏览导航记录与可视化功能。系统能够捕获各种导航事件，并通过消息通信机制在内容脚本和后台脚本间传递数据。

核心功能包括会话管理、导航记录、导航关系构建、数据存储和可视化展示，这些功能通过不同的组件协同工作，为用户提供完整的浏览历史可视化体验。系统的设计遵循关注点分离、单一职责和依赖注入等设计原则，使代码结构清晰、可维护性强，并为未来的功能扩展提供了灵活的基础架构。

系统现在能够更精确地处理跨日会话转换，根据环境自动调整行为，并通过事件系统实现更松散的组件耦合。这些改进使系统更加健壮、易于维护，并为开发人员提供了更好的调试工具和日志支持。