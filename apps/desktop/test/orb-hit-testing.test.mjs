import test from 'node:test';import assert from 'node:assert/strict';import {orbHitRadius,orbHitDecision,createOrbHitTestController,ORB_HIT_FRACTION,ORB_HIT_HYSTERESIS,ORB_HIT_TESTING_REVISION} from '../electron/orb-hit-testing.js';

const BOUNDS = {x: 100, y: 200, width: 112, height: 112};
const CENTER = {x: 156, y: 256};

test('published constants keep the capture zone outside the visible shell',()=>{
  assert.equal(ORB_HIT_TESTING_REVISION,1);
  const radius=orbHitRadius(112,112);
  assert.ok(radius<ORB_HIT_FRACTION*112/2+1e-9);
  // Worst-case visible shell ≈39.3 DIPs must stay inside the capture zone.
  assert.ok(radius-ORB_HIT_HYSTERESIS>=39.3,`capture zone ${radius-ORB_HIT_HYSTERESIS} must cover 39.3`);
  // Transparent corners must stay outside the ignore threshold.
  assert.ok(ORB_HIT_HYSTERESIS+radius<79.2,'corners must click through');
  assert.throws(()=>orbHitRadius(112,112,1.2),RangeError);
  assert.equal(orbHitRadius(0,112),0);
  assert.equal(orbHitRadius(112,-1),0);
});

test('decision captures the center and shell, forwards transparent edges and corners',()=>{
  assert.equal(orbHitDecision({point:CENTER,bounds:BOUNDS}).capture,true);
  assert.equal(orbHitDecision({point:{x:CENTER.x+30,y:CENTER.y},bounds:BOUNDS}).capture,true,'shell rim captures');
  assert.equal(orbHitDecision({point:{x:CENTER.x+50,y:CENTER.y},bounds:BOUNDS}).capture,false,'transparent band forwards');
  const corner=orbHitDecision({point:{x:BOUNDS.x+2,y:BOUNDS.y+2},bounds:BOUNDS});
  assert.equal(corner.capture,false,'corners forward to windows underneath');
  assert.ok(corner.distance>60);
  assert.equal(orbHitDecision({point:CENTER,bounds:{...BOUNDS,width:0}}).capture,true,'degenerate bounds never ignore');
  assert.equal(orbHitDecision({point:{x:NaN,y:2},bounds:BOUNDS}).capture,true,'uncertain point never ignores');
  assert.equal(orbHitDecision({point:CENTER,bounds:undefined}).capture,true);
});

test('hysteresis keeps the previous decision inside the band',()=>{
  // Radius 42, hysteresis 2 → the memory band is [40, 44] DIPs.
  const band={point:{x:CENTER.x+42,y:CENTER.y},bounds:BOUNDS};
  assert.equal(orbHitDecision({...band,capture:true}).capture,true);
  assert.equal(orbHitDecision({...band,capture:false}).capture,false);
  // Outside the band the geometry wins regardless of previous state.
  assert.equal(orbHitDecision({point:{x:CENTER.x+46,y:CENTER.y},bounds:BOUNDS,capture:true}).capture,false);
  assert.equal(orbHitDecision({point:{x:CENTER.x+35,y:CENTER.y},bounds:BOUNDS,capture:false}).capture,true);
});

function fakeWin({visible=true,destroyed=false,bounds=BOUNDS}={}){
  const calls=[];
  return {calls,
    setIgnoreMouseEvents:(ignore,options)=>calls.push({ignore,options}),
    isDestroyed:()=>destroyed,
    isVisible:()=>visible,
    getContentBounds:()=>({...bounds})};
}

test('controller toggles ignore state only on changes and forces capture while busy',()=>{
  const win=fakeWin();
  let cursor=CENTER;
  const screen={getCursorScreenPoint:()=>cursor};
  let busy=false;
  const controller=createOrbHitTestController({win,screen,isBusy:()=>busy});
  assert.equal(controller.refresh().capture,true);
  assert.deepEqual(win.calls,[]);
  cursor={x:CENTER.x+70,y:CENTER.y};
  assert.equal(controller.refresh().capture,false);
  assert.deepEqual(win.calls,[{ignore:true,options:{forward:true}}]);
  assert.equal(controller.refresh().capture,false);
  assert.equal(win.calls.length,1,'no churn while state unchanged');
  busy=true;
  assert.equal(controller.refresh().capture,true,'drag forces capture');
  assert.deepEqual(win.calls[1],{ignore:false,options:{forward:true}});
  cursor={x:1e9,y:1e9};
  win.getContentBounds=()=>{throw Error('display gone');};
  assert.equal(controller.refresh().capture,true);
  assert.equal(win.calls.length,2,'sample failure restores capture');
  assert.equal(controller.ignoring,false);
});

test('controller treats hidden or destroyed windows and stop() as capture',async()=>{
  const hidden=fakeWin({visible:false});
  const hiddenController=createOrbHitTestController({win:hidden,screen:{getCursorScreenPoint:()=>CENTER}});
  assert.equal(hiddenController.refresh().capture,true);
  assert.deepEqual(hidden.calls,[]);
  const gone=fakeWin({destroyed:true});
  const goneController=createOrbHitTestController({win:gone,screen:{getCursorScreenPoint:()=>CENTER}});
  assert.equal(goneController.refresh().capture,true);
  assert.deepEqual(gone.calls,[]);
  // stop() clears the interval and restores capture.
  const win=fakeWin();
  let cursor={x:CENTER.x+70,y:CENTER.y};
  const controller=createOrbHitTestController({win,screen:{getCursorScreenPoint:()=>cursor},intervalMs:5});
  controller.start();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(controller.ignoring,true);
  cursor=CENTER;
  controller.stop();
  assert.equal(controller.ignoring,false);
  assert.deepEqual(win.calls.at(-1),{ignore:false,options:{forward:true}});
  const afterStop=controller.refresh();
  assert.equal(afterStop.capture,true);
  assert.equal(afterStop.reason,'stopped');
});

test('controller logs sample failures through the injected sink without throwing',()=>{
  const win=fakeWin();
  const events=[];
  const controller=createOrbHitTestController({win,
    screen:{getCursorScreenPoint:()=>{throw Error('cursor unavailable');}},
    log:event=>events.push(event)});
  assert.equal(controller.refresh().capture,true);
  assert.equal(events.length,1);
  assert.match(events[0],/orb-hit-test-error:cursor unavailable/);
});
