// Explicit, local-only acceptance: existing weights + original public startup
// warmup + authenticated health + stop. No business inference or cloud request.
import assert from 'node:assert/strict';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createLocalLayaHost} from '../../../apps/desktop/electron/laya-local-host.js';
import {createLocalInboxClassifier} from '@personal-agent/runtime/application';
import {LayaActionChoiceService, LocalLayaHttpTransport} from '@personal-agent/cognition';

const report = {startedAt:new Date().toISOString(),profile:'huawei_ict_agentarts',
  scope:'existing Desktop local service only; no cloud task or Local Agent',
  freeMemoryBeforeBytes:os.freemem(),healthAttempts:0,businessInference:false};
const host = createLocalLayaHost({projectRoot:fileURLToPath(new URL('../../../',import.meta.url)),
  createService:createLocalInboxClassifier,
  createChooser:({port,getApiKey}) => new LayaActionChoiceService(new LocalLayaHttpTransport(port,getApiKey)),
  request:async (url,options) => {
    assert.equal(url,'http://127.0.0.1:8766/health');
    report.healthAttempts++;
    const response = await fetch(url,options);
    if(response.ok) {
      const value = await response.clone().json();
      report.health = {status:value.status,model:value.model,warmed:value.warmed,
        device:value.device,inferenceCalls:value.inferenceCalls,inferenceBusy:value.inferenceBusy};
    }
    return response;
  },
});
try {
  report.start = await host.start();
  if(report.start.state==='memory_insufficient') {
    report.outcome='not_run'; report.reason='original memory gate'; process.exitCode=2;
  } else {
    assert.equal(report.start.state,'ready');
    assert.equal(report.health?.warmed,true);
    assert.equal(report.health?.inferenceCalls,0);
    assert.equal(report.health?.inferenceBusy,false);
    report.outcome='passed';
  }
} catch {
  report.outcome='failed'; process.exitCode=1;
} finally {
  report.stop = await host.stop();
  if(report.stop.state!=='stopped') {report.outcome='failed';process.exitCode=1;}
  report.freeMemoryAfterBytes=os.freemem(); report.finishedAt=new Date().toISOString();
  console.log(JSON.stringify(report));
}
