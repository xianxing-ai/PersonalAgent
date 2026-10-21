const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {_electron} = require('playwright');
const {closeDesktop}=require('../test-support/close-desktop.cjs');

// Production panel, isolated data and explicit Fake. The backdrop contains only
// synthetic text/colours so compositor captures never need other app content.
(async () => {
  const root = path.resolve(__dirname, '../../..');
  const output = path.resolve(__dirname, '../.cache/panel-glass-qa');
  fs.mkdirSync(output, {recursive:true});
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PA_')));
  const app = await _electron.launch({
    executablePath:path.join(root, 'node_modules/electron/dist/electron.exe'),
    args:[path.join(root, 'apps/desktop'), '--fake-runtime'],
    env:{...env, ELECTRON_RUN_AS_NODE:undefined, PA_RUNTIME_PROFILE:'local',
      PA_USER_DATA_DIR:fs.mkdtempSync(path.join(output, 'profile-')), PA_DESKTOP_EPHEMERAL_MODEL:'1'},
  });
  const errors = [], layouts = [];
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  try {
    await app.firstWindow();
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    await orb.waitForSelector('.orb-button');
    assert.equal((await orb.evaluate(() => window.desktop.invoke('orb.open'))).ok, true);
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    await panel.waitForSelector('[data-session-list] option', {state:'attached'});
    const themeFlags = await app.evaluate(({nativeTheme}) => ({
      prefersReducedTransparency:nativeTheme.prefersReducedTransparency,
      shouldUseHighContrastColors:nativeTheme.shouldUseHighContrastColors,
      shouldUseDarkColors:nativeTheme.shouldUseDarkColors,
    }));
    const {panelWindowAppearance} = await import('../electron/panel-material.js');
    const material = {os:require('node:os').release(), ...themeFlags, ...panelWindowAppearance(themeFlags)};
    for (const theme of ['light','dark']) {
      await app.evaluate(({nativeTheme}, value) => {nativeTheme.themeSource=value;}, theme);
      await panel.evaluate(async value => (await import('../ui/preferences.js')).saveTheme(value), theme);
      for (const [width,height,zoom] of [[420,720,1],[420,600,1],[360,600,1],[420,720,1.25]]) {
        await app.evaluate(({BrowserWindow,screen}, size) => {
          const win=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes('mode=panel'));
          const area=screen.getPrimaryDisplay().workArea;
          win.webContents.setZoomFactor(size.zoom);
          win.setResizable(true);
          win.setBounds({x:area.x+40,y:area.y+30,width:size.width,height:size.height});
          win.setResizable(false);
        }, {width,height,zoom});
        await panel.waitForTimeout(100);
        const layout=await panel.evaluate(() => {
          const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
          return {viewport:{width:innerWidth,height:innerHeight},header:rect('.panel>header'),sessions:rect('.conversation-sessions'),
            thread:rect('.thread'),composer:rect('.composer'),input:rect('.composer>textarea'),send:rect('#send'),close:rect('#close'),sessionsHidden:document.querySelector('.conversation-sessions').hidden};
        });
        const label=JSON.stringify({theme,width,height,zoom,layout});
        assert.equal(layout.sessionsHidden,true,'single main conversation keeps management out of the panel');
        assert.ok(layout.header.bottom<=layout.thread.y+1, label);
        assert.ok(layout.thread.bottom<=layout.composer.y+1, label);
        assert.ok(layout.thread.height>=40, label);
        assert.ok(layout.composer.bottom<=layout.viewport.height+1, label);
        for (const key of ['input','send','close']) {
          assert.ok(layout[key].right<=layout.viewport.width+1 && layout[key].bottom<=layout.viewport.height+1, label);
        }
        await panel.locator('.composer>textarea').fill(`玻璃面板草稿 ${theme}`);
        await panel.locator('#model').click();
        await panel.locator('#model-menu').waitFor({state:'visible'});
        const menu=await panel.locator('#model-menu').evaluate(element=>{
          const r=element.getBoundingClientRect(),style=getComputedStyle(element);
          return {top:r.top,bottom:r.bottom,colour:style.backgroundColor};
        });
        assert.ok(menu.top>=0 && menu.bottom<=layout.viewport.height+1, JSON.stringify(menu));
        assert.match(menu.colour,/^rgb\(/,'model menu has an opaque background');
        await panel.locator('#model').click();
        await panel.locator('#bell').click();
        await panel.locator('#bell-menu').waitFor({state:'visible'});
        assert.match(await panel.locator('#bell-menu').evaluate(element=>getComputedStyle(element).backgroundColor),/^rgb\(/);
        await panel.locator('#bell').click();
        assert.equal(await panel.locator('.composer>textarea').inputValue(),`玻璃面板草稿 ${theme}`);
        await panel.locator('.wake-controls>summary').click();
        assert.equal(await panel.locator('.wake-controls').evaluate(element=>element.open),true);
        await panel.locator('#wake-state').waitFor({state:'visible'});
        await panel.locator('.wake-controls>summary').click();
        await panel.locator('.composer>textarea').fill('多行任务草稿，保留滚动与发送入口。\n'.repeat(30));
        const longDraft=await panel.evaluate(()=>{
          const thread=document.querySelector('.thread').getBoundingClientRect(),composer=document.querySelector('.composer').getBoundingClientRect();
          return {threadHeight:thread.height,composerBottom:composer.bottom,viewportHeight:innerHeight};
        });
        assert.ok(longDraft.threadHeight>=24 && longDraft.composerBottom<=longDraft.viewportHeight+1,JSON.stringify({theme,width,height,zoom,longDraft}));
        layouts.push({theme,width,height,zoom,...layout});
      }
      // A native compositor capture includes the Windows material, unlike capturePage.
      await app.evaluate(async ({BrowserWindow,screen,desktopCapturer}, value) => {
        const panel=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes('mode=panel'));
        panel.webContents.setZoomFactor(1);
        const area=screen.getPrimaryDisplay().workArea;
        panel.setResizable(true);
        panel.setBounds({x:area.x+60,y:area.y+40,width:420,height:Math.min(720,area.height-80)});
        panel.setResizable(false);
        if(globalThis.glassScene)globalThis.glassScene.destroy();
        const bounds=panel.getBounds();
        const scene=new BrowserWindow({x:bounds.x-20,y:bounds.y-20,width:bounds.width+40,height:bounds.height+40,frame:false,show:false,skipTaskbar:true});
        globalThis.glassScene=scene;
        const colour=value==='light'?'#b9d6ef':'#243551';
        await scene.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<html style="background:${colour};font:24px sans-serif;color:#25405e"><body style="margin:0;background:radial-gradient(circle at 85% 20%,#edb98c,transparent 50%),radial-gradient(circle at 0 80%,#83a7df,transparent 65%)">${'<p>PersonalAgent · GLASS TEST · 0123456789</p>'.repeat(16)}</body></html>`));
        scene.setAlwaysOnTop(true,'pop-up-menu');panel.hide();scene.showInactive();
        await new Promise(resolve=>setTimeout(resolve,160));
        const display=screen.getDisplayMatching(bounds);
        const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
        const source=sources.find(item=>item.display_id===String(display.id));
        const factor=source.thumbnail.getSize().width/display.size.width;
        const crop=source.thumbnail.crop({x:Math.round((bounds.x-display.bounds.x)*factor),y:Math.round((bounds.y-display.bounds.y)*factor),width:Math.round(bounds.width*factor),height:Math.round(bounds.height*factor)});
        const bitmap=crop.toBitmap(),size=crop.getSize();
        globalThis.glassCorners=[[3,3],[size.width-4,3],[3,size.height-4],[size.width-4,size.height-4]].map(([x,y])=>[...bitmap.subarray((y*size.width+x)*4,(y*size.width+x)*4+3)]);
        panel.setAlwaysOnTop(true,'screen-saver');panel.show();panel.moveTop();panel.focus();
      },theme);
      await panel.locator('.composer>textarea').fill('');
      await panel.waitForTimeout(600);
      await panel.screenshot({path:path.join(output,`renderer-panel-${theme}.png`)});
      const captured=await app.evaluate(async ({BrowserWindow,desktopCapturer,screen}) => {
        const panel=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes('mode=panel'));
        const bounds=panel.getBounds(),display=screen.getDisplayMatching(bounds);
        const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
        const source=sources.find(item=>item.display_id===String(display.id));
        if(!source)throw Error('Native panel capture unavailable');
        const factor=source.thumbnail.getSize().width/display.size.width;
        const crop=source.thumbnail.crop({x:Math.round((bounds.x-display.bounds.x)*factor),y:Math.round((bounds.y-display.bounds.y)*factor),width:Math.round(bounds.width*factor),height:Math.round(bounds.height*factor)});
        const bitmap=crop.toBitmap(),size=crop.getSize();
        const corners=[[3,3],[size.width-4,3],[3,size.height-4],[size.width-4,size.height-4]].map(([x,y])=>[...bitmap.subarray((y*size.width+x)*4,(y*size.width+x)*4+3)]);
        return {png:crop.toPNG().toString('base64'),corners,reference:globalThis.glassCorners};
      });
      assert.deepEqual(captured.corners,captured.reference,'all four corners must expose the original background, without a rectangular material backing');
      fs.writeFileSync(path.join(output,`native-panel-${theme}.png`),Buffer.from(captured.png,'base64'));
      fs.writeFileSync(path.join(output,`corners-${theme}.json`),JSON.stringify({corners:captured.corners,reference:captured.reference}));
    }
    await panel.mouse.move(90,100);
    await panel.waitForTimeout(40);
    assert.ok(await panel.locator('.panel').evaluate(element=>element.style.getPropertyValue('--light-x')));
    await panel.emulateMedia({reducedMotion:'reduce'});
    await panel.mouse.move(130,110);
    assert.equal(await panel.locator('.panel').evaluate(element=>getComputedStyle(element,'::before').display),'none');
    await panel.emulateMedia({forcedColors:'active'});
    const contrast=await panel.locator('.panel').evaluate(element=>{
      const probe=document.createElement('span');probe.style.backgroundColor='Canvas';element.append(probe);
      const value={panel:getComputedStyle(element).backgroundColor,canvas:getComputedStyle(probe).backgroundColor};probe.remove();return value;
    });
    assert.equal(contrast.panel,contrast.canvas,'high contrast uses the selected system Canvas colour');
    const bounds=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes('mode=panel'));return {window:win.getBounds(),content:win.getContentBounds()};});
    assert.deepEqual(bounds.window,bounds.content,'no non-client grey frame around the material');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({profile:'explicit_fake_runtime',material,layouts,pageErrors:errors},null,2));
    console.log(`PASS: ${layouts.length} theme/size/zoom cases; menus and drafts; native captures in ${output}`);
  } finally {await closeDesktop(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
