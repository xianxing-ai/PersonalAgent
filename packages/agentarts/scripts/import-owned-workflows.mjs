import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=process.argv[2];
if(!source) throw Error('Pass the reviewed architecture.json path');
const features=JSON.parse(await readFile(source,'utf8'));
if(!Array.isArray(features)||features.length!==28||features.reduce((n,f)=>n+f.nodes.length,0)!==185) throw Error('Unexpected design catalog');
const data=features.map(({id,name,nodes,edges,recovery})=>({id,name,nodes:nodes.map(node=>{
  const {id,label,kind,dependencies,required,resourceKeys,effectType,inputFields,outputFields,condition,evidenceRequirement}=node;
  return {id,label,kind,dependencies,required,resourceKeys,effectType,inputFields,outputFields,
    ...(condition?{condition}:{}),...(evidenceRequirement?{evidenceRequirement}:{})};
}),edges:edges.map(({source,target,required,condition})=>({source,target,required,...(condition?{condition}:{})})),recovery}));
const serialized=JSON.stringify(data);
const output='// Generated from reviewed architecture.json by scripts/import-owned-workflows.mjs.\n'
  +`// Source projection sha256: ${createHash('sha256').update(serialized).digest('hex')}\n`
  +`export const OWNED_WORKFLOW_SOURCE: unknown = ${JSON.stringify(data,null,2)};\n`;
const destination=new URL('../src/owned-workflow-data.ts',import.meta.url);
if(process.argv.includes('--check')) {
  if((await readFile(destination,'utf8')).replaceAll('\r\n','\n')!==output) throw Error('Owned workflow template projection is stale');
} else await writeFile(destination,output);
