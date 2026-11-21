# Navigraph 全库审计收尾与 1.2.5 候选（2026-11-21）

## 目标与版本

本轮完成 PR #57 的追加审核、必要修复和合并，并审计现有扩展全库的严重安全、性能、持久化及设计缺陷。保留树图和瀑布图，不做海洋视图或整体架构重写。PR #57 合并提交为 `60d9720539d9ea3efd60209c3dedd344b067a85c`；本候选从该提交建立独立 PR 分支，源码 manifest 从 1.2.4 更新为 1.2.5。

本报告记录静态审计与本轮直接路径验证，不把旧报告的 PASS 当成本轮最终版本全套重跑。最终验证来源和可重建输入见[本轮 1.2.5 验证报告](../verification/audit-closeout-1.2.5-2026-11-21.md)。

## 覆盖与方法

初始审计快照 `0105682` 有 108 个 TypeScript 文件、30,181 行；另检查 manifest、构建及翻译脚本、HTML/CSS、锁定依赖和本地 D3。随后对 PR57 追加变更及本候选逐项增量复审。按信任边界和核心路径审计，不能据文件数量宣称逐行形式化验证。

|范围|检查内容|方式|
|---|---|---|
|消息与权限|全部 runtime handlers、sender/顶层文档/节点归属、特权扩展页、WAR、CSP、无痕范围|独立安全静态审计；相关健康 GET 实际越权拒绝|
|网页与渲染输入|四个构建入口、URL/title/favicon、DOM sinks、外联、翻译密钥和打包边界|独立安全审计；核对官方 Chrome 文档|
|持久化与会话|IDB migration/事务/清理、会话建立/结束/删除、设置、队列、启动和 Worker 重启|独立后台审计；严重发现先复现再修复|
|后台性能|普通记录、索引查询、维护、缓存容量/失效、快照、alarms、标签生命周期|调用路径和已有性能证据复核；本轮故障 E2E|
|前端与设置|两种 renderer、抽屉/滚轮/rAF/定时器、分页、会话选择、设置交互|独立前端静态审计；代表性运行验证|
|构建和依赖|锁文件公告、开发与运行时归属、生产构建、vendored 库一致性|npm audit、npm ci、typecheck/webpack、字节比较|

开发子代理实施及运行验证，后台 Reviewer 与安全/前端 Reviewer 独立只读审查，管理者按证据裁决和控制 Git/PR。Reviewer 的只读为指令约束，不宣称专用沙箱隔离。使用 goal-driven-review 和 hypothesis-driven-debugging；现代 Web 指南用于核对 DOM 安全及主线程资源，不因通用建议加入新的前端 API、兼容层或防御状态机。

## 重大问题及处置

|编号/等级|可达触发、影响与证据|处置|
|---|---|---|
|A1 / P1|PR57 启动初始化失败时没有标记健康异常，且健康 GET 被已拒绝的 ready 阻断。独立浏览器中 IDB.open 故障导致空 badge、GET 失败；迟到 restore 还可能恢复 healthy。|已在 PR57 修复并验证、合并：失败先标 error；健康 GET 保留授权、专门绕开 ready；普通消息仍等待 ready。|
|A2 / P1|SettingsService.initialize 吞掉 sync 设置读取错误。Worker 没有 localStorage 缓存；连续两次读取失败后，以默认保留30天执行清理，即使真实持久化偏好为0/永久。隔离库中已用真实导航记录 aging 到60天、预存0、重启 Worker 仅拒绝前两次读取，复现旧记录被删。|1.2.5候选已修复并定向验证：初始化重新抛出读取错误，第一次失败即停止，旧记录不变、健康状态error可读；下一Worker正常加载0并保留旧记录。正常记录另由fresh/smoke验证。|
|A3 / P1|会话结束后已打开 SPA 继续 pushState，ensureRecordingSession 会新建会话并重置标签历史；history handler 无 parent 直接 return。实际同一 HTTP 文档在结束会话后跳 b/c，两条记录均缺失。|1.2.5候选已修复并定向验证：无parent沿原路径保存新session根节点，有parent才建边；b/c均入库且c.parentId=b.id，片段跳转、删除/清空后新根通过，旧session与原记录不改。|

严重程度根据数据损失和核心记录中断后果判断；设置存储故障实际发生频率未知，未编造概率。对其他读写失败不新增通用重试、自动补回或批量重建。健康提示中的“恢复”只表示后续某次实际提交，无法补回过去漏记；初始化失败后本 Worker 停止正常处理，后续 Worker 成功初始化才能恢复。

## 安全专项结论

限定所审源码和信任模型，未发现有证据可由普通网页直接触发的严重越权、历史上传或 DOM 注入路径。此结论不是“全项目不存在漏洞”。

- 实际注入网页的是 navigraph.ts，只构造 getTabId/getNodeId 消息，无网页 postMessage/DOM 数据桥接；读取历史、清除及设置属于精确扩展页授权。
- WAR 为空，MV3 的默认 CSP 仍约束本地脚本；未为满足审计添加无必要的 CSP/Trusted Types 兼容机制。[Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)、[WAR](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)。
- 标题、URL、错误信息主要经 textContent/D3.text；剩余 HTML sink 为包内常量/翻译，未找到网页输入到 HTML sink 的可达路径。详情链接使用 noopener/noreferrer，favicon 经 Chrome 本地 _favicon origin 构造。[官方 favicon](https://developer.chrome.com/docs/extensions/how-to/ui/favicons)。
- 未找到运行时上传、密码/表单值/Cookie/请求体/响应体采集路径，webRequest 只处理主框架重定向。完整 URL 本地保存属于既定功能，会包含 URL 自身携带的敏感信息；不把本地存储等同于没有隐私取舍。
- 未发现受控文件中的匹配私钥或令牌；翻译工具从环境取密钥，构建规则不复制 .env。此检查不是完整凭据或供应链认证。
- 仓库 d3.v7.min.js 与 npm ci 锁定的 d3@7.9.0/dist/d3.min.js 逐字相同，SHA256 `f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539`。

PR57 的 BFCache 意见被证据排除：实际扩展顶层页面往返为新文档，CDP 为 SchemeNotHTTPOrHTTPS/EmbedderExtensionFrame；[Chromium 文档](https://chromium.googlesource.com/chromium/src/+/HEAD/extensions/docs/back_forward_cache.md)明确顶层 chrome-extension 主框架不具资格。未用合成 persisted 事件制造产品缺陷。

## 依赖公告

2026-11-21 的锁文件审计命中3个包（high/moderate/low各1），均为 dev transitive，不是扩展运行时新增高危漏洞。只更新现有约束允许的补丁，package.json 不变：

|包|原锁 → 候选锁|归属/公告|
|---|---|---|
|fast-uri|3.1.8 → 3.1.9|AJV/schema-utils 工具链；[公告](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)|
|follow-redirects|1.16.1 → 1.16.3|开发翻译工具 axios；[公告](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)|
|serialize-javascript|7.1.2 → 7.1.4|copy-webpack-plugin；[公告](https://github.com/advisories/GHSA-m5mm-p8h7-m29v)|

最终候选锁已实际 npm ci --ignore-scripts、npm run build（含typecheck）和 npm audit --json，通过；2026-11-21 审计 total=0。这是当日公告库结果，不代表未来没有公告。没有使用 --force 或扩大依赖主版本。

## 非阻塞遗留事项

以下为静态确认或此前已有证据的事项，未在本轮扩大修复。没有新的浏览器复现时不宣称动态通过；不影响本轮“防止误删与恢复持续记录”的直接验收。

|等级/位置|影响与触发|后续方向|
|---|---|---|
|P2 / CalendarSessionSelector.ts:455–458|先截取最新500个会话再按月份筛选，长期保留/多会话时旧会话无法从日历选择；底层数据未删除。|按可见月份先筛选，再选择必要分页/限制。|
|P2 / WaterfallRenderer.ts:1529–1556|1000个10分钟分段只覆盖约6天22小时40分；manual长会话同页跨度更大时旧节点漏画，计数仍包含。树视图及底层记录仍在。|合并空时间段或覆盖完整页内范围，避免仅增加固定上限。|
|P2 / bg-message-service.ts payload 选择|以 pageInfo/linkInfo/formInfo truthiness 选验证对象，部分 handler 却读顶层字段。受控 content script 可伪造历史；未证实真实网页可构造该消息，不开放读全库/删库/设置。|按 action 使用实际 payload 做一次边界校验。|
|P2 / settings service/options|多页整对象保存可能覆盖设置；通知可能覆盖未保存草稿。|明确字段提交和草稿边界；不把普通重构纳入补丁。|
|P2 / 查询与维护|冷查询、深offset、全局revision失效、逐会话count、关tab扫open keys仍有规模成本；普通页持有量有界不等于所有DB工作恒定。|按实际瓶颈再选游标分页/局部失效/按tab索引，不先扩建缓存系统。|
|P3 / 日历弹层|反复打开时匿名关闭监听器可累积；轻量操作且随页面销毁，未见持续空转。|保持稳定函数引用并随控件清理。|
|产品/架构|暂停/排除站点、容量反馈和更清晰回看价值尚未补齐；大型renderer和历史兼容接口仍有维护成本。|另开产品设计阶段，再按独立职责改造；不据函数长度决定推倒重写。|

## 验证边界与收尾条件

候选核心验收为限定范围 PASS：两条已证实的P1均已修复，安全/前端增量审核无新增阻塞；独立Reviewer核对原始分段结果与最终构建来源。候选改动仅4个产品输入（manifest.json、package-lock.json、navigation-event-handler.ts、settings/service.ts），按相对路径排序后连续拼接 `path + LF + bytes + LF` 的SHA256为 `4874b0aef97a71c0bb956c148132074c3fafb869ac8659071c051d2f77bb9aee`；以此基线与差异绑定结论，报告文件不算运行逻辑。

- 实际执行：两条P1基线复现；修复后故障读取不删/正常重启保留；SPA根、后继父节点关系及fragment；结束并确认删除、清空后继续记录；无key首次安装默认30天可记录；options读取失败的现有错误提示。边对象保存路径经源码核对，夹具没有直接查询edges store断言。
- 实际执行：1200条合成节点加1条真实正常导航，输入持久化后重启Worker，再从普通UI切换瀑布/树图，两视图各持有当前100节点且SVG存在。这是代表性路径验证，不是CPU、堆峰值或绘制完整性基准。
- 实际执行：最终锁安装、类型检查、生产构建、依赖公告审计、差异检查。仅保留既有D3体积warning。
- 夹具纠正：删除场景初次缺confirm，被既有授权要求拒绝，补齐后验收；smoke初次raw IDB seed绕开产品缓存失效，改为seed后Worker重启。没有为夹具问题修改产品或把重跑当成首次成功。

直接路径脚本、环境、实际结果和bundle哈希均记录在验证报告。PR57此前的23项分段场景及本轮追加启动审查另有报告，未把它们汇总成当前候选整套回归。

未做全天 CPU/内存/能耗采样（此前用户取消，未擅自恢复）、真实磁盘写满、所有旧报告的整套回归、最低 Chrome106/Node20.9矩阵、商店审核/安装升级验收或海洋视图。静态未发现新的无界热点，不等同于全天资源占用已证实很低。已有索引和分页收益可参考历史报告，不将旧单次采样解释为稳定速度倍数或新版本峰值内存测量。

本轮只提交源码、锁文件、版本字段及报告。测试数据库、profile、浏览器、脚本、完整日志和构建均由管理者在审核后清理。1.2.5 为待审核候选；新 PR 的合入、打 tag、GitHub Release 和商店发布分别按用户授权执行，不以本报告宣称已经发布。
