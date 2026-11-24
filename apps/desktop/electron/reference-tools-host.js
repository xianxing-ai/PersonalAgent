import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {createPublicReferenceExport} from '@personal-agent/mcp';
import {createCloudSkillSelectionPort,CLOUD_SKILL_TOOL_NAME,CLOUD_SKILL_TOOL_VERSION,CLOUD_SKILL_CHOICE_SCHEMA} from '@personal-agent/skills';

const BINDING='desktop-reference-binding-v1';
const NAMESPACE='desktop-reference-namespace-v1';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal=task=>['succeeded','failed','cancelled'].includes(task.state);

/** Trusted composition of the fixed MCP service and worker-level Skill. */
export function createDesktopReferenceHost({workspace,createMcp,onUpdate=()=>{},assertDispatchBinding,
  publicReferenceExport,publicReferenceAvailability,publicSkillAvailability,resolvePublicSkillSource,
  hostUserNamespace,resolvePublicSkillPath,readPublicSkillSourceRefs}) {
  let application,service=createMcp(),binding,configurationRef,closed=false;
  let mutation=Promise.resolve();
  const tasks=new Set();
  const publicOrigins=new Map();
  const descriptor=service.tools[0].descriptor;
  const current=()=>!closed && binding && workspace.isWorkspaceBindingCurrent(binding)
    && service.health().connected ? configurationRef : undefined;
  let cloudSkill;
  const exporter=createPublicReferenceExport({currentConfigurationRef:current,
    readPreflight(query) {
      assertTask(query.taskId);
      return publicReferenceExport?.readPreflight?.(query);
    },
    readAuthorization(query) {
      assertTask(query.taskId);
      return publicReferenceExport?.readAuthorization?.(query);
    },
    readConfirmed(query) {
      assertTask(query.taskId);
      return publicReferenceExport?.readConfirmed?.(query);
    }});
  function bindTask(taskId) {
    const ref=current();
    if (!application || !ref) throw Error('请先许可工作区并连接只读参考服务');
    const prior=application.runtime.loadCheckpoint(taskId,BINDING);
    if (prior!==undefined && prior!==ref) throw Error('参考任务的工作区许可已改变');
    if (prior===undefined && !application.runtime.saveCheckpointOnce(taskId,BINDING,ref)) throw Error('参考任务绑定冲突');
    if(typeof hostUserNamespace==='string' && /^[A-Za-z0-9._:-]{1,128}$/.test(hostUserNamespace)) {
      const namespace=application.runtime.loadCheckpoint(taskId,NAMESPACE);
      if(namespace!==undefined && namespace!==hostUserNamespace) throw Error('参考任务的用户范围已改变');
      if(namespace===undefined && !application.runtime.saveCheckpointOnce(taskId,NAMESPACE,hostUserNamespace)) throw Error('参考任务用户范围绑定冲突');
    }
    tasks.add(taskId);return ref;
  }
  function assertTask(taskId) {
    if (!current() || application.runtime.loadCheckpoint(taskId,BINDING)!==configurationRef) throw Error('参考任务的工作区许可已撤销或改变');
  }
  /** Strict native-only candidate query. No caller supplies receipt, SHA or path alias. */
  function publicQuery(input) {
    const keys=['taskId','proposalId','path','configurationRef'];
    if(!input || typeof input!=='object' || Array.isArray(input)
      || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw Error();
    const fields=Object.getOwnPropertyDescriptors(input);
    if(Reflect.ownKeys(input).length!==keys.length || keys.some(key=>!fields[key]?.enumerable
      || !('value' in fields[key]) || typeof fields[key].value!=='string' || !fields[key].value)) throw Error();
    const query=Object.fromEntries(keys.map(key=>[key,fields[key].value]));
    assertTask(query.taskId);
    if(query.configurationRef!==current() || !hostUserNamespace
      || application.runtime.loadCheckpoint(query.taskId,NAMESPACE)!==hostUserNamespace) throw Error();
    const task=application.runtime.getTask(query.taskId);
    if(terminal(task) || task.cancelRequested || ['cancelling','verifying'].includes(task.state)
      || application.runtime.loadCheckpoint(query.taskId,'application-profile')!=='huawei_ict_agentarts') throw Error();
    return query;
  }
  function publicOrigin(input) {
    const query=publicQuery(input),runtime=application.runtime;
    const loop=runtime.loadCheckpoint(query.taskId,'competition-loop');
    const pending=loop?.pending?.proposalId===query.proposalId?loop.pending:undefined;
    const prior=loop?.receipts?.find(item=>item.proposal?.proposalId===query.proposalId)?.proposal;
    const selection=runtime.loadCheckpoint(query.taskId,'skill:cloud-selection:v1');
    const deadline=runtime.loadCheckpoint(query.taskId,'application-deadline');
    if(typeof deadline!=='string' || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline)<=Date.now()) throw Error();
    let runId,args;
    const proposal=pending??prior;
    if(proposal?.kind==='tool_proposal' && proposal.verification==='unverified'
      && proposal.toolName===descriptor.name && proposal.toolVersion===descriptor.version) {
      validateToolValue(descriptor.inputSchema,proposal.arguments);
      args=structuredClone(proposal.arguments);
      if(pending) {
        if(!Number.isSafeInteger(loop.step) || loop.step<1) throw Error();
        runId=`competition-tool-${query.taskId}-${loop.step}`;
      } else runId=publicOrigins.get(JSON.stringify([query.taskId,query.proposalId]))?.runId;
    } else {
      const manifest=application.referenceSkillSnapshot().manifest;
      const saved=selection?.taskId===query.taskId && selection.proposalId===query.proposalId?selection:undefined;
      const choice=saved?.choice ?? (pending?.toolName===CLOUD_SKILL_TOOL_NAME
        && pending.toolVersion===CLOUD_SKILL_TOOL_VERSION && pending.verification==='unverified'?pending.arguments:undefined);
      validateToolValue(CLOUD_SKILL_CHOICE_SCHEMA,choice);
      if(!manifest || choice.skillId!==manifest.id || choice.version!==manifest.version || choice.digest!==manifest.digest) throw Error();
      let path;
      if(saved) {
        if(saved.source?.sourceRef!==choice.sourceRef || saved.source.configurationRef!==query.configurationRef
          || saved.source.sensitivity!=='PUBLIC' || saved.source.purpose!=='reference-summary') throw Error();
        path=saved.source.path;
      } else path=resolvePublicSkillPath?.({taskId:query.taskId,proposalId:query.proposalId,
        sourceRef:choice.sourceRef,configurationRef:query.configurationRef});
      args={path};validateToolValue(descriptor.inputSchema,args);
      const intent=runtime.loadCheckpoint(query.taskId,'application-reference-skill-v1');
      if(intent && (intent.input?.skillId!==choice.skillId || intent.input.version!==choice.version
        || intent.input.digest!==choice.digest || intent.input.path!==path || intent.deadline!==deadline)) throw Error();
      runId=`skill-read-${query.taskId}-${choice.digest.slice(0,16)}`;
    }
    if(args.path!==query.path || typeof runId!=='string' || !runId) throw Error();
    const metadata={query,runId,toolName:descriptor.name,toolVersion:descriptor.version,arguments:args,deadline};
    const key=JSON.stringify([query.taskId,query.proposalId]),pin=publicOrigins.get(key);
    if(pin && !isDeepStrictEqual(pin,metadata)) throw Error();
    if(!pin) publicOrigins.set(key,structuredClone(metadata));
    publicQuery(query); // Recheck task/config after any native alias callback.
    return metadata;
  }
  function confirmedPublicRead(input) {
    const metadata=publicOrigin(input),runtime=application.runtime;
    const record=runtime.readToolExecutions(metadata.query.taskId).find(item=>item.evidenceId===metadata.runId);
    if(!record || record.state!=='confirmed' || record.policyDecision!=='allow' || !record.executionStarted || !record.finishedAt
      || record.toolName!==metadata.toolName || record.toolVersion!==metadata.toolVersion
      || !runtime.matchesToolExecutionInput(record,{arguments:metadata.arguments,scopeRef:metadata.runId})
      || !runtime.getTask(metadata.query.taskId).evidenceRefs.includes(metadata.runId)) throw Error();
    const saved=runtime.loadCheckpoint(metadata.query.taskId,'tool-result-'+metadata.runId);
    validateToolValue(descriptor.outputSchema,saved?.result);
    const result=structuredClone(saved.result),byteLength=Buffer.byteLength(result.text);
    if(result.path!==metadata.query.path || byteLength>262144
      || createHash('sha256').update(result.text).digest('hex')!==result.contentDigest) throw Error();
    if(!isDeepStrictEqual(metadata,publicOrigin(input))) throw Error();
    return {metadata,result,byteLength};
  }
  function freezeCandidate(metadata,confirmation) {
    return Object.freeze({...metadata,query:Object.freeze({...metadata.query}),arguments:Object.freeze({...metadata.arguments}),
      ...(confirmation?{contentDigest:confirmation.result.contentDigest,byteLength:confirmation.byteLength}:{})});
  }
  const tools=[{descriptor,execute:async(input,context)=>{
    assertTask(context.taskId);
    const active=service,ref=configurationRef;
    const result=await active.tools[0].execute(input,context);
    assertTask(context.taskId);
    if (active!==service || ref!==configurationRef) throw Error('参考读取配置已改变');
    return result;
  }}];
  const competitionToolAvailability=[{toolName:descriptor.name,toolVersion:descriptor.version,
    available:async(input)=>{
      const {taskId,signal}=input;
      if(signal.aborted || !current()) return false;
      try {
        bindTask(taskId);
        // Workspace read permission does not publish private MCP availability.
        const ref=current();
        const allowed=await publicReferenceAvailability?.({...input,configurationRef:ref});
        assertTask(taskId);
        return allowed===true && !signal.aborted && ref===current()
          && Number.isFinite(Date.parse(input.deadline)) && Date.parse(input.deadline)>Date.now();
      } catch {return false;}
    }}];
  const competitionToolExports=[exporter];
  function snapshot() {return {mcp:service.health(),skill:application?.referenceSkillSnapshot()??{health:{state:'unavailable',enabled:false}}};}
  async function stop() {
    cloudSkill?.close();cloudSkill=undefined;
    application?.setReferenceSkillEnabled(false);
    for(const taskId of tasks) {
      const task=application?.runtime.getTask(taskId);
      if(task && !terminal(task)) application.runtime.requestCancel(taskId,'参考资料许可已撤销');
    }
    tasks.clear();publicOrigins.clear();binding=undefined;configurationRef=undefined;
    await service.dispose();service=createMcp();onUpdate();
  }
  function serialize(work) {const next=mutation.then(work);mutation=next.catch(()=>{});return next;}
  return {tools,competitionToolAvailability,competitionToolExports,snapshot,bindTask,assertTask,
    /** Original native workspace selection and fixed owned Skill, including while disabled. */
    readF21Configuration(){
      const selected=workspace.readWorkspaceBinding(),manifest=application?.referenceSkillSnapshot().manifest;
      if(closed||!selected||!workspace.isWorkspaceBindingCurrent(selected)||!manifest)return;
      return structuredClone({workspace:selected,manifest,descriptor});
    },
    readF21Connection(){const ref=current();return ref?{configurationRef:ref,mcp:service.health(),skill:application.referenceSkillSnapshot().health}:undefined;},
    readPublicReferencePreflightCandidate(query) {
      try {return freezeCandidate(publicOrigin(query));} catch {return undefined;}
    },
    readPublicReferenceCandidate(query) {
      try {const confirmed=confirmedPublicRead(query);return freezeCandidate(confirmed.metadata,confirmed);} catch {return undefined;}
    },
    readConfirmedPublicReference(query) {
      try {
        const base={taskId:query.taskId,proposalId:query.proposalId,path:query.path,configurationRef:query.configurationRef};
        const confirmed=confirmedPublicRead(base);
        if(!isDeepStrictEqual(query.arguments,confirmed.metadata.arguments) || query.contentDigest!==confirmed.result.contentDigest) return undefined;
        return {runId:confirmed.metadata.runId,result:confirmed.result};
      } catch {return undefined;}
    },
    configureCloudSkillWorker(versionedSkillworker) {
      cloudSkill?.close();
      cloudSkill=createCloudSkillSelectionPort({versionedSkillworker,
        publicReferenceExport:{currentConfigurationRef:current,
          readPreflight:query=>{assertTask(query.taskId);return publicReferenceExport?.readPreflight?.(query);},
          readAuthorization:query=>{assertTask(query.taskId);return publicReferenceExport?.readAuthorization?.(query);},
          readConfirmed:query=>{assertTask(query.taskId);return publicReferenceExport?.readConfirmed?.(query);}},
        resolvePublicSource:input=>{
        assertTask(input.taskId);
        const ref=current();
        const source=resolvePublicSkillSource?.({...input,configurationRef:ref});
        assertTask(input.taskId);
        if(!source || !ref || source.configurationRef!==ref || current()!==ref)
          throw new ProtocolError('UNAUTHORIZED','Native public Skill permission is unavailable');
        return source;
      }});
      return cloudSkill;
    },
    async cloudSkillCatalog(input) {
      if(!cloudSkill || input.signal.aborted || !current()) return undefined;
      const selectedSkill=cloudSkill;
      try {
        bindTask(input.taskId);const ref=current();
        const allowed=await publicSkillAvailability?.({...input,configurationRef:ref});
        assertTask(input.taskId);
        if(allowed!==true || input.signal.aborted || ref!==current()
          || !Number.isFinite(Date.parse(input.deadline)) || Date.parse(input.deadline)<=Date.now()) return undefined;
        // Native-selected PUBLIC aliases only. Never publish their local paths.
        const sourceRefs=readPublicSkillSourceRefs?.({...input,configurationRef:ref});
        assertTask(input.taskId);
        if(selectedSkill!==cloudSkill || input.signal.aborted || ref!==current()
          || !Number.isFinite(Date.parse(input.deadline)) || Date.parse(input.deadline)<=Date.now()) return undefined;
        return selectedSkill.describe(sourceRefs);
      } catch {return undefined;}
    },
    async dispatchCloudSkillProposal(proposal,context) {
      if(!cloudSkill) throw new ProtocolError('UNSUPPORTED_CAPABILITY','Cloud Skill worker is unavailable');
      bindTask(context.taskId);
      return cloudSkill.dispatch(proposal,context);
    },
    bindApplication(value) {
      application=value;
      application.configureReferenceSkill({enabled:false,isToolAvailable:()=>Boolean(current()),
        currentConfigurationRef:current,assertDispatchBinding:taskId=>{
          bindTask(taskId);assertTask(taskId);
          // The learning owner installs its original binding guard separately.
          return assertDispatchBinding?.(taskId);
        }});
    },
    invalidate:()=>serialize(stop),
    setMcpEnabled(enabled,request={}) {return serialize(async()=>{
      if(typeof enabled!=='boolean' || closed) throw Error('参考服务设置无效');
      const assertCurrent=()=>{if(request.signal?.aborted||request.deadline!==undefined&&(!Number.isFinite(Date.parse(request.deadline))||Date.parse(request.deadline)<=Date.now())
        ||request.assertCurrent&&request.assertCurrent()!==true)throw Error('原参考连接操作已失效');};
      assertCurrent();
      await stop();
      if(enabled) {
        assertCurrent();
        binding=workspace.readWorkspaceBinding();
        if(!binding) throw Error('请先选择工作区、可信 Node，并许可本会话读取');
        // Reconnecting the same permitted root must not revive prior session
        // receipts or complete Skill caches after stop/revocation.
        configurationRef=digest({binding,connectionId:randomUUID()});
        if(request.onBound){const result=request.onBound({configurationRef});if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('参考连接绑定须同步保存');}}
        service=createMcp({rootPath:binding.rootPath,nodeExecutable:binding.nodeExecutable,enabled:true});
        const duration=Math.max(1,Math.min(15000,request.deadline===undefined?15000:Date.parse(request.deadline)-Date.now()));
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),duration);
        const signal=request.signal?AbortSignal.any([controller.signal,request.signal]):controller.signal;
        try {
          await service.start({signal,deadline:new Date(Date.now()+duration).toISOString()});assertCurrent();
          if(!workspace.isWorkspaceBindingCurrent(binding)) throw Error('工作区许可在连接期间已改变');
        } catch(error) {await stop();throw error;} finally {clearTimeout(timer);}
      }
      onUpdate();return snapshot();
    });},
    setSkillEnabled(enabled) {
      if(typeof enabled!=='boolean' || (enabled && !current())) throw Error('请先连接只读参考服务');
      application.setReferenceSkillEnabled(enabled);onUpdate();return snapshot();
    },
    submit({path}) {
      if(!current() || typeof path!=='string') throw Error('参考读取尚未就绪');
      const manifest=application.referenceSkillSnapshot().manifest;
      if(!manifest) throw Error('参考 Skill 尚未装配');
      const task=application.submitReferenceSkillTask({skillId:manifest.id,version:manifest.version,digest:manifest.digest,path,
        idempotencyKey:randomUUID(),deadline:new Date(Date.now()+60000).toISOString()});
      onUpdate();return {taskId:task.taskId,state:task.state};
    },
    async reconcile(taskId) {assertTask(taskId);const task=await application.reconcileReferenceSkillTask(taskId);onUpdate();return {taskId:task.taskId,state:task.state};},
    dispose() {return serialize(async()=>{closed=true;exporter.dispose();await stop();await service.dispose();});},
  };
}
