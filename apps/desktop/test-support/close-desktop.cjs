// Keep the debugger connection alive while the product's asynchronous draft,
// voice and native-child preflights finish. Playwright app.close() disconnects
// its Node inspector immediately after the initial app.quit() call returns.
exports.closeDesktop=async app=>{
  const page=app.windows().find(page=>page.url().includes('mode=orb'));
  if(!page)return app.close();
  await Promise.all([
    app.waitForEvent('close',{timeout:15_000}),
    page.evaluate(()=>window.desktop.invoke('app.quit')).then(result=>{
      if(!result?.ok)throw Error('Desktop did not accept the test quit request');
    }).catch(error=>{
      if(!/Target.*closed|Execution context was destroyed/.test(error.message))throw error;
    }),
  ]);
};
