# 树视图 debounce timer 清理短验收（2026-10-16）

针对 PR #52 外部 P2。基线 `a8eb91fe253b9dd6066e58917eb44b1907de73c1`；本次产品源码仅 `TreeRenderer.ts`。取消旧 save-state debounce 以前只 clearTimeout，未从 renderer.timers 删除；现统一 cancelTracked（取消+Set.delete），debounce取消及cleanup复用。callback正常执行仍会自行从Set删除，移除初始化null上的无效clearTimeout。未更改导航监听、视图功能或数据层，未恢复已取消的长时性能测试。

## 环境与结果

macOS 26.6.2(25G83) arm64，Node26.7.0、npm11.19.0、Playwright1.62.1、Chromium151.0.7922.34。独立headless Chromium，1280×900，HTTP localhost合成页面，独立profile。基线和修复版各 `npm run build`（包含typecheck）通过，webpack5.111.1只有D3包大小提示。

实际扩展UI非空树，先等待初始化fit/restore计时器排空。同一个renderer，真实80次往返小幅wheel（每次后8ms）+按下鼠标连续120次小幅pan（每次后4ms），每次读取renderer身份及普通TS私有属性timers。输入调用间隔由自动化/浏览器往返决定，连续手势保持在300ms保存debounce内；不是派发合成DOM事件，也未添加产品调试接口。

| 样本 | 同renderer | Set峰值 | 输入结束时 | 静置650ms后 | 最后transform保存 |
| --- | --- | ---: | ---: | ---: | --- |
| 基线 | true | 200 | 200 | 199 | 正确 |
| 修复 | true | 1 | 1 | 0 | 正确 |

两版最终 x≈147、y≈96.6、k≈0.8，均在已有保存guard允许范围；断言localStorage tree.transform逐字段精确等于实际currentTransform，而非仅检查键存在。

修复版另4项通过：wheel手势结束后180ms（保存延迟300ms尚未到期）触发refresh，旧renderer Set清0；树→瀑布旧Set清0；切回树后wheel仍生效且静置Set0；pageErrors为空。完整修复短测5项PASS，基线复现及无pageError共2项PASS。

前置夹具曾要求两条可见记录而超时，诊断当时会话实际只有1条；timer目标只需非空树，改为>=1而不修改产品数据逻辑。另首次在mouse.wheel同帧立刻refresh曾观测旧Set1，D3 wheel手势/异步派发尚在途；本次cleanup通过项明确限定在手势结束、保存debounce仍pending的时点。没有据此宣称任意同帧手势销毁均已验收。未做CPU/内存/能耗长测或无关回归。

外部P1静态核对：当前 `NavigationManager.resetNavigationState` 仅 reset tabStateManager/nodeTracker/edgeTracker/pendingNavigationTracker，另将已有tab标dirty；没有调用navigationEventHandler.reset。全仓未发现eventHandler.reset调用者，因此“会话reset移除监听器”在当前代码上不成立，本轮没有修改导航代码。

## 可重建命令

在本PR最终代码checkout运行。构建仅task temp，npm缓存、浏览器、profile、脚本、结果均task temp；脚本写的JSON仅供当次核实，审核后删除整个任务目录，不加入Git。baseline/fixed使用不同扩展目录和profile。

```sh
TASK_TMP=$(mktemp -d "${TMPDIR:-/tmp}/navigraph-tree-timer.XXXXXX")
export TASK_TMP
export npm_config_cache="$TASK_TMP/npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="$TASK_TMP/browsers"
export NAVIGRAPH_PLAYWRIGHT="$TASK_TMP/harness/node_modules/playwright"
mkdir "$TASK_TMP/source"
git archive a8eb91fe253b9dd6066e58917eb44b1907de73c1 | tar -x -C "$TASK_TMP/source"
(cd "$TASK_TMP/source" && npm ci --ignore-scripts && npm run build)
cp -R "$TASK_TMP/source/dist" "$TASK_TMP/baseline-dist"
git archive HEAD | tar -x -C "$TASK_TMP/source"
(cd "$TASK_TMP/source" && npm run build)
npm install --prefix "$TASK_TMP/harness" --no-audit --no-fund playwright@1.62.1
node "$TASK_TMP/harness/node_modules/playwright/cli.js" install chromium
python3 - <<'EXTRACT'
import os,re,pathlib
s=pathlib.Path('docs/verification/tree-timer-cleanup-2026-10-16.md').read_text()
code=re.search(r'```javascript\n(.*?)\n```',s,re.S).group(1)
pathlib.Path(os.environ['TASK_TMP'],'e2e.cjs').write_text(code+'\n')
EXTRACT
node "$TASK_TMP/e2e.cjs" baseline
node "$TASK_TMP/e2e.cjs" fixed
# 审核后确认本任务browser/process均退出，再删除本次temp。
rm -rf "$TASK_TMP"
```

```javascript
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),http=require('http');const base=__dirname,mode=process.argv[2]||'fixed';process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(base,'browsers');const{chromium}=require(process.env.NAVIGRAPH_PLAYWRIGHT);const dist=path.join(base,mode==='baseline'?'baseline-dist':'source/dist'),wait=ms=>new Promise(r=>setTimeout(r,ms));let context,server;const checks=[];function pass(name,data={}){checks.push({name,data});console.log('PASS',name,JSON.stringify(data))}
(async()=>{server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Tree timer fixture</title><a href="/next">Next</a>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));context=await chromium.launchPersistentContext(path.join(base,'profile-'+mode+'-4'),{headless:true,channel:'chromium',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];for(const p of context.pages())if(p.url().includes('/content/'))await p.close();const web=await context.newPage(),origin='http://127.0.0.1:'+server.address().port;await web.goto(origin+'/one');await wait(350);await web.goto(origin+'/two?q=1#end');await wait(350);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`chrome-extension://${id}/content/index.html`);try{await page.waitForFunction(()=>window.visualizer?.allNodes.length>=1)}catch(e){console.log('DEBUG',await page.evaluate(async()=>({nodes:window.visualizer?.allNodes,session:window.visualizer?.currentSession,page:window.visualizer?.pageInfo,latest:await chrome.runtime.sendMessage({target:'background',action:'getLatestSession'})})));throw e}async function switchTo(view){await page.locator('#control-panel-handle').hover();await page.waitForFunction(()=>document.querySelector('#control-panel').classList.contains('visible'));await page.locator('#'+view+'-view').click();await page.mouse.move(10,10);await page.keyboard.press('Escape');await wait(650);await page.waitForFunction(view=>window.visualizer.currentView===view,view)}await switchTo('tree');await wait(1300);await page.evaluate(()=>{globalThis.__original=window.visualizer.renderingManager.getCurrentRenderer();globalThis.__sizes=[]});const read=()=>page.evaluate(()=>{const r=window.visualizer.renderingManager.getCurrentRenderer();const size=r.timers.size;globalThis.__sizes.push(size);return{size,same:r===globalThis.__original,transform:{...window.visualizer.currentTransform}}});await page.mouse.move(640,430);const before=await read();for(let i=0;i<80;i++){await page.mouse.wheel(0,i%2?12:-12);await wait(8);await read()}await page.mouse.move(640,430);await page.mouse.down();for(let i=0;i<120;i++){await page.mouse.move(640+(i%20),430+(i%10));await wait(4);await read()}await page.mouse.up();const during=await read();await wait(650);const settled=await page.evaluate(()=>{const r=window.visualizer.renderingManager.getCurrentRenderer(),transform=window.visualizer.currentTransform;return{same:r===globalThis.__original,size:r.timers.size,max:Math.max(...globalThis.__sizes),transform:{x:transform.x,y:transform.y,k:transform.k},saved:JSON.parse(localStorage.getItem('nav_view_state_'+(window.visualizer.tabId||'')))?.tree?.transform}});assert(settled.same);assert.notDeepEqual(settled.transform,before.transform);assert.deepEqual(settled.saved,settled.transform);if(mode==='baseline'){assert(settled.size>100);pass('baseline real wheel/pan leaves canceled tracked handles after idle',{during,settled});}else{assert(settled.max<=1,JSON.stringify(settled));assert.equal(settled.size,0);pass('same tree renderer wheel80/pan120 timers bounded and last transform saved',{during,settled});
// Exercise refresh cleanup while a wheel debounce is still pending.
await page.mouse.wheel(0,-12);await wait(180);await page.evaluate(()=>{globalThis.__old=window.visualizer.renderingManager.getCurrentRenderer();return window.visualizer.refreshData()});await page.waitForFunction(()=>window.visualizer.renderingManager.getCurrentRenderer()!==globalThis.__old);assert.equal(await page.evaluate(()=>globalThis.__old.timers.size),0);pass('refresh cleanup clears previous renderer timer Set');await wait(1300);await page.mouse.move(640,430);await page.mouse.wheel(0,-12);await page.evaluate(()=>globalThis.__old=window.visualizer.renderingManager.getCurrentRenderer());await switchTo('waterfall');assert.equal(await page.evaluate(()=>globalThis.__old.timers.size),0);pass('view switch cleanup clears tree timer Set');await switchTo('tree');await page.mouse.move(640,430);await page.mouse.wheel(0,-12);await wait(650);assert.equal(await page.evaluate(()=>window.visualizer.renderingManager.getCurrentRenderer().timers.size),0);pass('return to tree remains interactive');}assert.equal(errors.length,0);pass('no page errors',errors);fs.writeFileSync(path.join(base,mode+'-result.json'),JSON.stringify({mode,checks,browser:context.browser().version(),node:process.version},null,2));await context.close();server.close()})().catch(async e=>{console.error(e);if(context)await context.close();server?.close();process.exit(1)});
```
