const TOPICS = new Set(['tasks','approvals','notifications','resources','all']);
const visible = win => !win.isDestroyed() && win.isVisible() && !win.isMinimized();

/** Display projections only. Runtime events and side effects never enter this queue. Each
 * renderer can retain one outstanding IPC and one bounded set of dirty topics, not snapshots. */
export function createSnapshotPublisher({project, interval = () => 16, schedule = setTimeout,
  cancel = clearTimeout, now = Date.now, onError = () => {}}) {
  const records = new Map();
  let timer, closed = false, revision = 0, generation = 0;
  function wake() {
    if (!closed && timer === undefined) timer = schedule(() => {timer=undefined; flush();}, interval());
  }
  function reset(record) {
    record.generation = ++generation; record.inFlight = undefined; record.full = true;
    record.dirty = new Set(['all']); record.revision = 0; wake();
  }
  function attach(win, surface) {
    if (closed || records.has(win)) return;
    // Electron throws when reading BrowserWindow.webContents after destruction.
    // Keep the original emitter so the closed handler can still remove its listener.
    const contents = win.webContents;
    const record = {win, surface, dirty: new Set(['all']), full: true, revision: 0, generation: ++generation};
    records.set(win, record);
    const resume = () => reset(record), remove = () => detach(win);
    const hidden = () => {record.full=true; record.dirty.add('all');};
    win.on('show', resume); win.on('restore', resume); win.on('hide', hidden);
    contents.on('did-finish-load', resume); win.on('closed', remove);
    record.release = () => {win.removeListener('show', resume); win.removeListener('restore', resume);
      win.removeListener('hide', hidden); win.removeListener('closed', remove);
      contents.removeListener('did-finish-load', resume);};
    wake();
  }
  function detach(win) {const record=records.get(win); records.delete(win); record?.release();}
  function mark(topics=['all']) {
    if(closed)return;
    revision++;
    const selected = Array.isArray(topics) && topics.length && topics.every(topic=>TOPICS.has(topic)) ? topics : ['all'];
    for(const record of records.values()) for(const topic of selected) record.dirty.add(topic);
    wake();
  }
  function flush() {
    if(closed)return;
    const cache=new Map();
    for(const record of records.values()) {
      const {win,surface}=record;
      if(win.isDestroyed()){detach(win);continue;}
      if(!visible(win)||record.inFlight||!record.dirty.size)continue;
      const topics=record.full||record.dirty.has('all')?['all']:[...record.dirty].sort();
      const full=topics[0]==='all',key=JSON.stringify([surface,topics]);
      try {
        if(!cache.has(key))cache.set(key,project(surface,topics));
        const token={generation:record.generation,revision:++record.revision};
        // Set before send so an immediate ACK from a test transport is also safe.
        record.inFlight={...token,sentAt:now()};record.dirty.clear();record.full=false;
        win.webContents.send('desktop:update',{...cache.get(key),sourceRevision:revision,snapshotPatch:!full,delivery:token});
      } catch(error) {record.inFlight=undefined;record.full=true;record.dirty.add('all');onError(error);}
    }
  }
  function ack(win, token) {
    const record=records.get(win),expected=record?.inFlight;
    if(!token||typeof token!=='object'||Array.isArray(token))return false;
    const rejected=Object.hasOwn(token,'applied')&&token.applied===false;
    if(Object.keys(token).length!==(rejected?3:2)
      ||!Number.isSafeInteger(token.generation)||!Number.isSafeInteger(token.revision)||!expected
      ||expected.generation!==token.generation||expected.revision!==token.revision)return false;
    const changed=record.dirty.size>0;
    record.inFlight=undefined;
    // A failed renderer released this exact delivery, but did not commit its state.
    // Keep a full projection pending; only a newer mark or explicit resync retries it.
    if(rejected){record.full=true;record.dirty.add('all');}
    if(changed)wake();
    return true;
  }
  return {attach,detach,mark,ack,flush,revision:()=>revision,
    resync(win){const record=records.get(win);if(record)reset(record);},
    stats(){return {revision,windows:records.size,pending:[...records.values()].map(record=>({surface:record.surface,
      inFlight:Boolean(record.inFlight),dirtyTopics:record.dirty.size,ageMs:record.inFlight?now()-record.inFlight.sentAt:0}))};},
    close(){closed=true;if(timer!==undefined)cancel(timer);timer=undefined;for(const win of [...records.keys()])detach(win);}};
}
