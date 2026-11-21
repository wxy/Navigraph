# 1.2.5 审计收尾直接路径验证（2026-11-21）

基线为已合并PR #57后的 `60d9720539d9ea3efd60209c3dedd344b067a85c`；分支 `codex/audit-closeout-1-2-5`。仅修两个本次全库审计确认的P1，合入三个开发依赖传递补丁并升manifest版本1.2.5。不包含海洋视图。

## 两个P1的复现与修复验收

|直接路径|baseline实际结果|最终实际结果|
|---|---|---|
|真实导航/a入库；真实storage.sync持久化dataRetention=0；关闭网页后把其节点timestamp/firstVisit/lastVisit改为60天前；只对worker前两次settings key读取拒绝，再实际stop/wake worker|拒绝2次后仍初始化成功；getSettings返回默认30；60天节点消失；健康GET竟为healthy|第1次失败即终止后台初始化；getSettings false；健康GET success:true/error；旧节点逐字段未变，未purge|
|解除故障再stop/wake worker|不作为baseline判别项|重新读到真实持久化0；旧节点逐字段保留；marker确认新worker|
|真实SPA/a保持打开，结束其session后pushState('/b')、pushState('/c')|b/c均无记录|b/c均javascript visit；b.parentId为空，c.parentId=b.id；二者归新session；原a节点与已结束session逐字段未变|
|已有parent后修改location.hash|不作为baseline判别项|c#section存在，parent为c|
|明确结束并confirm删除新session，再同一SPA pushState|不作为baseline判别项|after-delete作为新session根节点，parentId为空|
|clearAllData后同一SPA pushState|不作为baseline判别项|after-clear作为根节点，parentId为空|
|全新无settings key的profile|不作为baseline判别项|默认30、正常导航入库，明确区分“无值”与“读取失败”|
|options页面自身storage.sync读取失败（worker正常）|不作为baseline判别项|真实options页面可见错误通知“加载设置失败，请重试”；worker正常记录不受此页面夹具影响|

第一项worker重启故障只覆盖 chrome.storage.sync.get('navigraph_settings')，读取其它key不变。不改sync持久值、不触发故障性onChanged。stop/wake前后随机marker不同；正常重启读取0再次证明原设置未被篡改。节点“变老”为直接数据库时间夹具，不代表测试等待了60天或实际用户历史数据。错误为受控API拒绝，不代表真实Chrome同步服务宕机。

最小代码：SettingsService.initialize记录错误后原样throw，复用现有后台停止/健康error与options错误展示，不增加状态机；SPA history handler不再因无parent早退，继续现有saveNode/状态缓存流程，以空字符串表示root，仅有parent时建edge。未批量补记其它打开标签页。只有两个src变更。

首轮delete夹具缺少既有RPC必需的confirm字段，被“需要确认删除操作”拒绝；纠正为先end且confirm:true后重跑SPA段通过。不是产品失败，也没有以反复重跑替代实现修复。retention段在之前完整通过，没有为该夹具修正重复跑它。

## 代表性smoke、依赖与构建

最终代表性smoke：一个真实正常浏览导航，加1200条明确synthetic节点夹具（复制该导航合法字段并改独立id/url/时间及索引派生字段）。seed后重启worker从磁盘加载，再打开真实图页：waterfall与tree各实际持有100节点、页面有SVG。只验证有界页接入与两视图基本渲染，不代表1200次真实访问、密集边性能、视觉验收或长时CPU/能耗。

smoke第一轮raw写库绕过产品cache revision，运行期filterTotals仍缓存旧总数1，实际页面仅1节点。判别页面状态后，将夹具改为seed完成后重启worker，不修改产品缓存逻辑；重新加载真实磁盘后两视图100节点通过。原有所有成功定向场景源码未改变，最后smoke通过即停止。

依赖只修改lock中的fast-uri3.1.8→3.1.9、follow-redirects1.16.1→1.16.3、serialize-javascript7.1.2→7.1.4，均dev transitive；package.json未改，lock根name保持原值。最终锁重新npm ci成功；npm run build（含tsc --noEmit）通过，仅既有D3体积warning；在线npm audit返回vulnerabilities={}、total=0（此时点结论）。manifest.version为1.2.5，无其它正式版本字段需要同步。git diff --check通过。

环境：本机macOS，Node26.7.0/npm11.19.0，Playwright1.62.1，独立完整Chrome for Testing151.0.7922.34，headless/channel chromium。profile、browser、探针bundle、日志、npm缓存全部在本任务temp，未使用日常浏览器。没有新建或补写unit测试。未重跑旧23项健康测试或旧全库报告，没有恢复全天测试；未测真实同步服务故障、最低Chrome矩阵、真实大规模磁盘/内存限制、长期能耗或发布包商店验收。

## 版本与证据绑定

哈希均SHA256。输入集合为git tracked非docs文件，按相对路径排序并连续散列 `path UTF-8 + LF + bytes + LF`：

- baseline源码输入：`ba90049f5dc07d0a132d0225cde9c4ae2d9591c9e01d9027e803160b1a29c5ab`
- 最终工作树源码输入：`7dac14e015834b9dfa82810e72fb4c221126bdacb49107150afcfabe9e9ca530`
- 最终临时build输入：`ba126b36031949e1422ce423512cc2ebaf43a7a4841b44e0d3233f5822077ea2`
- 两者差异仅9个_locales/messages.json，被现有build插件生成；其它tracked非docs输入逐字一致。
- 最终四修改文件集合（两个src+manifest+lock）：`4874b0aef97a71c0bb956c148132074c3fafb869ac8659071c051d2f77bb9aee`
- 最终原background bundle：`278a5da7740787717d13537963ed164c7137fb9ecdac5b1f1ddcb5b9e0d42a50`
- 最终原content/content.js：`55503d4ed7b894f842ae3798c1f52d63f47c728f36dbcefc3741c2e63fe9054d`
- 最终原content/navigraph.js：`2ecc200e09cc8f4ab58b64c957f6275dd1191fedb7c48991202ddfe270302e90`
- 最终dist/manifest.json：`31a6f3f254a8a96d22d336e45029fb868d75fae2a588d8c14616dffc9baa73f5`

所有最终场景使用同一次最终build，无后续实现变化。探针仅在各临时background bundle前增加单行prefix，去掉首行即上述原bundle；options故障使用页面init script；数据库aging/seed仅在独立profile。报告是唯一长期保留测试产物，下面日志名为当次证据来源与校验值，不要求归档这些过程文件：

|原始日志段|覆盖|SHA256|
|---|---|---|
|baseline-runtime.log|两P1 baseline|`4b7a238b3faad737da5efe7d2702d80125e4b1b6b793859e1e50330506884169`|
|fixed-runtime.log|retention通过；之后SPA缺confirm夹具失败|`c0878780eeb825a7dbe43fa3a4fc5ce31c1f17762e80fdd225b6f56ac79f9ceb`|
|fixed-spa-fresh-options.log|纠正confirm后SPA/fragment/delete/clear、fresh、options通过|`f8e4daa5953e5c9a5766bf430815e9500ba2d5d8da46889a6f9051e0b5a8c503`|
|fixed-smoke.log|纠正raw seed缓存前提后最终两视图smoke|`36f2dd90c67fa6bb0634413611da9265d8f917be2df352f85d06db9fc477f4e0`|
|fixed-build.log|最终锁生产build含typecheck|`e327fd76ec0164a4fe79732f9f48b2cfa483f52a9ec2bd95aa73e46ca3db81da`|
|fixed-audit.json|最终锁在线audit|`d9720c8e65689d6a578312bc071339dae9cf1887b6d5f06b975182f59f8708fb`|

## 可重复命令与夹具

在独立任务temp下建立release/Navigraph副本（名称保留Navigraph），复制git tracked文件包括docs；browser放任务temp/developer/browsers。最终版本按下面执行，调整Playwright require路径。运行脚本会清理**它自己创建的同名profile**后重建，避免上次故障flag残留；不要把root指向正式用户目录。临时产物不加入Git。

```sh
cd "$TASK/developer/release/Navigraph"
npm ci --ignore-scripts
npm run build
npm audit --json
cd ..
# baseline checkout完成build后：
node p1-paths.cjs
# 最终checkout及最终锁完成build后：
MODES=retention,spa,fresh,options-failure node p1-paths.cjs --fixed
MODES=smoke node p1-paths.cjs --fixed
```

下面为最终夹具；各模式断言独立，baseline只运行retention/spa。报告中最终已执行段以日志表为准，不宣称一次重跑了全部段。

```js
const fs=require('fs'),path=require('path'),assert=require('assert'),http=require('http');const root=__dirname;process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'../browsers');const {chromium}=require('/Users/xingyuwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const fixed=process.argv.includes('--fixed');const pause=ms=>new Promise(r=>setTimeout(r,ms));const results=[];
async function wait(f){for(let i=0;i<100;i++){if(await f())return;await pause(50)}throw Error('condition timeout')}
const prefix=`self.__probe={marker:crypto.randomUUID(),rejects:0};const syncGet=chrome.storage.sync.get.bind(chrome.storage.sync);chrome.storage.sync.get=async function(k,...a){if(k==='navigraph_settings'&&(await chrome.storage.local.get('__failSettings')).__failSettings&&self.__probe.rejects<2){self.__probe.rejects++;throw Error('fixture sync read unavailable')}return syncGet(k,...a)};\n`;
async function run(mode){const dir=path.join(root,(fixed?'fixed':'baseline')+'-'+mode);fs.cpSync(path.join(root,'Navigraph/dist'),dir,{recursive:true});const file=path.join(dir,'background/background.js');fs.writeFileSync(file,prefix+fs.readFileSync(file));const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end('<html><title>SPA fixture</title><body>fixture</body></html>')}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;fs.rmSync(path.join(root,(fixed?'fixed':'baseline')+'-'+mode+'-profile'),{recursive:true,force:true});const ctx=await chromium.launchPersistentContext(path.join(root,(fixed?'fixed':'baseline')+'-'+mode+'-profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dir}`,`--load-extension=${dir}`]});try{let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const ext=sw.url().split('/')[2];for(const p of ctx.pages())await p.close();if(mode==='options-failure')await ctx.addInitScript(()=>{if(location.protocol==='chrome-extension:'&&chrome.storage?.sync)chrome.storage.sync.get=()=>Promise.reject(Error('fixture options settings unavailable'));});const opts=await ctx.newPage();await opts.goto(`chrome-extension://${ext}/options/index.html`);const rpc=(action,data={})=>opts.evaluate(({action,data})=>chrome.runtime.sendMessage({target:'background',action,requestId:'p1',...data}),{action,data});assert((await rpc('getSettings')).success);const db=async (operation,data)=>sw.evaluate(async({operation,data})=>{const all=await indexedDB.databases();const db=await new Promise((r,j)=>{const q=indexedDB.open(all[0].name);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});return new Promise((r,j)=>{const tx=db.transaction(['nodes','edges','sessions'],['age','seed'].includes(operation)?'readwrite':'readonly');const st=tx.objectStore(data.store||'nodes');const q=st.getAll();q.onsuccess=()=>{if(operation==='seed'){const a=q.result[0];for(let i=0;i<1200;i++){const time=Date.now()+i;st.put({...a,id:'smoke-'+i,url:data.url+'/synthetic-'+i,title:'Synthetic '+i,timestamp:time,lastVisit:time,firstVisit:time,parentId:'',_pageTime:-time,_statsTime:time,_statsUrl:data.url+'/synthetic-'+i});}}if(operation==='age')for(const n of q.result)if(n.url===data.url)st.put({...n,timestamp:data.time,lastVisit:data.time,firstVisit:data.time});else{}if(!['age','seed'].includes(operation))r(q.result)};tx.oncomplete=()=>{if(['age','seed'].includes(operation))r(true);db.close()};tx.onabort=()=>j(tx.error)});},{operation,data});const nodes=()=>db('read',{});const web=await ctx.newPage();await web.goto(base+'/a');await wait(async()=>(await nodes()).some(n=>n.url===base+'/a'));await pause(1300);
if(mode==='smoke'){await db('seed',{url:base});const stop=await ctx.newCDPSession(opts);await stop.send('ServiceWorker.enable');await stop.send('ServiceWorker.stopAllWorkers');await rpc('getSettings');sw=ctx.serviceWorkers().find(w=>w.url().includes(ext));const graph=await ctx.newPage();await graph.goto(`chrome-extension://${ext}/content/index.html`);await wait(async()=>graph.evaluate(()=>window.visualizer?.nodes?.length===100));const views=[];for(const view of ['waterfall','tree']){await graph.evaluate(v=>window.visualizer.switchView(v),view);await pause(300);const state=await graph.evaluate(()=>({view:window.visualizer.currentView,nodes:window.visualizer.nodes.length,svg:!!document.querySelector('svg')}));assert.equal(state.view,view);assert.equal(state.nodes,100);assert(state.svg);views.push(state);}results.push({mode,seeded:1200,realNavigation:1,views});await graph.close();}if(mode==='fresh'){const settings=(await rpc('getSettings')).settings;assert.equal(settings.dataRetention,30);results.push({mode,dataRetention:settings.dataRetention,recorded:true});}if(mode==='options-failure'){await opts.waitForSelector('#notification.error',{state:'visible'});results.push({mode,notification:await opts.locator('#notification').textContent(),recorded:true});}if(mode==='retention'){await sw.evaluate(()=>chrome.storage.sync.set({navigraph_settings:{dataRetention:0}}));await wait(async()=>((await rpc('getSettings')).settings.dataRetention===0));await web.close();await pause(150);const old=Date.now()-60*86400000;await db('age',{url:base+'/a',time:old});const before=(await nodes()).find(n=>n.url===base+'/a');assert(before);await sw.evaluate(()=>chrome.storage.local.set({__failSettings:true}));const marker=await sw.evaluate(()=>self.__probe.marker);const cdp=await ctx.newCDPSession(opts);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');const ack=await rpc('getSettings');sw=ctx.serviceWorkers().find(w=>w.url().includes(ext));assert.notEqual(await sw.evaluate(()=>self.__probe.marker),marker);await pause(300);const after=(await nodes()).find(n=>n.id===before.id);const rejects=await sw.evaluate(()=>self.__probe.rejects);const health=await rpc('getRecordingHealth');const result={mode,beforePresent:true,afterPresent:!!after,rejects,ack,health};if(fixed){assert.deepEqual(after,before);assert.equal(rejects,1);assert.equal(ack.success,false);assert.equal(health.health.phase,'error');await sw.evaluate(()=>chrome.storage.local.set({__failSettings:false}));const marker2=await sw.evaluate(()=>self.__probe.marker);await cdp.send('ServiceWorker.stopAllWorkers');const ready=await rpc('getSettings');sw=ctx.serviceWorkers().find(w=>w.url().includes(ext));assert.notEqual(await sw.evaluate(()=>self.__probe.marker),marker2);assert.equal(ready.settings.dataRetention,0);assert.deepEqual((await nodes()).find(n=>n.id===before.id),before);result.normalRestartRetention=ready.settings.dataRetention;}else{assert.equal(rejects,2);assert.equal(after,undefined);}results.push(result);}
if(mode==='spa'){const a=(await nodes()).find(n=>n.url===base+'/a');const sessionBefore=(await db('read',{store:'sessions'})).find(s=>s.id===a.sessionId);assert((await rpc('endSession',{sessionId:a.sessionId})).success);const ended=(await db('read',{store:'sessions'})).find(s=>s.id===a.sessionId);await web.evaluate(()=>history.pushState({},'', '/b'));await pause(250);await web.evaluate(()=>history.pushState({},'', '/c'));await pause(400);const all=await nodes(),b=all.find(n=>n.url===base+'/b'),c=all.find(n=>n.url===base+'/c');const result={mode,aId:a.id,b:b||null,c:c||null};if(fixed){assert(b&&c);assert.equal(b.type,'javascript');assert.equal(c.type,'javascript');assert.equal(b.parentId,'');assert.equal(c.parentId,b.id);assert.notEqual(b.sessionId,a.sessionId);assert.equal(c.sessionId,b.sessionId);assert.deepEqual(all.find(n=>n.id===a.id),a);assert.deepEqual((await db('read',{store:'sessions'})).find(s=>s.id===a.sessionId),ended);await web.evaluate(()=>location.hash='section');await pause(350);const fragment=(await nodes()).find(n=>n.url===base+'/c#section');assert(fragment);assert.equal(fragment.parentId,c.id);result.fragmentParent=fragment.parentId;assert((await rpc('endSession',{sessionId:b.sessionId})).success);const deleted=await rpc('deleteSession',{sessionId:b.sessionId,confirm:true});assert(deleted.success,JSON.stringify(deleted));await web.evaluate(()=>history.pushState({},'', '/after-delete'));await pause(350);const afterDelete=(await nodes()).find(n=>n.url===base+'/after-delete');assert(afterDelete);assert.equal(afterDelete.parentId,'');result.deletedSessionRoot=true;assert((await rpc('clearAllData')).success);await web.evaluate(()=>history.pushState({},'', '/after-clear'));await pause(350);const afterClear=(await nodes()).find(n=>n.url===base+'/after-clear');assert(afterClear);assert.equal(afterClear.parentId,'');result.clearedRoot=true;}else{assert(!b&&!c);}results.push(result);}
console.log(JSON.stringify(results.at(-1)));fs.writeFileSync(path.join(root,(fixed?'fixed':'baseline')+'-p1-results.json'),JSON.stringify(results,null,2));}finally{await ctx.close();server.close()}}
(async()=>{for(const mode of (process.env.MODES?.split(',')||['retention','spa']))await run(mode)})().catch(e=>{console.error(e);process.exitCode=1});

```
