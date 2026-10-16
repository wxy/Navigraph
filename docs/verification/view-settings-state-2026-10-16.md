# 默认视图与显示设置验证（2026-10-16）

基线：`f0d3e01e79e5cd4cf0a9de2b57c77e955f07b98a`，分支 `codex/view-settings-state`。本次只涉及视图来源、历史状态、显示设置与必要抽屉交互。未做海洋视图、长时 CPU/能耗测试，未改变后台记录/数据模型或新增 session URL 路由。旧报告未改。

## 行为与边界

- 有效 URL `view=tree|waterfall` > 已保存 defaultView > 内置 waterfall。无效 URL 按缺失处理。隐式页跟随默认设置，显式 URL/手动选择固定当前视图；普通刷新不把隐式选择写成显式 URL。
- 手动切换只新增一次 history；初始化、popstate 和设置通知不 push。前后导航恢复视图及 filter，缺失 filter 恢复默认。保留未知 query、hash、localStorage 当前 session；不解释 `session` query。
- 同值或无关设置不会重置分页/重建 renderer。动画/标签更新当前页；有效 maxNodes 变化重载第0页，原 generation 丢弃旧响应。UI 未就绪仅更新目标，UI 就绪后允许新设置使在途旧查询失效；等待 window.load 后再读最新 URL。
- 动画关闭时 D3 duration/delay、抽屉动画等待与树缩放 duration 为0，保留 end 清理和功能性滚动 RAF。空态不创建 SMIL，图内 CSS animation/transition 关闭。仅节点标题隐藏，徽标与必要提示/点击保留；轴不受标题开关影响属于CSS/选择器静态结论，并非本轮轴显示实测。
- options 性能页实际提供动画、标题和每页节点数（1..500）。数值下取整/夹紧，空值回到100；旧值1000显示有效500，未编辑时无关保存保留1000，避免静默更改历史偏好。不会截断会话数据。9种 locale 加入必要文案。

## 环境与实际检查

macOS 26.6.2 (25G83)、arm64；Node 26.7.0 / npm 11.19.0；Playwright 1.62.1；其 Chromium channel 分发（Chrome for Testing 151.0.7922.34，revision1234），headless、1400×1000、独立 persistent profile、unpacked MV3。不是用户日用浏览器。生产 `npm run build` 包含 `tsc --noEmit`，最终通过，只有现有 d3 资产体积 warning。

16个不同直接场景通过；没有新增单元/隔离测试。先后运行 initial、continuation、targeted tail、race、drawer 段，并非最终代码下一次整套重跑。较早10项在显示行为实现后通过；随后仅补初始化重读、badge/defs清理并针对性构建、验证4个竞态与2个抽屉场景。所有测试使用干净生产 bundle；临时观测只在页面对象/浏览器 API 上包装，没有产品测试接口或改写查询结果。

| 场景 | 实际证据 |
|---|---|
| 1 新profile内置默认 | waterfall、implicit、URL不写view |
| 2 options默认/重开/URL | 保存tree后已打开implicit立即tree，新页tree；有效waterfall覆盖，bogus回退tree |
| 3 手动/历史/显式固定 | 切换push1次，重复同视图不新增；改默认不覆盖explicit；真实back/forward、reload正确 |
| 4 空态动画/标题 off→on | SMIL 0→2；树zoom duration 0→250；标题none→block，空态提示仍block |
| 5 fixture与有界页 | 600 nodes/599 edges，首屏100 nodes、3折叠组；seed后真实stop/wake |
| 6 有数据标题/详情 | waterfall标题隐藏/恢复，徽标仍显示；真实点击节点打开详情 |
| 7 树形显示 | 标题隐藏/恢复，zoom duration 0/250 |
| 8 每页数/重开 | 1→500→1.9(1)→空(100)，当前nodes/limit一致，total始终600，重开回显100 |
| 9 legacy/false/0 | 1000显示500；未触碰max而保存flags，仍1000；animation/showLabels=false，retention/idle=0保留 |
| 10 reset | 真实confirm接受，恢复100/true/true并即时应用，显式tree不被默认重置 |
| 11 慢window.load | 本地未结束图片请求保持load；真实options改default/false/limit1、真实back后释放；最终explicit tree/limit1/false，无showError |
| 12 初始RPC竞态 | 实际100查询callback暂缓；options改500先应用；释放旧100后仍500 nodes/limit500 |
| 13 popstate竞态 | 在途旧page暂缓；真实back/forward到waterfall+reload:false；matched300且100条均非reload，旧响应不覆盖；back恢复tree/reload:true/matched600；unknown/hash/session记忆保留 |
| 14 重复/无关通知 | 当前page2，实际保存同值及theme设置后，page2和同renderer身份保持 |
| 15 抽屉motion off | 实际可见item命中后wheel，逻辑target=900；duration/delay全0；同badge close后current=null、3个body wheel/RAF=false、drawer clip=0；可重开、外关、切另一组 |
| 16 抽屉motion on | 同路径target=900；观测duration200/180、delay最高160；正常close清理同off，后续交互通过 |

最终 result.json 记录 errors:[]；各段重建 errors 数组，不能等价于所有分段页面错误的累计断言；竞态与抽屉段退出前显式 assert errors=[]。RPC 延迟探针实际先请求后台，再暂缓原 callback，不伪造成功响应。`__transition`/private 普通TS属性仅用于观测；没有新增产品接口。节点详情用实际click，所有 drawer 操作用实际鼠标，未force。

## 验证中发现与处理

1. 夹具一度从隐藏的options performance标签访问default select；改为先点击basic标签。SVG body整体bbox包含裁剪外内容，随后取bg点又恰落在行间；动画on/off同位置均穿透，原bg明确pointer:none。最终取可见drawer-item中心并断言elementFromPoint属于drawer，再发真实wheel。open raise改变DOM顺序，后续点击固定data-collapse-group身份，避免动态first点另一组。
2. 实际on/off方法顺序均为document capture `closeCurrentDrawer(before=current, after=null)` → badge冒泡 `togglePrebuiltDrawer(before=null)` →最后重新open同group。最小修复只把当前group的badge纳入内部命中，保留其它badge/外部点击。
3. 正常close端点开始可达后，clip=1断言失败。三处 `defsSel && !defsSel.empty && !defsSel.empty()` 把function取反，恒false：open反复append defs、close永不删除。仅纠正这三处，最终on/off正常关闭均clip=0；没有以延迟重试掩盖问题。

既有快速外关/换组 `closeDrawerSel` 仍使用不同清理路径：本轮只验证关闭/换组状态与继续操作，没有声称它已释放全部handler/RAF/clip；该旧路径资源清理另列后续。默认设置控制的是本图内动画；未对浏览器/系统动画作保证。没有做性能/堆峰值、长期泄漏、全库或其它业务回归。

## 构建来源

最终仓库输入清单哈希（git ls-files + 新display-settings.ts，排除本报告；逐文件SHA256+两空格+相对路径+换行后整体SHA256）：`ce9361c4e557073a84d1f89b194ba27f0bcfc9df0fc09b81e44e05b65ee189ab`。

临时source同清单构建后哈希：`c2ee9caedb73470498f2e6f92a7bf8751f7909e64c4507e10cd4e7f60271df4c`。与仓库仅9个locale JSON不同，来自构建插件生成合并；7个新options key在全部locale内容逐项相同，所有其余列入清单源码字节相同。没有随后用baseline覆盖source。最终clean-dist是最后一次生产build的dist复制；未加bundle探针：

- content/content.js：`df1dba20a13155b52331497553979ae78f43d6d9d02e92dc6972053a5bbf9ba0`
- options/options.js：`5b381de40b50a365e031da235f746ffecb3631f60364e364f2d57ec30f0f1940`
- background/background.js：`20a85366abfaddf5fc8352af29b717b68802aeff54f2236b1668a9b3cb9a4300`

最后生产构建覆盖本次全部源码。前面的非最终构建仅有本报告明确的后续小修差异；不会把它们称作最终冻结输入的整套回归。

## 完整重建

在该PR最终源码checkout执行下列准备；不要在仓库原地build。依赖安装/浏览器下载可能需要网络权限。PLAYWRIGHT_MODULE可指已安装Playwright1.62.1，或按此装入任务temp。缓存、profile、构建、fixture和日志全部temp；报告记录后清理该目录。原始证据曾位于系统temp `navigraph-view-settings.SrBKFO`，不要求其永久存在。

```sh
REPO=/Volumes/MacSSD/develop/Navigraph
TASK_TMP=$(mktemp -d "${TMPDIR:-/tmp}/navigraph-view-settings.XXXXXX")
export TASK_TMP
export npm_config_cache="$TASK_TMP/npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="$TASK_TMP/browsers"
mkdir "$TASK_TMP/source"
git -C "$REPO" archive HEAD | tar -x -C "$TASK_TMP/source"
# 未提交工作树复现时，精确覆盖tracked源码与本次新增helper：
python3 - <<'COPY'
import os, pathlib, subprocess, shutil
root=pathlib.Path('/Volumes/MacSSD/develop/Navigraph')
dest=pathlib.Path(os.environ['TASK_TMP'])/'source'
paths=subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()
paths+=['src/content/utils/display-settings.ts']
for rel in set(paths):
    src=root/rel
    if src.is_file():
        (dest/rel).parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(src,dest/rel)
COPY
# 已提交PR也可直接archive；不要复制node_modules/旧dist。
(cd "$TASK_TMP/source" && npm ci --ignore-scripts && npm run build > "$TASK_TMP/build.log" 2>&1)
cp -R "$TASK_TMP/source/dist" "$TASK_TMP/clean-dist"
npm install --prefix "$TASK_TMP/tooling" --no-save playwright@1.62.1
export PLAYWRIGHT_MODULE="$TASK_TMP/tooling/node_modules/playwright"
node "$PLAYWRIGHT_MODULE/cli.js" install chromium
```

将下面4段分别保存到 `$TASK_TMP` 同名文件。脚本require路径请换为 `require(process.env.PLAYWRIGHT_MODULE)`，原始运行使用本机bundled Playwright路径。新profile仅包含本次合成fixture。fixture直接写IDB维护全部派生键，之后真实stop/wake清除绕过生产wrapper的聚合缓存；不是用户录制数据或生产写入验收。所有时间由运行时Date.now生成，600条每50条换tab/10分钟段，初始/reload各300、相邻父子599条。统计/记录流程不是本轮验收目标。

重建顺序：

```sh
cd "$TASK_TMP"
node e2e.cjs > initial.log 2>&1
node continue-repro.cjs > continuation.log 2>&1
node races.cjs > races.log 2>&1
node drawer-final.cjs > drawer.log 2>&1
```

这是把实际分段成功断言整理的重建序列，未以该四命令整体再跑。continue-repro显式先保存false/false以重建原先drawer诊断留下的起始状态；它不假称该额外设置步骤在旧tail记录中重新执行。失败诊断不需反复重现，原顺序与原因已记录。最终结果为16 distinct PASS；没有把预载结果当作重复执行。

### e2e.cjs

```javascript
const fs=require('fs'),path=require('path'),assert=require('assert');
const T=__dirname;process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(T,'browsers');
const {chromium}=require('/Users/xingyuwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const results=[],errors=[];let ctx;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function pass(name,fn){const data=await fn();results.push({name,data});fs.writeFileSync(path.join(T,'result.json'),JSON.stringify({results,errors},null,2));console.log('PASS',name,JSON.stringify(data));}
(async()=>{ctx=await chromium.launchPersistentContext(path.join(T,'profile3'),{channel:'chromium',headless:true,viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${T}/clean-dist`,`--load-extension=${T}/clean-dist`]});
ctx.setDefaultTimeout(10000);ctx.setDefaultNavigationTimeout(10000);
let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');let id=new URL(sw.url()).hostname,base=`chrome-extension://${id}`;
ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));for(const p of ctx.pages())p.on('pageerror',e=>errors.push(e.message));
const opt=await ctx.newPage();await opt.goto(base+'/options/index.html');await opt.waitForSelector('#save-btn');await sleep(500);
const rpc=(action,fields={})=>opt.evaluate(({action,fields})=>chrome.runtime.sendMessage({target:'background',action,...fields}),{action,fields});
const read=()=>opt.evaluate(()=>chrome.storage.sync.get(null));
async function save({view,animation,labels,max}={}){if(view!==undefined){await opt.click('[data-tab=basic-settings]');await opt.selectOption('#default-view',view);}await opt.locator('[data-tab="performance-settings"]').click();if(animation!==undefined)await opt.locator('#animation-enabled').setChecked(animation);if(labels!==undefined)await opt.locator('#show-labels').setChecked(labels);if(max!==undefined)await opt.fill('#max-nodes',String(max));await opt.click('#save-btn');await sleep(550);}
async function graph(query=''){const p=await ctx.newPage();await p.goto(base+'/content/index.html'+query);await p.waitForFunction(()=>window.visualizer?.displayReady&&window.visualizer?.currentSession);await sleep(200);return p;}
const state=p=>p.evaluate(()=>{const v=window.visualizer;return{view:v.currentView,explicit:v.hasExplicitView,ready:v.displayReady,url:location.href,page:v.sessionService?.pageInfo,flags:window.navigraphSettings,nodes:v.allNodes?.length,filter:v.filters}});
let g=await graph();
await pass('fresh builtin waterfall',async()=>{let s=await state(g);assert.equal(s.view,'waterfall');assert.equal(s.explicit,false);assert(!new URL(s.url).searchParams.has('view'));return s;});
await save({view:'tree'});
await pass('options default live implicit, reopen and URL precedence',async()=>{assert.equal((await state(g)).view,'tree');let reopen=await graph();assert.equal((await state(reopen)).view,'tree');await reopen.close();let p=await graph('?view=waterfall&session=untouched&custom=kept#anchor');assert.equal((await state(p)).view,'waterfall');let invalid=await graph('?view=bogus');assert.equal((await state(invalid)).view,'tree');assert.equal((await state(invalid)).explicit,false);await invalid.close();await p.close();return await state(g);});
await pass('manual history and explicit settings pin',async()=>{let h=await g.evaluate(()=>history.length);await g.click('#waterfall-view');console.log('after switch');assert.equal(await g.evaluate(()=>history.length),h+1);await g.click('#waterfall-view');console.log('after switch');assert.equal(await g.evaluate(()=>history.length),h+1);await save({view:'waterfall'});assert.equal((await state(g)).view,'waterfall');await save({view:'tree'});assert.equal((await state(g)).view,'waterfall');console.log('before back',g.url());await g.goBack();console.log('after back',g.url());await g.waitForFunction(()=>window.visualizer.currentView==='tree');assert.equal((await state(g)).explicit,false);await g.goForward();await g.waitForFunction(()=>window.visualizer.currentView==='waterfall');await g.reload();await g.waitForFunction(()=>window.visualizer?.displayReady);assert.equal((await state(g)).view,'waterfall');return await state(g);});
await save({animation:false,labels:false,max:100});
await pass('empty motion labels off then on',async()=>{await g.waitForFunction(()=>!window.navigraphSettings.animationEnabled);await g.click('#tree-view');let s=await g.evaluate(()=>({smil:document.querySelectorAll('svg animate').length,duration:window.visualizer.zoom.duration(),labels:[...document.querySelectorAll('.node-title-label')].map(e=>getComputedStyle(e).display),hints:[...document.querySelectorAll('.empty-data-message')].map(e=>getComputedStyle(e).display)}));assert.equal(s.smil,0);assert.equal(s.duration,0);assert(s.labels.every(x=>x==='none'));await save({animation:true,labels:true});await g.waitForFunction(()=>window.navigraphSettings.animationEnabled);let on=await g.evaluate(()=>({smil:document.querySelectorAll('svg animate').length,duration:window.visualizer.zoom.duration(),labels:[...document.querySelectorAll('.node-title-label')].map(e=>getComputedStyle(e).display)}));assert(on.smil>0);assert.equal(on.duration,250);assert(on.labels.some(x=>x!=='none'));return {off:s,on};});
fs.writeFileSync(path.join(T,'context.json'),JSON.stringify({id,base}));
console.log('STAGE1',JSON.stringify(await read()));
await g.close();for(const p of ctx.pages())if(p!==opt&&p.url().includes('/content/index.html'))await p.close();
const latest=await rpc('getLatestSession');assert(latest.success);let sid=latest.session.id;
await sw.evaluate(async sid=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('NavigraphDB');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});if(!db.objectStoreNames.contains('nodes'))throw Error('stores:'+Array.from(db.objectStoreNames));await new Promise((res,rej)=>{const tx=db.transaction(['nodes','edges'],'readwrite'),ns=tx.objectStore('nodes'),es=tx.objectStore('edges'),now=Date.now();for(let i=0;i<600;i++){let timestamp=now-i*1000-Math.floor(i/50)*600000,id=`fixture-${String(i).padStart(4,'0')}`,url=`https://fixture.invalid/page/${i}`,node={id,sessionId:sid,tabId:900+Math.floor(i/50),url,title:`Fixture title ${i}`,timestamp,type:i%2?'reload':'initial',parentId:i<599?`fixture-${String(i+1).padStart(4,'0')}`:null,isClosed:false};ns.put({...node,_pageSession:sid,_pageTime:-timestamp,_pageType:node.type,_pageClosed:0,_pageTracking:0,_restoreTab:node.tabId,_statsDomain:'fixture.invalid',_statsUrl:url,_statsTime:timestamp,_statsKnown:1,_timeUnknown:false});if(i<599){let edge={id:`edge-${i}`,sessionId:sid,source:node.parentId,target:id,timestamp,type:'link'};es.put({...edge,_pageSession:sid,_pageSource:edge.source,_pageTarget:id,_pageTime:timestamp});}}tx.oncomplete=res;tx.onabort=()=>rej(tx.error)});db.close()},sid);
const cdp=await ctx.newCDPSession(opt);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await sleep(350);await rpc('getSettings');await sleep(200);
g=await graph('?view=waterfall&custom=kept#anchor');
console.log('SEEDED',JSON.stringify(await state(g)));
await g.screenshot({path:path.join(T,'seeded.png')});
await pass('seed is current bounded page',async()=>{let n=await g.evaluate(()=>({nodes:window.visualizer.allNodes.length,page:window.visualizer.sessionViewController.sessionService?.pageInfo,renderer:window.visualizer.renderingManager.getCurrentRenderer()?.constructor?.name,badges:document.querySelectorAll('.group-badge').length}));assert.equal(n.nodes,100);return n;});
fs.writeFileSync(path.join(T,'checkpoint.json'),JSON.stringify({id,sid}));
await ctx.close();
})().catch(async e=>{console.error(e.stack);fs.writeFileSync(path.join(T,'failure.txt'),e.stack);if(ctx)await ctx.close();process.exitCode=1});
```

### continue-repro.cjs

```javascript
const fs=require('fs'),path=require('path'),assert=require('assert'),http=require('http');const T=__dirname;process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(T,'browsers');const{chromium}=require('/Users/xingyuwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const results=JSON.parse(fs.readFileSync(T+'/result.json')).results,errors=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ctx,g,opt,base;
async function pass(name,fn){let data=await fn();results.push({name,data});fs.writeFileSync(T+'/result.json',JSON.stringify({results,errors},null,2));console.log('PASS',name,JSON.stringify(data));}
async function save({view,animation,labels,max}={}){if(view!==undefined){await opt.click('[data-tab=basic-settings]');await opt.selectOption('#default-view',view);}await opt.click('[data-tab=performance-settings]');if(animation!==undefined)await opt.locator('#animation-enabled').setChecked(animation);if(labels!==undefined)await opt.locator('#show-labels').setChecked(labels);if(max!==undefined)await opt.fill('#max-nodes',String(max));await opt.click('#save-btn');await sleep(450);}
const state=()=>g.evaluate(()=>({view:window.visualizer.currentView,explicit:window.visualizer.hasExplicitView,page:window.visualizer.pageInfo,nodes:window.visualizer.allNodes.length,filters:window.visualizer.filters,flags:window.navigraphSettings,url:location.href}));
async function panel(show){let visible=await g.locator('#control-panel').evaluate(e=>e.classList.contains('visible'));if(visible!==show){await g.locator('#control-panel-handle').click();await g.mouse.move(10,950);await sleep(500);}}
async function switchView(v){await panel(true);await g.click('#'+v+'-view');await panel(false);await sleep(350);}
(async()=>{ctx=await chromium.launchPersistentContext(T+'/profile3',{channel:'chromium',headless:true,viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${T}/clean-dist`,`--load-extension=${T}/clean-dist`]});ctx.setDefaultTimeout(12000);ctx.setDefaultNavigationTimeout(12000);base=JSON.parse(fs.readFileSync(T+'/context.json')).base;ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));opt=await ctx.newPage();await opt.goto(base+'/options/index.html');await opt.waitForSelector('#save-btn');for(let p of ctx.pages())if(p!==opt)await p.close();g=await ctx.newPage();await g.goto(base+'/content/index.html?view=waterfall&custom=kept#anchor');await g.waitForFunction(()=>window.visualizer?.allNodes.length===100);await sleep(350);await opt.click('[data-tab=performance-settings]');await opt.screenshot({path:T+'/options-performance.png'});
if(!results.some(r=>r.name==='populated labels/motion off on and details'))await pass('populated labels/motion off on and details',async()=>{await save({animation:false,labels:false});await g.waitForFunction(()=>document.querySelector('svg.hide-node-labels.motion-disabled'));await panel(false);let off=await g.evaluate(()=>({labels:[...document.querySelectorAll('.node-title-label')].map(e=>getComputedStyle(e).display),badges:[...document.querySelectorAll('.group-badge-text')].map(e=>getComputedStyle(e).display),axes:document.querySelectorAll('.time-axis-labels text').length}));assert(off.labels.length>0);assert(off.labels.every(x=>x==='none'));assert(off.badges.some(x=>x!=='none'));let node=g.locator('.node').first();console.log('nodeclasses',await g.locator('svg g').evaluateAll(es=>es.slice(0,10).map(e=>e.getAttribute('class'))));if(await node.count()===0)node=g.locator('.navigation-node').first();await node.click();await g.waitForFunction(()=>{const e=document.querySelector('.node-details-panel');return e&&getComputedStyle(e).display!=='none'});await g.keyboard.press('Escape');await save({animation:true,labels:true});await g.waitForFunction(()=>!document.querySelector('svg.hide-node-labels'));let on=await g.evaluate(()=>[...document.querySelectorAll('.node-title-label')].map(e=>getComputedStyle(e).display));assert(on.some(x=>x!=='none'));return{off,on};});
await save({animation:false,labels:false});
await pass('tree labels and doubleclick duration off/on',async()=>{await switchView('tree');let off=await g.evaluate(()=>({duration:window.visualizer.zoom.duration(),labels:[...document.querySelectorAll('.node-title-label')].map(e=>getComputedStyle(e).display)}));assert.equal(off.duration,0);assert(off.labels.length&&off.labels.every(x=>x==='none'));await save({animation:true,labels:true});let on=await g.evaluate(()=>({duration:window.visualizer.zoom.duration(),labels:[...document.querySelectorAll('.node-title-label')].map(e=>getComputedStyle(e).display)}));assert.equal(on.duration,250);assert(on.labels.some(x=>x!=='none'));return{off,on};});
await pass('nodes per page 1/500/decimal/blank and options reopen',async()=>{let samples=[];for(let [raw,want]of[['1',1],['500',500],['1.9',1],['',100]]){await save({max:raw});await g.waitForFunction(n=>window.visualizer.pageInfo?.limit===n&&window.visualizer.allNodes.length===n,want);samples.push({raw,want,page:(await state()).page});assert.equal((await state()).page.total,600);}await opt.reload();await opt.waitForSelector('#save-btn');await opt.click('[data-tab=performance-settings]');assert.equal(await opt.inputValue('#max-nodes'),'100');return samples;});
await pass('legacy max untouched save preserves and flags/zero persist',async()=>{await opt.evaluate(async()=>{let {navigraph_settings:s}=await chrome.storage.sync.get('navigraph_settings');await chrome.storage.sync.set({navigraph_settings:{...s,maxNodes:1000,dataRetention:0,idleTimeout:0}})});await opt.reload();await opt.waitForSelector('#save-btn');await opt.click('[data-tab=performance-settings]');assert.equal(await opt.inputValue('#max-nodes'),'500');await save({animation:false,labels:false});let stored=await opt.evaluate(async()=> (await chrome.storage.sync.get('navigraph_settings')).navigraph_settings);assert.equal(stored.maxNodes,1000);assert.equal(stored.dataRetention,0);assert.equal(stored.idleTimeout,0);assert.equal(stored.animationEnabled,false);assert.equal(stored.showLabels,false);await g.waitForFunction(()=>window.visualizer.pageInfo?.limit===500);await opt.reload();await opt.waitForSelector('#save-btn');await opt.click('[data-tab=performance-settings]');assert.equal(await opt.isChecked('#animation-enabled'),false);return stored;});
await pass('options reset confirmation restores defaults live',async()=>{opt.once('dialog',d=>d.accept());await opt.click('#reset-btn');await g.waitForFunction(()=>window.visualizer.pageInfo?.limit===100&&window.navigraphSettings.showLabels&&window.navigraphSettings.animationEnabled);assert.equal(await opt.inputValue('#max-nodes'),'100');assert(await opt.isChecked('#animation-enabled'));let s=await state();assert.equal(s.view,'tree');assert.equal(s.explicit,true);return s;});
console.log('TAIL READY');await ctx.close();})().catch(async e=>{console.error(e.stack);if(g)await g.screenshot({path:T+'/continue-fail.png'}).catch(()=>{});fs.writeFileSync(T+'/continue-fail.txt',e.stack);if(ctx)await ctx.close();process.exitCode=1});
```

### races.cjs

```javascript
const fs=require('fs'),path=require('path'),assert=require('assert'),http=require('http');const T=__dirname;process.env.PLAYWRIGHT_BROWSERS_PATH=T+'/browsers';const{chromium}=require('/Users/xingyuwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const results=JSON.parse(fs.readFileSync(T+'/result.json')).results,errors=[];let ctx,opt,g,base,server,pending=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function pass(name,fn){const data=await fn();results.push({name,data});fs.writeFileSync(T+'/result.json',JSON.stringify({results,errors},null,2));console.log('PASS',name,JSON.stringify(data));}async function save({view,max,animation,labels}={}){if(view!==undefined){await opt.click('[data-tab=basic-settings]');await opt.selectOption('#default-view',view);}await opt.click('[data-tab=performance-settings]');for(let[key,val]of[['#animation-enabled',animation],['#show-labels',labels]])if(val!==undefined)await opt.locator(key).setChecked(val);if(max!==undefined)await opt.fill('#max-nodes',String(max));await opt.click('#save-btn');await sleep(350);}const settings=()=>opt.evaluate(async()=>(await chrome.storage.sync.get('navigraph_settings')).navigraph_settings);
const probe=()=>{window.__rpcLog=[];window.__held=[];const old=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=function(message,...args){const idx=args.findIndex(a=>typeof a==='function');if(message.action==='getSessionPage'){window.__rpcLog.push({limit:message.limit,page:message.page,filters:message.filters});let hold=window.__delayNext===true;window.__delayNext=false;if(idx>=0){let cb=args[idx];args[idx]=r=>{if(hold)window.__held.push(()=>cb(r));else cb(r)}}}return old(message,...args)};};
(async()=>{ctx=await chromium.launchPersistentContext(T+'/profile3',{channel:'chromium',headless:true,viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${T}/clean-dist`,`--load-extension=${T}/clean-dist`]});ctx.setDefaultTimeout(12000);ctx.setDefaultNavigationTimeout(12000);base=JSON.parse(fs.readFileSync(T+'/context.json')).base;ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));opt=await ctx.newPage();await opt.goto(base+'/options/index.html');await opt.waitForSelector('#save-btn');for(let p of ctx.pages())if(p!==opt)await p.close();
await save({view:'tree',max:100,animation:true,labels:true});
await pass('slow actual window load settings and history use latest before UI',async()=>{server=http.createServer((req,res)=>{pending.push(res)});await new Promise(r=>server.listen(0,'127.0.0.1',r));let port=server.address().port;g=await ctx.newPage();await g.addInitScript(port=>{document.addEventListener('DOMContentLoaded',()=>{let img=document.createElement('img');img.src=`http://127.0.0.1:${port}/hold.png`;img.style.display='none';document.body.append(img)},{once:true})},port);await g.goto(base+'/content/index.html?keep=slow#anchor',{waitUntil:'domcontentloaded'});await g.waitForFunction(()=>window.visualizer&&!window.visualizer.displayReady);await g.evaluate(()=>{window.__showErrors=[];let v=window.visualizer,old=v.showError;v.showError=function(...a){window.__showErrors.push(a);return old.apply(this,a)}});assert(pending.length>0);await save({view:'waterfall',max:1,animation:false,labels:false});await g.waitForFunction(()=>window.navigraphSettings.maxNodes===1);await g.evaluate(()=>{history.pushState(null,'','?view=tree&keep=slow#anchor');history.pushState(null,'','?view=waterfall&keep=slow#anchor')});await g.goBack({waitUntil:'commit'});assert(new URL(g.url()).searchParams.get('view')==='tree');for(let res of pending){res.writeHead(200,{'Content-Type':'image/png'});res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kM4cAAAAASUVORK5CYII=','base64'))}pending=[];await g.waitForFunction(()=>window.visualizer.displayReady&&window.visualizer.pageInfo?.limit===1);let s=await g.evaluate(()=>({view:window.visualizer.currentView,explicit:window.visualizer.hasExplicitView,flags:window.navigraphSettings,page:window.visualizer.pageInfo,showErrors:window.__showErrors,readyState:document.readyState,url:location.href}));assert.equal(s.view,'tree');assert.equal(s.explicit,true);assert.equal(s.flags.animationEnabled,false);assert.equal(s.flags.showLabels,false);assert.deepEqual(s.showErrors,[]);assert.equal(s.readyState,'complete');await g.close();await new Promise(r=>server.close(r));server=null;return s;});
await save({max:100,animation:true,labels:true});
await pass('initial async page size changes reject old response',async()=>{g=await ctx.newPage();await g.addInitScript(probe);await g.addInitScript(()=>{window.__delayNext=true});await g.goto(base+'/content/index.html?view=tree&keep=race#anchor');await g.waitForFunction(()=>window.visualizer?.displayReady&&window.__held.length===1);await save({max:500});await g.waitForFunction(()=>window.visualizer.pageInfo?.limit===500&&window.visualizer.allNodes.length===500);await g.evaluate(()=>{window.__held.shift()()});await sleep(180);let s=await g.evaluate(()=>({limit:window.visualizer.pageInfo.limit,nodes:window.visualizer.allNodes.length,log:window.__rpcLog}));assert.equal(s.limit,500);assert.equal(s.nodes,500);assert(s.log.some(q=>q.limit===100));assert(s.log.some(q=>q.limit===500));return s;});
await save({max:100});await g.waitForFunction(()=>window.visualizer.pageInfo?.limit===100);
await pass('popstate filters and view defeat delayed old page',async()=>{await g.evaluate(()=>{window.__delayNext=true;void window.visualizer.loadGraphPage(1)});await g.waitForFunction(()=>window.__held.length===1);await g.evaluate(()=>{let u=new URL(location.href);u.searchParams.set('view','waterfall');u.searchParams.set('filter',JSON.stringify({reload:false}));history.pushState(null,'',u)});await g.goBack();await g.goForward();await g.waitForFunction(()=>window.visualizer.currentView==='waterfall'&&window.visualizer.filters.reload===false&&window.visualizer.pageInfo?.matched===300);await g.evaluate(()=>window.__held.shift()());await sleep(180);let s=await g.evaluate(()=>({view:window.visualizer.currentView,page:window.visualizer.pageInfo,filters:window.visualizer.filters,nodes:window.visualizer.allNodes.map(n=>({id:n.id,type:n.type})),url:location.href,remembered:localStorage.getItem('navigraph_current_session')}));assert.equal(s.view,'waterfall');assert.equal(s.filters.reload,false);assert(s.nodes.every(n=>n.type!=='reload'));assert.equal(new URL(s.url).searchParams.get('keep'),'race');assert(new URL(s.url).hash==='#anchor');await g.goBack();await g.waitForFunction(()=>window.visualizer.currentView==='tree'&&window.visualizer.filters.reload&&window.visualizer.pageInfo?.matched===600);return{filtered:{view:s.view,page:s.page,filters:s.filters,nodes:s.nodes.length,url:s.url,remembered:s.remembered},back:await g.evaluate(()=>({view:window.visualizer.currentView,reload:window.visualizer.filters.reload,matched:window.visualizer.pageInfo.matched}))};});
await pass('same and unrelated options save keep current page and renderer',async()=>{await g.evaluate(async()=>{await window.visualizer.loadGraphPage(2);window.__sameRenderer=window.visualizer.renderingManager.getCurrentRenderer()});await save();await g.waitForFunction(()=>window.visualizer.pageInfo.page===2);assert(await g.evaluate(()=>window.__sameRenderer===window.visualizer.renderingManager.getCurrentRenderer()));await opt.click('[data-tab=basic-settings]');await opt.selectOption('#theme','dark');await opt.click('#save-btn');await sleep(300);let s=await g.evaluate(()=>({page:window.visualizer.pageInfo.page,same:window.__sameRenderer===window.visualizer.renderingManager.getCurrentRenderer(),view:window.visualizer.currentView}));assert.equal(s.page,2);assert.equal(s.same,true);return s;});
assert.deepEqual(errors,[]);await ctx.close();})().catch(async e=>{console.error(e.stack);if(g)await g.screenshot({path:T+'/races-fail.png'}).catch(()=>{});if(ctx)await ctx.close();for(let res of pending)res.end();if(server)server.close();process.exitCode=1});
```

### drawer-final.cjs

```javascript
const fs=require('fs'),path=require('path'),assert=require('assert'),http=require('http');const T=__dirname;process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(T,'browsers');const{chromium}=require('/Users/xingyuwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const results=JSON.parse(fs.readFileSync(T+'/result.json')).results,errors=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ctx,g,opt,base;
async function pass(name,fn){let data=await fn();results.push({name,data});fs.writeFileSync(T+'/result.json',JSON.stringify({results,errors},null,2));console.log('PASS',name,JSON.stringify(data));}
async function save({view,animation,labels,max}={}){if(view!==undefined){await opt.click('[data-tab=basic-settings]');await opt.selectOption('#default-view',view);}await opt.click('[data-tab=performance-settings]');if(animation!==undefined)await opt.locator('#animation-enabled').setChecked(animation);if(labels!==undefined)await opt.locator('#show-labels').setChecked(labels);if(max!==undefined)await opt.fill('#max-nodes',String(max));await opt.click('#save-btn');await sleep(450);}
const state=()=>g.evaluate(()=>({view:window.visualizer.currentView,explicit:window.visualizer.hasExplicitView,page:window.visualizer.pageInfo,nodes:window.visualizer.allNodes.length,filters:window.visualizer.filters,flags:window.navigraphSettings,url:location.href}));
async function panel(show){let visible=await g.locator('#control-panel').evaluate(e=>e.classList.contains('visible'));if(visible!==show){await g.locator('#control-panel-handle').click();await g.mouse.move(10,950);await sleep(500);}}
async function switchView(v){await panel(true);await g.click('#'+v+'-view');await panel(false);await sleep(350);}
(async()=>{ctx=await chromium.launchPersistentContext(T+'/profile3',{channel:'chromium',headless:true,viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${T}/clean-dist`,`--load-extension=${T}/clean-dist`]});ctx.setDefaultTimeout(12000);ctx.setDefaultNavigationTimeout(12000);base=JSON.parse(fs.readFileSync(T+'/context.json')).base;ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));opt=await ctx.newPage();await opt.goto(base+'/options/index.html');await opt.waitForSelector('#save-btn');for(let p of ctx.pages())if(p!==opt)await p.close();g=await ctx.newPage();await g.goto(base+'/content/index.html?view=waterfall&custom=kept#anchor');await g.waitForFunction(()=>window.visualizer?.allNodes.length===100);await sleep(350);await opt.click('[data-tab=performance-settings]');await opt.screenshot({path:T+'/options-performance.png'});
if(!results.some(r=>r.name==='populated labels/motion off on and details'))await pass('populated labels/motion off on and details',async()=>{await save({animation:false,labels:false});await g.waitForFunction(()=>document.querySelector('svg.hide-node-labels.motion-disabled'));await panel(false);let off=await g.evaluate(()=>({labels:[...document.querySelectorAll('.node-title-label')].map(e=>getComputedStyle(e).display),badges:[...document.querySelectorAll('.group-badge-text')].map(e=>getComputedStyle(e).display),axes:document.querySelectorAll('.time-axis-labels text').length}));assert(off.labels.length>0);assert(off.labels.every(x=>x==='none'));assert(off.badges.some(x=>x!=='none'));let node=g.locator('.node').first();console.log('nodeclasses',await g.locator('svg g').evaluateAll(es=>es.slice(0,10).map(e=>e.getAttribute('class'))));if(await node.count()===0)node=g.locator('.navigation-node').first();await node.click();await g.waitForFunction(()=>{const e=document.querySelector('.node-details-panel');return e&&getComputedStyle(e).display!=='none'});await g.keyboard.press('Escape');await save({animation:true,labels:true});await g.waitForFunction(()=>!document.querySelector('svg.hide-node-labels'));let on=await g.evaluate(()=>[...document.querySelectorAll('.node-title-label')].map(e=>getComputedStyle(e).display));assert(on.some(x=>x!=='none'));return{off,on};});
for(const animation of[false,true]){await pass(`waterfall drawer motion=${animation} wheel samebadge cleanup outside switch`,async()=>{await save({animation,labels:false});await panel(false);await g.evaluate(()=>{window.__transitions=[];for(let method of['duration','delay']){const p=d3.transition.prototype,old=p[method];p[method]=function(...args){if(args.length)window.__transitions.push({method,value:args[0]});return old.apply(this,args)}}});let firstBadge=g.locator('.group-badge').filter({has:g.locator('path')}).first();let key=await firstBadge.getAttribute('data-collapse-group');let badge=g.locator(`.group-badge[data-collapse-group="${key}"]`);await badge.click();await g.waitForFunction(()=>{let r=window.visualizer.renderingManager.getCurrentRenderer();return !r.drawerTransitioning&&document.querySelector('.collapsed-drawer[data-open=true]')});let drawer=g.locator('.collapsed-drawer[data-open=true]');let body=drawer.locator('.drawer-body');let bgBox=await drawer.locator('.drawer-item').first().boundingBox();let point={x:bgBox.x+Math.min(50,bgBox.width/2),y:bgBox.y+Math.min(20,bgBox.height/2)};await g.mouse.move(point.x,point.y);assert(await g.evaluate(p=>!!document.elementFromPoint(p.x,p.y)?.closest('.collapsed-drawer'),point));await g.mouse.wheel(0,150);await sleep(150);let opened=await g.evaluate(()=>{let b=document.querySelector('.collapsed-drawer[data-open=true] .drawer-body');return{wheel:!!b.__drawerWheelHandler,scroll:b.__drawerTarget,raf:b.__drawerWheelRaf,transitions:window.__transitions}});assert(opened.transitions.length);assert(opened.scroll>0);if(animation)assert(opened.transitions.some(t=>t.value>0));else assert(opened.transitions.every(t=>t.value===0));await badge.click();await g.waitForFunction(()=>!window.visualizer.renderingManager.getCurrentRenderer().drawerTransitioning&&!document.querySelector('.collapsed-drawer[data-open=true]'));let closed=await g.evaluate(()=>({clips:document.querySelectorAll('clipPath[id^=drawer-clip]').length,clipIds:[...document.querySelectorAll('clipPath[id^=drawer-clip]')].map(e=>({id:e.id,parent:e.parentElement.outerHTML.slice(0,180)})),handlers:[...document.querySelectorAll('.drawer-body')].map(b=>({wheel:!!b.__drawerWheelHandler,raf:!!b.__drawerWheelRaf})),open:window.visualizer.renderingManager.getCurrentRenderer().currentOpenCollapseId}));console.log('CLOSED',JSON.stringify(closed));assert.equal(closed.clips,0);assert(closed.handlers.every(x=>!x.wheel&&!x.raf));await badge.click();await g.waitForFunction(()=>!window.visualizer.renderingManager.getCurrentRenderer().drawerTransitioning&&document.querySelector('.collapsed-drawer[data-open=true]'));await badge.click();await g.waitForFunction(()=>!window.visualizer.renderingManager.getCurrentRenderer().drawerTransitioning);await badge.click();await g.waitForFunction(()=>!window.visualizer.renderingManager.getCurrentRenderer().drawerTransitioning);await g.mouse.click(1100,700);await g.waitForFunction(()=>!window.visualizer.renderingManager.getCurrentRenderer().currentOpenCollapseId);await badge.click();await g.waitForFunction(()=>!window.visualizer.renderingManager.getCurrentRenderer().drawerTransitioning);let other=await g.locator('.group-badge').evaluateAll((es,key)=>es.map(e=>e.getAttribute('data-collapse-group')).find(id=>id!==key),key);await g.locator(`.group-badge[data-collapse-group="${other}"]`).click();await g.waitForFunction(other=>!window.visualizer.renderingManager.getCurrentRenderer().drawerTransitioning&&window.visualizer.renderingManager.getCurrentRenderer().currentOpenCollapseId===other,other);await g.mouse.click(1100,700);await g.waitForFunction(()=>!window.visualizer.renderingManager.getCurrentRenderer().currentOpenCollapseId);return{opened,closed,other,externalClosed:true};});
}assert.deepEqual(errors,[]);await ctx.close();})().catch(async e=>{console.error(e.stack);if(g)await g.screenshot({path:T+'/drawer-final-fail.png'}).catch(()=>{});if(ctx)await ctx.close();process.exitCode=1});
```
