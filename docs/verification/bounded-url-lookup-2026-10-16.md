# 当前会话精确 URL 最新节点有界查找（2026-10-16）

基线 `2b39917145332fc01632d5439ff612033cf0c400`，本轮只修复 getNodeId→getOrCreateNodeForUrl(referrer)→findNodeByUrl 回退。原路径 url.getAll 跨会话物化记录后filter/sort；专用60秒缓存又会在新访问后选旧父节点。现移除该专用缓存，保留tab缓存和异常log→null语义；每次进行有界查找。

## 设计与失败方式

复用现有v3 statisticsOrder=[session,domain,exactURL,normalizedTime,id,known]。domain提取与indexedNode共用nodeUrlDomain；URL自身不归一化，query/hash保留。一个readonly transaction内，精确prefix倒序key cursor取最大time，再同time prefix正向value cursor取最小ID一条。两个cursor均不continue。正常合法时间按timestamp降序、ID升序，保持原URL索引主键序+stable sort的并列选择。无需新索引、schema仍3，无破坏迁移或旧数据重写；v1/v2→v3的升级代码未改，本轮不重复旧报告迁移验收。

实现前列出的失败方式及直接验收：跨会话/URL变体误选、无匹配/空referrer误选、并列/epoch0/负值/非法时间不明确；批量读取或cursor扫描全部values；缓存命中掩盖查询/新访问更新时间删除后陈旧父ID；会话切换/冷worker错误；IDB异常挂起或错误父节点；已有v3记录/边/字段或派生键写入受损。下述E2E逐项覆盖。未新建单元或隔离测试。

## 环境、受控回退前提与测量口径

macOS26.6.2(25G83) arm64，Node26.7.0、npm11.19.0、Playwright1.62.1、Chromium151.0.7922.34，headless独立profile，本地HTTP真实页面+unpacked MV3。基线/修复各typecheck+生产build通过，webpack5.111.1仅D3大小提示。

Chrome正常onCommitted通常早于content getNodeId预建target，导致不会进入目标回退。测试临时bundle只跳过`/target/`的onCommitted预建事件，并在临时content入口将getNodeId.referrer替换为URL参数，以便可靠传入带fragment/空值等输入（浏览器document.referrer通常剥离fragment）。其余生产getNodeId sender授权、tab绑定、handler、NodeTracker、存储和saveNode均实际执行。每个target是新tab/新URL，无既存target/history；测试断言真实content sender URL/referrer与最终child.parentId。不是只调用storage helper，也不是用pageLoaded充当目标路径。产品源码没有这些探针/控制补丁。

全部扩展图页与准备用options页在每个目标样本前关闭。历史fixture含多sessionId及会话元数据，1k/10k同URL记录、当前会话两个并列最新ID A/Z、更晚other-session记录、更晚query/hash变体，以及保留字段/边。retention设0以避免人工负时间fixture被清理。新增/更新/删除fixture在真实IDB事务中同步维护既有派生字段；timestamp更新不是lastVisit更新，也不是不存在的UI编辑功能。另将生产saveNode写出的child再次作为referrer，直接验证实际新增/close更新后覆盖键仍可读。

探针在worker脚本入口前安装，区分method调用次数与success非null返回行数。每次采样从reset到getNodeId响应，另核实同worker marker及实际child记录；验证child的读取在快照之后。请求数不是行数：no-match有1次key请求但0返回key/value，empty referrer才0目标请求。非目标后台close/metadata读取可能与窗口重叠，不能把目标1value说成整个后台仅1次DB工作。表中完整node-value总数只涵盖该响应窗口；后续content metadata等不包括在目标收益内。

## 实际结果

基线3项复现PASS：1k/10k各一次url.getAll分别返回1003/10003 node values；插入更晚同URL节点后，同worker再次回退仍返回旧tie-A，缓存命中0DB读取。修复最终16项PASS。

| 修复样本 | 目标key请求/返回key | 目标value请求/返回value | 窗口全部node values | 非目标node keys |
| --- | ---: | ---: | ---: | ---: |
| 1k跨会话重复 | 1/1 | 1/1 | 1 | openTabState4 |
| 10k跨会话重复 | 1/1 | 1/1 | 1 | 0 |
| 无匹配 | 1/0 | 0/0 | 0 | 0 |
| 空referrer | 0/0 | 0/0 | 0 | 0 |
| 注入目标索引异常 | 1/0 | 0/0 | 0 | 0 |
| stop/wake后的回退 | 1/1 | 1/1 | 3（含其他2个get） | 0 |

修复目标窗口没有node getAll。1k样本有准备页关闭触发的openTabState cursor在途返回4key，属于非目标工作；未隐去或算作目标开销。metadata session get请求另记于脚本结果，表只计node values/keys。没有耗时加速倍数、heap峰值或CPU/能耗结论；这是有界物化与语义正确性的短验收，已取消的长测未恢复。

命中样本确认当前session精确URL、query/hash变体不泄入、并列选A；同worker新增后选newer，更新tie-Z.timestamp后选Z，删除Z立即回到newer；不存在/空值无伪父；一次IDB故障flag实际消费、getNodeId仍创建child且parent为空。切新session先无匹配、写自身parent后正确选择，stopAllWorkers/wake使marker变化后仍选新session父节点。DB仍v3，旧record.extra与edge.extra保留。

非法旧时间边界：复用v3已有normalizedTime，缺失/非finite/超Date范围设0；这会与合法epoch0并列按ID选，不声称等价原NaN comparator的未定义顺序。实测bad(1e100)与zero(0)同归0时ID bad优先；删bad后zero优先于neg(-1)，再删zero可选负时间。合法time的旧语义保持。通用queryNodes及其他legacy API未优化；没有新增迁移、图页/设置或架构变化。

16项断言名称：

- 1000 cross-session duplicates, exact URL and stable tie
- 10000 cross-session duplicates, exact URL and stable tie
- same-worker new visit immediately replaces previous parent
- production saveNode maintains lookup covering fields
- same-worker timestamp update immediately changes newest parent
- deleted newest cannot survive URL cache
- no match yields no parent
- empty referrer skips lookup
- storage exception keeps null fallback and creates child
- normalized invalid time0 ties valid epoch0 by ascending ID
- valid epoch0 is newer than negative time
- negative timestamp remains selectable
- session switch isolates old URL history
- new session own parent
- cold worker restores session and bounded referrer lookup
- existing v3 records edges extra fields preserved

## 构建输入与复建

干净修复生产background bundle SHA256：`503db62b8588cd540d06630010b881fbb7cc09becf772cfc7214737e28b8b785`。构建前源码输入集合hash：`0a4596a3e83455d84236e62cb29ac355810ea26fbf99c44cf22ab159792d65aa`，算法为基线`git ls-tree -r --name-only`路径顺序，对每个路径拼接path UTF8、NUL、当时工作树bytes、NUL后SHA256（不包含新增本报告）。测试临时bundle另加下面完整script中的prefix/bypass补丁，不冒充未加探针的bundle。构建只在temp，以免locale插件改checkout。

在本PR最终checkout运行。所有依赖/cache/build/browser/profile/log/结果仅task temp。下述脚本完整含输入生成及断言；审核后关闭本任务进程并删除temp，只保留本报告。

```sh
TASK_TMP=$(mktemp -d "${TMPDIR:-/tmp}/navigraph-url-lookup.XXXXXX")
export TASK_TMP
export npm_config_cache="$TASK_TMP/npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="$TASK_TMP/browsers"
export NAVIGRAPH_PLAYWRIGHT="$TASK_TMP/harness/node_modules/playwright"
mkdir "$TASK_TMP/source"
git archive 2b39917145332fc01632d5439ff612033cf0c400 | tar -x -C "$TASK_TMP/source"
(cd "$TASK_TMP/source" && npm ci --ignore-scripts && npm run build)
cp -R "$TASK_TMP/source/dist" "$TASK_TMP/baseline-dist"
git archive HEAD | tar -x -C "$TASK_TMP/source"
(cd "$TASK_TMP/source" && npm run build)
cp -R "$TASK_TMP/source/dist" "$TASK_TMP/fixed-dist"
npm install --prefix "$TASK_TMP/harness" --no-audit --no-fund playwright@1.62.1
node "$TASK_TMP/harness/node_modules/playwright/cli.js" install chromium
python3 - <<'EXTRACT'
import os,re,pathlib
s=pathlib.Path('docs/verification/bounded-url-lookup-2026-10-16.md').read_text()
code=re.search(r'```javascript\n(.*?)\n```',s,re.S).group(1)
pathlib.Path(os.environ['TASK_TMP'],'e2e.cjs').write_text(code+'\n')
EXTRACT
node "$TASK_TMP/e2e.cjs" baseline
node "$TASK_TMP/e2e.cjs" fixed
# 确认本任务browser/process全部退出后，只删本task temp。
rm -rf "$TASK_TMP"
```

```javascript
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),http=require('http');const base=__dirname,mode=process.argv[2]||'fixed';process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(base,'browsers');const{chromium}=require(process.env.NAVIGRAPH_PLAYWRIGHT);const clean=path.join(base,mode+'-dist'),dist=path.join(base,mode+'-fixture');fs.cpSync(clean,dist,{recursive:true});let ctx,server,sw,control,serial=0;const checks=[],wait=ms=>new Promise(r=>setTimeout(r,ms));function pass(name,data={}){checks.push({name,data});console.log('PASS',name,JSON.stringify(data))}
// Test-only event suppression makes the content getNodeId referrer fallback observable.
const prefix=`globalThis.__marker=crypto.randomUUID();globalThis.__rows={};globalThis.__calls={};globalThis.__requests=[];globalThis.__responses={};const committed=chrome.webNavigation.onCommitted.addListener.bind(chrome.webNavigation.onCommitted);chrome.webNavigation.onCommitted.addListener=(fn,...rest)=>committed(d=>{if(new URL(d.url).pathname.startsWith('/target/'))return;return fn(d)},...rest);const listen=chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);chrome.runtime.onMessage.addListener=fn=>listen((m,s,r)=>{if(m.action==='getNodeId')globalThis.__requests.push({url:m.url,referrer:m.referrer,sender:s.url,tabId:s.tab?.id});return fn(m,s,response=>{if(m.action==='getNodeId')globalThis.__responses[m.url]=response;r(response)})});for(const proto of[IDBObjectStore.prototype,IDBIndex.prototype])for(const method of['get','getAll','openCursor','openKeyCursor']){const old=proto[method];proto[method]=function(...args){const name=this.objectStore?.name||this.name,label=name+':'+(this.objectStore?this.name:'store')+':'+method;globalThis.__calls[label]=(globalThis.__calls[label]||0)+1;if(globalThis.__failOnce&&this.name==='statisticsOrder'&&method==='openKeyCursor'){globalThis.__failOnce=false;throw new Error('fixture lookup failure')}const q=old.apply(this,args);if(['nodes','edges'].includes(name))q.addEventListener('success',()=>{if(q.result)globalThis.__rows[label]=(globalThis.__rows[label]||0)+(Array.isArray(q.result)?q.result.length:1)});return q}};\n`;
const background=path.join(dist,'background/background.js');fs.writeFileSync(background,prefix+fs.readFileSync(background,'utf8'));const content=path.join(dist,'content/navigraph.js');fs.writeFileSync(content,`if(location.pathname.startsWith('/target/')){const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=(message,...args)=>send(message?.action==='getNodeId'?{...message,referrer:new URL(location.href).searchParams.get('ref')||''}:message,...args)};\n`+fs.readFileSync(content,'utf8'));
async function rpc(action,data={}){const result=await control.evaluate(({action,data})=>chrome.runtime.sendMessage({target:'background',action,...data}),{action,data});assert(result.success,JSON.stringify(result));return result}async function db(op){return sw.evaluate(async op=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('NavigraphDB');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});try{return await new Promise((r,j)=>{const tx=db.transaction(['nodes','edges','sessions'],op.kind==='read'?'readonly':'readwrite'),nodes=tx.objectStore('nodes');let output;const derive=n=>{let domain='';try{domain=new URL(n.url).hostname}catch{}const known=Number.isFinite(n.timestamp)&&Math.abs(n.timestamp)<=8640000000000000,time=known?n.timestamp:0;return{...n,_pageSession:n.sessionId,_pageTime:-time,_pageType:n.type||'initial',_pageClosed:n.isClosed?1:0,_pageTracking:0,_restoreTab:n.tabId??-1,_statsDomain:domain,_statsUrl:n.url,_statsTime:time,_statsKnown:known?1:0,_timeUnknown:!known}};
if(op.kind==='seed'){for(const sessionId of['other-0','other-1','other-2','other-newer'])tx.objectStore('sessions').put({id:sessionId,startTime:op.time,isActive:false,title:'Historical fixture'});for(let i=0;i<op.count;i++)nodes.put(derive({id:op.key+'-'+String(i).padStart(5,'0'),sessionId:i%4===0?op.sid:'other-'+i%3,url:op.url,tabId:800,timestamp:op.time-1000+i,title:'Legacy fixture',isClosed:true,extra:{preserved:true}}));nodes.put(derive({id:op.key+'-other-newer',sessionId:'other-newer',url:op.url,timestamp:op.time+900000,isClosed:true}));for(const id of['A','Z'])nodes.put(derive({id:op.key+'-tie-'+id,sessionId:op.sid,url:op.url,timestamp:op.time+100000,tabId:801,type:'initial'}));for(const suffix of['#other','&query=other'])nodes.put(derive({id:op.key+'-variant-'+suffix,sessionId:op.sid,url:suffix[0]==='#'?op.url+suffix:op.url.replace('?','?other=1&'),timestamp:op.time+200000,tabId:802}));tx.objectStore('edges').put({id:'preserved-edge-'+op.key,sessionId:op.sid,source:op.key+'-00000',target:op.key+'-tie-A',timestamp:op.time,extra:'edge preserved'});}
if(op.kind==='put')nodes.put(derive(op.node));if(op.kind==='delete'){for(const id of op.ids)nodes.delete(id)}if(op.kind==='read'){const q=nodes.get(op.id);q.onsuccess=()=>output=q.result}if(op.kind==='update'){const q=nodes.get(op.id);q.onsuccess=()=>nodes.put(derive({...q.result,...op.patch}))}if(op.kind==='integrity'){const q=nodes.get(op.id);q.onsuccess=()=>{output={node:q.result,version:db.version};const e=tx.objectStore('edges').get(op.edge);e.onsuccess=()=>output.edge=e.result}}tx.oncomplete=()=>r(output);tx.onabort=()=>j(tx.error)})}finally{db.close()}},op)}
async function closeControls(){for(const p of ctx.pages())if(p.url().startsWith('chrome-extension://'))await p.close();assert(!ctx.pages().some(p=>p.url().startsWith('chrome-extension://')))}async function openControl(id){control=await ctx.newPage();await control.goto(`chrome-extension://${id}/options/index.html`);await rpc('getSettings')}
async function lookup(referrer,expected,label,{empty=false,fault=false}={}){await closeControls();const before=await sw.evaluate(()=>{globalThis.__rows={};globalThis.__calls={};globalThis.__requests=[];globalThis.__responses={};return globalThis.__marker});if(fault)await sw.evaluate(()=>globalThis.__failOnce=true);const target=origin+'/target/'+(++serial)+'?ref='+encodeURIComponent(referrer),page=await ctx.newPage();await page.goto(target);let response;for(let i=0;i<150;i++){response=await sw.evaluate(url=>globalThis.__responses[url],target);if(response)break;await wait(30)}assert(response?.success,JSON.stringify(response));const probe=await sw.evaluate(()=>({marker:globalThis.__marker,rows:globalThis.__rows,calls:globalThis.__calls,failOnce:globalThis.__failOnce,requests:globalThis.__requests}));assert.equal(probe.marker,before);assert(probe.requests.some(q=>q.url===target&&q.referrer===referrer&&q.sender===target));const node=await db({kind:'read',id:response.nodeId});assert.equal(node.url,target);assert.equal(node.parentId,expected);if(mode==='fixed'){assert.equal(probe.calls['nodes:statisticsOrder:openKeyCursor']||0,referrer?1:0);assert.equal(probe.calls['nodes:statisticsOrder:openCursor']||0,expected?1:0);if(fault)assert.equal(probe.failOnce,false);assert(!Object.keys(probe.rows).some(k=>k.endsWith(':getAll')),JSON.stringify(probe));assert.equal(probe.rows['nodes:statisticsOrder:openKeyCursor']||0,expected?1:0);assert.equal(probe.rows['nodes:statisticsOrder:openCursor']||0,expected?1:0)}else if(!empty){assert((probe.rows['nodes:url:getAll']||0)>=1000||label==='cached stale parent')}pass(label,{childId:node.id,parentId:node.parentId,...probe});await page.close();return {...probe,childId:node.id,target}}
let origin;
(async()=>{server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Referrer-Policy':'unsafe-url'});res.end('<title>URL lookup fixture</title>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;ctx=await chromium.launchPersistentContext(path.join(base,'profile-'+mode+'-3'),{headless:true,channel:'chromium',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=sw.url().split('/')[2];await openControl(id);await rpc('saveSettings',{settings:{dataRetention:0,idleTimeout:0}});const sid=(await rpc('getLatestSession')).session.id,now=Date.now();for(const count of[1000,10000]){const key='n'+count,url=origin+'/parent?count='+count+'#exact';await db({kind:'seed',sid,key,url,count,time:now});await lookup(url,key+'-tie-A',count+' cross-session duplicates, exact URL and stable tie');}const url=origin+'/parent?count=10000#exact';await db({kind:'put',node:{id:'newer',sessionId:sid,url,timestamp:now+300000,tabId:803}});if(mode==='baseline'){await lookup(url,'n10000-tie-A','cached stale parent');}else{const created=await lookup(url,'newer','same-worker new visit immediately replaces previous parent');await lookup(created.target,created.childId,'production saveNode maintains lookup covering fields');await db({kind:'update',id:'n10000-tie-Z',patch:{timestamp:now+400000}});await lookup(url,'n10000-tie-Z','same-worker timestamp update immediately changes newest parent');await db({kind:'delete',ids:['n10000-tie-Z']});await lookup(url,'newer','deleted newest cannot survive URL cache');await lookup(origin+'/missing?x=1#none','','no match yields no parent');await lookup('','','empty referrer skips lookup');await lookup(url,'','storage exception keeps null fallback and creates child',{fault:true});
// Epoch0, negative and malformed legacy values exercise v3 normalized-time contract.
const edgeUrl=origin+'/edge-times?x=1#hash';for(const[id,time]of[['neg',-1],['zero',0],['bad',1e100]])await db({kind:'put',node:{id,sessionId:sid,url:edgeUrl,timestamp:time,tabId:804}});await lookup(edgeUrl,'bad','normalized invalid time0 ties valid epoch0 by ascending ID');await db({kind:'delete',ids:['bad']});await lookup(edgeUrl,'zero','valid epoch0 is newer than negative time');await db({kind:'delete',ids:['zero']});await lookup(edgeUrl,'neg','negative timestamp remains selectable');
await openControl(id);const next=(await rpc('createSession',{options:{title:'Second',makeActive:true,updateCurrent:true,skipCooldown:true}})).session.id;await closeControls();await lookup(url,'','session switch isolates old URL history');await db({kind:'put',node:{id:'second-parent',sessionId:next,url,timestamp:now+500000,tabId:805}});await lookup(url,'second-parent','new session own parent');const cdp=await ctx.newCDPSession(ctx.pages()[0]||await ctx.newPage());await cdp.send('ServiceWorker.enable');const oldMarker=await sw.evaluate(()=>globalThis.__marker);await cdp.send('ServiceWorker.stopAllWorkers');await wait(300);const wake=await ctx.newPage();await wake.goto(origin+'/wake');await wait(300);sw=ctx.serviceWorkers()[0]||sw;assert.notEqual(await sw.evaluate(()=>globalThis.__marker),oldMarker);await lookup(url,'second-parent','cold worker restores session and bounded referrer lookup');const intact=await db({kind:'integrity',id:'n10000-00000',edge:'preserved-edge-n10000'});assert.equal(intact.version,3);assert.deepEqual(intact.node.extra,{preserved:true});assert.equal(intact.edge.extra,'edge preserved');pass('existing v3 records edges extra fields preserved',intact);}
fs.writeFileSync(path.join(base,mode+'-result.json'),JSON.stringify({mode,checks,browser:ctx.browser().version(),node:process.version},null,2));await ctx.close();server.close();console.log('COMPLETE',checks.length)})().catch(async e=>{console.error('FAIL',e);fs.writeFileSync(path.join(base,mode+'-partial.json'),JSON.stringify({checks,error:String(e)},null,2));if(ctx)await ctx.close();server?.close();process.exit(1)});
```
