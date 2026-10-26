import {mkdirSync,writeFileSync,mkdtempSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {createRuntimeApplication} from '../../runtime/dist/application.js';
import {seedPerformanceDatabase} from './performance-database.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.resolve(root,process.argv[2]??'.cache/performance/runtime.json');
const size=Number(process.argv[3]??10000),samples=[];
mkdirSync(path.dirname(out),{recursive:true});
const dir=mkdtempSync(path.join(path.dirname(out),'database-'));
const fixture=await seedPerformanceDatabase(path.join(dir,'runtime.sqlite'),size);
const application=createRuntimeApplication({path:path.join(dir,'runtime.sqlite'),profile:'huawei_ict_agentarts'});
const summary=values=>{const v=[...values].sort((a,b)=>a-b);return {p50:v[Math.ceil(v.length*.5)-1],p95:v[Math.ceil(v.length*.95)-1],max:v.at(-1),count:v.length};};
const measure=(name,fn)=>{const values=[];for(let i=0;i<8;i++){const begin=performance.now();fn();if(i>=2)values.push(performance.now()-begin);}
  samples.push({name,wallMs:summary(values),rawWallMs:values,memory:process.memoryUsage()});};
try {
  measure('latest40',()=>application.runtime.readTaskDisplayPage({conversationId:'desktop-panel',limit:40}));
  measure('missingChildConversation',()=>application.runtime.listTasks({conversationId:'desktop-subtask:absent',limit:100}));
  measure('workspaceChildSummary',()=>application.listSubagentConversations({limit:100}));
  measure('legacyDoubleReplay',()=>{application.runtime.readEvents(0);application.runtime.readEvents(0);});
  const histogram=monitorEventLoopDelay({resolution:1});histogram.enable();
  await new Promise(resolve=>setTimeout(resolve,10));
  let afterSequence=0,throughSequence,batches=0,eventCount=0;const batchTimes=[],begin=performance.now();
  do {
    const started=performance.now(),batch=application.readEventBatch({afterSequence,throughSequence,limit:128});
    batchTimes.push(performance.now()-started);throughSequence=batch.throughSequence;batches++;eventCount+=batch.events.length;
    afterSequence=batch.events.at(-1)?.sequence??afterSequence;
    if(!batch.hasMore)break;await new Promise(resolve=>setImmediate(resolve));
  } while(true);
  const drainMs=performance.now()-begin;await new Promise(resolve=>setTimeout(resolve,10));histogram.disable();
  writeFileSync(out,JSON.stringify({mode:'real-sqlite-synthetic-records-no-provider',size,fixture,
    sourceHashes:Object.fromEntries(['apps/runtime/dist/index.js','apps/runtime/dist/application/runtime-application.js'].map(name=>[name,createHash('sha256').update(readFileSync(path.join(root,name))).digest('hex')])),
    samples,eventDrain:{batches,eventCount,throughSequence,afterSequence,drainMs,batchWallMs:summary(batchTimes),
      eventLoopDelayMs:{p50:histogram.percentile(50)/1e6,p95:histogram.percentile(95)/1e6,max:histogram.max/1e6}},
    limitations:['Single machine, synthetic tasks only','Sampled process memory, not peak RSS','No renderer, provider, real cloud or device','Legacy double replay is the old read-path equivalent, not a baseline app launch']},null,2)+'\n');
  console.log(JSON.stringify({size,samples:samples.map(({name,wallMs})=>({name,wallMs})),eventDrain:{batches,eventCount,drainMs,batchWallMs:summary(batchTimes)}}));
} finally {application.runtime.close();}
