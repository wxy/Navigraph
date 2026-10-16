# 瀑布抽屉外关资源验证（2026-10-16）

基线 `880fd12abf9ec6031eb7f96e2e25398de7cdfadc`，分支 `codex/drawer-fast-close-cleanup`。本次只改 WaterfallRenderer 的抽屉资源生命周期与旧 fallback 局部清理；未改布局、后台、设置、海洋视图，未做长期 CPU/内存/能耗或堆泄漏测量。此前16+3设置场景未重跑。

## 实现前失败矩阵与修复

| 失败方式 | 处理/验收 |
|---|---|
| body真实/legacy handler别名遗漏 | release移除两种wheel函数，EventTarget实际登记/移除探针核对 |
| shared container/doc残留或删除新组监听 | owner持有实际函数，移除自身函数；仅引用相同才删共享属性；旧refs inactive且新组4项资源仍有效 |
| wheel积累RAF与平滑RAF在关闭后继续 | cancel两个handle、清target/accum/transform；两处callback与wheel入口先校验owner |
| pending open回调迟挂 | open异步前登记owner/外点；owner timer受控、release先失效再cancel/interrupt |
| normal close pending旧end清理新组 | 正常动画duration/stagger保留，end guard后统一release；外关后新组超过旧deadline保持 |
| renderer cleanup during open/close遗漏 | disposed+release，namespace/clip/doc/current/busy归零；真实history切view覆盖 |
| 重复close/cleanup不幂等 | 已释放owner直接返回；旧renderer重复清理不影响新renderer |
| reopen非零、badge不还原 | 活抽屉关闭后scroll/target0、badge50；重开0，可继续wheel |
| motion off/on不同异步边界 | 两模式各5场景；off零延迟pending用明确夹具保持，正常交互另有自然样本 |
| legacy异常fallback局部资源退化 | 保留本renderer SVG click.drawer解绑并移除自身fallback DOM，无全container扫描 |

代码集中一个文件，新增121行、删除250行（消除重复清理分支）。每次open建立唯一owner，早登记current与外点监听；所有drawer schedule/end/wheel/两个RAF在写状态前校验owner/disposed。release先使owner失效，再取消timer/interrupt/移除监听与两RAF，恢复视觉状态。正常动画close end、外关、换组及cleanup共用释放。共享container只移除owner持有的实际函数，避免旧owner删除新owner属性。legacy fallback仅清理本renderer SVG的namespace和DOM。

## 基线实际复现

独立profile、未改生产bundle、真实badge展开→真实item命中→wheel150→外点关闭。关闭前有document click/body wheel/container forwarder/document wheel共4个实际refs；关闭后：

- open=false/current=null/docClick=false，但**3个wheel refs仍登记active**；bodyWheel/containerWheel/debugDoc均true。
- drawer clip=1、target=900、scroll=`translate(0, -900)`；badge恢复50但资源未释放。
- drawer子树观测到2个D3 transition（包括hover造成的效果）；仅作为当次状态，不把它推及全SVG或另外组。

基线复用上轮干净生产构建：121个产品输入（src/webpack/package/manifest）逐文件字节与本基线master一致，清单SHA256 `e6036234cb7d588338d10d83ccb0f8305c02d38cb05d999e6eba60076fa8420f`。相关Waterfall源SHA256 `773d316097acb23d527551068377f5f11ed6c53ae8c40798887ccfe8036b4d97`。没有改写基线bundle或用组件模拟替代。

## 实际环境、结果和证据边界

macOS26.6.2(25G83)/arm64，Node26.7.0/npm11.19.0，Playwright1.62.1，Chromium151.0.7922.34（channel chromium分发）；headless1400×1000，独立persistent profiles，unpacked MV3。固定构建 `npm --prefix fixed-source run build` 包含typecheck，最终通过，仅已有d3资产体积warning。

合成100 nodes/99相邻edges，同session、2个tab各50节点、两10分钟段，精确ID fixture-0000..0099，日期由运行时生成。原始IDB fixture维护v3覆盖键，之后真实stop/wake清除绕过wrapper的聚合缓存；不把seed当自然记录路径。options真实切动画，固定group key，wheel前检查elementFromPoint落在可见drawer-item，未force。

**11个不同场景通过**：两motion模式各5项正常/受控交互，以及1项受控legacy helper资源清理。

| 每个motion模式的场景 | 关键实际结果 |
|---|---|
| 自然wheel→外关/旧scroll不响应/重开/normal close | wheel1后target50，off观测活跃anim handle14、on224；外关后两RAF=null、target/accum0、transform0、3wheel refs+docclick均inactive、timer/子树transition/clip0、current=null/busy=false；旧位置再wheel不恢复旧scroll，重开0；正常同badge close也清空且badge50 |
| 受控保持真实wheel派生的两RAF→点另一组 | off41/42、on791/792均记录cancelAnimationFrame调用；旧refs inactive/clip0/target0，新组body/forwarder/debug/doc/clip有效；手动迟投两旧callback后新组snapshot不变，新组仍可wheel |
| normal close pending→外关→开另一组 | off保持0ms timer，on自然pending；旧owner释放后新组过2.2秒（超过约1.81秒旧关闭链）snapshot不变，旧组无refs/clip |
| opening时真实history切tree，再forward开新组 | 旧renderer disposed，body实际函数refs与两RAF清空、timer/transition/clip0、doc/current/busy归零；旧renderer重复close/cleanup两次不拆新owner，过2.2秒稳定 |
| closing时相同history/重复清理 | 与opening一致，保护pending close与新owner |

旧SVG在切view时本就被UI清空子DOM，因此disposed样本允许旧body的scroll子节点已不存在；仍持有旧body对象检查属性、实际listener refs、RAF等。共享container被新组/renderer接管时允许其新属性true；断言针对旧函数是否移除，不误把新资源算残留。

RAF夹具明确：实际鼠标wheel进入真实生产handler；临时requestAnimationFrame包装可把已到达的callback暂存，先交付wheel callback以形成平滑RAF，再来一次真实wheel形成第二个RAF；实际cancelAnimationFrame原函数仍被调用。**这不证明取消发生在天然浏览器frame交付之前**。随后手动迟投被取消的旧函数，是owner守卫容错验收。自然两模式另有未暂停wheel样本且观测到活跃平滑RAF。临时legacy wheel no-op别名用于兼容释放分支，非声称正常生产同时注册该别名。

off的pending窗口很短：仅这些专门的pending场景暂存已到达0ms timeout callback，再真实外关/切view并迟投旧callback；on使用自然延时，跨旧deadline实查。没有伪造后台查询结果。EventTarget探针跟踪实际add/remove的target/function/capture，RAF/timer探针保留原API调用；探针自身保留DOM引用，不用于堆内存结论。

legacy附加场景是**受控真实helper资源构造**：在真实图页用lifecycle原node与当前group/segment，直接调用现有showCollapsedNodesDrawer；确认DOM=1、SVG click.drawer=true，再真实goBack切tree，确认DOM=0/namespace=false/disposed=true。不是自然异常恢复验收。最初尝试使toggle抛错未到legacy：预构建阶段会覆盖badge click，直接调用toggle，故该fault只抛错而不进入旧try/catch分支；没有为测试改其可达性或布局。最终场景不再注入throw。

## 分段事实与停止范围

- 首轮fixed脚本3 PASS后，切view夹具错误地要求已被UI删除的旧scroll DOM仍存在，失败；源码未改。修正disposed DOM与shared container归属的断言。
- resume保留已有3项并跳过，完成另外7项。随后legacy fault入口未创建资源，不能算通过；定位到上面的覆盖handler后，最后仅执行受控helper资源场景，其余10项跳过。
- 最终result含11 distinct，errors:[]；最后受控helper段退出前显式assert errors=[]。每段errors数组重建，**不是所有分段pageerror的累计断言**，失败fault段包含刻意抛错，不能掩作自然pageerror0。
- 最终驱动整理后未在一个全新profile完整重跑11项；可重建脚本如下，PREVIOUS只表示载入旧PASS，不计重新执行。

没有扩大到全库/旧设置测试/长期性能，未宣称消除所有UI或内存泄漏。

## 冻结来源

- 最终Waterfall源码与fixed-source输入逐字节相同，SHA256 `35719b4f7c8cc7714229b915f5393dc9bcd02f1c72e6a3453cc73016e7b3728c`。
- 最终干净fixed-dist/218.js（包含Waterfall模块）SHA256 `b43c5e20ff204accfd9628944dd64a120ae9557e419dc9999f1c1bf34c7ce898`；content/content.js bootstrap `c5f9335fb2029dbe996dae0439f5a87e616153726d1f77c3e6d6f33c4bff03d8`。不是只校验bootstrap便声称renderer相同。
- 基线renderer实际在baseline-dist/497.js，SHA256 `9ec95edb5eb1e8cfc9916511cc233c42367fc15b0bb674ee5df8b1cae0533b85`；bootstrap为df1dba20a13155b52331497553979ae78f43d6d9d02e92dc6972053a5bbf9ba0。
- 基线与fixed构建/profile/脚本均分目录，未覆盖上轮theme source/dist/log证据；产品没有测试接口或bundle补丁。源码之外仅本报告进入Git。

## 完整复建

在本PR最终源码checkout执行。实际复用已有任务根依赖/浏览器；下述给出独立安装入口。所有过程文件只在系统temp。原证据目录 `navigraph-theme-notice.K0KJY4/drawer` 只供当次审核，完成后删除，不要求永久存在。

```sh
REPO=/Volumes/MacSSD/develop/Navigraph
TASK_TMP=$(mktemp -d "${TMPDIR:-/tmp}/navigraph-drawer.XXXXXX")
export TASK_TMP
export npm_config_cache="$TASK_TMP/npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="$TASK_TMP/browsers"
mkdir -p "$TASK_TMP/drawer/baseline-source" "$TASK_TMP/drawer/fixed-source"
git -C "$REPO" archive 880fd12abf9ec6031eb7f96e2e25398de7cdfadc | tar -x -C "$TASK_TMP/drawer/baseline-source"
git -C "$REPO" archive HEAD | tar -x -C "$TASK_TMP/drawer/fixed-source"
# 未提交工作树复现时覆盖本轮唯一源码；提交后也等价。
cp "$REPO/src/content/visualizer/renderers/WaterfallRenderer.ts" "$TASK_TMP/drawer/fixed-source/src/content/visualizer/renderers/WaterfallRenderer.ts"
(cd "$TASK_TMP/drawer/baseline-source" && npm ci --ignore-scripts && npm run build > ../baseline-build.log 2>&1)
ln -s "$TASK_TMP/drawer/baseline-source/node_modules" "$TASK_TMP/drawer/fixed-source/node_modules"
(cd "$TASK_TMP/drawer/fixed-source" && npm run build > ../build.log 2>&1)
cp -R "$TASK_TMP/drawer/baseline-source/dist" "$TASK_TMP/drawer/baseline-dist"
cp -R "$TASK_TMP/drawer/fixed-source/dist" "$TASK_TMP/drawer/fixed-dist"
npm install --prefix "$TASK_TMP/tooling" --no-save playwright@1.62.1
export PLAYWRIGHT_MODULE="$TASK_TMP/tooling/node_modules/playwright"
node "$PLAYWRIGHT_MODULE/cli.js" install chromium
# 保存下面4段到 $TASK_TMP/drawer 对应文件；首次运行没有fixed-result，故执行全部场景。
(cd "$TASK_TMP/drawer" && node baseline.cjs > baseline.log 2>&1 && node fixed.cjs > fixed.log 2>&1)
```

实际baseline复用了已核对相同输入的现有生产build，而非又运行基线build；独立复建命令生成等价产物。node_modules软链仅temp。脚本默认require本机bundled Playwright，设置PLAYWRIGHT_MODULE则走独立安装。100节点/99边输入、设置/真实worker stop-wake与所有断言均在脚本内。

### baseline-harness.cjs

```javascript
const fs=require('fs'),path=require('path'),assert=require('assert');const D=__dirname,T=path.dirname(D);process.env.PLAYWRIGHT_BROWSERS_PATH=T+'/browsers';const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/xingyuwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function probe(){window.__listeners=[];const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;const cap=o=>typeof o==='boolean'?o:!!o?.capture;EventTarget.prototype.addEventListener=function(type,fn,opts){const out=add.call(this,type,fn,opts);if(['wheel','click'].includes(type)&&!window.__listeners.some(r=>r.active&&r.target===this&&r.type===type&&r.fn===fn&&r.capture===cap(opts)))window.__listeners.push({target:this,type,fn,capture:cap(opts),active:true});return out};EventTarget.prototype.removeEventListener=function(type,fn,opts){for(let r of window.__listeners)if(r.target===this&&r.type===type&&r.fn===fn&&r.capture===cap(opts))r.active=false;return remove.call(this,type,fn,opts)};window.__raf={pending:new Map(),held:new Map(),cancelled:[],hold:false};const request=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);window.requestAnimationFrame=fn=>{let id=request(time=>{if(window.__raf.hold){window.__raf.held.set(id,{fn,time});return}window.__raf.pending.delete(id);fn(time)});window.__raf.pending.set(id,fn);return id};window.cancelAnimationFrame=id=>{window.__raf.cancelled.push(id);window.__raf.pending.delete(id);return cancel(id)};}
async function setup(kind){const ctx=await chromium.launchPersistentContext(D+'/profile-'+kind,{channel:'chromium',headless:true,viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${D}/${kind}-dist`,`--load-extension=${D}/${kind}-dist`]});ctx.setDefaultTimeout(12000);ctx.setDefaultNavigationTimeout(12000);const errors=[];ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),base=`chrome-extension://${new URL(sw.url()).hostname}`,opt=await ctx.newPage();await opt.goto(base+'/options/index.html');await opt.waitForSelector('#save-btn');for(let p of ctx.pages())if(p!==opt)await p.close();const rpc=(action,fields={})=>opt.evaluate(({action,fields})=>chrome.runtime.sendMessage({target:'background',action,...fields}),{action,fields});await rpc('getSettings');let latest=await rpc('getLatestSession');assert(latest.success);let sid=latest.session.id;
await sw.evaluate(async sid=>{const db=await new Promise((res,rej)=>{const q=indexedDB.open('NavigraphDB');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});await new Promise((res,rej)=>{const tx=db.transaction(['nodes','edges'],'readwrite'),ns=tx.objectStore('nodes'),es=tx.objectStore('edges'),base=Math.floor(Date.now()/600000)*600000-300000;ns.clear();es.clear();for(let i=0;i<100;i++){let id=`fixture-${String(i).padStart(4,'0')}`,url=`https://fixture.invalid/${i}`,timestamp=base-Math.floor(i/50)*600000-(i%50)*1000,n={id,sessionId:sid,tabId:900+Math.floor(i/50),url,title:`Fixture ${i}`,timestamp,type:'initial',parentId:i<99?`fixture-${String(i+1).padStart(4,'0')}`:null,isClosed:false};ns.put({...n,_pageSession:sid,_pageTime:-timestamp,_pageType:n.type,_pageClosed:0,_pageTracking:0,_restoreTab:n.tabId,_statsDomain:'fixture.invalid',_statsUrl:url,_statsTime:timestamp,_statsKnown:1,_timeUnknown:false});if(i<99)es.put({id:`edge-${i}`,sessionId:sid,source:n.parentId,target:id,timestamp,type:'link',_pageSession:sid,_pageSource:n.parentId,_pageTarget:id,_pageTime:timestamp});}tx.oncomplete=res;tx.onabort=()=>rej(tx.error)});db.close()},sid);
const cdp=await ctx.newCDPSession(opt);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await sleep(250);await rpc('getSettings');let g=await ctx.newPage();await g.addInitScript(probe);await g.goto(base+'/content/index.html?view=waterfall');await g.waitForFunction(()=>window.visualizer?.allNodes.length===100);await sleep(200);await g.mouse.move(10,950);await sleep(400);return{ctx,g,opt,errors,sid,base};}
async function flags(opt,animation){await opt.click('[data-tab=performance-settings]');await opt.locator('#animation-enabled').setChecked(animation);await opt.click('#save-btn');await sleep(200);}
async function key(g,other){return g.locator('.group-badge').evaluateAll((es,other)=>es.map(e=>e.getAttribute('data-collapse-group')).find(k=>k!==other),other)}
async function open(g,k){await g.locator(`.group-badge[data-collapse-group="${k}"]`).click();await g.waitForFunction(k=>{let r=window.visualizer.renderingManager.getCurrentRenderer();return !r.drawerTransitioning&&r.currentOpenCollapseId===k},k)}
async function wheel(g,k,delta=1){let item=g.locator(`.collapsed-drawer[data-collapse-group="${k}"] .drawer-item`).filter({visible:true}).first();let b=await item.boundingBox(),p={x:b.x+50,y:b.y+20};assert(await g.evaluate(p=>!!document.elementFromPoint(p.x,p.y)?.closest('.drawer-item'),p));await g.mouse.move(p.x,p.y);await g.mouse.wheel(0,delta);}
async function capture(g,k){await g.evaluate(k=>{let r=window.visualizer.renderingManager.getCurrentRenderer(),drawer=document.querySelector(`.collapsed-drawer[data-collapse-group="${k}"]`),body=drawer.querySelector('.drawer-body');window.__old={r,drawer,body,container:r.container,svg:r.svg.node(),refs:[body.__drawerWheelHandler,body.__navigraph_wheel_handler,r.container.__drawerWheelContainerHandler,r.container.__drawerDebugDocHandler,r.documentClickHandler].filter(Boolean),badge:document.querySelector(`.group-badge[data-collapse-group="${k}"]`),key:k}},k)}
async function state(g){return g.evaluate(()=>{let{r,drawer,body,container,svg,refs,badge,key}=window.__old;return{key,open:drawer.getAttribute('data-open'),bodyWheel:!!body.__drawerWheelHandler,legacyWheel:!!body.__navigraph_wheel_handler,containerWheel:!!container.__drawerWheelContainerHandler,debugDoc:!!container.__drawerDebugDocHandler,activeRefs:window.__listeners.filter(e=>e.active&&refs.includes(e.fn)).map(e=>({type:e.type,target:e.target===document?'document':e.target===container?'container':'body'})),raf:body.__drawerWheelRaf??null,anim:body.__drawerAnim??null,target:body.__drawerTarget??0,accum:body.__drawerWheelAccum??0,scroll:body.querySelector('.drawer-scroll')?.getAttribute('transform'),timers:r.timers.size,transitions:[drawer,...drawer.querySelectorAll('*')].filter(e=>!!e.__transition).length,clip:svg.querySelectorAll(`clipPath[id="drawer-clip-${key}"]`).length,docClick:!!r.documentClickHandler,current:r.currentOpenCollapseId,busy:r.drawerTransitioning,badge:badge.textContent,disposed:r.disposed??null}})}
module.exports={setup,flags,key,open,wheel,capture,state,sleep,assert,fs,D};
```

### harness.cjs

```javascript
const fs=require('fs'),path=require('path'),assert=require('assert');const D=__dirname,T=path.dirname(D);process.env.PLAYWRIGHT_BROWSERS_PATH=T+'/browsers';const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/xingyuwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function probe(){window.__listeners=[];const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;const cap=o=>typeof o==='boolean'?o:!!o?.capture;EventTarget.prototype.addEventListener=function(type,fn,opts){const out=add.call(this,type,fn,opts);if(['wheel','click'].includes(type)&&!window.__listeners.some(r=>r.active&&r.target===this&&r.type===type&&r.fn===fn&&r.capture===cap(opts)))window.__listeners.push({target:this,type,fn,capture:cap(opts),active:true});return out};EventTarget.prototype.removeEventListener=function(type,fn,opts){for(let r of window.__listeners)if(r.target===this&&r.type===type&&r.fn===fn&&r.capture===cap(opts))r.active=false;return remove.call(this,type,fn,opts)};window.__raf={pending:new Map(),held:new Map(),cancelled:[],hold:false};const request=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);window.requestAnimationFrame=fn=>{let id=request(time=>{if(window.__raf.hold){window.__raf.held.set(id,{fn,time});return}window.__raf.pending.delete(id);fn(time)});window.__raf.pending.set(id,fn);return id};window.cancelAnimationFrame=id=>{window.__raf.cancelled.push(id);window.__raf.pending.delete(id);return cancel(id)};window.__timeouts={hold:false,held:new Map(),cancelled:[]};const timeout=setTimeout.bind(window),clear=clearTimeout.bind(window);window.setTimeout=(fn,delay,...args)=>{if(typeof fn!=='function')return timeout(fn,delay,...args);let id=timeout(()=>{if(window.__timeouts.hold&&delay===0)window.__timeouts.held.set(id,()=>fn(...args));else fn(...args)},delay);return id};window.clearTimeout=id=>{window.__timeouts.cancelled.push(id);return clear(id)};}
async function setup(kind){const ctx=await chromium.launchPersistentContext(D+'/profile-'+kind,{channel:'chromium',headless:true,viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${D}/${kind}-dist`,`--load-extension=${D}/${kind}-dist`]});ctx.setDefaultTimeout(12000);ctx.setDefaultNavigationTimeout(12000);const errors=[];ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),base=`chrome-extension://${new URL(sw.url()).hostname}`,opt=await ctx.newPage();await opt.goto(base+'/options/index.html');await opt.waitForSelector('#save-btn');for(let p of ctx.pages())if(p!==opt)await p.close();const rpc=(action,fields={})=>opt.evaluate(({action,fields})=>chrome.runtime.sendMessage({target:'background',action,...fields}),{action,fields});await rpc('getSettings');let latest=await rpc('getLatestSession');assert(latest.success);let sid=latest.session.id;
await sw.evaluate(async sid=>{const db=await new Promise((res,rej)=>{const q=indexedDB.open('NavigraphDB');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});await new Promise((res,rej)=>{const tx=db.transaction(['nodes','edges'],'readwrite'),ns=tx.objectStore('nodes'),es=tx.objectStore('edges'),base=Math.floor(Date.now()/600000)*600000-300000;ns.clear();es.clear();for(let i=0;i<100;i++){let id=`fixture-${String(i).padStart(4,'0')}`,url=`https://fixture.invalid/${i}`,timestamp=base-Math.floor(i/50)*600000-(i%50)*1000,n={id,sessionId:sid,tabId:900+Math.floor(i/50),url,title:`Fixture ${i}`,timestamp,type:'initial',parentId:i<99?`fixture-${String(i+1).padStart(4,'0')}`:null,isClosed:false};ns.put({...n,_pageSession:sid,_pageTime:-timestamp,_pageType:n.type,_pageClosed:0,_pageTracking:0,_restoreTab:n.tabId,_statsDomain:'fixture.invalid',_statsUrl:url,_statsTime:timestamp,_statsKnown:1,_timeUnknown:false});if(i<99)es.put({id:`edge-${i}`,sessionId:sid,source:n.parentId,target:id,timestamp,type:'link',_pageSession:sid,_pageSource:n.parentId,_pageTarget:id,_pageTime:timestamp});}tx.oncomplete=res;tx.onabort=()=>rej(tx.error)});db.close()},sid);
const cdp=await ctx.newCDPSession(opt);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await sleep(250);await rpc('getSettings');let g=await ctx.newPage();await g.addInitScript(probe);await g.goto(base+'/content/index.html?view=waterfall');await g.waitForFunction(()=>window.visualizer?.allNodes.length===100);await sleep(200);await g.mouse.move(10,950);await sleep(400);return{ctx,g,opt,errors,sid,base};}
async function flags(opt,animation){await opt.click('[data-tab=performance-settings]');await opt.locator('#animation-enabled').setChecked(animation);await opt.click('#save-btn');await sleep(200);}
async function key(g,other){return g.locator('.group-badge').evaluateAll((es,other)=>es.map(e=>e.getAttribute('data-collapse-group')).find(k=>k!==other),other)}
async function open(g,k){await g.locator(`.group-badge[data-collapse-group="${k}"]`).click();await g.waitForFunction(k=>{let r=window.visualizer.renderingManager.getCurrentRenderer();return !r.drawerTransitioning&&r.currentOpenCollapseId===k},k)}
async function wheel(g,k,delta=1){let item=g.locator(`.collapsed-drawer[data-collapse-group="${k}"] .drawer-item`).filter({visible:true}).first();let b=await item.boundingBox(),p={x:b.x+50,y:b.y+20};assert(await g.evaluate(p=>!!document.elementFromPoint(p.x,p.y)?.closest('.drawer-item'),p));await g.mouse.move(p.x,p.y);await g.mouse.wheel(0,delta);}
async function capture(g,k){await g.evaluate(k=>{let r=window.visualizer.renderingManager.getCurrentRenderer(),drawer=document.querySelector(`.collapsed-drawer[data-collapse-group="${k}"]`),body=drawer.querySelector('.drawer-body');window.__old={r,drawer,body,container:r.container,svg:r.svg.node(),refs:[body.__drawerWheelHandler,body.__navigraph_wheel_handler,r.container.__drawerWheelContainerHandler,r.container.__drawerDebugDocHandler,r.documentClickHandler].filter(Boolean),badge:document.querySelector(`.group-badge[data-collapse-group="${k}"]`),key:k}},k)}
async function state(g){return g.evaluate(()=>{let{r,drawer,body,container,svg,refs,badge,key}=window.__old;return{key,open:drawer.getAttribute('data-open'),bodyWheel:!!body.__drawerWheelHandler,legacyWheel:!!body.__navigraph_wheel_handler,containerWheel:!!container.__drawerWheelContainerHandler,debugDoc:!!container.__drawerDebugDocHandler,activeRefs:window.__listeners.filter(e=>e.active&&refs.includes(e.fn)).map(e=>({type:e.type,target:e.target===document?'document':e.target===container?'container':'body'})),raf:body.__drawerWheelRaf??null,anim:body.__drawerAnim??null,target:body.__drawerTarget??0,accum:body.__drawerWheelAccum??0,scroll:body.querySelector('.drawer-scroll')?.getAttribute('transform'),timers:r.timers.size,transitions:[drawer,...drawer.querySelectorAll('*')].filter(e=>!!e.__transition).length,clip:svg.querySelectorAll(`clipPath[id="drawer-clip-${key}"]`).length,docClick:!!r.documentClickHandler,current:r.currentOpenCollapseId,busy:r.drawerTransitioning,badge:badge.textContent,disposed:r.disposed??null}})}
module.exports={setup,flags,key,open,wheel,capture,state,sleep,assert,fs,D};
```

### baseline.cjs

```javascript
const{setup,key,open,wheel,capture,state,sleep,assert,fs,D}=require('./baseline-harness.cjs');(async()=>{let{ctx,g}=await setup('baseline');try{let k=await key(g);await open(g,k);await capture(g,k);await wheel(g,k,150);await sleep(120);let before=await state(g);await g.mouse.click(1100,700);let after=await state(g);assert.equal(after.open,'false');assert.equal(after.current,null);assert(after.bodyWheel&&after.containerWheel&&after.debugDoc&&after.clip===1);fs.writeFileSync(D+'/baseline-result.json',JSON.stringify({before,after},null,2));console.log('REPRO',JSON.stringify({before,after}));}finally{await ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
```

### fixed.cjs

```javascript
const{setup,flags,key,open,wheel,capture,state,sleep,assert,fs,D}=require('./harness.cjs');const results=fs.existsSync(D+'/fixed-result.json')?JSON.parse(fs.readFileSync(D+'/fixed-result.json')).results:[];let ctx,g,opt,errors;
async function pass(name,fn){if(results.some(r=>r.name===name)){console.log('PREVIOUS',name);return}let data=await fn();results.push({name,data});fs.writeFileSync(D+'/fixed-result.json',JSON.stringify({results,errors},null,2));console.log('PASS',name,JSON.stringify(data));}
function clean(s,newKey=null,shared=false){assert.equal(s.open,'false');assert.equal(s.bodyWheel,false);assert.equal(s.legacyWheel,false);assert.equal(s.raf,null);assert.equal(s.anim,null);assert.equal(s.target,0);assert.equal(s.accum,0);if(s.disposed)assert(s.scroll===undefined||s.scroll==='translate(0, 0)');else assert.equal(s.scroll,'translate(0, 0)');assert.equal(s.clip,0);assert.equal(s.transitions,0);assert.equal(s.activeRefs.length,0);assert.equal(s.current,newKey);assert.equal(s.busy,false);if(!newKey){if(!shared){assert.equal(s.containerWheel,false);assert.equal(s.debugDoc,false);}assert.equal(s.docClick,false);assert.equal(s.timers,0)}}
async function live(k){return g.evaluate(k=>{const r=window.visualizer.renderingManager.getCurrentRenderer(),b=document.querySelector(`.collapsed-drawer[data-collapse-group="${k}"] .drawer-body`);return{current:r.currentOpenCollapseId,busy:r.drawerTransitioning,wheel:!!b.__drawerWheelHandler,forwarder:!!r.container.__drawerWheelContainerHandler,debug:!!r.container.__drawerDebugDocHandler,doc:!!r.documentClickHandler,clip:r.svg.node().querySelectorAll(`clipPath[id="drawer-clip-${k}"]`).length,target:b.__drawerTarget??0,scroll:b.querySelector('.drawer-scroll')?.getAttribute('transform')}} ,k)}
async function pendingZero(enabled){await g.evaluate(enabled=>{window.__timeouts.hold=enabled},enabled)}
async function waitPending(animation){if(animation)assert(await g.evaluate(()=>window.__old.r.drawerTransitioning&&window.__old.r.timers.size>0));else await g.waitForFunction(()=>[...window.__old.r.timers].some(id=>window.__timeouts.held.has(id)),undefined,{polling:10});}
async function keepOldCallbacks(){await g.evaluate(()=>{window.__lateTimers=[...window.__old.r.timers].map(id=>({id,fn:window.__timeouts.held.get(id)})).filter(x=>x.fn);window.__timeouts.hold=false})}
async function historyReady(){await g.evaluate(()=>{history.pushState(null,'','?view=tree');history.pushState(null,'','?view=waterfall')})}
async function backToTree(){await g.goBack();await g.waitForFunction(()=>window.visualizer.currentView==='tree')}
async function forwardWaterfall(){await g.goForward();await g.waitForFunction(()=>window.visualizer.currentView==='waterfall'&&document.querySelector('.group-badge'));await sleep(100)}
(async()=>{({ctx,g,opt,errors}=await setup('fixed'));
for(const animation of[false,true]){
 await flags(opt,animation);await g.waitForFunction(a=>window.navigraphSettings.animationEnabled===a,animation);let a=await key(g),b=await key(g,a);
 await pass(`motion=${animation}: native wheel external close, idle old scroll, reopen and normal close`,async()=>{await open(g,a);await capture(g,a);await wheel(g,a,1);await sleep(20);const active=await state(g);await g.mouse.click(1100,700);let closed=await state(g);clean(closed);await g.mouse.move(100,245);await g.mouse.wheel(0,150);await sleep(60);clean(await state(g));await open(g,a);let reopened=await live(a);assert.equal(reopened.target,0);assert.equal(reopened.scroll,'translate(0, 0)');await g.locator(`.group-badge[data-collapse-group="${a}"]`).click();await g.waitForFunction(()=>!window.visualizer.renderingManager.getCurrentRenderer().drawerTransitioning);let normal=await state(g);clean(normal);assert.equal(normal.badge,'50');return{active,closed,reopened,normal}});
 await pass(`motion=${animation}: held real-wheel two RAFs, switch group, stale callbacks`,async()=>{await open(g,a);await capture(g,a);await g.evaluate(()=>{window.__raf.hold=true;window.__raf.cancelled=[];let legacy=()=>{};window.__old.body.__navigraph_wheel_handler=legacy;window.__old.body.addEventListener('wheel',legacy,true);window.__old.refs.push(legacy)});await wheel(g,a,1);await g.waitForFunction(()=>window.__raf.held.has(window.__old.body.__drawerWheelRaf),undefined,{polling:10});await g.evaluate(()=>{let id=window.__old.body.__drawerWheelRaf,frame=window.__raf.held.get(id);window.__raf.held.delete(id);window.__raf.pending.delete(id);frame.fn(frame.time)});await wheel(g,a,1);await g.waitForFunction(()=>{let b=window.__old.body;return b.__drawerAnim!=null&&b.__drawerWheelRaf!=null&&window.__raf.held.has(b.__drawerAnim)&&window.__raf.held.has(b.__drawerWheelRaf)},undefined,{polling:10});let ids=await g.evaluate(()=>{let b=window.__old.body;window.__lateFrames=[b.__drawerAnim,b.__drawerWheelRaf].map(id=>({id,...window.__raf.held.get(id)}));return window.__lateFrames.map(x=>x.id)});await g.locator(`.group-badge[data-collapse-group="${b}"]`).click();await g.evaluate(()=>{window.__raf.hold=false;let late=new Set(window.__lateFrames.map(x=>x.id));for(let[id,f]of window.__raf.held)if(!late.has(id)){window.__raf.held.delete(id);window.__raf.pending.delete(id);f.fn(f.time)}});await g.waitForFunction(b=>!window.visualizer.renderingManager.getCurrentRenderer().drawerTransitioning&&window.visualizer.renderingManager.getCurrentRenderer().currentOpenCollapseId===b,b);let old=await state(g);clean(old,b);let cancelled=await g.evaluate(()=>window.__raf.cancelled);assert(ids.every(id=>cancelled.includes(id)));const before=await live(b);await g.evaluate(()=>{for(let f of window.__lateFrames)f.fn(f.time)});await sleep(50);assert.deepEqual(await live(b),before);await wheel(g,b,150);await sleep(50);assert((await live(b)).target>0);await g.mouse.click(1100,700);return{ids,cancelled:ids.filter(id=>cancelled.includes(id)),old,newBefore:before,newAfterStale:before}});
 await pass(`motion=${animation}: pending normal close external release and reopen past old deadline`,async()=>{await open(g,a);await capture(g,a);await pendingZero(!animation);await g.locator(`.group-badge[data-collapse-group="${a}"]`).click();await waitPending(animation);await keepOldCallbacks();await g.mouse.click(1100,700);clean(await state(g));await open(g,b);const before=await live(b);await g.evaluate(()=>{for(let t of window.__lateTimers)t.fn()});await sleep(2200);const after=await live(b);assert.deepEqual(after,before);clean(await state(g),b);await g.mouse.click(1100,700);return{heldZero:!animation,before,after}});
 for(const phase of['opening','closing'])await pass(`motion=${animation}: history view cleanup during ${phase}, repeated cleanup cannot affect new owner`,async()=>{await historyReady();if(phase==='closing')await open(g,a);await capture(g,a);await pendingZero(!animation);await g.locator(`.group-badge[data-collapse-group="${a}"]`).click();await waitPending(animation);await capture(g,a);await keepOldCallbacks();await backToTree();let closed=await state(g);clean(closed);assert.equal(closed.disposed,true);await forwardWaterfall();await open(g,b);const before=await live(b);await g.evaluate(()=>{window.__old.r.closeCurrentDrawer();window.__old.r.cleanup();window.__old.r.cleanup();for(let t of window.__lateTimers)t.fn()});await sleep(2200);assert.deepEqual(await live(b),before);clean(await state(g),null,true);await g.mouse.click(1100,700);return{closed,newOwner:before,heldZero:!animation}});
}
await pass('controlled legacy helper resources then real history cleanup',async()=>{await historyReady();const a=await key(g);const created=await g.evaluate(a=>{const r=window.visualizer.renderingManager.getCurrentRenderer(),group=r.collapsedGroups.find(c=>c.displayNode.id===a),node=r.swimlanes.flatMap(l=>l.lifecycles.flatMap(c=>c.nodes)).find(n=>n.id===a),segment=r.allSegments.find(s=>s.nodes.some(n=>n.id===a)),lane=r.getSwimlaneForNode(node);if(!group||!node||!segment||!lane)throw Error('legacy fixture precondition');window.__fallback={r,svg:r.svg};r.showCollapsedNodesDrawer(group,node,segment,50,lane.y+5,150,40);return{handler:!!r.svg.on('click.drawer'),dom:r.svg.selectAll('.collapsed-nodes-drawer').size(),canonicalNode:node.id}},a);assert(created.handler&&created.dom>0);await backToTree();const cleared=await g.evaluate(()=>({handler:!!window.__fallback.svg.on('click.drawer'),dom:window.__fallback.svg.selectAll('.collapsed-nodes-drawer').size(),disposed:window.__fallback.r.disposed}));assert.deepEqual(cleared,{handler:false,dom:0,disposed:true});return{created,cleared}});
assert.deepEqual(errors,[]);await ctx.close();})().catch(async e=>{console.error(e.stack);if(g)await g.screenshot({path:D+'/fixed-fail.png'}).catch(()=>{});if(ctx)await ctx.close();process.exitCode=1});
```
