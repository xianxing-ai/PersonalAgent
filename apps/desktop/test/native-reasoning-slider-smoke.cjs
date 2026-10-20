const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
  const folder=path.resolve(__dirname,'../../../.cache/native-reasoning-slider');fs.mkdirSync(folder,{recursive:true});
  const userData=fs.mkdtempSync(path.join(folder,'user-'));
  const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(environment,{PA_USER_DATA_DIR:userData,PA_RUNTIME_PROFILE:'huawei_ict_agentarts',
    PA_AGENTARTS_GATEWAY_URL:'https://synthetic.huaweicloud-agentarts.com',PA_AGENTARTS_RUNTIME_NAME:'synthetic-slider',
    PA_AGENTARTS_AUTHORIZATION:'Bearer synthetic-slider-only',PA_AGENTARTS_RESPONSE_MODE:'tool-proposal-json'});
  const app=await _electron.launch({executablePath:process.env.PA_SLIDER_TEST_ELECTRON??path.resolve(__dirname,'../../../node_modules/electron/dist/electron.exe'),args:[path.join(__dirname,'native-reasoning-slider-fixture.mjs')],env:environment});
  const errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
  const invoke=(page,name,payload)=>page.evaluate(async({name,payload})=>{const result=await window.desktop.invoke(name,payload);if(!result.ok)throw Error(result.error);return result.value;},{name,payload});
  const read=page=>invoke(page,'snapshot');
  const native=page=>page.getByRole('slider',{name:'模型原生思考深度',exact:true});
  const rangeTo=async(page,locator,index)=>{await locator.focus();await page.keyboard.press('Home');for(let i=0;i<index;i++)await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>[...document.querySelectorAll('input[type=range]')].every(input=>input.getAttribute('aria-busy')!=='true'));};
  const choose=async(page,value)=>{const s=await read(page),id=s.conversationPreference?.executionModel?.modelId??s.conversationPreference?.modelId??s.agentArtsModels.catalog.defaultModelId;const efforts=s.agentArtsModels.catalog.models.find(m=>m.id===id).reasoningEfforts;await rangeTo(page,native(page),value?efforts.indexOf(value)+1:0);};
  const setModel=async(page,id)=>{const s=await read(page);await rangeTo(page,page.locator('.conversation-model-choice'),s.modelChoices.filter(m=>m.available!==false).findIndex(m=>m.id===id)+1);};
  try{
    await app.firstWindow();const orb=app.windows().find(p=>p.url().includes('mode=orb'));await invoke(orb,'orb.open');
    const panel=app.windows().find(p=>p.url().includes('mode=panel'));await panel.waitForSelector('#mm-slider',{state:'attached'});
    await panel.waitForFunction(async()=>Boolean((await window.desktop.invoke('snapshot')).value?.agentArtsModels?.catalog));
    const initial=await read(panel);assert.equal(initial.connectionError,'',initial.connectionError);
    assert.match(panel.url(),/mode=panel/);assert.match(await panel.title(),/PersonalAgent/);assert.ok((await panel.locator('#root').textContent()).includes('PersonalAgent'));
    assert.equal(await panel.locator('[data-session-new]').isVisible(),false);
    for(const name of ['conversation.new','conversation.switch','conversation.archive','conversation.restore']){
      const result=await panel.evaluate(({name})=>window.desktop.invoke(name,{}),{name});assert.equal(result.ok,false);assert.match(result.error,/只保留一个主对话/);
    }
    await panel.locator('#model').click();await choose(panel,'high');
    assert.equal(await panel.locator('#mm-depth-label').textContent(),'高');assert.equal(await panel.locator('#mm-slider').inputValue(),'3');
    // Actual keyboard input emits input/change on the real range control.
    await panel.locator('#mm-slider').focus();await panel.keyboard.press('Home');await panel.keyboard.press('ArrowRight');
    await panel.waitForFunction(()=>document.querySelector('#mm-slider').value==='1'&&document.querySelector('#mm-slider').getAttribute('aria-busy')==='false');
    assert.equal((await read(panel)).conversationPreference.executionModel.reasoningEffort,'low');
    const steps=await read(panel);await panel.locator('#mm-fast').click();
    await panel.waitForFunction(async()=>Boolean((await window.desktop.invoke('snapshot')).value.conversationPreference.fast));
    assert.equal((await read(panel)).conversationPreference.executionModel.reasoningEffort,'low');assert.equal((await read(panel)).conversationPreference.depth,steps.conversationPreference.depth);
    await panel.screenshot({path:path.join(folder,'panel-low.png')});
    await panel.locator('#model').click();await panel.locator('textarea[aria-label="任务内容"]').fill('synthetic native low');await panel.locator('#send').click();
    await panel.waitForFunction(async()=>{const s=(await window.desktop.invoke('snapshot')).value;return s.tasks.some(t=>t.state==='succeeded');});
    const queries=await app.evaluate(()=>globalThis.reasoningSliderSmoke.queries);assert.equal(queries[0].executionModel.reasoningEffort,'low');
    await panel.locator('#model').click();await choose(panel,'');assert.equal(await panel.locator('#mm-depth-label').textContent(),'供应商默认');
    await panel.locator('#model').click();await panel.locator('textarea[aria-label="任务内容"]').fill('synthetic provider default');await panel.locator('#send').click();
    await panel.waitForFunction(async()=>{const s=(await window.desktop.invoke('snapshot')).value;return s.tasks.filter(t=>t.state==='succeeded').length===2;});
    const defaults=await app.evaluate(()=>globalThis.reasoningSliderSmoke.queries);assert.equal(Object.hasOwn(defaults[1].executionModel,'reasoningEffort'),false);
    await panel.locator('#model').click();await setModel(panel,'qwen3.8-max');
    await panel.waitForFunction(()=>document.querySelector('#mm-slider').max==='1'&&document.querySelector('.conversation-model-choice').getAttribute('aria-busy')==='false');
    assert.equal(await panel.locator('#mm-depth-label').textContent(),'供应商默认');await choose(panel,'max');assert.equal(await panel.locator('#mm-depth-label').textContent(),'最高');
    await setModel(panel,'glm-5.3');await panel.waitForFunction(()=>document.querySelector('#mm-slider').disabled);
    assert.equal(await native(panel).isDisabled(),true);assert.equal(await panel.locator('#mm-depth-label').textContent(),'供应商默认');assert.equal(await panel.locator('#model-menu select').count(),0);
    await panel.locator('#model').click();const opened=app.waitForEvent('window');await panel.locator('#panel-expand').click();
    const workspace=await opened;await native(workspace).waitFor();assert.equal(await workspace.locator('.conversation-preferences select').count(),0);
    assert.match(workspace.url(),/mode=workspace/);assert.match(await workspace.title(),/PersonalAgent/);
    await choose(workspace,'medium');const before=await read(workspace);await workspace.locator('[data-session-new]').click();
    await workspace.waitForFunction(async()=>!(await window.desktop.invoke('snapshot')).value.conversationPreference.executionModel);
    assert.equal(await native(workspace).inputValue(),'0');
    assert.equal((await read(panel)).conversationPreference.executionModel.modelId,'glm-5.3');
    await workspace.locator('[data-session-list]').selectOption(before.conversationState.activeId);
    await workspace.waitForFunction(()=>document.querySelector('[aria-label="模型原生思考深度"]').value==='2');
    await workspace.screenshot({path:path.join(folder,'workspace-medium.png')});
    const observed=await app.evaluate(()=>globalThis.reasoningSliderSmoke);assert.equal(observed.unexpectedRequests,0);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({state:'passed',profile:'huawei_ict_agentarts',main:'actual product',preload:'actual IPC',renderer:'panel and workspace',transport:'synthetic fetch',modelCalls:0,singlePanelMain:true,queries:observed.queries.map(q=>q.executionModel),userData,screenshots:[path.join(folder,'panel-low.png'),path.join(folder,'workspace-medium.png')]}));
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
