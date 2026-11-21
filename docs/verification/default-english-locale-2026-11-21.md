# 默认英文fallback验证（2026-11-21）

base=e594a8451f9837a1f600883ba0306dcd5717bd27，3个最小源码变更：manifest.default_locale=en；webpack.common的I18nPlugin显式defaultLang=zh_CN（中文源码提取目录，不是Chrome fallback）；仅en catalog补缺失content_unknown_time='Unknown time'。DEFAULT_SETTINGS.forcedLocale仍system，用户显式选语言保留；不强制全部用户英文，不改生成器引擎或其它8catalog源。

判别基线：临时只改manifest=en后production build将英文1322→1254keys，1244个既有message值改写、1243含汉字。最小方案最终build/typecheck通过：English源1323→包1254，仍存既有message0改写、所有message无汉字。现有生成器删69旧key；其余8locale补缺content_unknown_time为中文，zh_CN的options_settings_saved_refresh按源码更新一值，其它locale仍存message0改写；这些既有build差异如实记入候选报告，未回写所有catalog。

最终候选ZIP的真实options en/zh_CN选择、标题显示及reload后storage.sync偏好保留已通过；native getManifest.default_locale观察为en，localized manifest.name始终与实际中文native appName一致。requested en/zh-CN/es的getUILanguage分别en/zh-CN/es-ES，但getMessage均命中zh_CN；Playwright locale emulation不能当macOS实际catalog切换。故**真实native英语catalog与不支持locale fallback未验收**，不能把脚本匹配任一catalog当作此目标通过。默认配置判断来自完整静态英文catalog与[Chrome官方message lookup契约](https://developer.chrome.com/docs/extensions/reference/api/i18n)，不替代该运行验收。

Credential prompt event：尝试macOS语言的两次直接spawn漏--use-mock-keychain/--password-store=basic；用户报告索取密钥提示。已终止精确任务user-data-dir前缀Chrome，pgrep确认无匹配；未调用credential工具、未读写/保存/索取凭据、未改系统偏好/钥匙串。不能宣称浏览器从未尝试访问钥匙串。此后没有继续启动浏览器/扩测；标准Playwright默认含保护参数已只读核实。

环境macOS26.6.2(25G83)/arm64、Node26.7.0/npm11.19.0、Playwright1.62.1、独立headless完整Chrome151.0.7922.34。命令：精确base git archive到temp/Navigraph；npm ci --ignore-scripts；反例npm run build；恢复9原catalog并覆盖3文件后npm run build。未仓库原地build，无unit新增；未重跑迁移/1200/业务全套。任务过程仅temp。

3文件hash=deb31ba68e536b4f193580f48d422765cb578e9aca81b12d503addf74be90313；完整非docs冻结输入01b535d7b48a48ab3cccea62d79fcc02acb78bbff45456241cab62602f216f3d。候选ZIP d6ca85f2de4f2c438d94f79eb65ad12ea9086258891e340464a79120ec1723fe（717615bytes），CRC/清单/引用/locale静态核对通过；与旧根ZIP只有manifest和en messages两个entry不同，其余44entry逐字相同。详细文件尺寸/hash、许可证、catalog差异、原生读数、credential事件与重建脚本见本地release/1.2.5/candidates/default-en/BUILD-INFO.json及RELEASE-CHECKS.md。

版本保持1.2.5，用户已确认未提审。旧根ZIP c724...027c及GitHub draft未替换；候选尚无交付commit，不宣称合并、发布或真实英文fallback运行通过。
