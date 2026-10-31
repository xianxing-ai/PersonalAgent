import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarSnapshotVersion} from '../dist/index.js';

test('calendar window version detects source changes and ignores read time and ordering',()=>{
  const window={fromUtc:'2026-10-31T00:00:00.000Z',toUtc:'2026-11-01T00:00:00.000Z'};
  const one={source:'calendar',accountRef:'fixture',externalId:'one',dedupeKey:'calendar:one:1',
    contentRef:'Meeting',validFor:'2026-10-31T01:00:00.000Z/2026-10-31T02:00:00.000Z',fetchedAt:'2026-10-31T00:01:00.000Z'};
  const two={...one,externalId:'two',dedupeKey:'calendar:two:1'};
  const original=calendarSnapshotVersion(window,[one,two]);
  assert.equal(original,calendarSnapshotVersion(window,[two,{...one,fetchedAt:'2026-10-31T00:02:00.000Z'}]));
  for(const changed of [{dedupeKey:'calendar:one:2'},{contentRef:'Changed'},{validFor:'changed'},{accountRef:'other'}])
    assert.notEqual(original,calendarSnapshotVersion(window,[{...one,...changed},two]));
  assert.notEqual(original,calendarSnapshotVersion(window,[one]));
  assert.notEqual(original,calendarSnapshotVersion({...window,toUtc:'2026-11-02T00:00:00.000Z'},[one,two]));
});
