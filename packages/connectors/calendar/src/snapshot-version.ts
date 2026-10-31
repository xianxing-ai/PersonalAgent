import {createHash} from 'node:crypto';
import type {ProtocolContracts} from '@personal-agent/contracts';
import type {CalendarWindow} from './provider.js';

/** Version of a complete bounded read, excluding transport observation time.
 * It is not an account-wide revision or an atomic conditional-write token. */
export function calendarSnapshotVersion(window:CalendarWindow,items:readonly ProtocolContracts['connectorItem'][]):string {
  const records=items.map(item=>({accountRef:item.accountRef,externalId:item.externalId,dedupeKey:item.dedupeKey,
    contentRef:item.contentRef,validFor:item.validFor??null}));
  records.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  return 'calendar-window-sha256:'+createHash('sha256').update(JSON.stringify({window,records})).digest('hex');
}
