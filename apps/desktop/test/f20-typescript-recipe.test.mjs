import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import {createF20TypeScriptRecipe,F20_TYPESCRIPT_RECIPE} from '../electron/f20-typescript-recipe.js';

test('fixed F20 recipe compiles the isolated sample against its contract and rejects phantom fields or bypasses',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pa-f20-typescript-'));
  const input={schemaFile:'contract.ts',codeFile:'api.ts',recipeId:F20_TYPESCRIPT_RECIPE};
  const context={taskId:'actual-isolated-trial',runId:'original-command',authorizationRef:'original-command',
    scopes:['workspace:execute'],deadline:new Date(Date.now()+120000).toISOString(),signal:new AbortController().signal};
  try {
    await writeFile(path.join(root,'contract.ts'),'export interface Request { name:string; }');
    await writeFile(path.join(root,'api.ts'),'export const version=1;');
    const recipe=createF20TypeScriptRecipe({rootPath:root,nodeExecutable:process.execPath,input,createWorkspaceCommandTool});
    for(const [sample,passes] of [
      ["import type {Request} from './contract.js'; const request:Request={name:'a'};",true],
      ["import type {Request} from './contract.js'; const request:Request={name:'a',phantom:true};",false],
      ["import type {Request} from './contract.js'; const request:Request={name:3};",false],
      ["import type {Request} from './contract.js'; const request:Request={name:3} as any;",false],
      ["import type {Request} from './contract.js'; // @ts-ignore\nconst request:Request={phantom:3};",false],
      ['const unrelated:number=1;',false],
      ["interface Request {name:string;} const request:Request={name:'a'};",false],
      ["import type {Request} from './contract.js'; const request:Request={name:'a'}; const unchecked={phantom:true};",false],
    ]){
      await writeFile(path.join(root,'api.ts.f20-sample.ts'),sample);
      const result=await recipe.tool.execute({recipeId:F20_TYPESCRIPT_RECIPE},context);
      assert.equal(result.exitCode===0,passes,result.stderr);
    }
    const abort=new AbortController();abort.abort();
    await assert.rejects(recipe.tool.execute({recipeId:F20_TYPESCRIPT_RECIPE},{...context,signal:abort.signal}),{code:'CANCELLED'});
    assert.throws(()=>createF20TypeScriptRecipe({rootPath:root,nodeExecutable:process.execPath,
      input:{...input,schemaFile:'contract.json'},createWorkspaceCommandTool}),{code:'UNSUPPORTED_CAPABILITY'});
  }finally{await rm(root,{recursive:true,force:true});}
});
