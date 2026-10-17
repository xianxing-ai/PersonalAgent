// Verifier development check only: deterministic positive/negative fixtures.
// This is NOT an Agent repair, model quality test or end-to-end acceptance.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {browserObservation} from './pelican-test-version.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const directory=await mkdtemp(join(root,'.cache','pelican-browser-check-'));
const source=await readFile(new URL('./fixtures/pelican-animation-bug.svg',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,executablePath:process.env.PA_TEST_BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const page=await browser.newPage({viewport:{width:900,height:720}});
const results=[];
try {
  for(const [name,text,expected] of [['controlled-fault',source,false],['positive-fixture',source.replaceAll('begin="indefinite"','begin="0s"'),true]]) {
    const path=join(directory,name+'.svg');await writeFile(path,text);
    const result=await browserObservation(page,path,join(directory,name+'.png'));
    assert.equal(result.nonBlank,true);assert.deepEqual(result.errors,[]);
    assert.ok(result.moving.every(item=>item.changed===expected));
    results.push({fixture:name,expectedMotion:expected,...result});
  }
}finally{await browser.close();}
const report={kind:'actual_browser_verifier_selftest',directory,agentRepair:false,modelCalls:0,results};
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({directory,passed:2,agentRepair:false,modelCalls:0}));
