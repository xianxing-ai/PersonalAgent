import {isAbsolute} from 'node:path';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {createCompetitionMailSourceChanges} from '@personal-agent/runtime/application';

/** Lazy Main composition over the existing private Memory database, with a separate fixed mail namespace. */
export function createF08SourceChangeHost({getApplication,memoryPath,graphNamespace,assertCurrent,confirmSource,confirmWithdraw,confirmErase}={}) {
  if(typeof getApplication!=='function'||!isAbsolute(memoryPath??'')||!graphNamespace||typeof assertCurrent!=='function')
    throw Error('F08 private source host requires the original Runtime, Memory path and configuration guard');
  const memoryNamespace=graphNamespace+':competition-mail-private',consumerKey='competition-mail-source-v1';
  let memory,host,application,closed=false;
  const ensure=()=>{
    if(closed)throw Error('F08 private source host is closed');
    const current=getApplication();if(!current?.runtime||current.profile!=='huawei_ict_agentarts')throw Error('Original Competition Runtime is unavailable');
    if(application&&application!==current)throw Error('Original Competition Runtime changed');
    if(!host){memory=openSqliteMemoryHost(memoryPath);application=current;
      host=createCompetitionMailSourceChanges({application,memory,memoryNamespace,graphNamespace,consumerKey,assertCurrent});}
    return host;
  };
  return Object.freeze({
    memoryNamespace,
    readSource:scope=>ensure().readSource(scope),
    rememberSource:(scope,input)=>ensure().rememberSource(scope,input,confirmSource),
    recordChange:(scope,receipt)=>ensure().recordChange(scope,receipt),
    listSources:scope=>ensure().listSources(scope),
    withdrawSource:(request,control)=>ensure().withdrawSource(request,(fact,scope)=>confirmWithdraw?.(fact,{...scope,...(control?{control}:{} )})),
    eraseSource:(request,control)=>ensure().eraseSource(request,(fact,scope)=>confirmErase?.(fact,{...scope,...(control?{control}:{} )})),
    readCurrentFact(input){ensure();assertCurrent();if(input.memoryNamespace!==memoryNamespace)return;
      const value=memory.readUserFactHead(memoryNamespace,input.fact.id);
      return value?.ref.revision===input.fact.revision&&value.state==='active'&&value.confirmation==='user_confirmed'?value:undefined;},
    /** Old Vault-only erase/backup/restore cannot claim coverage of this bound namespace or its historical backups. */
    async assertLegacyPrivacyCoverage(scope){const page=await ensure().listSources(scope);
      const markers=memory.listFactErasures(memoryNamespace,{limit:1,...scope});
      if(page.facts.length||markers.length)throw Error('原 Vault 私密记忆操作不覆盖 Competition 邮件来源及其备份；请使用原邮件来源版本的撤销/删除，不能宣称已全部清除或恢复已过滤');
    },
    close(){if(closed)return;closed=true;memory?.close();host=undefined;},
  });
}
