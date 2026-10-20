import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Opaque identity of this loaded Runtime artifact set, not a release or deployment version. */
function snapshot():string|undefined {
  try {
    const filename=fileURLToPath(import.meta.url),root=path.dirname(filename);
    if(path.basename(root)!=='dist'||path.extname(filename)!=='.js')return undefined;
    const rootStat=lstatSync(root);
    if(!rootStat.isDirectory()||rootStat.isSymbolicLink())return undefined;
    const files:{relative:string;bytes:Buffer}[]=[];
    const walk=(directory:string):void=>{
      for(const name of readdirSync(directory).sort()) {
        const target=path.resolve(directory,name),relative=path.relative(root,target);
        if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error();
        const stat=lstatSync(target);
        if(stat.isSymbolicLink())throw Error();
        if(stat.isDirectory())walk(target);
        else if(stat.isFile()&&name.endsWith('.js'))files.push({relative:relative.split(path.sep).join('/'),bytes:readFileSync(target)});
      }
    };
    walk(root);
    if(!files.some(file=>file.relative==='index.js')||!files.some(file=>file.relative==='build-identity.js'))return undefined;
    const digest=createHash('sha256');
    for(const file of files.sort((left,right)=>left.relative<right.relative?-1:left.relative>right.relative?1:0)) {
      // Length-prefix paths and bytes so no concatenation can alias another file set.
      const name=Buffer.from(file.relative,'utf8');
      digest.update(String(name.length)+':').update(name).update(String(file.bytes.length)+':').update(file.bytes);
    }
    return 'runtime-artifacts:sha256:'+digest.digest('hex');
  } catch {return undefined;}
}

// Bind the original artifacts once. Newly written dist must never become the identity
// of code already loaded in this process, even when a file is later restored.
const loaded=snapshot();
let invalid=loaded===undefined;
export function readRuntimeBuildIdentity():string|undefined {
  if(invalid)return undefined;
  if(snapshot()!==loaded){invalid=true;return undefined;}
  return loaded;
}
