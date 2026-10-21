// Read committed Git objects and recovered immutable inputs; never compile here.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeTarName,validateRecoveryOutput} from './recover-existing-image-inputs.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const lf=value=>Buffer.from(value.toString('utf8').replaceAll('\r\n','\n'));
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const workspaces=['packages/contracts','packages/coordination','packages/models','packages/agentarts','apps/agentarts-runtime'];
function git(repo,args){return execFileSync('git',args,{cwd:repo,maxBuffer:16*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']});}
function committed(repo,revision,filename){
  const bytes=git(repo,['show',revision+':'+filename]);
  return{path:filename,gitBlob:git(repo,['rev-parse',revision+':'+filename]).toString().trim(),
    sha256:hash(bytes),lfSha256:hash(lf(bytes)),bytes:bytes.length,content:bytes};
}
function strippedManifest(value){const result=structuredClone(value);delete result.devDependencies;delete result.scripts;return result;}
function derivedLock(full,manifests,registry){
  const lock=structuredClone(full),selected=new Set(['',...workspaces]),queue=[...workspaces];
  for(const [workspace,manifest]of manifests){const link='node_modules/'+manifest.name;
    if(!full.packages[link]?.link||full.packages[link].resolved!==workspace)throw Error('Candidate workspace lock link mismatch');
    selected.add(link);delete lock.packages[workspace].devDependencies;}
  function resolve(name,from){let directory=from;while(true){const candidate=path.posix.join(directory,'node_modules',name);if(full.packages[candidate])return candidate;if(!directory)return;directory=path.posix.dirname(directory);if(directory==='.')directory='';}}
  for(let index=0;index<queue.length;index++){const location=queue[index],entry=lock.packages[location];
    for(const name of Object.keys({...entry.dependencies,...entry.optionalDependencies})){const dependency=resolve(name,location);
      if(!dependency){if(Object.hasOwn(entry.optionalDependencies??{},name))continue;throw Error('Candidate production dependency missing');}
      if(!selected.has(dependency)){selected.add(dependency);queue.push(dependency);}}}
  lock.packages=Object.fromEntries(Object.entries(lock.packages).filter(([key])=>selected.has(key)));let rewrittenTarballs=0;
  for(const entry of Object.values(lock.packages))if(typeof entry.resolved==='string'&&entry.resolved.startsWith('https://registry.npmjs.org/')){entry.resolved=entry.resolved.replace('https://registry.npmjs.org/',registry);rewrittenTarballs++;}
  const manifest={name:'personal-agent-owned-image',version:'0.0.0',private:true,type:'module',workspaces};
  lock.name=manifest.name;lock.packages['']={name:manifest.name,version:manifest.version,workspaces};
  return{lock,manifest,registry:{registry,rewrittenTarballs,sourceLockModified:false,versionAndIntegrityPreserved:true}};
}
function sourceFor(filename){
  if(!filename.includes('/dist/'))return{path:filename,method:filename.endsWith('/package.json')?'stripped_workspace_manifest':'direct_copy'};
  const source=filename.replace('/dist/','/src/');
  if(source.endsWith('.mjs')||source.endsWith('.d.mts'))return{path:source,method:'direct_observability_copy'};
  return{path:source.replace(/\.d\.ts$/,'.ts').replace(/\.js$/,'.ts'),method:'typescript_emit_requires_separate_verification'};
}
function summary(file){const {content,...publicFields}=file;return publicFields;}
export async function compareSources({receipt,inputs,repo=root,candidates}){
  if(!Array.isArray(candidates)||!candidates.length||candidates.some(value=>!/^[a-f0-9]{40}$/.test(value)))throw Error('Explicit immutable candidate Git commits required');
  const recovered=JSON.parse(await readFile(receipt,'utf8'));
  if(recovered.kind!=='immutable_image_copied_input_recovery'||!Array.isArray(recovered.files))throw Error('Unexpected recovery receipt');
  const content=new Map();
  for(const file of recovered.files){safeTarName(file.path);const filename=path.join(inputs,...file.path.split('/'));
    if(!(await lstat(filename)).isFile()||(await lstat(filename)).isSymbolicLink())throw Error('Recovered source must be a regular file');
    const bytes=await readFile(filename);if(hash(bytes)!==file.sha256)throw Error('Recovered input no longer matches immutable receipt');content.set(file.path,bytes);}
  const registryValue=JSON.parse(content.get('npm-registry.json').toString()),registry=new URL(registryValue.registry);
  if(registry.protocol!=='https:'||registry.username||registry.password||registry.search||registry.hash)throw Error('Unsafe retained npm registry');
  const results=[];
  for(const revision of candidates){
    const cache=new Map(),sourceFile=filename=>{if(!cache.has(filename))cache.set(filename,committed(repo,revision,filename));return cache.get(filename);};
    const manifests=new Map(workspaces.map(workspace=>[workspace,strippedManifest(JSON.parse(sourceFile(workspace+'/package.json').content))]));
    const fullLock=sourceFile('package-lock.json'),derived=derivedLock(JSON.parse(fullLock.content),manifests,registry.href);
    const generated=new Map([['package.json',encode(derived.manifest)],['package-lock.json',encode(derived.lock)],['npm-registry.json',encode(derived.registry)]]),files=[],sources=new Map();
    for(const file of recovered.files){
      const actual=content.get(file.path);let expected,source,method;
      if(generated.has(file.path)){expected=generated.get(file.path);method='generated_context';source=file.path==='package-lock.json'?summary(fullLock):undefined;}
      else{
        const mapping=sourceFor(file.path);method=mapping.method;
        try{source=sourceFile(mapping.path);sources.set(source.path,summary(source));}
        catch(error){if(error.status!==128||!error.stderr?.toString().includes('does not exist'))throw Error('Candidate Git source read failed');files.push({path:file.path,method,candidateSourcePath:mapping.path,status:'candidate_source_missing'});continue;}
        if(method==='stripped_workspace_manifest')expected=encode(manifests.get(file.path.slice(0,-'/package.json'.length)));
        else if(method!=='typescript_emit_requires_separate_verification')expected=source.content;
      }
      files.push({path:file.path,method,source:source?summary(source):undefined,imageSha256:file.sha256,imageLfSha256:file.lfSha256,
        expectedSha256:expected?hash(expected):undefined,exactBytes:expected?expected.equals(actual):undefined,
        lfEqual:expected?lf(expected).equals(lf(actual)):undefined,status:expected?(expected.equals(actual)?'exact_bytes':lf(expected).equals(lf(actual))?'lf_only_match':'different'):'compiler_verification_pending'});
    }
    const sourceFiles=[...sources.values()].sort((left,right)=>left.path.localeCompare(right.path));
    results.push({revision,tree:git(repo,['rev-parse',revision+'^{tree}']).toString().trim(),
      commit:git(repo,['show','-s','--format=%H%n%P%n%aI%n%cI',revision]).toString().trim().split(/\r?\n/),
      files,sourceFiles,summary:{exactBytes:files.filter(file=>file.status==='exact_bytes').length,lfOnly:files.filter(file=>file.status==='lf_only_match').length,
        different:files.filter(file=>file.status==='different').length,missing:files.filter(file=>file.status==='candidate_source_missing').length,
        compilerVerificationPending:files.filter(file=>file.status==='compiler_verification_pending').length},
      sourceLock:summary(fullLock),contextGenerator:summary(sourceFile('apps/agentarts-runtime/scripts/image-context.mjs')),
      dockerfile:summary(sourceFile('apps/agentarts-runtime/Dockerfile'))});
  }
  return{kind:'recovered_image_git_source_comparison',version:1,image:recovered.image,recoveredTreeSha256:recovered.recoveredTreeSha256,
    retainedFileCount:recovered.files.length,registry:{protocol:registry.protocol,host:registry.host,pathname:registry.pathname,credentialFieldsPresent:false},
    candidates:results,uniqueHistoricalGitSourceEstablished:false,
    distinction:'Direct copied content and deterministic context generation are tested here. Compiler equivalence and historical provenance are separate claims.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('Source comparison configuration too large');}
    const config=JSON.parse(input),output=await validateRecoveryOutput(config.output);
    const result=await compareSources(config);await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({kind:result.kind,retainedFileCount:result.retainedFileCount,candidates:result.candidates.map(value=>({revision:value.revision,summary:value.summary})),uniqueHistoricalGitSourceEstablished:false}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
