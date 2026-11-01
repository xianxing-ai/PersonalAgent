import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('actual Main supplies original knowledge and only the public weather tool and export to business graphs',()=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const begin=source.indexOf('const businessWorkflow=agentArtsPinned?'),end=source.indexOf('f16F17Cases=',begin);
  assert.ok(begin>=0&&end>begin);
  const weather={descriptor:{name:'weather.forecast'}},foreign={descriptor:{name:'unrelated.tool'}},knowledge={descriptor:{name:'knowledge.search'}};
  const weatherPolicy={toolName:'weather.forecast'},foreignPolicy={toolName:'unrelated.tool'},knowledgePolicy={toolName:'knowledge.search'};
  const context={agentArtsPinned:true,runtimeModule:{},runtimeApplication:{},todoHost:undefined,connectorConversationTools:undefined,
    notificationApplicationHost:{},knowledgeTools:{tools:[knowledge],competitionToolExports:[knowledgePolicy]},
    productTools:{tools:[weather,foreign],competitionToolExports:[weatherPolicy,foreignPolicy]},namespace:'fixture',
    createBusinessWorkflowWorkerPorts:options=>options,createBusinessWorkflowAvailability:options=>options,authorizeWorkflowExport(){}};
  const options=runInNewContext(source.slice(begin,end)+'\nbusinessWorkflow;',context);
  assert.deepEqual([...options.businessTools],[knowledge,weather]);
  assert.deepEqual([...options.competitionToolExports],[knowledgePolicy,weatherPolicy]);
});
