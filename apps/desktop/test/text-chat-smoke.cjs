const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {_electron} = require('playwright');

(async () => {
  const localElectron = path.resolve(__dirname, '../node_modules/electron/dist/electron.exe');
  const workspaceElectron = path.resolve(__dirname, '../../../node_modules/electron/dist/electron.exe');
  const executablePath = fs.existsSync(localElectron) ? localElectron : workspaceElectron;
  const app = await _electron.launch({
    executablePath,
    args: [path.resolve(__dirname, '..'), '--fake-model'],
    env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, PA_DESKTOP_EPHEMERAL_MODEL: '1'},
  });
  const errors = [];
  try {
    await app.firstWindow();
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    assert.ok(orb, 'orb window loaded');
    orb.on('pageerror', error => errors.push(error.message));
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    await panel.waitForSelector('textarea[aria-label="任务内容"]');
    panel.on('pageerror', error => errors.push(error.message));
    const textarea = panel.locator('textarea[aria-label="任务内容"]');
    assert.equal(await textarea.getAttribute('maxlength'), null);
    const initialTaskCount = await panel.locator('#tasks .task').count();
    const enterGoal = 'Enter 发送 Smoke 测试';
    await textarea.fill(enterGoal);
    await textarea.press('Shift+Enter');
    assert.match(await textarea.inputValue(), /\n$/);
    assert.equal(await panel.locator('#tasks .task').count(), initialTaskCount);
    await textarea.press('Enter');
    await panel.waitForFunction(expected => document.querySelector('#tasks')?.innerText.includes(`Fake Model 回答：${expected}`), enterGoal, {timeout: 10_000});
    assert.match(await panel.locator('#tasks .user-message').last().innerText(), new RegExp(enterGoal));
    const longGoal = '长'.repeat(10_001);
    await textarea.fill(longGoal);
    await textarea.press('Enter');
    // waitForFunction polls a synchronous predicate. An async predicate is a truthy
    // Promise and can finish with false before the coalesced display update arrives.
    await panel.waitForFunction(goal => {
      const turn = document.querySelector('#tasks .turn:last-child');
      return turn?.querySelector('.user-message')?.textContent === goal
        && turn?.querySelector('.assistant-message')?.textContent.includes(`Fake Model 回答：${goal}`);
    }, longGoal, {timeout: 10_000});
    const longTask = (await panel.evaluate(() => window.desktop.invoke('snapshot'))).value.tasks.at(-1);
    assert.equal(longTask.state, 'succeeded');
    assert.equal(longTask.userMessage, longGoal);
    assert.equal(await panel.locator('#tasks .turn:last-child .assistant-message').textContent(), longTask.resultSummary);
    assert.equal((await panel.locator('#tasks .user-message').last().innerText()).length, longGoal.length);
    await panel.locator('.thread').evaluate(element => { element.style.maxHeight = '120px'; });
    const buttonGoal = '按钮重复发送 Smoke 测试';
    await textarea.fill(buttonGoal);
    await panel.waitForFunction(() => !document.querySelector('#send').disabled, {timeout: 5000});
    assert.equal(await panel.locator('#send').isDisabled(), false);
    await panel.locator('#send').click();
    await panel.waitForFunction(expected => document.querySelector('#tasks')?.innerText.includes(`Fake Model 回答：${expected}`), buttonGoal, {timeout: 10_000});
    const snap = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    const task = snap.value.tasks.find(t => t.userMessage === buttonGoal);
    const expectedButtonAnswer = task?.resultSummary;
    assert.ok(expectedButtonAnswer?.includes(`Fake Model 回答：${buttonGoal}`));
    await panel.waitForFunction(expected => document.querySelector('#tasks .turn:last-child .assistant-message')?.textContent === expected, expectedButtonAnswer, {timeout: 10_000});
    const lastTurn = panel.locator('#tasks .turn').last();
    assert.equal(await lastTurn.locator('.assistant-message').textContent(), expectedButtonAnswer);
    await panel.waitForFunction(() => document.querySelector('#tasks .turn:last-child .response-actions button'));
    assert.equal(await lastTurn.locator('.response-actions button').count(), 3);
    const priorClipboard = await app.evaluate(({clipboard}) => clipboard.readText());
    await lastTurn.locator('[data-ui-action="copy"]').evaluate(el => el.click());
    assert.equal(await app.evaluate(({clipboard}) => clipboard.readText()), expectedButtonAnswer);
    await app.evaluate(({clipboard}, value) => clipboard.writeText(value), priorClipboard);
    const like = lastTurn.locator('[data-ui-action="like"]');
    await like.evaluate(el => el.click());
    assert.equal(await like.getAttribute('aria-pressed'), 'true');
    const output = path.resolve(__dirname, '../.cache/qa');
    fs.mkdirSync(output, {recursive: true});
    await panel.screenshot({path: path.join(output, 'chat-clean.png')});
    // The explicit offline model keeps the same identity as the trusted host snapshot.
    const snapshot = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    assert.equal(await panel.locator('.model-thinking-trigger [data-picker-model]').innerText(), snapshot.value.model.label);
    assert.equal(await panel.locator('.picker-thinking input[type="range"]').isDisabled(), true);
    await panel.waitForFunction(() => { const thread=document.querySelector('.thread');return thread.scrollTop+thread.clientHeight>=thread.scrollHeight-2; });
    assert.equal(snapshot.value.fakeModel, true);
    assert.equal(snapshot.value.agentArtsModels?.catalog == null, true);
    assert.equal(snapshot.value.tasks.at(-1).state, 'succeeded');
    assert.match(snapshot.value.model.label, /Fake Model/);
    assert.deepEqual(errors, []);
    console.log('PASS: local Runtime text chat with explicit Fake Model');
  } finally {
    await app.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
