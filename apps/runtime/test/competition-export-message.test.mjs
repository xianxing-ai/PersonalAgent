import assert from 'node:assert/strict';
import test from 'node:test';
import {withheldExportMessage} from '../dist/application.js';

/**
 * 2026-10-21 现场：`calendar.cancel` 已在本地确认成功，但云端续答失败后任务进入
 * waiting_reconciliation，错误只说"没有可读回执"。调用方据此认为取消没发生，又重复取消了一次。
 * 这条消息必须点明"本地已应用"，并带上工具名，才能区分"写失败"和"写成功但续答未完成"。
 */
test('扣留导出时说明本地写入已生效并点名工具', () => {
  assert.match(withheldExportMessage('calendar.cancel'), /calendar\.cancel already applied locally/);
  assert.match(withheldExportMessage('calendar.cancel'), /fresh host check/);
  assert.match(withheldExportMessage('mail.save_draft'), /mail\.save_draft already applied locally/);
  // 没有可点名的工具时也不能退回"什么都没有发生"的措辞。
  assert.match(withheldExportMessage(undefined), /local tool already applied locally/);
});
