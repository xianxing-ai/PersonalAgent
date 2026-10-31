import {createHash} from 'node:crypto';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext} from '@personal-agent/contracts';
import type {GhProviderOptions} from './gh.js';
import {checkContext, withGitHubContext} from './service.js';
import {redactGitHubText} from './redact.js';
import {GITHUB_CONNECTOR_VERSION} from './connector.js';

const fail = (code:string, message:string):never => {throw new ProtocolError(code,message);};
const object = (properties:Record<string,unknown>) => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const sha = {type:'string',pattern:'^(?:[a-f0-9]{40}|[a-f0-9]{64})$'};
const integer = {type:'integer',minimum:1};
const repository = {type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$'};
const identity = {repo:repository,prNumber:integer,headSha:sha,baseSha:sha};
const record = (value:unknown):Record<string,any> => {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('EXTERNAL_FAILURE','Malformed GitHub object');
  return value as Record<string,any>;
};
const connection = (value:unknown):Record<string,any>[] => {
  const result=record(value);
  if(result.pageInfo?.hasNextPage!==false||!Array.isArray(result.nodes)||result.nodes.length>100)
    fail('UNSUPPORTED_CAPABILITY','Complete GitHub gate page unavailable');
  return result.nodes.map(record);
};
export interface GitHubF18F19Options extends GhProviderOptions {
  /** Trusted repository policy. Empty lists cannot authorize a merge. */
  requiredChecks:readonly string[];
  eligibleReviewers:readonly string[];
  /** Persist the original write attempt in the existing Runtime before dispatch. */
  beforeWrite:(operation:string,input:Record<string,unknown>,context:ToolContext)=>void;
}

const gateQuery=`query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner
  pullRequest(number:$number){number state isDraft headRefOid baseRefOid mergeable mergeStateStatus reviewDecision
  author{login __typename} baseRepository{nameWithOwner} headRepository{nameWithOwner}
  latestReviews(first:100){pageInfo{hasNextPage} nodes{state author{login __typename} commit{oid}}}
  reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved}}
  commits(last:1){nodes{commit{oid statusCheckRollup{state contexts(first:100){pageInfo{hasNextPage} nodes{
    __typename ... on CheckRun{name status conclusion checkSuite{commit{oid}}}
    ... on StatusContext{context state commit{oid}}}}}}}}
}}}`;

/** Explicit opt-in tools. Uses the existing restricted gh runner/token port;
 * no executor, credential store, authorization decision or retry loop is added. */
export function createGitHubF18F19Tools(options:GitHubF18F19Options):RegisteredTool[] {
  if(!options?.runner||typeof options.runner.run!=='function'||typeof options.readToken!=='function'
    ||!Array.isArray(options.repositories)||!options.repositories.length
    ||options.repositories.some(repo=>typeof repo!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(repo))
    ||!Array.isArray(options.requiredChecks)||!options.requiredChecks.length||!Array.isArray(options.eligibleReviewers)
    ||!options.eligibleReviewers.length||typeof options.beforeWrite!=='function'
    ||[...options.requiredChecks,...options.eligibleReviewers].some(v=>typeof v!=='string'||!v.trim()||v.length>256))
    fail('INVALID_ARGUMENT','Explicit GitHub workflow policy and original write recorder required');
  options=Object.freeze({...options,repositories:Object.freeze([...options.repositories]),
    requiredChecks:Object.freeze([...options.requiredChecks]),eligibleReviewers:Object.freeze([...options.eligibleReviewers])});
  const runner=options.runner;
  const run=async(operation:string,input:Record<string,any>,context:ToolContext):Promise<unknown>=>{
    checkContext(context);
    if(!options.repositories.includes(input.repo))fail('SCOPE_DENIED','GitHub repository unavailable');
    let token:string;
    try{token=await withGitHubContext(context,bounded=>options.readToken(bounded));}
    catch{ return fail('UNAUTHORIZED','GitHub credential unavailable'); }
    if(typeof token!=='string'||!token||token.length>4096||/[\r\n\x00]/u.test(token))fail('UNAUTHORIZED','GitHub credential unavailable');
    let dispatched=false;
    const request=async(endpoint:string,method='GET',payload?:unknown,raw=false)=>{
      checkContext(context);
      if(!options.repositories.includes(input.repo))fail('SCOPE_DENIED','GitHub repository revoked');
      const args=['api','--hostname','github.com','--method',method,endpoint,'-H','X-GitHub-Api-Version: 2022-11-28',
        '-H',raw?'Accept: application/vnd.github.diff':'Accept: application/vnd.github+json'];
      if(payload!==undefined)args.push('--input','-');
      const write=method!=='GET'&&endpoint!=='graphql';
      if(write){
        const value=options.beforeWrite(operation,structuredClone(input),context);
        if(value!==undefined){void Promise.resolve(value).catch(()=>{});fail('UNAUTHORIZED','Original write recorder must be synchronous');}
      }
      let response;
      try{response=await withGitHubContext(context,bounded=>{
        if(write)dispatched=true;
        return runner.run({args,token,context:bounded,maxBytes:1048576,...(payload===undefined?{}:{stdin:JSON.stringify(payload)})});
      });}catch{return fail(dispatched?'RESULT_UNKNOWN':'EXTERNAL_FAILURE','GitHub workflow request unconfirmed');}
      if(response.exitCode!==0||typeof response.stdout!=='string'||typeof response.stderr!=='string'
        ||Buffer.byteLength(response.stdout)+Buffer.byteLength(response.stderr)>1048576)
        fail(dispatched?'RESULT_UNKNOWN':'EXTERNAL_FAILURE','GitHub workflow response unavailable');
      if(raw)return redactGitHubText(response.stdout,[token]);
      try{return JSON.parse(response.stdout) as unknown;}catch{return fail(dispatched?'RESULT_UNKNOWN':'EXTERNAL_FAILURE','GitHub workflow response invalid');}
    };
    const root=`repos/${input.repo}`;
    const pull=async(allowMerged=false)=>{
      const value=record(await request(`${root}/pulls/${input.prNumber}`));
      if(value.number!==input.prNumber||value.base?.repo?.full_name!==input.repo||value.head?.repo?.full_name!==input.repo
        ||value.head?.sha!==input.headSha||value.base?.sha!==input.baseSha&&!(allowMerged&&value.merged===true))
        fail('REVISION_CONFLICT','Original GitHub PR repository or revision changed');
      return value;
    };
    const gate=async()=>{
      const [owner,name]=input.repo.split('/');
      const data=record(await request('graphql','POST',{query:gateQuery,variables:{owner,name,number:input.prNumber}}));
      if(data.errors!==undefined||data.data?.repository?.nameWithOwner!==input.repo)fail('EXTERNAL_FAILURE','GitHub merge gate unavailable');
      const pr=record(data.data.repository.pullRequest);
      if(pr.number!==input.prNumber||pr.headRefOid!==input.headSha||pr.baseRefOid!==input.baseSha
        ||pr.baseRepository?.nameWithOwner!==input.repo||pr.headRepository?.nameWithOwner!==input.repo)
        fail('REVISION_CONFLICT','GitHub merge gate revision changed');
      const reviews=connection(pr.latestReviews),threads=connection(pr.reviewThreads);
      const commit=pr.commits?.nodes?.length===1?pr.commits.nodes[0]?.commit:undefined;
      if(commit?.oid!==input.headSha||!commit.statusCheckRollup)fail('UNSUPPORTED_CAPABILITY','Current commit technical CI unavailable');
      const checks=connection(commit.statusCheckRollup.contexts);
      const successful=(check:Record<string,any>)=>check.__typename==='CheckRun'
        ?check.checkSuite?.commit?.oid===input.headSha&&check.status==='COMPLETED'&&check.conclusion==='SUCCESS'
        :check.__typename==='StatusContext'&&check.commit?.oid===input.headSha&&check.state==='SUCCESS';
      const approved=reviews.some(review=>review.state==='APPROVED'&&review.author?.__typename==='User'
        &&review.author.login!==pr.author?.login&&options.eligibleReviewers.includes(review.author.login)&&review.commit?.oid===input.headSha);
      const passed=pr.state==='OPEN'&&pr.isDraft===false&&pr.mergeable==='MERGEABLE'&&pr.mergeStateStatus==='CLEAN'
        &&typeof pr.author?.login==='string'&&pr.author.login.length>0
        &&pr.reviewDecision==='APPROVED'&&approved&&!reviews.some(review=>review.state==='CHANGES_REQUESTED')
        &&threads.every(thread=>thread.isResolved===true)&&commit.statusCheckRollup.state==='SUCCESS'&&checks.length>0
        &&checks.every(successful)&&options.requiredChecks.length>0&&options.requiredChecks.every(name=>checks.some(check=>(check.name??check.context)===name&&successful(check)));
      return {headSha:input.headSha,mergeRequirementsSatisfied:passed};
    };
    try{
      if(operation==='bound_pr_diff'){
        const before=await pull();
        if(before.state!=='open'||before.merged!==false)fail('REVISION_CONFLICT','Original PR is no longer open');
        const diff=await request(`${root}/pulls/${input.prNumber}`,'GET',undefined,true);
        if(typeof diff!=='string'||diff.length>65536)fail('UNSUPPORTED_CAPABILITY','Complete PR diff exceeds workflow limit');
        const after=await pull();
        for(const key of ['changed_files','additions','deletions'])
          if(!Number.isSafeInteger(after[key])||after[key]<0||after[key]!==before[key])fail('REVISION_CONFLICT','PR diff metadata changed');
        return {headSha:input.headSha,filesChanged:after.changed_files,additions:after.additions,deletions:after.deletions,diff,
          diffDigest:createHash('sha256').update(diff as string).digest('hex')};
      }
      if(operation==='current_head_merge_gate')return gate();
      if(operation==='registered_merge'){
        if(!(await gate()).mergeRequirementsSatisfied)fail('UNAUTHORIZED','Current non-author approval, technical CI and merge requirements are not satisfied');
        await pull();
        const merged=record(await request(`${root}/pulls/${input.prNumber}/merge`,'PUT',{sha:input.headSha,merge_method:input.mergeMethod}));
        if(merged.merged!==true||typeof merged.sha!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(merged.sha))
          fail('RESULT_UNKNOWN','Original merge outcome unconfirmed');
        const current=await pull(true);
        if(current.merged!==true||current.state!=='closed'||current.merge_commit_sha!==merged.sha)
          fail('RESULT_UNKNOWN','Original merge readback unconfirmed');
        return {mergedSha:merged.sha,prClosed:true};
      }
      if(operation==='merged_pr_readback'){
        const pr=await pull(true);
        return {headSha:input.headSha,merged:pr.merged===true&&pr.state==='closed',
          mergedSha:pr.merged===true&&typeof pr.merge_commit_sha==='string'?pr.merge_commit_sha:null};
      }
      if(operation==='issue_snapshot'){
        const issue=record(await request(`${root}/issues/${input.issueId}`));
        if(issue.number!==input.issueId||issue.pull_request||issue.html_url!==`https://github.com/${input.repo}/issues/${input.issueId}`
          ||issue.updated_at!==input.expectedUpdatedAt||issue.state!=='open')fail('REVISION_CONFLICT','Original Issue identity or version changed');
        if(typeof issue.title!=='string'||typeof issue.body!=='string'&&issue.body!==null)fail('EXTERNAL_FAILURE','Issue content unavailable');
        const title=redactGitHubText(issue.title,[token]),body=redactGitHubText(issue.body??'',[token]);
        if(title.length>1024||body.length>32768)fail('UNSUPPORTED_CAPABILITY','Issue content exceeds workflow limit');
        return {count:1,issueId:input.issueId,updatedAt:issue.updated_at,title,body};
      }
      if(operation==='issue_close_readback'){
        const issue=record(await request(`${root}/issues/${input.issueId}`));
        if(issue.number!==input.issueId||issue.pull_request||issue.html_url!==`https://github.com/${input.repo}/issues/${input.issueId}`)
          fail('REVISION_CONFLICT','Original Issue identity changed');
        return {issueId:input.issueId,closed:issue.state==='closed',updatedAt:issue.updated_at};
      }
      return fail('UNSUPPORTED_CAPABILITY','GitHub workflow operation unavailable');
    }catch(error){
      if(dispatched)fail('RESULT_UNKNOWN','Original GitHub write requires read-only reconciliation');
      if(error instanceof ProtocolError)throw error;
      return fail('EXTERNAL_FAILURE','GitHub workflow operation failed');
    }
  };
  const specifications=[
    ['bound_pr_diff',object(identity),object({headSha:sha,filesChanged:{type:'integer',minimum:0},additions:{type:'integer',minimum:0},
      deletions:{type:'integer',minimum:0},diff:{type:'string',maxLength:65536},diffDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}})],
    ['current_head_merge_gate',object(identity),object({headSha:sha,mergeRequirementsSatisfied:{type:'boolean'}})],
    ['registered_merge',object({...identity,mergeMethod:{enum:['merge','squash','rebase']}}),object({mergedSha:sha,prClosed:{const:true}})],
    ['merged_pr_readback',object(identity),object({headSha:sha,merged:{type:'boolean'},mergedSha:{anyOf:[sha,{type:'null'}]}})],
    ['issue_snapshot',object({repo:repository,issueId:integer,expectedUpdatedAt:{type:'string',format:'date-time'}}),
      object({count:{const:1},issueId:integer,updatedAt:{type:'string',format:'date-time'},title:{type:'string',maxLength:1024},body:{type:'string',maxLength:32768}})],
    ['issue_close_readback',object({repo:repository,issueId:integer}),object({issueId:integer,closed:{type:'boolean'},updatedAt:{type:'string',format:'date-time'}})],
  ] as const;
  return specifications.map(([operation,inputSchema,outputSchema])=>{
    const write=operation==='registered_merge',scope=write?'github:write':'github:read';
    return {descriptor:{name:'github.'+operation,version:GITHUB_CONNECTOR_VERSION,inputSchema,outputSchema,
      sideEffect:write?'external_write':'read',requiredScopes:[scope],idempotencySupport:!write,recoverySupport:!write,requiresPresence:write},
    execute:async(input,context)=>{
      if(!context?.authorizationRef||!context.scopes.includes(scope))fail('SCOPE_DENIED','Original GitHub workflow authorization required');
      validateToolValue(inputSchema,input);const result=await run(operation,structuredClone(input) as Record<string,unknown>,context);
      try{validateToolValue(outputSchema,result);}catch{fail(write?'RESULT_UNKNOWN':'EXTERNAL_FAILURE','GitHub workflow result invalid');}
      return result;
    }};
  });
}
