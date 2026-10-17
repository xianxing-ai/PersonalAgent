import test from 'node:test';
import assert from 'node:assert/strict';
import {cognitionReviewFeedback, mountProactiveControls} from '../src/app/proactive-controls.js';

test('goal treatment feedback never upgrades acceptance, analysis or legacy prose into verified update', () => {
  for (const status of ['created', 'submitted', 'pending', 'running', 'verifying', 'waiting_approval', 'waiting_reconciliation', 'succeeded', 'failed', 'cancelled']) {
    const item = cognitionReviewFeedback({status, taskId:'handoff-1', executionVerified:false, graphUpdateVerified:false});
    assert.equal(item.locked, true);
    assert.equal(item.label, '已交给主智能体');
    assert.doesNotMatch(item.message, /更新已核实|方案已执行/);
  }
  assert.equal(cognitionReviewFeedback({state:'applied', executionStatus:'已在本地执行'}).locked, false);
  assert.doesNotMatch(cognitionReviewFeedback({status:'applied', taskId:'legacy'}).message, /更新已核实/);
  assert.equal(cognitionReviewFeedback({status:'applied', executionVerified:true, graphUpdateVerified:true}).message, '执行与目标更新已核实');
  assert.equal(cognitionReviewFeedback({status:'unavailable'}).locked, false);
  assert.equal(cognitionReviewFeedback({state:'succeeded'}).message,'方案已记录，尚未交给主智能体处理');
  assert.equal(cognitionReviewFeedback({status:'submission_unknown'}).locked, true);
});

test('pending Goal handoff without an accepted task ID stays unresolved and locked until authoritative snapshot changes', () => {
  for (const item of [{state:'pending'}, {status:'pending'}, {state:'pending',executionStatus:'arbitrary prose'}]) {
    const feedback=cognitionReviewFeedback(item);
    assert.match(feedback.message,/受理结果待核实/);
    assert.doesNotMatch(feedback.message,/尚未交给|执行与目标更新已核实/);
    assert.equal(feedback.label,'受理结果待核实');
    assert.equal(feedback.locked,true);
  }
  const accepted=cognitionReviewFeedback({state:'running',taskId:'handoff-1'});
  assert.equal(accepted.locked,true);
  assert.equal(accepted.label,'已交给主智能体');
  const verified=cognitionReviewFeedback({status:'applied',taskId:'repair-1',executionVerified:true,graphUpdateVerified:true});
  assert.equal(verified.message,'执行与目标更新已核实');
  assert.equal(verified.locked,true);
  for (const state of ['local','selected','review','unavailable','expired']) {
    assert.equal(cognitionReviewFeedback({state}).locked,false);
  }
  assert.equal(cognitionReviewFeedback({executionStatus:'编排受理结果待核实，尚未确认执行'}).locked,false);
});

test('Goal reconciliation without task identity stays locked based on structured state', () => {
  for(const field of ['state','status']) {
    for(const executionStatus of [undefined,'arbitrary prose']) {
      const feedback=cognitionReviewFeedback({[field]:'waiting_reconciliation',executionStatus});
      assert.equal(feedback.locked,true);assert.equal(feedback.label,'受理结果待核实');
      assert.match(feedback.message,/处理结果待核实.*请勿重复提交/);
      assert.doesNotMatch(feedback.message,/尚未交给|执行与目标更新已核实/);
    }
  }
  assert.equal(cognitionReviewFeedback({executionStatus:'修复回执绑定待核实，不会重复提交'}).locked,false);
});

test('accepted unavailable repair receipt retains its handoff and unverified update meaning', () => {
  // Public GoalCognitionHost's missing localRepair port branch returns unavailable
  // alongside the already succeeded source task ID, rather than refusing handoff.
  const receipt={status:'unavailable',state:'succeeded',taskId:'synthetic-succeeded-source',
    reviewTaskId:'synthetic-reviewed-repair',executionVerified:false,graphUpdateVerified:false};
  for(const reason of [undefined,'受控修复端口尚未装配','Untrusted unrelated prose']) {
    const feedback=cognitionReviewFeedback({...receipt,reason});
    assert.match(feedback.message,/编排任务已受理.*受控修复暂不可用.*目标更新尚未核实/);
    assert.doesNotMatch(feedback.message,/无法交给|更新已核实/);
    assert.equal(feedback.label,'已交给主智能体');assert.equal(feedback.locked,true);
  }
  const {taskId,...unsubmitted}=receipt;
  assert.equal(cognitionReviewFeedback(unsubmitted).message,'当前无法交给主智能体处理');
  assert.equal(cognitionReviewFeedback(unsubmitted).locked,false);
  assert.equal(cognitionReviewFeedback({...receipt,status:'applied',executionVerified:true,graphUpdateVerified:true}).message,
    '执行与目标更新已核实');
});

// Explicit Fake DOM with normal parent/descendant identity; innerHTML replaces actual test nodes.
class Element {
  constructor(tag) {this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.disabled=false;this.open=false;this._text='';}
  append(...nodes) {for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  after(node) {node.parentNode=this.parentNode;const index=this.parentNode.children.indexOf(this);this.parentNode.children.splice(index+1,0,node);}
  setAttribute(name,value='') {
    this.attributes[name]=value;
    if(name==='class')this.className=value;
    if(name==='disabled')this.disabled=true;
    if(name==='open')this.open=true;
    if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;
  }
  set textContent(value) {this._text=String(value);this.children=[];}
  get textContent() {return this._text+this.children.map(node=>node.textContent).join('');}
  contains(node) {return node===this || this.children.some(child=>child.contains(node));}
  focus(options) {globalThis.document.activeElement=this;this.lastFocusOptions=options;}
  set innerHTML(value) {
    if(this.contains(globalThis.document.activeElement))globalThis.document.activeElement=null;
    for(const child of this.children)child.parentNode=null;
    this.children=[];this._text='';const stack=[this];
    for(const token of String(value).match(/<[^>]+>|[^<]+/g)??[]) {
      if(token.startsWith('</')) {stack.pop();continue;}
      if(token.startsWith('<')) {
        const tag=token.match(/^<([a-z0-9-]+)/i)?.[1];if(!tag)continue;
        const node=new Element(tag);
        for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(match[1],match[2]??'');
        stack.at(-1).append(node);
        if(!['input','br','hr','link','img'].includes(tag))stack.push(node);
      } else {const node=new Element('#text');node.textContent=token;stack.at(-1).append(node);}
    }
  }
  insertAdjacentHTML(position,value) {
    assert.equal(position,'beforebegin');
    const fragment=new Element('fragment');fragment.innerHTML=value;
    const index=this.parentNode.children.indexOf(this);
    for(const node of fragment.children)node.parentNode=this.parentNode;
    this.parentNode.children.splice(index,0,...fragment.children);
  }
  get elements() {return Object.fromEntries(this.querySelectorAll('input').map(node=>[node.attributes.name,node]));}
  addEventListener(name,handler) {(this.listeners[name]??=[]).push(handler);}
  async emit(name,event) {await Promise.all((this.listeners[name]??[]).map(handler=>handler(event)));}
  matches(selector) {
    const match=selector.match(/^([\w-]+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
    return Boolean(match)&&(!match[1]||this.tag===match[1])
      &&(!match[2]||String(this.className??'').split(/\s+/).includes(match[2]))
      &&(!match[3]||Object.hasOwn(this.attributes,match[3])&&(match[4]===undefined||this.attributes[match[3]]===match[4]));
  }
  querySelectorAll(selector) {return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector) {return this.querySelectorAll(selector)[0]??null;}
  closest(selector) {return this.matches(selector)?this:this.parentNode?.closest(selector)??null;}
}
function deferred() {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const reviewId='synthetic-review';
const localReview=()=>({reviewTaskId:reviewId,state:'selected',trigger:'Synthetic Goal',choice:'recheck',executionVerified:false,graphUpdateVerified:false});
const accepted=()=>({reviewTaskId:reviewId,status:'submitted',state:'running',taskId:'synthetic-handoff',executionVerified:false,graphUpdateVerified:false});
const verified=()=>({...accepted(),status:'applied',state:'succeeded',executionVerified:true,graphUpdateVerified:true});
function controls(t,invoke) {
  const original=globalThis.document;t.after(()=>{globalThis.document=original;});
  globalThis.document={createElement:tag=>new Element(tag)};
  const container=new Element('main'),control=mountProactiveControls(container,invoke);
  const render=(reviews,permission={enabled:true,cloudAllowed:true})=>control.render({suggestions:[],cognition:{...permission,reason:'Synthetic host',reviews}});
  const list=container.querySelector('[data-cognition-reviews]');
  const button=()=>list.querySelector('[data-action="apply-cognition"]');
  const click=()=>list.emit('click',{target:button()});
  const status=()=>list.querySelector('.cognition-status')?.textContent;
  return {render,button,click,status,list};
}

function settingControls(t,invoke) {
  const original=globalThis.document;t.after(()=>{globalThis.document=original;});
  globalThis.document={createElement:tag=>new Element(tag)};
  const container=new Element('main'),control=mountProactiveControls(container,invoke,{settings:true});
  const form=container.querySelector('form');
  return {form,render:control.render,feedback:()=>container.querySelector('[data-feedback]').textContent,
    submit:()=>form.emit('submit',{preventDefault(){}})};
}

test('settings save completion reads actual ProactiveHost lease expiry published before its older reply', async t => {
  const {mkdir,mkdtemp,rm}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url');
  const {createDesktopProactiveHost}=await import('../electron/proactive-host.js');
  const directory=fileURLToPath(new URL('../../../.cache/proactive-settings-expiry/',import.meta.url));
  await mkdir(directory,{recursive:true});const userData=await mkdtemp(directory+'case-');
  let now=Date.parse('2026-10-07T00:00:00.000Z'),ui,calls=0,stops=0;
  const host=createDesktopProactiveHost({namespace:'synthetic-settings-expiry',userData,
    application:{profile:'huawei_ict_agentarts',createCompetitionFactHost:()=>({close(){}}),
      startSystemObservationSession:input=>({sessionId:'synthetic-observation-session',expiresAt:input.expiresAt}),
      stopSystemObservationSession:()=>{stops++;}},client:{},now:()=>now,onUpdate:()=>ui?.render(host.snapshot())});
  t.after(async()=>{host.close();await rm(userData,{recursive:true,force:true});});
  await host.configure({enabled:true,cloudAnalysis:false});
  ui=settingControls(t,async(action,payload)=>{
    assert.equal(action,'proactive.configure');calls++;
    const older=await host.configure(payload);
    now+=8*60*60_000;await host.tick();
    assert.equal(older.enabled,true);assert.equal(host.snapshot().enabled,false);
    return older;
  });
  ui.render(host.snapshot());assert.equal(ui.form.elements.enabled.checked,true);
  ui.form.elements.cloudAnalysis.checked=true;await ui.form.emit('change',{});
  await ui.submit();
  assert.equal(ui.form.elements.enabled.checked,false);assert.equal(ui.form.elements.cloudAnalysis.checked,false);
  assert.equal(ui.form.querySelector('button').disabled,false);assert.equal(calls,1);assert.equal(stops,1);
  assert.match(ui.feedback(),/设置已保存/);
});

test('settings failed save preserves the dirty form draft while enabling controls after a publication', async t => {
  const reply=deferred();let calls=0;
  const ui=settingControls(t,()=>{calls++;return reply.promise;});
  const snapshot={suggestions:[],enabled:false,cloudAnalysis:false,cognition:{enabled:false,cloudAllowed:false,reviews:[]}};
  ui.render(snapshot);
  for(const field of Object.values(ui.form.elements))field.checked=true;
  await ui.form.emit('change',{});const work=ui.submit();
  ui.render(snapshot);reply.reject(Error('Synthetic rejected configuration'));await work;
  for(const field of Object.values(ui.form.elements)) {assert.equal(field.checked,true);assert.equal(field.disabled,false);}
  assert.equal(ui.form.querySelector('button').disabled,false);assert.equal(calls,1);
  assert.match(ui.feedback(),/Synthetic rejected configuration/);
  ui.render(snapshot);
  for(const field of Object.values(ui.form.elements))assert.equal(field.checked,true);
});

async function actualCognitionHost(t,onUpdate,{keep=false}={}) {
  const {createDesktopGoalCognitionHost}=await import('../electron/goal-cognition-host.js');
  const namespace='synthetic-repaint-host',option={id:'recheck',revision:1,action:'RECHECK',description:'Synthetic review'};
  const review={taskId:reviewId,graphNamespace:namespace,graphRevision:1,bindingVersion:'desktop-goal-analysis-v1',
    evaluatedAt:'2026-10-07T00:00:00.000Z',action:'RECHECK',affected:[],subjectGoal:{id:'synthetic-goal',revision:1},
    options:[option],selectedOption:option,selection:{state:'selected',selected:{id:option.id,revision:1},eligibleForRuntime:true}};
  if(keep) {
    review.action='KEEP';review.options=[];
    delete review.selectedOption;delete review.selection;delete review.subjectGoal;
  }
  const readback={task:{taskId:reviewId,state:'succeeded',revision:3},review};
  const graph={namespace,revision:1,history:[{id:'synthetic-goal',kind:'goal',revision:1,graphRevision:1,
    summary:'Synthetic Goal',reason:'Synthetic fixture',sourceRef:'synthetic/source',validFrom:'2026-01-01T00:00:00.000Z',
    validUntil:'2099-01-01T00:00:00.000Z',sensitivity:'public',state:'active',dependencies:[]}]};
  let handoffs=0;
  const host=createDesktopGoalCognitionHost({namespace,
    application:{runtime:{bindCoordinationStore:()=>({read:()=>structuredClone(graph)}),
      loadCheckpoint:(id,key)=>id==='synthetic-source'&&key==='desktop-goal-cognition-review'?reviewId:undefined}},
    goalHost:{listTasks:()=>[{taskId:'synthetic-source'}]},client:{call(){throw Error('Unexpected cloud dispatch');}},
    facts:{},chooser:{},ready:()=>true,onUpdate:()=>onUpdate?.(host.snapshot()),
    createHost:()=>({readReview:()=>readback,async handoffReview(){handoffs++;return {...readback,handoff:{state:'unavailable'}};},close(){}})});
  t.after(()=>host.close());
  return {host,handoffs:()=>handoffs};
}

test('actual Host local KEEP publication prevents a known preflight refusal without invoking', async t => {
  const {host,handoffs}=await actualCognitionHost(t,undefined,{keep:true});
  host.configure({enabled:true,cloudAllowed:true});
  await assert.rejects(host.applyDecision(reviewId),/没有合法选择/);
  assert.equal(handoffs(),0);
  const snapshot=host.snapshot(),item=snapshot.reviews[0];
  assert.equal(item.action,'KEEP');assert.equal(item.state,'local');assert.equal(item.taskId,undefined);
  let calls=0;
  const ui=controls(t,()=>{calls++;return host.applyDecision(reviewId);});ui.render(snapshot.reviews,snapshot);
  assert.equal(ui.button().disabled,true);assert.equal(ui.button().textContent.trim(),'保持现状');
  assert.match(ui.status(),/保持现状.*无需交给/);assert.doesNotMatch(ui.status(),/待核实|更新已核实/);
  await ui.click();assert.equal(calls,0);assert.equal(handoffs(),0);
  ui.render([]);ui.render(snapshot.reviews,snapshot);
  assert.equal(ui.button().disabled,true);await ui.click();assert.equal(calls,0);
});

test('local KEEP gate preserves prior unknown accepted and verified receipts and cannot replace pending states', async t => {
  const keep={...localReview(),action:'KEEP',state:'local'};
  for(const receipt of ['unknown','accepted','verified']) {
    let calls=0;
    const ui=controls(t,async()=>{calls++;if(receipt==='unknown')throw Error('Synthetic lost IPC');return accepted();});
    ui.render([localReview()]);await ui.click();
    if(receipt==='verified')ui.render([verified()]);
    const before=ui.status();ui.render([]);ui.render([keep]);
    assert.equal(ui.status(),before);assert.equal(ui.button().disabled,true);
    await ui.click();assert.equal(calls,1);
  }
  const ui=controls(t,()=>assert.fail('Unresolved KEEP data cannot invoke'));
  for(const state of ['pending','waiting_reconciliation','submission_unknown']) {
    ui.render([{...keep,state}]);
    assert.equal(ui.button().disabled,true);assert.match(ui.status(),/待核实/);
    assert.doesNotMatch(ui.status(),/无需交给/);
  }
});

test('proactive action completion updates the replacement card after an actual Host unavailable publication', async t => {
  let ui;
  const {host,handoffs}=await actualCognitionHost(t,snapshot=>ui?.render(snapshot.reviews,snapshot));
  host.configure({enabled:true,cloudAllowed:true});
  ui=controls(t,()=>host.applyDecision(reviewId));ui.render(host.snapshot().reviews,host.snapshot());
  const previous=ui.button();await ui.click();
  assert.notEqual(ui.button(),previous);
  assert.equal(cognitionReviewFeedback(host.snapshot().reviews[0]).locked,false);
  assert.equal(ui.button().disabled,false);
  assert.match(ui.status(),/当前无法交给/);
  assert.match(ui.list.querySelector('[data-feedback-id]').textContent,/当前无法交给/);
  assert.equal(handoffs(),1);
});

test('published permission denial avoids an actual Host preflight rejection and permits later authorized dispatch', async t => {
  for(const permission of [{enabled:true,cloudAllowed:false},{enabled:false,cloudAllowed:true}]) {
    let ui,calls=0;
    const {host,handoffs}=await actualCognitionHost(t,snapshot=>ui?.render(snapshot.reviews,snapshot));
    host.configure(permission);
    // This public producer rejects before reaching the Fake Runtime handoff.
    await assert.rejects(host.applyDecision(reviewId),/目标云端分析许可未开启/);
    assert.equal(handoffs(),0);
    ui=controls(t,()=>{calls++;return host.applyDecision(reviewId);});
    ui.render(host.snapshot().reviews,host.snapshot());
    assert.equal(ui.button().disabled,true);assert.match(ui.status(),/请先在设置中/);
    await ui.click();assert.equal(calls,0);assert.equal(handoffs(),0);
    host.configure({enabled:true,cloudAllowed:true});
    assert.equal(ui.button().disabled,false);assert.doesNotMatch(ui.status(),/待核实/);
    await ui.click();assert.equal(calls,1);assert.equal(handoffs(),1);
    assert.equal(ui.button().disabled,false);assert.match(ui.status(),/当前无法交给/);
  }
});

test('actual Host recovered repair binding failure keeps its unidentified reconciliation card locked', async t => {
  const {createDesktopGoalCognitionHost}=await import('../electron/goal-cognition-host.js');
  const namespace='synthetic-recovered-reconciliation',option={id:'recheck',revision:1,action:'RECHECK',description:'Synthetic review'};
  const review={taskId:reviewId,graphNamespace:namespace,graphRevision:1,bindingVersion:'desktop-goal-analysis-v1',
    evaluatedAt:'2026-10-07T00:00:00.000Z',action:'RECHECK',affected:[],subjectGoal:{id:'synthetic-goal',revision:1},
    options:[option],selectedOption:option,selection:{state:'selected',selected:{id:option.id,revision:1},eligibleForRuntime:true}};
  const handoffTask={taskId:'synthetic-accepted',state:'succeeded',conversationId:`desktop-proactive-goals:${namespace}`};
  const recovered={task:{taskId:reviewId,state:'succeeded',revision:3},review,handoff:{state:'submitted',task:handoffTask}};
  let calls=0,handoffs=0;
  const host=createDesktopGoalCognitionHost({namespace,
    application:{runtime:{bindCoordinationStore:()=>({read:()=>({namespace,revision:1,history:[]})}),
      saveCheckpoint(){},getTask:()=>handoffTask,
      loadCheckpoint:(id,key)=>id==='synthetic-source'&&key==='desktop-goal-cognition-review'?reviewId
        :id===reviewId&&key==='desktop-goal-cognition-repair-task-v1'?{version:0,taskId:'synthetic-corrupt-repair'}:undefined}},
    goalHost:{listTasks:()=>[{taskId:'synthetic-source'}]},client:{call(){throw Error('Unexpected cloud dispatch');}},
    facts:{},chooser:{},ready:()=>true,
    createHost:()=>({readReview:()=>recovered,handoffReview(){handoffs++;throw Error('Unexpected repeated handoff');},close(){}})});
  t.after(()=>host.close());
  const snapshot=host.snapshot(),item=snapshot.reviews[0];
  assert.equal(item.state,'waiting_reconciliation');assert.equal(item.taskId,undefined);
  const ui=controls(t,()=>{calls++;return host.applyDecision(reviewId);});ui.render(snapshot.reviews,snapshot);
  assert.equal(ui.button().disabled,true);assert.match(ui.status(),/处理结果待核实.*请勿重复提交/);
  await ui.click();assert.equal(calls,0);assert.equal(handoffs,0);
  host.configure({enabled:true,cloudAllowed:true});
  ui.render(host.snapshot().reviews,host.snapshot());
  assert.equal(ui.button().disabled,true);assert.doesNotMatch(ui.status(),/尚未交给|执行与目标更新已核实/);
  ui.render([]);ui.render([localReview()]);
  assert.equal(ui.button().disabled,true);await ui.click();assert.equal(calls,0);
  ui.render([verified()]);assert.equal(ui.button().disabled,true);assert.match(ui.status(),/执行与目标更新已核实/);
});

test('proactive action keeps an identified accepted receipt when later snapshots have no task', async t => {
  let calls=0;
  const ui=controls(t,async()=>{calls++;return accepted();});ui.render([localReview()]);
  await ui.click();
  assert.equal(ui.button().disabled,true);
  assert.match(ui.status(),/已受理/);
  ui.render([]);ui.render([localReview()]);
  assert.equal(ui.button().disabled,true);
  await ui.click();assert.equal(calls,1);
  assert.doesNotMatch(ui.status(),/尚未交给/);
});

test('proactive action late receipt or error cannot replace a verified snapshot on a new card', async t => {
  for(const fail of [false,true]) {
    const reply=deferred(),ui=controls(t,()=>reply.promise);ui.render([localReview()]);
    const work=ui.click();ui.render([verified()]);
    if(fail)reply.reject(Error('Synthetic lost response'));else reply.resolve(accepted());
    await work;
    assert.equal(ui.button().disabled,true);
    assert.match(ui.status(),/执行与目标更新已核实/);
    assert.equal(ui.button().textContent,'更新已核实');
  }
});

test('proactive action lost or mismatched reply retains uncertainty through redraw and an empty list', async t => {
  for(const malformed of [false,true]) {
    const reply=deferred();let calls=0;
    const ui=controls(t,()=>{calls++;return reply.promise;});ui.render([localReview()]);
    const work=ui.click();ui.render([localReview()]);
    assert.match(ui.list.querySelector('[data-feedback-id]').textContent,/正在交给/);
    if(malformed)reply.resolve({...accepted(),reviewTaskId:'different-review'});else reply.reject(Error('Synthetic acceptance reply lost'));
    await work;
    assert.match(ui.status(),/待核实/);assert.equal(ui.button().disabled,true);
    ui.render([]);ui.render([localReview()]);
    assert.equal(ui.button().disabled,true);await ui.click();assert.equal(calls,1);
    ui.render([accepted()]);
    assert.equal(ui.button().disabled,true);assert.equal(ui.button().textContent.trim(),'已交给主智能体');
    assert.match(ui.status(),/已受理/);
  }
});

test('known source revision changes disable only the affected review and are checked before dispatch', async t => {
  const submitted=[];
  const ui=controls(t,async(_action,payload)=>{submitted.push(payload.reviewTaskId);return {...accepted(),reviewTaskId:payload.reviewTaskId};});
  ui.render([{...localReview(),sourceOutdated:true},{...localReview(),reviewTaskId:'current-review',sourceOutdated:false}]);
  const cards=ui.list.querySelectorAll('.cognition-review-card');
  const stale=cards[0].querySelector('[data-action="apply-cognition"]');
  const current=cards[1].querySelector('[data-action="apply-cognition"]');
  assert.equal(stale.disabled,true);assert.equal(current.disabled,false);
  assert.match(cards[0].querySelector('.cognition-status').textContent,/图版本已变化/);
  assert.doesNotMatch(cards[1].querySelector('.cognition-status').textContent,/图版本已变化/);
  stale.disabled=false;await ui.list.emit('click',{target:stale});
  assert.equal(stale.disabled,true);assert.deepEqual(submitted,[]);
  await ui.list.emit('click',{target:current});assert.deepEqual(submitted,['current-review']);
  ui.render([{...localReview(),sourceOutdated:false}]);
  assert.equal(ui.button().disabled,false);
});

test('source revision presentation preserves accepted, verified, pending and reconciliation feedback', async t => {
  const receipts=[accepted(),verified(),{...localReview(),status:'pending'},
    {...localReview(),status:'waiting_reconciliation'},
    {...accepted(),status:'unavailable',state:'unavailable'}];
  for(const item of receipts) {
    let calls=0;const ui=controls(t,()=>{calls++;});
    const expected=cognitionReviewFeedback(item);
    ui.render([{...item,sourceOutdated:true}]);
    assert.equal(ui.button().disabled,true);assert.equal(ui.button().textContent.trim(),expected.label);
    assert.ok(ui.status().includes(expected.message));
    assert.doesNotMatch(ui.status(),/图版本已变化/);await ui.click();assert.equal(calls,0);
    ui.render([]);ui.render([{...localReview(),sourceOutdated:true}]);
    assert.equal(ui.button().disabled,true);assert.ok(ui.status().includes(expected.message));
    assert.doesNotMatch(ui.status(),/图版本已变化/);await ui.click();assert.equal(calls,0);
  }
});

test('a source revision change after dispatch cannot replace an unknown submission', async t => {
  const reply=deferred();let calls=0;
  const ui=controls(t,()=>{calls++;return reply.promise;});ui.render([localReview()]);
  const work=ui.click();ui.render([{...localReview(),sourceOutdated:true}]);
  reply.reject(Error('Synthetic revision changed after dispatch'));await work;
  assert.equal(ui.button().disabled,true);assert.match(ui.status(),/提交结果待核实/);
  assert.doesNotMatch(ui.status(),/图版本已变化/);
  ui.render([]);ui.render([{...localReview(),sourceOutdated:true}]);
  assert.match(ui.status(),/提交结果待核实/);await ui.click();assert.equal(calls,1);
  ui.render([{...accepted(),sourceOutdated:true}]);assert.match(ui.status(),/已受理/);
});


test('validated oversized export feedback identifies the complete bound and keeps old receipt locks',()=>{
  const cloudExport={state:'blocked',reason:'goal_text_limit',chars:24338,maxChars:16000};
  const feedback=cognitionReviewFeedback({state:'local',cloudExport});
  assert.match(feedback.message,/24338.*16000/);assert.match(feedback.message,/本地/);
  assert.equal(feedback.locked,true);assert.equal(feedback.label,'云端内容超出上限');
  for(const state of ['failed','pending','waiting_reconciliation']) {
    const old={state,taskId:'old-accepted',cloudExport};
    assert.equal(cognitionReviewFeedback(old).locked,true);
    assert.equal(cognitionReviewFeedback(old).label,'已交给主智能体');
  }
  for(const cloudExport of [false,{state:'blocked',reason:'goal_text_limit',chars:16000,maxChars:16000},
    {state:'blocked',reason:'goal_text_limit',chars:24338,maxChars:17000},
    {state:'blocked',reason:'unknown',chars:24338,maxChars:16000}]) {
    assert.equal(cognitionReviewFeedback({state:'local',cloudExport}).locked,false);
  }
});

test('retain local Goal revokes only cloud permission using authoritative configuration readback',async t=>{
  const calls=[],reply=deferred();
  const ui=controls(t,(name,payload)=>{calls.push({name,payload});return reply.promise;});
  ui.render([{...localReview(),cloudExport:{state:'blocked',reason:'goal_text_limit',chars:24338,maxChars:16000}}]);
  const button=ui.list.querySelector('[data-action="retain-local-cognition"]');assert.ok(button);
  const work=ui.list.emit('click',{target:button});
  assert.deepEqual(calls,[{name:'proactive.configure',payload:{goalAnalysis:true,goalCloudAnalysis:false}}]);
  assert.doesNotMatch(ui.status(),/已关闭目标云端许可/);
  reply.resolve({enabled:true,cloudAnalysis:true,cognition:{enabled:true,cloudAllowed:false,reviews:[]}});await work;
  assert.match(ui.list.parentNode.querySelector('[data-local-feedback]').textContent,/已关闭目标云端许可/);
});


test('retain local Goal requires confirmed false permission and prefers a newer host snapshot',async t=>{
  const item={...localReview(),cloudExport:{state:'blocked',reason:'goal_text_limit',chars:24338,maxChars:16000}};
  for(const reply of [false,{}, {cognition:{enabled:true,cloudAllowed:true}}, {cognition:{enabled:true,cloudAllowed:'false'}}]) {
    const ui=controls(t,async()=>reply);ui.render([item]);
    await ui.list.emit('click',{target:ui.list.querySelector('[data-action="retain-local-cognition"]')});
    const text=ui.list.parentNode.querySelector('[data-local-feedback]').textContent;
    assert.match(text,/尚未核实/);assert.doesNotMatch(text,/已关闭目标云端许可/);
  }
  for(const newer of [{enabled:true,cloudAllowed:true},{enabled:false,cloudAllowed:false},{enabled:true,cloudAllowed:false}]) {
    const reply=deferred(),ui=controls(t,()=>reply.promise);ui.render([item]);
    const work=ui.list.emit('click',{target:ui.list.querySelector('[data-action="retain-local-cognition"]')});
    ui.render([item],newer);
    reply.resolve({cognition:{enabled:true,cloudAllowed:false,reviews:[item]}});await work;
    assert.match(ui.list.parentNode.querySelector('[data-local-feedback]').textContent,
      newer.enabled && !newer.cloudAllowed ? /已关闭目标云端许可/ : /尚未核实/);
  }
});

test('retain local Goal preserves settings draft and excludes an overlapping full settings save',async t=>{
  const item={...localReview(),cloudExport:{state:'blocked',reason:'goal_text_limit',chars:24338,maxChars:16000}},reply=deferred(),calls=[];
  const original=globalThis.document;t.after(()=>globalThis.document=original);globalThis.document={createElement:tag=>new Element(tag)};
  const container=new Element('main'),control=mountProactiveControls(container,(name,payload)=>{calls.push({name,payload});return reply.promise;},{settings:true});
  const initial={enabled:true,cloudAnalysis:true,suggestions:[],cognition:{enabled:true,cloudAllowed:true,reviews:[item]}};control.render(initial);
  const form=container.querySelector('form');form.elements.enabled.checked=false;await form.emit('change',{});
  const list=container.querySelector('[data-cognition-reviews]'),work=list.emit('click',{target:list.querySelector('[data-action="retain-local-cognition"]')});
  assert.equal(form.querySelector('button').disabled,true);await form.emit('submit',{preventDefault(){}});assert.equal(calls.length,1);
  reply.resolve({...initial,cognition:{...initial.cognition,cloudAllowed:false}});await work;
  assert.equal(form.elements.enabled.checked,false);assert.equal(form.querySelector('button').disabled,false);
  assert.match(container.querySelector('[data-local-feedback]').textContent,/已关闭目标云端许可/);
  assert.equal(container.querySelector('[data-feedback]').textContent,'有未保存的设置');
});

test('long Goal trigger uses native disclosure and preserves full escaped text outside the visible outcome',async t=>{
  const ui=controls(t,async()=>{}),trigger='Synthetic dependency <b>& details '.repeat(30);
  ui.render([{...localReview(),trigger}]);
  const details=ui.list.querySelector('details[data-trigger-review]');assert.ok(details);
  assert.equal(details.open,false);
  assert.equal(details.querySelector('summary').textContent,'查看完整触发原因');
  assert.equal(details.querySelector('.cognition-trigger').textContent,'触发原因：'+trigger.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'));
  assert.equal(details.querySelector('.cognition-status'),null);assert.equal(details.querySelector('[data-action="apply-cognition"]'),null);
  ui.render([{...localReview(),trigger:'Short original cause'}]);
  assert.equal(ui.list.querySelector('details[data-trigger-review]'),null);
  assert.match(ui.list.querySelector('.cognition-trigger').textContent,/Short original cause/);
});

test('long Goal trigger expansion follows actual native open state across snapshots and clears absent reviews',async t=>{
  const ui=controls(t,async()=>{}),first={...localReview(),trigger:'First full synthetic trigger '.repeat(20)},second={...localReview(),reviewTaskId:'second-review',trigger:'Second full trigger '.repeat(30)};
  ui.render([first,second]);let details=ui.list.querySelectorAll('details[data-trigger-review]');assert.equal(details.length,2);
  details[0].open=true;details[1].open=false;ui.render([first,second]);details=ui.list.querySelectorAll('details[data-trigger-review]');
  assert.equal(details[0].open,true);assert.equal(details[1].open,false);
  details[0].open=false;details[1].open=true;ui.render([first,second]);details=ui.list.querySelectorAll('details[data-trigger-review]');
  assert.equal(details[0].open,false);assert.equal(details[1].open,true);
  ui.render([first]);ui.render([first,second]);assert.equal(ui.list.querySelectorAll('details[data-trigger-review]')[1].open,false);
});


test('long Goal trigger preserves only the focused native summary for the same current review',async t=>{
  const ui=controls(t,async()=>{}),first={...localReview(),trigger:'Full synthetic trigger '.repeat(30)},second={...first,reviewTaskId:'second-review'};
  ui.render([first,second]);let summaries=ui.list.querySelectorAll('summary');summaries[1].focus();
  ui.render([second,first]);summaries=ui.list.querySelectorAll('summary');
  assert.equal(document.activeElement,summaries[0]);assert.deepEqual(summaries[0].lastFocusOptions,{preventScroll:true});
  ui.render([first]);assert.equal(document.activeElement,null);
  ui.render([first,second]);assert.equal(document.activeElement,null);
  ui.list.querySelector('summary').focus();ui.render([{...first,trigger:'Short reason'},second]);assert.equal(document.activeElement,null);
  const outside=new Element('button');outside.focus();ui.render([first,second]);assert.equal(document.activeElement,outside);
  const button=ui.button();button.focus();ui.render([first,second]);assert.equal(document.activeElement,button);
  assert.equal(ui.list.querySelectorAll('summary').some(node=>node.lastFocusOptions),false);
});
