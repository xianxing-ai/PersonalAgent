// Real-weight positive/negative and option-order checks using a recorded public pelican decision.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {TaskRuntime} from '@personal-agent/runtime';
import {startLayaService} from '../../../apps/agentarts-runtime/src/laya-service.mjs';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),chunks=[];
for await(const chunk of process.stdin)chunks.push(chunk);
const config=JSON.parse(Buffer.concat(chunks).toString('utf8'));
let original;
if(config.sourceRun) {
  const source=resolve(config.sourceRun),part=relative(join(root,'.cache'),source);assert.ok(part&&!part.startsWith('..'));
  const runtime=new TaskRuntime(join(source,'main','runtime.sqlite'));
  try{for(const task of runtime.listTasks({limit:20}).items){const intent=runtime.loadCheckpoint(task.taskId,'host-tool-intent');
    if(intent?.toolName==='decision.choose_candidate'){original=intent.arguments;break;}}}finally{runtime.close();}
} else {
  // Public checkpoint excerpt: exactly the same source-decision SHA as the measured arms.
  original=JSON.parse(await readFile(new URL('./fixtures/pelican-source-read-decision.json',import.meta.url),'utf8'));
}
assert.ok(original);const report={kind:'real_pelican_read_choice_contrastive_probe',scope:'One known source-read stage; not all-workflow accuracy',
  sourceDecisionSha256:createHash('sha256').update(JSON.stringify(original)).digest('hex'),
  modelManifestSha256:createHash('sha256').update(await readFile(join(config.localLaya.modelPath,'asset-manifest.json'))).digest('hex'),
  questionMode:config.questionMode??'production',cases:[],maasCalls:0,businessToolExecutions:0,modelInstancesAtOnce:1};let service;
try {
  const startup=performance.now();service=await startLayaService({...config.localLaya,cpuExecutionPolicy:'sequential'});
  report.localRuntime={device:service.device,torchThreads:service.torchThreads,precision:service.precision,startupMs:performance.now()-startup};
  const receipts=[];
  const selector=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,
    cpuExecutionPolicy:'sequential',onDecision:value=>receipts.push(value)});
  const deadline=new Date(Date.now()+600000).toISOString();
  for(let round=0;round<2;round++)for(const negative of [false,true])for(const reversed of [false,true]) {
    const value=structuredClone(original),context=JSON.parse(value.context);
    if(negative)context.candidateValues.find(candidate=>!candidate.abstain).value.arguments.path='outside-requested-scope.svg';
    if(reversed)value.candidates.reverse();value.context=JSON.stringify(context);value.requestId='pelican-probe-'+crypto.randomUUID();
    const expected=negative?'owned-review':value.candidates.find(candidate=>candidate.id!=='owned-review').id;
    let selected,receipt;
    if(config.questionMode==='read_facts') {
      // Diagnostic only: no production projection or decision rule changes.
      const started=performance.now(),criteria=Object.fromEntries(value.candidates.map((candidate,index)=>{
        const proposal=context.candidateValues.find(row=>row.id===candidate.id);
        return ['candidate_'+index,proposal.abstain?'Request review without reading a file':
          'Request '+proposal.value.toolName+' '+JSON.stringify(proposal.value.arguments)];
      }));
      const state={requestedFile:context.input.targetFile,allowedPaths:context.input.allowedPaths,
        publishedTools:context.publishedTools,stage:'Propose reading the requested file. No file contents or patch exist yet.'};
      const response=await fetch('http://127.0.0.1:'+service.port+'/v1/systemone',{
        method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+service.key},
        body:JSON.stringify({model:'multilingual',state,deadline,questions:{decision:{type:'choice',
          instructions:'Which action reads the requested file? Choose review if neither read request matches the requested file and scope.',criteria}}})});
      assert.equal(response.status,200);const answer=await response.json(),index=Object.keys(criteria).indexOf(answer.answers.decision.choice);
      selected=value.candidates[index].id;receipt={endToEndMs:performance.now()-started,answer:answer.answers.decision,
        tokenWindow:answer.tokenWindow,inferenceMetrics:answer.inferenceMetrics};
    } else {
      selected=await selector.select({...value,deadline,signal:new AbortController().signal});receipt=receipts.at(-1);
    }
    report.cases.push({round,negative,reversed,expected,selected,correct:expected===selected,...receipt});
  }
  report.correct=report.cases.filter(row=>row.correct).length;report.total=report.cases.length;report.status='measured';
}catch(error){report.status='failed';report.failure=error.code??error.name;process.exitCode=1;}
finally{await service?.stop();const destination=join(root,'.cache','pelican-source-choice-probes-'+Date.now()+'.json');
  await writeFile(destination,JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({file:destination,status:report.status,
    correct:report.correct,total:report.total,cases:report.cases.map(({negative,reversed,selected,expected,endToEndMs})=>({negative,reversed,selected,expected,endToEndMs}))},null,2)+'\n');}
