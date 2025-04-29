# 本地化支持任务列表

以下是为 Navigraph 扩展增加本地化支持的分步任务。完成后请在对应的方括号内打勾。

- [x] 1. 确定目标语言（如 zh-CN、en-US 等）  
- [x] 2. 在项目根目录下创建 `_locales/` 文件夹及子目录结构  
- [x] 3. 更新 `manifest.json`，添加 `"default_locale"` 字段  
- [x] 4. 在 `_locales/zh_CN/messages.json` 中建立初始模板（Chrome i18n 默认模板）  
- [ ] 5. 抽取所有简体中文硬编码字符串到 `_locales/zh_CN/messages.json`  
- [ ] 6. 将 en 模板复制到其他语言目录（zh-TW、zh-HK、de、ja、ko、ru、fr）  
- [ ] 7. 扫描并替换代码中的硬编码文案为 `chrome.i18n.getMessage('key')`  
- [ ] 8. 在 HTML、JS/TS 等文件中使用 i18n 接口获取本地化字符串  
- [ ] 9. 在不同语言环境下运行并验证各界面和提示是否正确显示  
- [ ] 10. 更新开发文档，说明如何新增或修改文案、添加新语言  
- [ ] 11. 将本地化文件纳入 CI／构建流程，确保 `messages.json` 格式合法  
- [ ] 12. 发布时打包所有 `_locales/` 目录，确保扩展包体积最优化