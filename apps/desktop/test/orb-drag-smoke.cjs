const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {_electron} = require('playwright');

// Native window geometry + the production renderer/IPC, with explicit Fake
// Runtime and an isolated profile. No model, credentials or account operations.
(async () => {
  const root = path.resolve(__dirname, '../../..');
  const output = path.resolve(__dirname, '../.cache/orb-drag-qa');
  const scale = process.env.PA_ORB_TEST_SCALE;
  if (scale !== undefined) assert.ok(Number.isFinite(Number(scale)) && Number(scale) > 0);
  fs.mkdirSync(output, {recursive:true});
  const app = await _electron.launch({
    executablePath:path.join(root, 'node_modules/electron/dist/electron.exe'),
    args:[path.join(root, 'apps/desktop'), '--fake-runtime', ...(scale ? [`--force-device-scale-factor=${scale}`] : [])],
    env:{...process.env, ELECTRON_RUN_AS_NODE:undefined, PA_RUNTIME_PROFILE:'local',
      PA_USER_DATA_DIR:fs.mkdtempSync(path.join(output, 'profile-')), PA_DESKTOP_MODEL_MODE:undefined,
      PA_DESKTOP_EPHEMERAL_MODEL:'1'},
  });
  const errors = [], results = [];
  app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
  try {
    await app.firstWindow();
    let orb;
    for(let i=0;i<100;i++) {
      orb=app.windows().find(page=>page.url().includes('mode=orb'));
      if(orb)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(orb);
    await orb.waitForSelector('.orb-button');
    for(const page of app.windows())page.on('pageerror',error=>errors.push(error.message));
    const initial=await app.evaluate(({BrowserWindow,screen})=>{
      const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=orb'));
      const bounds=win.getContentBounds(), area=screen.getDisplayMatching(bounds).workArea;
      globalThis.orbDragPointer={x:bounds.x+28,y:bounds.y+37};
      screen.getCursorScreenPoint=()=>({...globalThis.orbDragPointer});
      return {bounds,area,scale:screen.getDisplayMatching(bounds).scaleFactor};
    });
    const readBounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=orb')).getContentBounds());
    // Real renderer pointer capture, including release outside the 112px orb.
    await orb.mouse.move(28,37); await orb.mouse.down(); await orb.mouse.move(40,49);
    const target={x:initial.area.x+Math.floor(initial.area.width/2),y:initial.area.y+Math.floor(initial.area.height/2)};
    await app.evaluate((_,point)=>{globalThis.orbDragPointer=point;},target);
    await orb.waitForTimeout(100);
    assert.deepEqual(await readBounds(),{x:target.x-28,y:target.y-37,width:112,height:112});
    await orb.mouse.move(140,140); await orb.mouse.up(); await orb.waitForTimeout(30);
    const released=await readBounds();
    await app.evaluate((_,point)=>{globalThis.orbDragPointer=point;},{x:initial.area.x,y:initial.area.y});
    await orb.waitForTimeout(100);
    assert.deepEqual(await readBounds(),released,'captured pointer release must stop following');
    for(const [name,right,bottom] of [['top-left',false,false],['top-right',true,false],['bottom-left',false,true],['bottom-right',true,true]]) {
      assert.equal((await orb.evaluate(()=>window.desktop.invoke('orb.dragStart',{x:28,y:37}))).ok,true);
      await app.evaluate((_,{right,bottom,area})=>{
        globalThis.orbDragPointer={x:area.x+(right?area.width-1:0),y:area.y+(bottom?area.height-1:0)};
      },{right,bottom,area:initial.area});
      await orb.waitForTimeout(70);
      assert.equal((await orb.evaluate(()=>window.desktop.invoke('orb.dragEnd'))).ok,true);
      const content=await readBounds();
      const expected={x:initial.area.x+(right?initial.area.width-112:0),y:initial.area.y+(bottom?initial.area.height-112:0)};
      assert.ok(Math.abs(content.x-expected.x)<=1,JSON.stringify({name,content,expected}));
      assert.ok(Math.abs(content.y-expected.y)<=1,JSON.stringify({name,content,expected}));
      assert.equal(content.width,112); assert.equal(content.height,112);
      const outer=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=orb')).getBounds());
      assert.ok(outer.width<=113&&outer.height<=113,'fractional-DPI outer bounds must not accumulate growth');
      results.push({name,content,expected});
    }
    const stopped=await readBounds();
    await app.evaluate(()=>{globalThis.orbDragPointer={x:300,y:300};}); await orb.waitForTimeout(100);
    assert.deepEqual(await readBounds(),stopped);
    assert.equal((await orb.evaluate(()=>window.desktop.invoke('orb.open'))).ok,true);
    const panel=app.windows().find(page=>page.url().includes('mode=panel'));
    await panel.waitForSelector('textarea');
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=panel')).isVisible()),true);
    assert.deepEqual(errors,[]);
    const report={profile:'explicit_fake_runtime',nativeWindows:true,initial,results,
      pointerCapture:true,releasedPositionStable:true,panelOpen:true,pageErrors:errors};
    fs.writeFileSync(path.join(output,`receipt-${scale||'system'}.json`),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
