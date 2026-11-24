import {lstatSync, realpathSync} from 'node:fs';
import path from 'node:path';

const windows=path.win32;
const localAbsolute=value=>typeof value==='string' && /^[A-Za-z]:[\\/]/.test(value)
  && !value.slice(2).includes(':') && !/[\u0000-\u001f\u007f]/.test(value);
const within=(file,directory)=>{
  const relative=windows.relative(directory,file);
  return relative==='' || (relative!=='..' && !relative.startsWith('..\\') && !windows.isAbsolute(relative));
};

/** Main-only lookup, never permission to execute. No implicit CWD, shell, PATHEXT or byte decoding.
 * Filesystem/platform parameters support explicit offline fixtures, not Renderer configuration.
 */
export function findWindowsExecutable(name,{environment=process.env,platform=process.platform,
  excludedDirectories=[],filesystem={lstatSync,realpathSync}}={}) {
  if(platform!=='win32' || !['pwsh.exe','git.exe','node.exe','docker.exe'].includes(name)
    || !Array.isArray(excludedDirectories) || !excludedDirectories.every(localAbsolute)) return undefined;
  const search=environment.PATH??environment.Path??'';
  if(typeof search!=='string') return undefined;
  const excluded=[...excludedDirectories];
  for(const root of excludedDirectories) {
    let canonical;
    try {
      canonical=filesystem.realpathSync.native(root);
    } catch(error) {
      if(['ENOENT','ENOTDIR'].includes(error?.code)) continue;
      return undefined;
    }
    try {
      if(!localAbsolute(canonical) || !filesystem.lstatSync(canonical).isDirectory()) return undefined;
    } catch {return undefined;}
    excluded.push(canonical);
  }
  for(let directory of search.split(';')) {
    if(directory.startsWith('"') && directory.endsWith('"')) directory=directory.slice(1,-1);
    if(!localAbsolute(directory) || directory.includes('"')) continue;
    directory=windows.normalize(directory);
    const candidate=windows.join(directory,name);
    let file;
    try {file=filesystem.lstatSync(candidate);}
    catch(error) {
      if(['ENOENT','ENOTDIR'].includes(error?.code)) continue;
      return undefined;
    }
    // The first existing candidate fixes the lookup identity. Unsafe candidates
    // cannot silently select a different program later in PATH.
    try {
      if((!file.isFile() && !file.isSymbolicLink()) || excluded.some(root=>within(candidate,root))) return undefined;
      const canonical=filesystem.realpathSync.native(candidate);
      if(!localAbsolute(canonical) || windows.basename(canonical).toLowerCase()!==name
        || excluded.some(root=>within(canonical,root))) return undefined;
      const resolved=filesystem.lstatSync(canonical);
      if(!resolved.isFile() || resolved.isSymbolicLink()) return undefined;
      return canonical;
    } catch {return undefined;}
  }
  return undefined;
}
