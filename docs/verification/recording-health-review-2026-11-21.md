# PR #57 追加审查验证（2026-11-21）

基线：`0105682c8b2deede36692aee36884b50df27634d`。仅核实三条已有 review，不包含全库审计后续或海洋视图。采用 `hypothesis-driven-debugging`：先运行 baseline 直接路径，再最小修改，再定向验收。没有新建或补写单元测试。

## 结论

|场景|baseline 实际结果|本次修复后|
|---|---|---|
|新 profile、worker 的 IndexedDB.open 抛 UnknownError，导致 SessionManager 初始化失败|健康 GET 返回 success:false；badge 空、title Navigraph|健康 GET success:true / error，badge !；普通 getSettings 仍 false；实际图页 `#recording-health[data-phase=error]` 可见|
|同上，健康 restore 先挂起后释放无 key|失败期间 unknown 的 !；迟到 restore 后 badge 清空|失败后立即 error；迟到 restore 后仍相同 failedAt、error、!|
|只挂起 worker sync.get，使后台 readiness 未完成|健康 GET 超过夹具700ms观察窗仍未返回|健康 GET 返回 success:true / healthy；此值表示没有已知录制故障，不代表后台ready|
|已保存 error，worker 的 sync.get 延迟300ms后返回 forcedLocale=en，浏览器消息语言中文|健康error但 toolbar title一直中文|title 与 `_locales/en/messages.json` 一致；之后通过真实 storage.sync.set 改 forcedLocale=zh_CN，title与中文资源一致|
|初始化失败后普通 HTTP 网页真实内容脚本隔离世界发健康 GET|未作为baseline判别项|被拒绝 Action not permitted；旁路保留原authorize|
|真实扩展图页 → example.com → 历史返回，去掉 Playwright 默认 `--disable-back-forward-cache`|返回新文档，旧window marker未恢复；CDP原因 SchemeNotHTTPOrHTTPS / EmbedderExtensionFrame|不修改生命周期代码；该Chrome版本无法到达review假设的扩展页BFCache恢复路径|

修复：后台初始化 catch 先调用现有 recordingHealth.failed()（同时递增epoch，拒绝旧restore）；仅健康 GET 绕开 readiness/写队列，仍经同一个authorize和handler；语言应用完成及后台现有设置listener检测 forcedLocale变化后重呈现当前健康状态，不写健康snapshot、不改变phase/epoch。其余消息继续原队列。

BFCache第一轮受到 Playwright默认禁用参数影响，第二轮明确移除该参数，以上结论取第二轮CDP证据。未以合成 pagehide/pageshow 作为浏览器可达性证据。BFCache结论仅限Chrome151实测，不宣称所有版本永久不支持。

## 验证环境、输入与边界

macOS本地，Node26.7.0 / npm11.19.0，Playwright1.62.1，独立 Chrome for Testing151.0.7922.34，headless完整浏览器（channel chromium），任务临时目录内新建persistent profiles。未操作日常浏览器。后台副作用通过Chrome原生 getBadgeText/getTitle 读取；没有验收系统工具栏像素。图页通过真实DOM visible状态验收。

故障注入仅在临时产物 background.js 前添加一行探针：替换 indexedDB.open 抛 UnknownError（命中1次），或仅对recordingHealth storage.local.get挂起，或仅对navigraph_settings storage.sync.get挂起/延迟给定合法设置；未改产品源代码来模拟状态成功。locale场景强制返回已保存error，用于复现恢复顺序。实际浏览器消息授权与页面DOM均使用产品bundle。

基线与修复各自构建副本目录名均为 Navigraph；拷贝 tracked inputs，包括webpack需要的docs。在临时副本执行 `npm ci --ignore-scripts`、`npm run build`（含 tsc --noEmit），最终通过，仅既有D3体积warning。仓库未原地构建，locale源码未被生成器改写。未重跑旧23项或其他无关回归，没有声称真实磁盘故障、最低Chrome版本矩阵或长时性能验收。

最终3个修改src的按相对路径排序、`path + LF + bytes + LF` SHA256：`f1e668dbc289d6c872e1f5b7cdf88cfb8c59f874d00af8e28c5b3864decb3dc2`；最终原始 `dist/background/background.js` SHA256：`d550686c8ffe4b4fdcfb9ca0d08c5789268b1786a62fcdc7a184a75ce93b662b`。探针bundle为一行prefix加该原bundle，所有场景产物/profile/日志均为临时测试过程文件，不入Git，交付只保留本报告。

## 重建命令与夹具

选择独立任务临时根目录，把仓库tracked文件拷到 `$TASK/Navigraph`，安装锁定依赖并构建。将下面脚本保存为 `$TASK/review-paths.cjs`，调整Playwright require路径，浏览器下载到 `$TASK/browsers`：

```sh
PLAYWRIGHT_BROWSERS_PATH="$TASK/browsers" node /path/to/playwright/cli.js install chromium
cd "$TASK/Navigraph"
npm ci --ignore-scripts
npm run build
cd "$TASK"
# baseline checkout运行：
node review-paths.cjs
# 修复checkout重新构建后，使用全新profile或移除同名测试profile：
MODES=startup-failure,late-restore,pending-ready,locale node review-paths.cjs --fixed
# BFCache可达性单独检查：
MODES=bfcache node review-paths.cjs
```

最终启动失败图页验证在上述4段通过后加到同一夹具，只重跑startup-failure段；再次通过。下面为最终夹具源码。可重复运行时先删除夹具生成的对应profile/dist，避免使用旧profile。测试中断或环境失败须先定位，不能把重跑成功当成原路径的证据。

```js
const fs=require('fs'),path=require('path'),assert=require('assert'),http=require('http');
const root=__dirname;process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'browsers');const {chromium}=require('/Users/xingyuwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixed=process.argv.includes('--fixed');const output=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(mode){const dist=path.join(root,(fixed?'fixed-':'baseline-')+mode);fs.cpSync(path.join(root,'Navigraph/dist'),dist,{recursive:true});const bundle=path.join(dist,'background/background.js');let prefix=`self.__probe={opens:0};`;
if(mode==='startup-failure'||mode==='late-restore')prefix+=`indexedDB.open=function(){self.__probe.opens++;throw new DOMException('fixture initialization failure','UnknownError')};`;
if(mode==='late-restore')prefix+=`const oldGet=chrome.storage.local.get.bind(chrome.storage.local);chrome.storage.local.get=function(k,...a){if(k==='recordingHealth')return new Promise(r=>self.__probe.restore=()=>r({}));return oldGet(k,...a)};`;
if(mode==='locale')prefix+=`const oldGet=chrome.storage.local.get.bind(chrome.storage.local);chrome.storage.local.get=function(k,...a){if(k==='recordingHealth')return Promise.resolve({recordingHealth:{phase:'error',failedAt:1}});return oldGet(k,...a)};const syncGet=chrome.storage.sync.get.bind(chrome.storage.sync);chrome.storage.sync.get=async function(k,...a){if(k==='navigraph_settings'){await new Promise(r=>setTimeout(r,300));return {navigraph_settings:{forcedLocale:'en'}};}return syncGet(k,...a)};`;
if(mode==='pending-ready')prefix+=`chrome.storage.sync.get=function(){return new Promise(()=>{})};`;
fs.writeFileSync(bundle,prefix+'\n'+fs.readFileSync(bundle));const ctx=await chromium.launchPersistentContext(path.join(root,(fixed?'fixed-':'baseline-')+mode+'-profile'),{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});try{const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const ext=sw.url().split('/')[2];for(const p of ctx.pages())await p.close();const page=await ctx.newPage();await page.goto(`chrome-extension://${ext}/options/index.html`);await pause(1600);const rpc=(action)=>page.evaluate(action=>Promise.race([chrome.runtime.sendMessage({target:'background',action,requestId:'targeted-review'}),new Promise(r=>setTimeout(()=>r({timedOut:true}),700))]),action);const result={mode,health:await rpc('getRecordingHealth'),badge:await sw.evaluate(()=>chrome.action.getBadgeText({})),title:await sw.evaluate(()=>chrome.action.getTitle({})),opens:await sw.evaluate(()=>self.__probe.opens)};
if(mode==='late-restore'){await sw.evaluate(()=>self.__probe.restore());await pause(100);result.afterRestore=await rpc('getRecordingHealth');result.afterBadge=await sw.evaluate(()=>chrome.action.getBadgeText({}));}
if(mode==='locale'){result.expected=JSON.parse(fs.readFileSync(path.join(dist,'_locales/en/messages.json'))).recording_health_error.message;if(fixed){assert.equal(result.title,result.expected);await page.evaluate(()=>chrome.storage.sync.set({navigraph_settings:{forcedLocale:'zh_CN'}}));await pause(300);result.changedTitle=await sw.evaluate(()=>chrome.action.getTitle({}));assert.equal(result.changedTitle,JSON.parse(fs.readFileSync(path.join(dist,'_locales/zh_CN/messages.json'))).recording_health_error.message);}}
if(fixed&&(mode==='startup-failure'||mode==='late-restore')){assert.equal(result.health.health.phase,'error');assert.equal(result.badge,'!');if(mode==='late-restore')assert.equal(result.afterRestore.health.phase,'error');assert.equal((await rpc('getSettings')).success,false);}
if(fixed&&mode==='pending-ready'){assert.equal(result.health.health.phase,'healthy');}
if(fixed&&mode==='startup-failure'){const graph=await ctx.newPage();await graph.goto(`chrome-extension://${ext}/content/index.html`);await graph.waitForSelector('#recording-health[data-phase=error]',{state:'visible'});result.graphWarning=await graph.locator('#recording-health').textContent();await graph.close();const server=http.createServer((q,r)=>r.end('<title>Unprivileged</title>')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const web=await ctx.newPage();const cdp=await ctx.newCDPSession(web);const worlds=[];cdp.on('Runtime.executionContextCreated',e=>worlds.push(e.context.id));await cdp.send('Runtime.enable');await web.goto('http://127.0.0.1:'+server.address().port);await pause(300);let isolated;for(const id of worlds){try{const value=await cdp.send('Runtime.evaluate',{contextId:id,expression:'typeof chrome!=="undefined" && chrome.runtime && chrome.runtime.id',returnByValue:true});if(value.result.value)isolated=id}catch{}}assert(isolated);const denied=await cdp.send('Runtime.evaluate',{contextId:isolated,expression:'chrome.runtime.sendMessage({target:"background",action:"getRecordingHealth",requestId:"web-denied"})',awaitPromise:true,returnByValue:true});result.webHealth=denied.result.value;assert.equal(result.webHealth.success,false);assert.equal(result.webHealth.error,'Action not permitted');await web.close();}finally{server.close();}}if(mode==='bfcache'){const graph=await ctx.newPage();await graph.goto(`chrome-extension://${ext}/content/index.html`);await graph.waitForSelector('#recording-health',{state:'attached'});const cdp=await ctx.newCDPSession(graph);const reasons=[];cdp.on('Page.backForwardCacheNotUsed',x=>reasons.push(x));await cdp.send('Page.enable');await graph.evaluate(()=>{window.__marker=crypto.randomUUID();window.addEventListener('pageshow',e=>window.__persisted=e.persisted)});const marker=await graph.evaluate(()=>window.__marker);await graph.goto('https://example.com');await graph.goBack();result.sameDocument=await graph.evaluate(m=>window.__marker===m,marker);result.persisted=await graph.evaluate(()=>window.__persisted??null);result.reasons=reasons;}
output.push(result);console.log(JSON.stringify(result));fs.writeFileSync(path.join(root,(fixed?'fixed':'baseline')+'-results.json'),JSON.stringify(output,null,2));}finally{await ctx.close();}}
(async()=>{for(const mode of (process.env.MODES?.split(',')||['startup-failure','late-restore','pending-ready','locale','bfcache']))await run(mode)})().catch(e=>{console.error(e);process.exitCode=1});

```
