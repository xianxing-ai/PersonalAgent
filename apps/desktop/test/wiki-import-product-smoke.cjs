// Actual Electron Main/Runtime/Policy/preload/renderer; synthetic files and model only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),{_electron}=require('playwright');
const {openSettings,snapshot}=require('../../../tests/manual/agentarts/desktop-pelican-default-live.cjs');

(async()=>{
  const root=path.resolve(__dirname,'../../..'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'pa-wiki-product-'));
  const userData=path.join(fixture,'user-data'),library=path.join(fixture,'library'),source=path.join(fixture,'synthetic.txt');
  fs.mkdirSync(userData);fs.mkdirSync(library);fs.writeFileSync(source,'合成青岛计划预算 2500 元。');
  const bootstrap=path.join(fixture,'bootstrap.mjs'),main=pathToFileURL(path.join(root,'apps/desktop/electron/main.js')).href;
  const controller=pathToFileURL(path.join(root,'apps/agentarts-runtime/src/wiki-controller.mjs')).href;
  fs.writeFileSync(bootstrap,`import {app,dialog,safeStorage} from 'electron';
import fs from 'node:fs';import path from 'node:path';
app.setPath('userData',${JSON.stringify(userData)});
const config={gatewayUrl:'https://wiki-fixture.cn-southwest-2.huaweicloud-agentarts.com',runtimeName:'wiki-fixture',
  deploymentVersion:'fixture-v1',authorization:'Bearer synthetic-platform',appToken:'a'.repeat(40)};
app.once('ready',()=>fs.writeFileSync(path.join(${JSON.stringify(userData)},'agentarts-config.json'),JSON.stringify({version:1,
  encrypted:safeStorage.encryptString(JSON.stringify(config)).toString('base64')})));
dialog.showOpenDialog=async(_window,options)=>({canceled:false,filePaths:[options.title.includes('保存目录')?${JSON.stringify(library)}:${JSON.stringify(source)}]});
const {createWikiWorkflowController}=await import(${JSON.stringify(controller)});
const deployment={provider:'fake',deployment:'synthetic',model:'fixture'};globalThis.__wikiSmoke={calls:0,blocked:0};
const model={deployment,async complete(request){globalThis.__wikiSmoke.calls++;const {data}=JSON.parse(request.messages[1].content);
  const output=data.question?{answer:'合成预算 2500 元。',insufficient:false,citations:[data.evidence[0]]}
    :Array.isArray(data.units)?{claims:data.units.map(unit=>({text:unit.text,kind:'fact',topic:'青岛计划',entities:['青岛'],
      evidence:[{sourceId:unit.sourceId,revision:unit.revision,unitId:unit.unitId,quote:unit.text}]}))}
    :{pages:[{title:'青岛计划',kind:'synthesis',claimIds:data.claims.map(claim=>claim.id),relatedTitles:['青岛']}]};
  return {deployment,response:{kind:'final',text:JSON.stringify(output)},usage:{inputTokens:10,outputTokens:10}};}};
const workflow=createWikiWorkflowController({model});
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url);
  if(url.hostname!==new URL(config.gatewayUrl).hostname||init.method!=='POST'){globalThis.__wikiSmoke.blocked++;throw Error('Synthetic smoke blocks network');}
  const outer=JSON.parse(init.body),value=JSON.parse(outer.query??Object.values(outer.inputs??{})[0]??'{}');
  if(value.wikiVersion!==1)return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
  const headers=new Headers(init.headers),result=await workflow({value,requestId:headers.get('X-Request-Id'),
    deadline:headers.get('X-PA-Deadline'),signal:init.signal});
  return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]),
    {status:200,headers:{'content-type':'application/json'}});
};
await import(${JSON.stringify(main)});\n`);
  const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC']
    .filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(env,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:userData});
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),
    args:['-r',path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/server/electron/loader.js'),bootstrap],env});
  const errors=[];
  async function until(read,predicate,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();
    if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Synthetic Wiki product state timed out');}
  try{
    app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
    await app.firstWindow();const orb=await until(()=>app.windows().find(page=>page.url().includes('mode=orb')),Boolean);
    assert.equal((await orb.evaluate(()=>window.desktop.invoke('orb.open'))).ok,true);
    const panel=await until(()=>app.windows().find(page=>page.url().includes('mode=panel')),Boolean);await panel.waitForSelector('#send');
    const admin=await openSettings({app,panel},'memory');console.log('phase: memory settings');
    await admin.getByRole('heading',{name:'LLM Wiki',exact:true}).waitFor({timeout:10000});
    await admin.getByRole('button',{name:'选择文件',exact:true}).click();
    await admin.getByRole('button',{name:'选择 Wiki 保存目录'}).click();
    console.log('phase: sources selected');
    await admin.locator('[data-wiki="auto-update"]').uncheck();
    await admin.getByRole('button',{name:'授权并生成 Wiki'}).click();
    console.log('phase: import authorization');
    async function approve(toolName){
      let question;
      try{question=await until(async()=> (await snapshot(panel)).authorizationQuestions?.find(item=>item.toolName===toolName&&item.state==='pending'),Boolean);}
      catch(error){console.error('synthetic Wiki status:',await admin.locator('[data-wiki="error"]').textContent(),
        await admin.locator('[data-wiki="progress"]').textContent());throw error;}
      const card=panel.locator(`[data-question-id="${question.questionId}"]`);
      await card.waitFor({state:'visible',timeout:10000});await card.locator('[data-authorization-decision="allow_once"]').click();
    }
    await approve('knowledge.compile_wiki');
    console.log('phase: import approved');
    await admin.locator('[data-wiki="generation"]').getByText(/当前发布版本/).waitFor({timeout:30000});
    await admin.locator('[data-wiki="question-input"]').fill('青岛计划预算是多少？');
    await admin.getByRole('button',{name:'授权并提问'}).click();await approve('knowledge.ask_wiki');
    console.log('phase: question approved');
    await admin.getByText('合成预算 2500 元。',{exact:true}).waitFor({timeout:30000});
    assert.equal(await admin.getByRole('button',{name:'来源 1'}).count(),1);
    assert.match(fs.readFileSync(source,'utf8'),/2500/);assert.ok((await app.evaluate(()=>globalThis.__wikiSmoke.calls))>=3);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'passed',profile:'huawei_ict_agentarts',model:'explicit-fake',main:'actual',runtime:'actual',
      policy:'actual',preload:'actual',renderer:'actual',fixture}));
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
