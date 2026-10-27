import assert from 'node:assert/strict';

// Explicit transport seam for delayed/replayed reads in ordering tests. The
// Runtime remains real; only delivery of this already bounded batch is controlled.
export function eventBatchFixture(readEvents) {
  return {readEvents,async readEventBatch({afterSequence,limit=128}={}){
    const events=await readEvents(afterSequence);
    assert(events.length<=limit,'This ordering fixture must stay within one bounded batch');
    return {events,hasMore:false,throughSequence:events.at(-1)?.sequence??afterSequence??0};
  }};
}
