import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseHarnessCandidateTrial,harnessCandidateArtifactDigest} from '@personal-agent/contracts/harness-candidates';
import type {HarnessCandidateTrial} from '@personal-agent/contracts/harness-candidates';
import {HARNESS_CANDIDATE_TRIAL_TOOL} from './harness-candidates.js';
import type {HostToolTaskReadback} from './runtime-application.js';
import type {RuntimeF20Input} from './owned-workflow-worker-capability.js';

// TODO(F20_WORKER_TRUST_GAPS): F20_N03 still publishes workspace.run_allowed_command until agentarts Schema
// renames the graph tool to an explicit candidate-check adapter; verifyCompletion must keep rejecting exit-code-only checks.

const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=4096;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message:string):never=>{throw new ProtocolError('UNAUTHORIZED',message);};

function confirmedSource(read:HostToolTaskReadback,path:string):{taskId:string;content:string;path:string} {
  const confirmed=read.confirmed;
  if(read.toolName!=='workspace.read_text'||read.task.state!=='succeeded'||!confirmed?.evidenceRefs.length)
    fail('F20 source has no original authorized readback');
  const raw:unknown=confirmed!.result;
  if(!plain(raw))return fail('F20 source has no original authorized readback');
  if(raw.path!==path||typeof raw.content!=='string')return fail('F20 source has no original authorized readback');
  return {taskId:read.task.taskId,path,content:raw.content};
}

function parseConfirmedTrial(check:HostToolTaskReadback,parse:(value:unknown)=>HarnessCandidateTrial):HarnessCandidateTrial {
  const confirmed=check.confirmed;
  if(check.toolName!==HARNESS_CANDIDATE_TRIAL_TOOL||check.task.state!=='succeeded'||!confirmed?.evidenceRefs.length
    ||!Object.hasOwn(confirmed,'result'))fail('F20 completion requires a confirmed harness trial');
  try {return parse(confirmed!.result);}catch{return fail('F20 harness trial is unavailable');}
}

/** Independently binds F20 completion to a confirmed harness trial, not an exit code or model claim. */
export function verifyF20HarnessCompletion(request:{
  input:RuntimeF20Input;
  read:HostToolTaskReadback;
  check:HostToolTaskReadback;
  sourceReads:readonly HostToolTaskReadback[];
  parseTrial?:(value:unknown)=>HarnessCandidateTrial;
}):{additionalSourceTaskIds:readonly string[]} {
  const {input:caseInput,read,check,sourceReads,parseTrial}=request;
  const parse=parseTrial??parseHarnessCandidateTrial;
  if(check.toolName==='workspace.run_allowed_command'
    ||plain(check.confirmed?.result)&&Object.keys(check.confirmed.result as object).sort().join(',')==='exitCode,recipeId,stderr,stdout')
    fail('F20 completion cannot accept exit-code-only verification');
  const trial=parseConfirmedTrial(check,parse);
  const sources=new Map<string,{taskId:string;content:string}>();
  for(const readback of sourceReads) {
    if(readback.toolName!=='workspace.read_text')continue;
    const path=plain(readback.confirmed?.result)?(readback.confirmed.result as {path?:unknown}).path:undefined;
    if(typeof path!=='string')continue;
    const saved=confirmedSource(readback,path);
    if(sources.has(path)&&sources.get(path)!.content!==saved.content)fail('F20 source readback drifted');
    sources.set(path,saved);
  }
  const primary=confirmedSource(read,caseInput.schemaFile);
  if(!sources.has(caseInput.schemaFile))sources.set(caseInput.schemaFile,primary);
  if(!sources.has(caseInput.codeFile)) {
    const code=sourceReads.map(item=>item.toolName==='workspace.read_text'?item:undefined).find(item=>item
      &&plain(item.confirmed?.result)&&(item.confirmed.result as {path?:string}).path===caseInput.codeFile);
    if(!code)fail('F20 requires confirmed original reads for both configured sources');
    sources.set(caseInput.codeFile,confirmedSource(code as HostToolTaskReadback,caseInput.codeFile));
  }
  const schema=sources.get(caseInput.schemaFile)!,code=sources.get(caseInput.codeFile)!;
  const sourceDigest=digest({sourceVersion:caseInput.sourceVersion,schemaFile:caseInput.schemaFile,codeFile:caseInput.codeFile,
    schemaSha256:createHash('sha256').update(schema.content).digest('hex'),codeSha256:createHash('sha256').update(code.content).digest('hex')});
  if(trial.binding.inputDigest!==sourceDigest||trial.binding.configurationDigest!==sourceDigest)
    fail('F20 harness trial does not bind the current configured sources');
  const baseline=trial.checkReadback.snapshot;
  for(const [path,entry] of sources.entries()) {
    const file=baseline.files.find(item=>item.path===path);
    const sha256=createHash('sha256').update(entry.content).digest('hex');
    if(!file||file.sha256!==sha256)fail('F20 harness trial baseline drifted from current sources');
  }
  if(trial.session.mode!=='isolated'||trial.checkReadback.sessionId!==trial.session.sessionId
    ||harnessCandidateArtifactDigest(trial.checkReadback.snapshot)!==trial.binding.artifactDigest)
    fail('F20 harness trial artifact digest mismatch');
  const required=trial.checkReadback.verification.filter(item=>item.recipeId===caseInput.recipeId);
  if(!required.length||required.some(item=>item.status!=='VALID'||item.exitCode!==0||item.sessionId!==trial.session.sessionId
    ||item.inputSnapshotId!==trial.checkReadback.snapshot.snapshotId))
    fail('F20 harness trial did not verify the configured recipe');
  const boundTasks=new Set([...sources.values()].map(item=>item.taskId));
  const additionalSourceTaskIds=[...boundTasks].filter(taskId=>taskId!==read.task.taskId).sort();
  if(additionalSourceTaskIds.some(taskId=>!sourceReads.some(readback=>readback.task.taskId===taskId)))
    fail('F20 completion cannot introduce unbound source tasks');
  return {additionalSourceTaskIds};
}
