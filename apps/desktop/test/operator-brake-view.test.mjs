import assert from 'node:assert/strict';
import test from 'node:test';
import {applyOperatorBrake, operatorBrakePresentation} from '../src/features/conversation/operator-brake-view.js';

test('the operator brake view is one switch and one status line', () => {
  assert.equal(operatorBrakePresentation({paused: false}).label, '暂停');
  assert.equal(operatorBrakePresentation({paused: false}).status, '');
  const paused = operatorBrakePresentation({paused: true});
  assert.equal(paused.label, '恢复');
  assert.equal(paused.pressed, true);
  assert.match(paused.status, /已暂停/);
  assert.equal(paused.stateLabel, '已暂停');
  const button = {hidden: true, textContent: '', title: '', classList: {toggle() {}}, setAttribute() {}};
  const status = {hidden: true, textContent: ''};
  const state = {textContent: '待机', classList: {toggle(_name, on) {this.paused = on;}}};
  applyOperatorBrake({button, status, state, snapshot: {paused: true}});
  assert.equal(button.textContent, '恢复');
  assert.equal(status.hidden, false);
  assert.equal(state.textContent, '已暂停');
});
