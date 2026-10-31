import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {lstatSync,readFileSync,readdirSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {resolveNodeExecutable} from './workspace-command-recipes.js';

export const F20_TYPESCRIPT_RECIPE='f20-typescript-sample';
const require=createRequire(import.meta.url);
const checker=fileURLToPath(new URL('./f20-typescript-check.cjs',import.meta.url));
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const relative=value=>typeof value==='string'&&value.length>0&&!/[\\:\u0000-\u001f]/u.test(value)&&!path.isAbsolute(value)
  &&value.split('/').every(part=>part&&part!=='.'&&part!=='..');

/** Main-only recipe. Fixed compiler and flags; no project scripts, config, plugins or sample execution. */
export function createF20TypeScriptRecipe({rootPath,nodeExecutable,input,createWorkspaceCommandTool}) {
  let compiler;try{compiler=require.resolve('typescript');}catch{throw new ProtocolError('UNSUPPORTED_CAPABILITY','Pinned F20 TypeScript compiler is unavailable');}
  const root=realpathSync.native(rootPath),node=resolveNodeExecutable(root,nodeExecutable);
  if(lstatSync(rootPath).isSymbolicLink()||typeof createWorkspaceCommandTool!=='function'
    ||input?.recipeId!==F20_TYPESCRIPT_RECIPE||!relative(input.schemaFile)||!input.schemaFile.endsWith('.ts')||!relative(input.codeFile))
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','F20 requires the fixed TypeScript contract recipe');
  const files=[node,checker,compiler,...readdirSync(path.dirname(compiler)).filter(name=>/^lib\..*\.d\.ts$/u.test(name)).map(name=>path.join(path.dirname(compiler),name))];
  for(const file of files){
    const fromRoot=path.relative(root,file);
    if(lstatSync(file).isSymbolicLink()||!statSync(file).isFile()||realpathSync.native(file)!==file
      ||fromRoot!== '..'&&!fromRoot.startsWith('..'+path.sep)&&!path.isAbsolute(fromRoot))
      throw new ProtocolError('UNAUTHORIZED','F20 compiler must be outside the writable workspace');
  }
  const pins=files.map(file=>[file,sha(file)]);
  const available=()=>{try{return pins.every(([file,digest])=>!lstatSync(file).isSymbolicLink()&&realpathSync.native(file)===file&&sha(file)===digest);}catch{return false;}};
  const tool=createWorkspaceCommandTool({rootPath:root,recipes:[{id:F20_TYPESCRIPT_RECIPE,executable:node,
    args:['--preserve-symlinks','--preserve-symlinks-main',checker,compiler,root,input.schemaFile,input.codeFile,input.codeFile+'.f20-sample.ts']}],
    trustedReadRoots:[path.dirname(checker),path.dirname(path.dirname(compiler))],maxDurationMs:30000,maxOutputBytes:4096});
  return {available,tool:{...tool,async execute(value,context){
    if(!available())throw new ProtocolError('REVISION_CONFLICT','F20 trusted compiler changed');
    const result=await tool.execute(value,context);
    if(!available())throw new ProtocolError('REVISION_CONFLICT','F20 trusted compiler changed during verification');
    return result;
  }}};
}
