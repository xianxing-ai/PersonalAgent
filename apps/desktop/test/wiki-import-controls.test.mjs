import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

test('Wiki controls preserve form state, follow Runtime states and render only safe, generation-bound links',
  {skip:process.env.PA_WIKI_UI_TEST !== '1',timeout:60000}, async t => {
    const {chromium} = await import('playwright');
    const source = await readFile(new URL('../src/app/wiki-import-controls.js',import.meta.url),'utf8');
    const server = createServer((request,response) => {
      response.setHeader('Content-Type',request.url === '/controls.js' ? 'text/javascript' : 'text/html; charset=utf-8');
      if (request.url === '/controls.js') {response.end(source);return;}
      response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Wiki synthetic test</title><main></main>
        <script type="module">
          import {mountWikiImportControls} from '/controls.js';
          window.calls=[];
          const pages=[{pageId:'topic',title:'主题',path:'topics/overview.md'},{pageId:'source',title:'原文',path:'sources/a.md'}];
          const state={available:true,automaticUpdate:true,reason:'合成工作流',modelLabel:'合成 AgentArts',library:{libraryId:'lib',displayName:'测试知识库'},librarySources:[{sourceId:'a',name:'已登记资料',revision:'revision'}],
            selection:{selectionId:'selection',revision:1,totalBytes:80,files:[{sourceId:'a',name:'<img src=x onerror="window.injected=true">.md',size:80}]}};
          const controls=mountWikiImportControls(document.querySelector('main'),async (name,payload)=>{
            calls.push({name,payload});
            if(name==='wiki.import.start'){state.batch={taskId:'task',revision:1,state:'waiting_approval',stage:'preflight'};return structuredClone(state);}
            if(name==='wiki.import.status')return structuredClone(state);
            if(name==='wiki.import.cancel'){state.batch.state='cancelled';return structuredClone(state);}
            if(name==='wiki.import.search')return {hits:[{pageId:'topic',title:'<img src=x onerror="window.injected=true">',excerpt:'<svg onload="window.injected=true"></svg>'}]};
            if(name==='wiki.import.ask'){state.question={taskId:'question',state:'waiting_approval'};return structuredClone(state);}
            if(name==='wiki.import.readPage')return {pageId:payload.pageId,path:payload.pageId==='topic'?'topics/overview.md':'sources/a.md',
              content:payload.pageId==='topic'?'# 合成主题\\n[查看原文](../sources/a.md)\\n[危险链接](javascript:window.injected=true)\\n<img src=x onerror="window.injected=true">':'# 合成原文\\n蓝色海豚项目预算 2500 元。',
              citations:[{label:'引用：原文第 1 段',sourceId:'a',revision:'revision',unitId:'u1'}]};
            if(name==='wiki.import.openSource')return {text:'合成原文第 1 段'};
            return structuredClone(state);
          });
          controls.update(state);
          window.setState=(value,publish=true)=>{state.batch={...state.batch,...value};if(publish)controls.update(state);};
          window.publishWiki=()=>{state.batch={...state.batch,state:'succeeded',stage:'complete',completed:2,total:2};state.published={generationId:'g1',pages};};
          window.publishAnswer=()=>{state.question={taskId:'question',state:'succeeded',answer:{answer:'合成回答 2500',insufficient:false,
            citations:[{sourceId:'a',revision:'revision',unitId:'u1',quote:'2500'}]}};};
          window.changeGeneration=()=>{state.published={generationId:'g2',pages};controls.update(state);};
          window.refreshControls=()=>controls.update(state);
          window.disposeControls=()=>controls.dispose();
        </script></html>`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
    const browser = await chromium.launch({headless:true,...(process.env.PA_WIKI_UI_BROWSER ? {executablePath:process.env.PA_WIKI_UI_BROWSER} : {})});
    t.after(()=>browser.close());
    const page = await browser.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading',{name:'LLM Wiki',exact:true}).waitFor({timeout:5000}).catch(error=>{
      throw new Error(`Wiki fixture did not mount: ${errors.join('; ')}`, {cause:error});
    });
    assert.equal(await page.locator('img').count(),0);
    const fenced = await page.evaluate(async () => {
      const {renderWikiDocument} = await import('/controls.js'), container = document.createElement('div');
      renderWikiDocument(container,{content:'````\n# 原文标题\n```\n## 仍是原文\n`````\n# 页面标题'},[],()=>{});
      return {code:container.querySelector('pre')?.textContent,headings:[...container.querySelectorAll('h2')].map(item=>item.textContent)};
    });
    assert.equal(fenced.code, '# 原文标题\n```\n## 仍是原文\n');
    assert.deepEqual(fenced.headings, ['页面标题']);
    await page.getByText('本批处理预算',{exact:true}).click();
    await page.locator('[data-wiki="max-calls"]').fill('40');
    await page.evaluate(()=>refreshControls());
    assert.equal(await page.locator('[data-wiki="max-calls"]').inputValue(),'40');
    await page.getByRole('button',{name:'授权并生成 Wiki'}).click();
    await page.getByText('等待本批授权 · 检查文件').waitFor();
    assert.deepEqual(await page.evaluate(()=>calls.find(call=>call.name==='wiki.import.start').payload),
      {selectionId:'selection',revision:1,maxCalls:40,maxTokens:128000,maxInputCharacters:2000000,timeoutMinutes:60,autoUpdate:true});
    for (const state of ['planning','verifying']) {
      await page.evaluate(state=>setState({state}),state);
      assert.equal(await page.getByRole('button',{name:'选择文件',exact:true}).isDisabled(),true);
      assert.equal(await page.getByRole('button',{name:'停止本批'}).isDisabled(),false);
    }
    for (const state of ['waiting_reconciliation','interrupted']) {
      await page.evaluate(state=>setState({state,canResume:true}),state);
      for (const name of ['选择文件','选择文件夹','选择 Wiki 保存目录','授权并生成 Wiki','撤销来源']) {
        assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true,`${name} should wait for recovery`);
      }
      assert.equal(await page.getByRole('button',{name:'核实并恢复'}).isDisabled(),false);
    }
    await page.evaluate(()=>setState({state:'planning'}));
    // No pushed snapshot: the component's exact task refresh must observe terminal state.
    await page.evaluate(()=>publishWiki());
    await page.getByText('任务已完成 · 发布完成 · 2/2').waitFor();
    assert.equal(await page.getByRole('button',{name:'停止本批'}).isDisabled(),true);
    await page.getByRole('button',{name:'打开页面'}).click();
    await page.getByRole('heading',{name:'合成主题'}).waitFor();
    assert.equal(await page.locator('img,a[href^="javascript:"]').count(),0);
    await page.getByRole('button',{name:'查看原文',exact:true}).click();
    await page.getByText('蓝色海豚项目预算 2500 元。',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>calls.filter(call=>call.name==='wiki.import.readPage').map(call=>call.payload.pageId)),['topic','source']);
    await page.getByRole('button',{name:'引用：原文第 1 段'}).click();
    await page.getByText('合成原文第 1 段',{exact:true}).waitFor();
    await page.locator('[data-wiki="query"]').fill('海豚');
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByText('找到 1 条',{exact:true}).waitFor();
    await page.locator('[data-wiki="question-input"]').fill('预算是多少？');
    await page.getByRole('button',{name:'授权并提问'}).click();
    await page.locator('[data-wiki="answer-status"]').getByText('等待本批授权').waitFor();
    await page.evaluate(()=>publishAnswer());
    await page.getByText('合成回答 2500',{exact:true}).waitFor();
    await page.getByRole('button',{name:'来源 1'}).click();
    await page.getByText('合成原文第 1 段',{exact:true}).waitFor();
    assert.equal(await page.locator('img').count(),0);
    assert.equal(await page.evaluate(()=>window.injected),undefined);
    await page.evaluate(()=>changeGeneration());
    assert.equal(await page.locator('[data-wiki="content"]').textContent(),'');
    assert.equal(await page.locator('[data-wiki="results"] li').count(),0);
    await page.getByText('Wiki 版本已更新，请重新打开页面或搜索').waitFor();
    await page.evaluate(()=>disposeControls());
    assert.deepEqual(errors,[]);
  });
