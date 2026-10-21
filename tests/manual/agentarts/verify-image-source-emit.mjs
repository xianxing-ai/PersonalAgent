// One isolated, sequential candidate compile. No install, Docker or product run.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,cp,lstat,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeTarName,validateRecoveryOutput} from './recover-existing-image-inputs.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const packages=['contracts','models','coordination','agentarts'];
const git=(repo,args)=>execFileSync('git',args,{cwd:repo,maxBuffer:16*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']});
async function put(directory,filename,bytes){safeTarName(filename);const target=path.join(directory,...filename.split('/'));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
async function declarationsOnly(source){const info=await lstat(source);return info.isDirectory()||info.isFile()&&/(?:\.d\.(?:ts|mts|cts)|package\.json)$/.test(source);}
async function listFiles(directory,prefix=''){
  const files=[];for(const entry of await readdir(directory,{withFileTypes:true})){const relative=prefix?prefix+'/'+entry.name:entry.name,target=path.join(directory,entry.name);
    if(entry.isDirectory())files.push(...await listFiles(target,relative));else if(entry.isFile())files.push(relative);else throw Error('Unexpected candidate output link');}return files;
}
export async function verifyEmit({repo=root,revision,recoveryReceipt,dependencyRoot,devDependencies,output}){
  if(!/^[a-f0-9]{40}$/.test(revision??''))throw Error('An immutable Git candidate is required');
  const destination=await validateRecoveryOutput(output),startFreeBytes=os.freemem(),startedAt=new Date().toISOString();await mkdir(destination);
  const recovered=JSON.parse(await readFile(recoveryReceipt,'utf8'));
  if(recovered.kind!=='immutable_image_copied_input_recovery')throw Error('Unexpected immutable recovery receipt');
  const sourceLockBytes=git(repo,['show',revision+':package-lock.json']),sourceLock=JSON.parse(sourceLockBytes);
  const compilerPath=path.join(dependencyRoot,'typescript','lib','typescript.js'),compilerBytes=await readFile(compilerPath);
  const ts=createRequire(import.meta.url)(compilerPath);
  if(ts.version!==sourceLock.packages['node_modules/typescript']?.version)throw Error('Compiler does not match candidate lock');
  const selectedPaths=git(repo,['ls-tree','-r','--name-only',revision,'--','tsconfig.base.json','package.json','package-lock.json',
    'packages/contracts/schema',...packages.flatMap(name=>['packages/'+name+'/src','packages/'+name+'/package.json','packages/'+name+'/tsconfig.json'])]).toString().trim().split(/\r?\n/).filter(Boolean);
  const sources=[];
  for(const filename of selectedPaths){safeTarName(filename);const bytes=git(repo,['show',revision+':'+filename]);await put(destination,filename,bytes);
    sources.push({path:filename,gitBlob:git(repo,['rev-parse',revision+':'+filename]).toString().trim(),sha256:hash(bytes),bytes:bytes.length});}
  // These are existing immutable-image dependencies, read as type declarations.
  // Only declaration/package files are copied; no npm hooks or package JS runs.
  const nodeModules=path.join(destination,'node_modules');await cp(dependencyRoot,nodeModules,{recursive:true,filter:declarationsOnly});
  const dependencyEvidence=[];
  for(const item of devDependencies??[]){
    safeTarName(item.location);if(!/^(?:node_modules|packages\/(?:contracts|models|coordination|agentarts)\/node_modules)\/(?:@types\/[^/]+|undici-types)$/.test(item.location))throw Error('Unexpected development type dependency');
    const manifest=JSON.parse(await readFile(path.join(item.source,'package.json'),'utf8')),locked=sourceLock.packages[item.location];
    if(!locked||locked.version!==manifest.version)throw Error('Existing development type package does not match candidate lock');
    await cp(item.source,path.join(destination,...item.location.split('/')),{recursive:true,filter:declarationsOnly});
    const files=[];for(const filename of await listFiles(item.source)){if(!/(?:\.d\.(?:ts|mts|cts)|package\.json)$/.test(filename))continue;
      files.push({path:filename,sha256:hash(await readFile(path.join(item.source,...filename.split('/'))))});}
    dependencyEvidence.push({location:item.location,name:manifest.name,version:manifest.version,lockIntegrity:locked.integrity,
      declarationFiles:files.sort((a,b)=>a.path.localeCompare(b.path))});
  }
  const programs=[],emitted=[];
  for(const name of packages){
    const workspace='packages/'+name,filename=path.join(destination,workspace,'tsconfig.json'),configuration=ts.readConfigFile(filename,ts.sys.readFile);
    if(configuration.error)throw Error('Candidate TypeScript configuration unreadable');
    const parsed=ts.parseJsonConfigFileContent(configuration.config,ts.sys,path.dirname(filename),undefined,filename);
    const compilerHost=ts.createCompilerHost(parsed.options);compilerHost.getCurrentDirectory=()=>path.dirname(filename);
    const program=ts.createProgram(parsed.fileNames,parsed.options,compilerHost),diagnostics=[...parsed.errors,...ts.getPreEmitDiagnostics(program)],emit=program.emit();
    const errors=[...diagnostics,...emit.diagnostics].filter(value=>value.category===ts.DiagnosticCategory.Error);
    programs.push({workspace,sourceFiles:parsed.fileNames.map(value=>path.relative(destination,value).replaceAll('\\','/')).sort(),
      originalConfiguration:configuration.config,baseConfigurationSha256:hash(await readFile(path.join(destination,'tsconfig.base.json'))),
      errorCodes:[...new Set(errors.map(value=>value.code))],emitSkipped:emit.emitSkipped});
    if(errors.length||emit.emitSkipped)throw Error('Candidate emit failed in '+workspace+' (codes '+programs.at(-1).errorCodes.join(',')+')');
    const dist=path.join(destination,workspace,'dist'),expected=recovered.files.filter(file=>file.path.startsWith(workspace+'/dist/')&&/\.(?:js|d\.ts)$/.test(file.path));
    const produced=(await listFiles(dist)).filter(value=>/\.(?:js|d\.ts)$/.test(value));
    if(expected.length!==produced.length)throw Error('Candidate emitted file set differs from immutable image');
    for(const file of expected){const bytes=await readFile(path.join(destination,...file.path.split('/'))),sha=hash(bytes),lfSha=hash(bytes.toString('utf8').replaceAll('\r\n','\n'));
      emitted.push({path:file.path,bytes:bytes.length,sha256:sha,imageSha256:file.sha256,exactBytes:sha===file.sha256,lfEqual:lfSha===file.lfSha256,
        sourcePath:file.path.replace('/dist/','/src/').replace(/\.d\.ts$/,'.ts').replace(/\.js$/,'.ts')});}
    // Later workspaces consume this candidate's freshly emitted public package,
    // rather than relying on an unrelated checkout's stale dist.
    await cp(dist,path.join(nodeModules,'@personal-agent',name,'dist'),{recursive:true});
  }
  const receipt={kind:'candidate_source_emit_comparison',version:1,revision,image:recovered.image,recoveredTreeSha256:recovered.recoveredTreeSha256,
    startedAt,finishedAt:new Date().toISOString(),startFreeBytes,endFreeBytes:os.freemem(),node:process.version,platform:process.platform,
    compiler:{package:'typescript',version:ts.version,sha256:hash(compilerBytes),candidateLockSha256:hash(sourceLockBytes),nodeFlags:process.execArgv},
    dependencyMode:'Existing immutable-image declaration packages plus lock-matched existing development types; no install or hooks',
    sources,developmentTypes:dependencyEvidence,programs,emitted,summary:{files:emitted.length,exactBytes:emitted.filter(value=>value.exactBytes).length,
      lfOnly:emitted.filter(value=>!value.exactBytes&&value.lfEqual).length,different:emitted.filter(value=>!value.lfEqual).length},
    uniqueHistoricalGitSourceEstablished:false,claim:'Compiler equivalence of this committed candidate, not proof that compilation uniquely identifies the historical input.'};
  await writeFile(path.join(destination,'emit-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('Emit configuration too large');}
    const result=await verifyEmit(JSON.parse(input));console.log(JSON.stringify({kind:result.kind,revision:result.revision,summary:result.summary,compiler:result.compiler,uniqueHistoricalGitSourceEstablished:false}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
