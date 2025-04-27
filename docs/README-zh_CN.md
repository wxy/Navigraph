Navigraph: 可视化浏览历史记录
===

> 直观地可视化您的浏览路径和网页导航历史，帮助您理解信息流动和记忆浏览轨迹。

## 主要功能

- 📊 **可视化浏览历史** - 以树形图和关系图展示您的网页浏览轨迹
- 🗂️ **会话管理** - 自动将浏览活动组织为有意义的会话
- 🔄 **实时更新** - 浏览时动态更新导航图
- 🛡️ **隐私保护** - 所有数据本地存储，不会上传到云端
- 🌙 **黑暗模式** - 支持深色主题，保护您的眼睛

## 安装方式

### 从Chrome网上应用店安装

1. 访问 [Chrome 网上应用店 Navigraph 页面](https://chrome.google.com/webstore/detail/navigraph/[extension-id])
2. 点击“添加至 Chrome” 按钮

### 开发者安装

1. 下载此仓库 `git clone https://github.com/wxy/Navigraph.git`
2. 安装依赖 `npm install`
3. 构建扩展 `npm run build`
4. 在 Chrome 浏览器中打开 `chrome://extensions/`
5. 开启“开发者模式”
6. 点击“加载已解压的扩展”，选择 `dist` 目录

## 使用指南

1. 安装扩展后，点击工具栏中的 Navigraph 图标
2. 默认显示当前会话的浏览历史可视化图
3. 使用筛选工具查看特定类型的导航
4. 点击节点查看页面详情或重新访问
5. 使用会话日历切换不同日期的浏览记录

## 技术架构

Navigraph采用现代浏览器扩展架构设计：

- **前端**：TypeScript、D3.js、CSS3
- **存储**：IndexedDB、LocalStorage
- **浏览器API**：Chrome Extensions API
- **构建工具**：Webpack

## 贡献指南

我们欢迎各种形式的贡献！如果您想参与此项目：

1. 复刻此仓库
2. 创建您的特性分支（`git checkout -b feature/amazing-feature`）
3. 提交您的更改（`git commit -m 'Add some amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 开启一个拉取请求

## 许可证

此项目采用 MIT 许可证 — 详情请查看 [LICENSE](LICENSE) 文件

## 联系方式

如有问题或建议，请通过以下方式联系我们：

- 提交议题：[GitHub 议题](https://github.com/wxy/Navigraph/issues)
