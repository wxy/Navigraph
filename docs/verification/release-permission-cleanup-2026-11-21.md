# 1.2.5 发布权限清理验证（2026-11-21）

baseCommit：02d1ad0a778b93e6ae99ce302384002898dd9e43。产品运行配置仅两个文件变更：manifest.permissions移除无实际生产调用的activeTab/contextMenus；EnvironmentPlugin既有isDev分支就近补回contextMenus，保留开发调试菜单。版本仍1.2.5，无其它运行时代码、依赖或状态机修改。

在精确base git archive的系统临时Navigraph副本覆盖这两文件，npm ci --ignore-scripts；npm run build:dev；保存dev manifest；npm run build（含tsc --noEmit）。均通过，生产仅既有D3体积warning。dev manifest实测0.1.2.5、含contextMenus且无activeTab；production实测1.2.5、两权限皆无。

最终ZIP解压产物验收通过：真实/a→endSession→SPA/b、/c正确根节点/parent链；两视图SVG、设置读取、root README及9帮助资源加载。另段实际帮助按钮HEAD docs/README-zh_CN.md为200，并打开正确GitHub文档URL；远程响应截获，仅验URL，不声称GitHub线上可用。v1/v2准确历史schema合成旧库各迁移为v3，stored节点/边、metadata非图字段与settings保留；内嵌missing图记录抽出，同ID已有记录不覆盖，新增索引回填。README页发RPC被正确拒绝的夹具已改用options唤醒；仅重跑迁移段。合成迁移不等于真实商店覆盖升级。

环境：macOS26.6.2(25G83)/arm64、Node26.7.0/npm11.19.0、Playwright1.62.1、独立headless完整Chrome151.0.7922.34。无日常browser/profile操作，无unit新建；未单独跑dev浏览器、全套旧测试、最低Chrome矩阵、长时性能或真实商店升级。

冻结两文件按相对路径排序、path+LF+bytes+LF的SHA256为bd557468c5fd81ad3217d17a213aade2bb6b3638f3c43384affcacd23c48cc50；完整非docs产品输入c652448abd5ea6712f24272a0f8067c7d99383c5e5284018b06bc74ea4762f15。运行时已测ZIP SHA256为62d134c166e867eeb2301bb2de8ccbc59b594e59edf225cd796bb249b4082dc0。构建后源集合仅生成器9locale差异，源树未原地build。

完整包文件清单/尺寸/逐文件hash、依赖许可证来源、bundle hash、命令与运行夹具保留在本地正式release/1.2.5/BUILD-INFO.json和RELEASE-CHECKS.md；zip/正式物料不加入Git。过程脚本/log/profile仅temp，root统一清理。补充PR尚未合并，不宣称发布或提审。


补充静态校正：9语言帮助README各仅修改一条隐私bullet，准确区分“浏览历史保存在本地浏览器配置文件；偏好可能随浏览器账号同步”，结构/图片/功能文字保持原样。package-info.md仅删除activeTab/contextMenus理由、补alarms/favicon、限定webRequest为main-frame redirect，并在storage/隐私与对应安全表述区分本地历史/同步偏好，作为商店理由来源。这10个文档来源改动与上述2个配置文件一同进入补充PR。

文案校正只做静态核对：各帮助文件行数一致、仅目标bullet一行变化；package-info权限条目与当前manifest/实现相符。同步9帮助文本到temp source/dist并重打包；未重新编译或重复browser/migration。最终ZIP CRC/路径清单与逐entry字节检查通过，仅9个帮助MD变化，所有JS/CSS/manifest等entry逐字不变。最终ZIP SHA256 c72427ea523f362686c8bb06a286db0b94bfe78b56595789da973a86971d027c，717648 bytes；不能将前述运行时结果说成最终文字ZIP重新跑过。

当前非docs产品源码hash9fb055ec40e5e5be7381dc3fc0ec5f13ed7fb9319706bf7caa4295b13e233d11；12个产品/发布来源修改文件hash06a26bc485bf86cb5afa8d499e60c59c64dbdc20eaf0c9c5c9efb44fde85d3eb。两配置冻结hashbd557...c50未变。BUILD-INFO保留真实compiledSource/buildInput hash，另记currentSource/postBuildStaticDocs；package-info.md不编译且不入包，未伪造新编译来源。
