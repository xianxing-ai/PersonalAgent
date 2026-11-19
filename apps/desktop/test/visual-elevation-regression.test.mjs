import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const readCss = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('solid-glass keeps primary/danger/hover button specificity above base controls and styles thin scrollbars', () => {
  const css = readCss('../src/app/solid-glass.css');
  assert.match(css, /\.admin \.main :where\(\.btn,input:not\(\[type="checkbox"\]\)/);
  assert.doesNotMatch(css, /\.admin \.main :is\(\.btn,input:not\(\[type="checkbox"\]\)/);
  assert.match(css, /\.admin \.main \.btn-primary\s*\{/);
  assert.match(css, /\.admin \.main \.btn-danger\s*\{/);
  assert.match(css, /--sg-ground:#111215/);
  assert.match(css, /--sg-ground:#e9ebee/);
  assert.match(css, /\*::-webkit-scrollbar\s*\{width:6px;height:6px\}/);
  assert.match(css, /\*::-webkit-scrollbar-button\s*\{display:none/);
  assert.match(css, /@supports selector\(::-webkit-scrollbar\)/);
  assert.match(css, /scrollbar-width:auto/);
  assert.match(css, /scrollbar-color:auto/);
});

test('panel glass styles the compact button as a single-line pill beside goal controls', () => {
  const css = readCss('../src/app/panel-glass.css');
  assert.match(css, /\.panel \.composer-bar>\.compact-entry/);
  assert.match(css, /white-space:nowrap/);
  assert.match(css, /border-radius:999px/);
});

test('assistant roster collapses empty box chrome in command center and hides empty card grids', () => {
  const css = readCss('../src/features/conversation/answer-block.css');
  assert.match(css, /\.assistant-cards:empty\{display:none\}/);
  assert.match(css, /\.command-center \.assistant-roster:not\(:has\(\.assistant-card\)\):not\(:has\(\.assistant-create-form:not\(\[hidden\]\)\)\)/);
});

test('command center aligns connector header actions and chat heading controls cleanly', () => {
  const css = readCss('../src/app/command-center.css');
  assert.match(css, /\.cc-chat-heading>div\s*\{margin-right:auto/);
  assert.match(css, /\.command-center \.connector-board>header>div\s*\{margin-right:auto\}/);
  assert.match(css, /\.command-center \.connector-board>header>button\s*\{margin-left:0\}/);
  assert.match(css, /\.command-center \.connector-status\s*\{[^}]*border-radius:999px/);
});
