import assert from 'node:assert/strict';
import test from 'node:test';
import {assessPsecTap} from './psec-acceptance-result.mjs';

const complete='TAP version 13\nok 1 - real root\n1..1\n# tests 7\n# pass 7\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const result=stdout=>({status:0,signal:null,stdout,stderr:''});
test('strict PSEC acceptance requires the expected real root and complete non-skipped execution',()=>{
  assert.equal(assessPsecTap(result(complete),'real root',7).accepted,true);
  for(const log of [complete.replace('real root','other root'),
    complete.replace('# tests 7\n# pass 7','# tests 1\n# pass 1'),
    complete.replace('# skipped 0','# skipped 1'),complete.replace('# todo 0','# todo 1'),
    complete.replace('# cancelled 0','# cancelled 1'),complete.replace('# fail 0','# fail 1'),
    complete+'# pass 7\n',complete.replace('real root','real root # SKIP'),
    complete.replace('ok 1','not ok 1'),''])assert.equal(assessPsecTap(result(log),'real root',7).accepted,false);
  assert.equal(assessPsecTap({...result(complete),status:1},'real root',7).accepted,false);
  assert.equal(assessPsecTap({...result(complete),signal:'SIGTERM'},'real root',7).accepted,false);
  assert.equal(assessPsecTap({...result(complete),error:{code:'ETIMEDOUT'}},'real root',7).accepted,false);
});
