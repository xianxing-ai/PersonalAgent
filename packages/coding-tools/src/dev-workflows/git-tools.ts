import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpathSync, lstatSync} from 'node:fs';
import {lstat, readFile, mkdtemp, rm, open, rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, isAbsolute, dirname, basename} from 'node:path';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolDescriptor, ToolHost} from '@personal-agent/contracts';
import type {GitToolsOptions, GitCommitInput, GitPushInput, GitFileHash} from './git-tools-types.js';
export type * from './git-tools-types.js';

export const GIT_HEAD_TOOL = 'workspace.git.head';
export const GIT_COMMIT_TOOL = 'workspace.git.commit';
export const GIT_PUSH_TOOL = 'workspace.git.push';
export const GIT_READ_SCOPE = 'workspace:git:read';
export const GIT_COMMIT_SCOPE = 'workspace:git:commit';
export const GIT_PUSH_SCOPE = 'workspace:git:push';
const shaPattern = '^[0-9a-f]{40,64}$';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message: string): never => {throw new ProtocolError('SCOPE_DENIED', message);};
const sameCanonicalPath = (a: string, b: string): boolean => {
  const left=resolve(a); const right=resolve(b);
  return process.platform==='win32' ? left.toLowerCase()===right.toLowerCase() : left===right;
};

/** Host evidence reader: no authorization is minted and no write is performed. */
export async function readGitWorkspaceFingerprint(rootPath: string, allowedPaths: readonly string[]): Promise<{files: GitFileHash[]; fingerprint: string}> {
  const root = realpathSync.native(rootPath);
  const files: GitFileHash[] = [];
  for(const p of [...allowedPaths].sort()) {
    if(!p || isAbsolute(p) || p.includes('\\') || p.split('/').some(s=>!s || s==='..' || s==='.' || s==='.git')) fail('Invalid evidence path');
    const candidate=resolve(root,p); const s=await lstat(candidate);
    if(!s.isFile() || s.isSymbolicLink() || s.size>4*1024*1024 || !sameCanonicalPath(realpathSync.native(candidate),candidate)) fail('Evidence requires bounded canonical files');
    files.push({path:p,sha256:createHash('sha256').update(await readFile(candidate)).digest('hex')});
  }
  return {files,fingerprint:digest(files)};
}

export function createGitTools(options: GitToolsOptions): {head: RegisteredTool; commit: RegisteredTool; push: RegisteredTool} {
  const root = realpathSync.native(options.rootPath);
  const rootIdentity = lstatSync(root, {bigint: true});
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) fail('Git root must be a canonical directory');
  const rootBindingCurrent = (): boolean => {
    try {
      const current = lstatSync(root, {bigint: true});
      return current.isDirectory() && !current.isSymbolicLink() && current.dev === rootIdentity.dev
        && current.ino === rootIdentity.ino && sameCanonicalPath(realpathSync.native(root), root);
    } catch {return false;}
  };
  const checkRoot = (): void => {if (!rootBindingCurrent()) fail('Git root binding changed; trusted host must register the workspace again');};
  checkRoot();
  const now = options.now ?? Date.now;
  const paths = [...options.allowedPaths].sort();
  const validPath = (p: string) => p.length > 0 && p.length < 1024 && !p.startsWith('-') && !p.includes('\\') && !/[\x00-\x1f]/u.test(p) && !isAbsolute(p) && p.split('/').every(s => s !== '.' && s !== '..' && s !== '' && s !== '.git');
  if (!paths.length || paths.length > 128 || new Set(paths).size !== paths.length || paths.some(p => !validPath(p))) fail('Invalid host Git path allowlist');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(options.sourceBranch) || options.sourceBranch.includes('..') || options.sourceBranch.endsWith('/') || options.sourceBranch.endsWith('.lock')) fail('Invalid host Git branch');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(options.remoteName)) fail('Invalid host Git remote');
  const url = new URL(options.remoteUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('Host Git remote must be credential-free HTTPS');
  if (!options.authorName || !options.authorEmail || /[\r\n\x00<>]/u.test(options.authorName + options.authorEmail)) fail('Invalid host Git author');
  const check = (c: ToolContext, scope: string) => {
    if (!c.authorizationRef || !c.scopes.includes(scope)) fail('Git authorization scope is required');
    if (c.signal.aborted) throw new ProtocolError('CANCELLED', 'Git operation cancelled; reconcile any started write before retry');
    if (!Number.isFinite(Date.parse(c.deadline)) || Date.parse(c.deadline) <= now()) throw new ProtocolError('TIMEOUT', 'Git deadline expired; reconcile any started write before retry');
    checkRoot();
  };
  // Host evidence/secret reads happen before the commit ref or remote push.
  // Bound these public ports even when an injected host ignores its signal;
  // ending our wait does not prove the host operation itself has stopped.
  const hostRead = async <T>(c: ToolContext, scope: string, work: (bounded: ToolContext) => Promise<T>): Promise<T> => {
    check(c,scope);
    const controller=new AbortController();
    const deadline=Date.parse(c.deadline);
    let timedOut=false, timer: ReturnType<typeof setTimeout> | undefined;
    let interrupt=()=>{};
    const abort=()=>controller.abort();
    const interruptedError=()=>new ProtocolError(timedOut?'TIMEOUT':'CANCELLED',timedOut?'Git host read deadline expired':'Git host read cancelled');
    const expire=():void=>{
      const remaining=deadline-now();
      if(remaining<=0) {timedOut=true;controller.abort();}
      else timer=setTimeout(expire,Math.min(remaining,2_147_483_647));
    };
    try {
      const interrupted=new Promise<never>((_resolve,reject)=>{
        interrupt=()=>reject(interruptedError());
        controller.signal.addEventListener('abort',interrupt,{once:true});
        c.signal.addEventListener('abort',abort,{once:true});
        if(c.signal.aborted) abort();
        expire();
      });
      const operation=Promise.resolve().then(()=>{
        check(c,scope);
        if(controller.signal.aborted) throw interruptedError();
        return work({...c,signal:controller.signal});
      });
      const result=await Promise.race([interrupted,operation]);
      // A synchronous callback can settle while aborting or exhausting the lease.
      if(now()>=deadline) {timedOut=true;controller.abort();}
      check(c,scope);
      if(controller.signal.aborted) throw interruptedError();
      return result;
    } finally {
      clearTimeout(timer);
      c.signal.removeEventListener('abort',abort);
      controller.signal.removeEventListener('abort',interrupt);
    }
  };
  const git = async (args: string[], c: ToolContext, scope: string, extra: Record<string,string> = {}, input?: string | Buffer): Promise<string> => {
    check(c, scope);
    return new Promise((done, reject) => {
      // Do not inherit Git injection variables or credential-bearing environment.
      const env: NodeJS.ProcessEnv = {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME,
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...extra};
      const child = spawn('git', ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','credential.interactive=false','-c','credential.helper=',...args], {cwd: root, env, shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe']});
      const output: Buffer[] = []; let size = 0; let interrupted = false;
      const stop = () => {interrupted = true; child.kill('SIGKILL');};
      const timer = setTimeout(stop, Math.min(60_000, Date.parse(c.deadline) - now()));
      c.signal.addEventListener('abort', stop, {once:true});
      child.stdout.on('data', (b: Buffer) => {size += b.length; if(size > 1024*1024) stop(); else output.push(Buffer.from(b));});
      // Drain stderr without returning possible remote credentials or private paths.
      child.stderr.on('data', () => {});
      child.on('error', () => {clearTimeout(timer); c.signal.removeEventListener('abort',stop); reject(new ProtocolError('EXTERNAL_FAILURE','Git process unavailable'));});
      child.on('close', code => {
        clearTimeout(timer); c.signal.removeEventListener('abort',stop);
        if (interrupted) reject(new ProtocolError('RESULT_UNKNOWN','Git result unknown; reconcile before retry'));
        else if(code !== 0) reject(new ProtocolError(args[0]==='push' || args[0]==='update-ref' ? 'RESULT_UNKNOWN':'EXTERNAL_FAILURE','Git rejected the bounded operation; reconcile any started write before retry'));
        else if (!rootBindingCurrent()) reject(new ProtocolError(args[0]==='push' || args[0]==='update-ref' ? 'RESULT_UNKNOWN':'SCOPE_DENIED',
          'Git root binding changed; reconcile any started write before retry'));
        else {
          // Pipe chunks can split a filename's UTF-8 code point. Decode complete
          // bounded bytes once; never guess a path from replacement characters.
          try {done(new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(Buffer.concat(output)));}
          catch {reject(new ProtocolError(args[0]==='push' || args[0]==='update-ref' ? 'RESULT_UNKNOWN':'EXTERNAL_FAILURE',
            'Git output encoding invalid; reconcile any started write before retry'));}
        }
      });
      child.stdin.end(input);
    });
  };
  const snapshot = async (): Promise<GitFileHash[]> => {
    checkRoot();
    const files: GitFileHash[] = [];
    for (const p of paths) {
      const candidate = resolve(root,p);
      const rel = relative(root,candidate);
      if (rel.startsWith('..') || isAbsolute(rel)) fail('Git path escapes root');
      const s = await lstat(candidate);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 4*1024*1024 || !sameCanonicalPath(realpathSync.native(candidate),candidate)) fail('Git allows bounded canonical regular files only');
      files.push({path:p,sha256:createHash('sha256').update(await readFile(candidate)).digest('hex')});
      checkRoot();
    }
    return files;
  };
  const state = async (c: ToolContext, scope: string) => {
    const reportedRoot=(await git(['rev-parse','--show-toplevel'],c,scope)).replace(/\r?\n$/u,'');
    if (!sameCanonicalPath(realpathSync.native(reportedRoot),root)) fail('Git root binding changed');
    if ((await git(['symbolic-ref','--short','HEAD'],c,scope)).trim() !== options.sourceBranch) fail('Git branch binding changed');
    if ((await git(['remote','get-url',options.remoteName],c,scope)).trim() !== options.remoteUrl) fail('Git remote binding changed');
    const headSha = (await git(['rev-parse','HEAD'],c,scope)).trim();
    const status = await git(['status','--porcelain=v1','-z','--untracked-files=all'],c,scope);
    const clean = status.split('\0').filter(Boolean).every(line => line[0] === ' ' && paths.includes(line.slice(3)));
    const files = await snapshot();
    check(c,scope);
    return {headSha,clean,workspaceClean:status.length===0,files,fingerprint:digest(files)};
  };
  const properties = {repository:{type:'string',enum:[options.repository]}};
  const descriptor = (name: string, scope: string, props: Record<string,unknown>, output: Record<string,unknown>): ToolDescriptor => ({name,version:'1.0.0', inputSchema:{type:'object',additionalProperties:false,required:Object.keys(props),properties:props},outputSchema:output,sideEffect:name === GIT_HEAD_TOOL ? 'read' : name === GIT_PUSH_TOOL ? 'external_write':'local_write',requiredScopes:[scope],requiresPresence:name !== GIT_HEAD_TOOL,idempotencySupport:false,recoverySupport:false});
  const resultSchema = (props: Record<string,unknown>) => ({type:'object',additionalProperties:false,required:Object.keys(props),properties:props});
  const sha = {type:'string',pattern:shaPattern};
  const hd = descriptor(GIT_HEAD_TOOL,GIT_READ_SCOPE,properties,resultSchema({headSha:sha,clean:{type:'boolean'},workspaceClean:{type:'boolean'},fingerprint:{type:'string'}}));
  const cd = descriptor(GIT_COMMIT_TOOL,GIT_COMMIT_SCOPE,{...properties,expectedHeadSha:sha,paths:{type:'array',minItems:1,maxItems:128,uniqueItems:true,items:{type:'string',enum:paths}},message:{type:'string',minLength:1,maxLength:1000},verificationRunId:{type:'string',minLength:1,maxLength:512}},resultSchema({headSha:sha,parentSha:sha,branch:{type:'string'}}));
  const pd = descriptor(GIT_PUSH_TOOL,GIT_PUSH_SCOPE,{...properties,expectedHeadSha:sha},resultSchema({headSha:sha,pushed:{const:true}}));
  let busy = false;
  const exclusive = async <T>(work:()=>Promise<T>):Promise<T> => {if(busy) fail('Git repository operation already active'); busy=true; try{return await work();} finally{busy=false;}};
  return {
    head:{descriptor:hd,execute:async(input,c)=>{validateToolValue(hd.inputSchema,input); return exclusive(async()=>{const s=await state(c,GIT_READ_SCOPE); return {headSha:s.headSha,clean:s.clean,workspaceClean:s.workspaceClean,fingerprint:s.fingerprint};});}},
    commit:{descriptor:cd,execute:async(input,c)=>{validateToolValue(cd.inputSchema,input); const q=input as GitCommitInput; return exclusive(async()=>{
      const s=await state(c,GIT_COMMIT_SCOPE);
      if(!s.clean || s.headSha!==q.expectedHeadSha) fail('Git baseline or unrelated workspace changes conflict');
      const rawIndexPath=(await git(['rev-parse','--git-path','index'],c,GIT_COMMIT_SCOPE)).trim();
      const requestedIndexPath=resolve(root,rawIndexPath);
      const indexPath=join(realpathSync.native(dirname(requestedIndexPath)),basename(requestedIndexPath));
      check(c,GIT_COMMIT_SCOPE);
      const indexStat=await lstat(indexPath);
      if(!indexStat.isFile() || indexStat.isSymbolicLink()) fail('Git index must be a canonical regular file');
      const originalIndex=await readFile(indexPath);
      const originalIndexHash=createHash('sha256').update(originalIndex).digest('hex');
      const receipt=await hostRead(c,GIT_COMMIT_SCOPE,bounded=>options.readVerification(bounded,q.verificationRunId));
      if(!receipt || receipt.taskId!==c.taskId || receipt.runId!==q.verificationRunId || receipt.toolName!=='workspace.run_allowed_command' || receipt.status!=='confirmed' || receipt.exitCode!==0 || receipt.headSha!==s.headSha || digest([...receipt.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0))!==s.fingerprint) fail('Trusted successful command receipt does not match current files');
      const temp=await mkdtemp(join(tmpdir(),'personal-agent-git-'));
      try {
        const env={GIT_INDEX_FILE:join(temp,'index'),GIT_AUTHOR_NAME:options.authorName,GIT_AUTHOR_EMAIL:options.authorEmail,GIT_COMMITTER_NAME:options.authorName,GIT_COMMITTER_EMAIL:options.authorEmail};
        await git(['read-tree',s.headSha],c,GIT_COMMIT_SCOPE,env);
        // Stage exact verified bytes with hash-object, bypassing arbitrary clean filters.
        for(const p of q.paths){const bytes=await readFile(resolve(root,p)); const hash=createHash('sha256').update(bytes).digest('hex'); if(s.files.find(f=>f.path===p)?.sha256!==hash) fail('Verified file changed');
          const blob=(await git(['hash-object','-w','--stdin'],c,GIT_COMMIT_SCOPE,env,bytes)).trim();
          const tracked=await git(['ls-tree',s.headSha,'--',p],c,GIT_COMMIT_SCOPE,env);
          const mode=tracked.startsWith('100755 ') ? '100755':'100644';
          await git(['update-index','--add','--cacheinfo',mode,blob,p],c,GIT_COMMIT_SCOPE,env);
        }
        const tree=(await git(['write-tree'],c,GIT_COMMIT_SCOPE,env)).trim();
        if(tree===(await git(['rev-parse',`${s.headSha}^{tree}`],c,GIT_COMMIT_SCOPE)).trim()) fail('No verified changes to commit');
        const next=(await git(['commit-tree',tree,'-p',s.headSha],c,GIT_COMMIT_SCOPE,env,q.message+'\n')).trim();
        // Git's exclusive index.lock makes the comparison and replacement one
        // transaction with respect to other cooperating Git index writers.
        const lockPath=indexPath+'.lock';
        check(c,GIT_COMMIT_SCOPE);
        const lock=await open(lockPath,'wx',indexStat.mode & 0o777);
        let ownsLock=true; let refAttempted=false;
        try {
          const currentIndexStat=await lstat(indexPath);
          if(!currentIndexStat.isFile() || currentIndexStat.isSymbolicLink()
            || createHash('sha256').update(await readFile(indexPath)).digest('hex')!==originalIndexHash) fail('User Git index changed before commit');
          const current=await state(c,GIT_COMMIT_SCOPE);
          if(!current.clean || current.headSha!==s.headSha || current.fingerprint!==s.fingerprint) fail('Git workspace changed before commit');
          check(c,GIT_COMMIT_SCOPE);
          await lock.writeFile(await readFile(env.GIT_INDEX_FILE));
          await lock.sync();
          await lock.close();
          check(c,GIT_COMMIT_SCOPE);
          refAttempted=true;
          await git(['update-ref',`refs/heads/${options.sourceBranch}`,next,s.headSha],c,GIT_COMMIT_SCOPE);
          // Complete local index installation even if cancellation arrives after
          // ref CAS: leaving an old index would invent reverse staged changes.
          checkRoot();
          await rename(lockPath,indexPath);
          ownsLock=false;
        } catch(error) {
          if(refAttempted) throw new ProtocolError('RESULT_UNKNOWN','Commit ref/index outcome unknown; read back HEAD and index before retry');
          throw error;
        } finally {
          await lock.close().catch(()=>{});
          // A replaced pathname can now refer to somebody else's index.lock.
          // Leave our original lock for explicit host recovery rather than delete that file.
          if(ownsLock && rootBindingCurrent()) await rm(lockPath,{force:true});
        }
        return {headSha:next,parentSha:s.headSha,branch:options.sourceBranch};
      } finally {await rm(temp,{recursive:true,force:true});}
    });}},
    push:{descriptor:pd,execute:async(input,c)=>{validateToolValue(pd.inputSchema,input); const q=input as GitPushInput; return exclusive(async()=>{
      const s=await state(c,GIT_PUSH_SCOPE); if(s.headSha!==q.expectedHeadSha) fail('Git push HEAD changed');
      check(c,GIT_PUSH_SCOPE);
      const credentials=await hostRead(c,GIT_PUSH_SCOPE,bounded=>options.getCredentials?.(bounded) ?? Promise.resolve(undefined));
      check(c,GIT_PUSH_SCOPE);
      if(!credentials?.token || credentials.token.length>16384 || /[\x00-\x20\x7f]/u.test(credentials.token)) throw new ProtocolError('UNAUTHORIZED','Trusted Git push credentials are unavailable');
      // Exact host URL only. Secret lives in this child's environment, never
      // argv, model arguments, returned diagnostics, or process-global config.
      const authEnv={GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:`http.${options.remoteUrl}.extraheader`,GIT_CONFIG_VALUE_0:`Authorization: Basic ${Buffer.from('x-access-token:'+credentials.token).toString('base64')}`,GIT_CONFIG_KEY_1:`http.${options.remoteUrl}.followRedirects`,GIT_CONFIG_VALUE_1:'false'};
      const ref=`refs/heads/${options.sourceBranch}`;
      const remote=(await git(['ls-remote','--heads',options.remoteUrl,ref],c,GIT_PUSH_SCOPE,authEnv)).trim().split(/\s/u)[0] ?? '';
      if(remote && !/^[0-9a-f]{40,64}$/u.test(remote)) fail('Invalid remote branch state');
      if(remote) await git(['merge-base','--is-ancestor',remote,s.headSha],c,GIT_PUSH_SCOPE);
      // Lease closes the remote read/write race; ancestry above forbids overwriting divergent history.
      await git(['push','--porcelain',`--force-with-lease=${ref}:${remote}`,options.remoteUrl,`${s.headSha}:${ref}`],c,GIT_PUSH_SCOPE,authEnv);
      return {headSha:s.headSha,pushed:true};
    });}},
  };
}
export function registerGitTools(host:ToolHost,options:GitToolsOptions):()=>void {
  const tools=createGitTools(options); const disposers:Array<()=>void>=[];
  try {
    for(const tool of Object.values(tools)) disposers.push(host.register(tool));
  } catch(error) {
    for(const dispose of disposers.reverse()) {try {dispose();} catch { /* Continue rollback of all acquired registrations. */ }}
    throw error;
  }
  return ()=>{for(const dispose of [...disposers].reverse()) dispose();};
}
