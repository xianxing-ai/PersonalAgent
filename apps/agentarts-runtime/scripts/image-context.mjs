import {readFile,writeFile,mkdir,mkdtemp,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../../',import.meta.url));
// Each invocation creates a fresh context, so old exports or secrets cannot survive.
const parent = path.join(root,'.cache','agentarts-image');
await mkdir(parent,{recursive:true});
const output = await mkdtemp(path.join(parent,'context-'));
const workspacePaths = ['packages/contracts','packages/coordination','packages/models','packages/agentarts','apps/agentarts-runtime'];
const fullLock = JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const manifests = new Map();
for (const relative of workspacePaths) {
  const manifest = JSON.parse(await readFile(path.join(root,relative,'package.json'),'utf8'));
  delete manifest.devDependencies;
  delete manifest.scripts;
  manifests.set(relative,manifest);
}
const lock = structuredClone(fullLock);
const selected=new Set(['',...workspacePaths]);
const queue=[...workspacePaths];
for (const [relative,manifest] of manifests) {
  const link=`node_modules/${manifest.name}`;
  if (!fullLock.packages[link]?.link || fullLock.packages[link].resolved!==relative) throw Error('Workspace link missing from root lock');
  selected.add(link);
  delete lock.packages[relative].devDependencies;
}
function resolveDependency(name,from) {
  let directory=from;
  while (true) {
    const candidate=path.posix.join(directory,'node_modules',name);
    if (fullLock.packages[candidate]) return candidate;
    if (!directory) return undefined;
    directory=path.posix.dirname(directory);
    if (directory==='.') directory='';
  }
}
for (let index=0;index<queue.length;index++) {
  const location=queue[index],entry=lock.packages[location];
  for (const [name] of Object.entries({...entry.dependencies,...entry.optionalDependencies})) {
    const dependency=resolveDependency(name,location);
    if (!dependency) {
      if (Object.hasOwn(entry.optionalDependencies??{},name)) continue;
      throw Error('Production dependency missing from root lock');
    }
    if (!selected.has(dependency)) {selected.add(dependency);queue.push(dependency);}
  }
}
lock.packages = Object.fromEntries(Object.entries(lock.packages).filter(([key]) => selected.has(key)));
const manifest = {name:'personal-agent-owned-image',version:'0.0.0',private:true,type:'module',workspaces:workspacePaths};
lock.name=manifest.name;
lock.packages['']={name:manifest.name,version:manifest.version,workspaces:workspacePaths};
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'package.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(output,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
for (const relative of workspacePaths) {
  const destination = path.join(output,relative); await mkdir(destination,{recursive:true});
  await writeFile(path.join(destination,'package.json'),JSON.stringify(manifests.get(relative),null,2)+'\n');
  const directory = relative.startsWith('apps/') ? 'src' : 'dist';
  await cp(path.join(root,relative,directory),path.join(destination,directory),{recursive:true});
  // Contracts uses its source-controlled protocol schema at runtime.
  if (relative==='packages/contracts') await cp(path.join(root,relative,'schema'),path.join(destination,'schema'),{recursive:true});
}
await cp(path.join(root,'apps/agentarts-runtime/Dockerfile'),path.join(output,'Dockerfile'));
await writeFile(path.join(output,'.dockerignore'),'node_modules\n.env*\n*.local\n*.log\n');
const files=[];
async function visit(directory){ for(const entry of await readdir(directory,{withFileTypes:true})) {
  const name=path.join(directory,entry.name); if(entry.isDirectory()) await visit(name); else files.push(path.relative(output,name).replaceAll('\\','/'));
}}
await visit(output);
await writeFile(path.join(output,'context-manifest.json'),JSON.stringify({workspacePaths,files},null,2)+'\n');
console.log(JSON.stringify({context:output,workspaces:workspacePaths,files:files.length}));
