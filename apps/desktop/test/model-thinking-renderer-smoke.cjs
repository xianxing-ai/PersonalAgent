// Actual renderer/CSS, explicit synthetic desktop bridge; no real Runtime or model calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require('playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),output=process.env.PA_PICKER_TEST_OUTPUT??fs.mkdtempSync(path.join(os.tmpdir(),'pa-picker-renderer-'));fs.mkdirSync(output,{recursive:true});
  const server=http.createServer((request,response)=>{
    const name=decodeURIComponent(new URL(request.url,'http://localhost').pathname),file=path.resolve(root,'.'+name);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
    response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');response.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const screenshots=[],errors=[];
  try{
    browser=await chromium.launch({channel:process.env.PA_PICKER_BROWSER??'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:420,height:700},colorScheme:'dark'});
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await context.addInitScript(()=>{
      localStorage.setItem('pa-theme','dark');
      const revision='a'.repeat(64),models=[{id:'a',displayName:'示例旗舰模型',type:'text',reasoningEfforts:['low','medium','high'],availability:'unverified'},{id:'b',displayName:'示例轻量模型',type:'text',reasoningEfforts:['max'],availability:'unverified'},{id:'catalog-only',displayName:'目录扩展模型',type:'text',reasoningEfforts:[],availability:'unverified'},{id:'blocked',displayName:'Unavailable',type:'text',reasoningEfforts:[],availability:'unavailable'}];
      const state={tasks:[],subagentTasks:[],capabilities:[],notifications:[],thinking:{depth:2,fast:false},conversationPreference:{depth:2,fast:false,modelSelection:'default'},conversationState:{activeId:'synthetic-conversation',sessions:[{id:'synthetic-conversation',title:'界面验证',state:'active'}],drafts:{},archived:[]},agentArtsModels:{catalog:{version:'1.0',revision,defaultModelId:'a',models},preferences:{catalogRevision:revision,defaultModelId:'a',defaultSubmodelId:'b',reasoningEffort:'medium',submodelReasoningEffort:'max'}},modelChoices:[{id:'a',displayName:'示例旗舰模型',available:true}],model:{configured:true,status:'configured',model:'示例旗舰模型'},connection:'界面验证 · 合成数据',connectionError:'',audioLevel:0,voice:{status:'unavailable',experimental:false},live:{active:false},proactive:{},wake:{enabled:false,phase:'unavailable'}};
      const subscribers=[],calls=[];let failNext=false;
      window.pickerFixture={state,calls,fail(){failNext=true;},publish(){for(const callback of subscribers)callback(structuredClone(state));}};
      window.desktop={subscribe:callback=>{subscribers.push(callback);return()=>{};},invoke:async(name,payload)=>{
        calls.push({name,payload});
        if(['conversation.model','thinking.update'].includes(name)){
          if(failNext){failNext=false;return {ok:false,error:'模拟保存失败'};}
          if(name==='conversation.model'){state.conversationPreference.modelId=payload.executionModel?.modelId??payload.modelId;state.conversationPreference.executionModel=payload.executionModel;state.conversationPreference.modelSelection=payload.modelSelection;if(payload.modelSelection==='default'){state.conversationPreference.depth=payload.depth;state.conversationPreference.fast=payload.fast;}}
          else {state.conversationPreference.depth=payload.depth;state.conversationPreference.fast=payload.fast;}
          window.pickerFixture.publish();return {ok:true,value:structuredClone(state.conversationPreference)};
        }
        return {ok:true,value:name==='snapshot'?structuredClone(state):name==='conversation.readDraft'?{text:''}:undefined};
      }};
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('favicon.ico'))errors.push(message.text());});
    const url='http://127.0.0.1:'+server.address().port+'/src/app/index.html';
    const settled=()=>page.waitForFunction(()=>document.querySelector('.model-thinking-trigger').getAttribute('aria-busy')==='false');
    const range=()=>page.getByRole('slider',{name:'思考强度',exact:true});
    const openChoices=async()=>{if(!await page.locator('.picker-model-choices').isVisible())await page.getByRole('button',{name:'选择具体模型',exact:true}).click();};
    const capture=async name=>{const file=path.join(output,name);await page.screenshot({path:file});screenshots.push(file);};
    const checkMenu=async()=>{const box=await page.locator('.model-thinking-menu').boundingBox();const size=page.viewportSize();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,JSON.stringify({box,size}));};
    await page.goto(url+'?mode=panel');await page.locator('[data-picker-model]').filter({hasText:'示例旗舰模型'}).waitFor();
    if(process.env.PA_PICKER_STOP_QA==='1'){
      assert.match(page.url(),/mode=panel/);assert.match(await page.title(),/PersonalAgent/);
      await page.evaluate(()=>{const f=window.pickerFixture;f.state.tasks=[{taskId:'synthetic-stop-compat',goal:'Synthetic active task',state:'running',createdAt:new Date().toISOString(),steps:[],resultSummary:'Synthetic before stop'}];f.publish();});
      await page.getByRole('combobox',{name:'对话中发送方式',exact:true}).selectOption('queue');
      await page.getByRole('textbox',{name:'任务内容',exact:true}).fill('Synthetic queued draft');await page.locator('#send').click();
      await page.waitForFunction(()=>document.querySelectorAll('.queued-message').length===1&&document.querySelector('textarea').value==='');
      assert.equal(await page.evaluate(()=>window.pickerFixture.calls.filter(call=>call.name==='task.submit').length),0);
      await page.locator('#stop').click();
      await page.waitForFunction(()=>window.pickerFixture.calls.some(call=>call.name==='task.cancel'&&call.payload==='synthetic-stop-compat'));
      await page.evaluate(()=>{const f=window.pickerFixture;f.state.tasks[0]={...f.state.tasks[0],state:'succeeded',resultSummary:'LATE CONTENT MUST NOT APPEAR'};f.publish();});
      await page.waitForFunction(()=>document.querySelector('#state').textContent==='已截断');
      assert.doesNotMatch(await page.locator('#tasks').innerText(),/LATE CONTENT MUST NOT APPEAR/);
      assert.equal(await page.locator('.queued-message').count(),1);assert.equal(await page.evaluate(()=>window.pickerFixture.calls.filter(call=>call.name==='task.submit').length),0);
      await page.getByRole('button',{name:'模型与思考',exact:true}).click();await openChoices();
      await page.getByRole('button',{name:'示例轻量模型',exact:true}).click();await settled();
      assert.equal(await range().getAttribute('max'),'1');assert.equal(await page.locator('input[type=range]').count(),1);
      await page.getByRole('button',{name:'快速模式',exact:true}).click();await settled();
      assert.equal(await page.evaluate(()=>window.pickerFixture.state.conversationPreference.fast),true);
      assert.equal(await page.locator('.queued-message').count(),1);await checkMenu();await capture('stop-queue-picker.png');
      assert.deepEqual(errors,[]);
      const result={state:'passed',renderer:'actual merged panel source',bridge:'explicit synthetic',runtime:'not exercised',realModelCalls:0,
        checks:['queue does not submit while running','stop retains paused draft','late result remains truncated','picker and Fast remain usable','one slider','no page or console errors'],screenshots,errors};
      fs.writeFileSync(path.join(output,'stop-queue-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
    }
    assert.match(page.url(),/mode=panel/);assert.match(await page.title(),/PersonalAgent/);
    assert.equal(await page.locator('input[type=range]').count(),1);assert.equal(await page.getByRole('slider',{name:/执行步骤预算|主思考模型/}).count(),0);
    await page.getByRole('button',{name:'模型与思考',exact:true}).click();await checkMenu();
    assert.equal(await page.locator('.picker-model-choices').isVisible(),false);assert.equal(await page.locator('.picker-model-list button').count(),3);assert.match(await page.locator('.picker-detail').textContent(),/默认组合/);
    await capture('panel-default.png');
    await openChoices();assert.equal(await page.getByRole('button',{name:'选择具体模型',exact:true}).getAttribute('aria-expanded'),'true');await capture('panel-model-choices.png');
    await page.getByRole('searchbox',{name:'搜索模型'}).fill('扩展');assert.equal(await page.locator('.picker-model-list button:visible').count(),1);await page.getByRole('searchbox',{name:'搜索模型'}).fill('');
    await page.getByRole('button',{name:'示例旗舰模型',exact:true}).click();await settled();
    await range().focus();await page.keyboard.press('End');await settled();
    assert.equal(await page.evaluate(()=>window.pickerFixture.state.conversationPreference.executionModel.reasoningEffort),'high');assert.equal(await page.evaluate(()=>window.pickerFixture.state.conversationPreference.depth),4);
    await capture('panel-manual-high.png');await page.keyboard.press('Escape');assert.equal(await page.locator('.model-thinking-menu').isVisible(),false);assert.equal(await page.locator('.model-thinking-trigger').evaluate(node=>node===document.activeElement),true);
    await page.getByRole('textbox',{name:'任务内容',exact:true}).focus();
    const compact=path.join(output,'panel-compact-entry.png');await page.locator('.model-thinking-trigger').screenshot({path:compact});screenshots.push(compact);
    await page.getByRole('button',{name:'模型与思考',exact:true}).click();await openChoices();await page.locator('[data-default]').click();await settled();await range().focus();await page.keyboard.press('End');await settled();
    assert.equal(await page.evaluate(()=>window.pickerFixture.state.conversationPreference.executionModel),undefined);assert.equal(await page.evaluate(()=>window.pickerFixture.state.agentArtsModels.preferences.defaultSubmodelId),'b');
    await page.evaluate(()=>window.pickerFixture.fail());await range().focus();await page.keyboard.press('Home');await settled();assert.match(await page.locator('.picker-save-status').textContent(),/未保存/);
    assert.equal(await range().inputValue(),'5');await page.keyboard.press('Home');await settled();assert.equal(await range().inputValue(),'0');
    await openChoices();await page.getByRole('button',{name:'目录扩展模型',exact:true}).click();await settled();assert.equal(await range().isEnabled(),true);assert.match(await page.locator('.picker-detail').textContent(),/供应商管理/);
    await openChoices();await page.locator('[data-default]').click();await settled();await range().focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await settled();
    assert.equal(await page.locator('[data-power-model]').textContent(),'示例轻量模型');assert.equal(await page.locator('[data-picker-output]').textContent(),'轻度');
    await page.setViewportSize({width:251,height:600});await page.keyboard.press('Escape');await page.getByRole('button',{name:'模型与思考',exact:true}).click();await checkMenu();await capture('panel-narrow.png');
    const power=path.join(output,'power-slider.png');await page.locator('.model-thinking-menu').screenshot({path:power});screenshots.push(power);
    await page.evaluate(()=>{localStorage.setItem('pa-theme','light');document.documentElement.dataset.theme='light';});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.picker-model-heading')).color==='rgb(23, 23, 23)');await capture('panel-narrow-light.png');
    await page.setViewportSize({width:1000,height:760});await page.goto(url+'?mode=workspace');await page.locator('[data-picker-model]').filter({hasText:'示例旗舰模型'}).waitFor();
    assert.match(page.url(),/mode=workspace/);assert.match(await page.title(),/PersonalAgent/);
    assert.equal(await page.locator('input[type=range]').count(),1);await page.getByRole('button',{name:'模型与思考',exact:true}).click();await openChoices();await page.getByRole('button',{name:'示例轻量模型',exact:true}).click();await settled();assert.equal(await range().getAttribute('max'),'1');
    await range().focus();await page.keyboard.press('End');await settled();assert.equal(await page.evaluate(()=>window.pickerFixture.state.conversationPreference.executionModel.reasoningEffort),'max');await checkMenu();await capture('workspace-max.png');
    assert.deepEqual(errors,[]);
    const result={state:'passed',renderer:'actual panel and workspace source',bridge:'explicit synthetic',runtime:'not exercised',realModelCalls:0,oneSliderPerSurface:true,defaultCombinationPreserved:true,checks:['all published models','search','native enums','default combination','save failure and retry','Escape focus','251px dark and light','workspace selection'],screenshots,errors};
    fs.writeFileSync(path.join(output,'renderer-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
