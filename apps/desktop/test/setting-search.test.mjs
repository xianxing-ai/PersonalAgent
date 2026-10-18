import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesSettingSearch} from '../src/features/admin/setting-search.js';

test('settings search supports capability aliases, case and combined words',()=>{
 assert.equal(matchesSettingSearch('models','模型',' api  AgentArts '),true);
 assert.equal(matchesSettingSearch('connections','连接','日历'),true);
 assert.equal(matchesSettingSearch('capabilities','插件','skills'),true);
 assert.equal(matchesSettingSearch('tasks','任务监控','证据'),true);
 assert.equal(matchesSettingSearch('tasks','任务监控','日历'),false);
 assert.equal(matchesSettingSearch('settings','常规','  '),true);
 assert.equal(matchesSettingSearch('new-route','新设置','新设置'),true);
});
