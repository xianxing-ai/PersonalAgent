import {isDeepStrictEqual} from 'node:util';
const terminal = task => ['succeeded','failed','cancelled'].includes(task.state);

/** Erasure may change derived visibility without a new task revision. Check the small trusted
 * marker at the final display boundary, including on a pinned older page and after a late event. */
export function readSafeTaskProjection(task,{runtime,delivery,cache,goals}) {
  if(runtime?.loadCheckpoint(task.taskId,'private-copy-erasure')!==undefined) {
    delivery?.clearBody(task.taskId);goals?.delete(task.taskId);
    const current={...runtime.getTask(task.taskId),createdAt:task.createdAt};cache?.set(task.taskId,current);
    return {...current,bodyWithheld:true};
  }
  return delivery?.project(task)??task;
}

/** Bounded terminal display cache. Active/unresolved tasks and visible page references are pinned;
 * evicting a projection never deletes or changes a Runtime record. */
export class TaskProjectionCache extends Map {
  constructor({terminalLimit=200,pinned=()=>new Set()}={}) {super();this.terminalLimit=terminalLimit;this.pinned=pinned;this.version=0;this.terminals=new Set();}
  discardOrder() {this.sorted=undefined;this.sortIndexes=undefined;this.sortedVersion=undefined;}
  set(id,task) {
    const previous=super.get(id);
    if(previous?.revision>task.revision)return this;
    const value={...task,createdAt:task.createdAt??previous?.createdAt??task.updatedAt};
    // Derived redaction can change a public readback without changing the task revision.
    if(previous?.revision===task.revision&&isDeepStrictEqual(previous,value))return this;
    const sortedIndex=this.sortedVersion===this.version&&previous?.createdAt===value.createdAt?this.sortIndexes?.get(id):undefined;
    super.delete(id);super.set(id,value);this.terminals.delete(id);if(terminal(value))this.terminals.add(id);
    this.version++;
    if(sortedIndex!==undefined){this.sorted[sortedIndex]=value;this.sortedVersion=this.version;}
    else this.discardOrder();
    this.prune();return this;
  }
  delete(id) {const deleted=super.delete(id);this.terminals.delete(id);if(deleted){this.version++;this.discardOrder();}return deleted;}
  clear() {super.clear();this.terminals.clear();this.discardOrder();this.version++;}
  prune() {
    const pinned=this.pinned();
    let evictable=this.terminals.size;
    for(const id of pinned)if(this.terminals.has(id))evictable--;
    if(evictable<=this.terminalLimit)return;
    for(const id of this.terminals){if(evictable<=this.terminalLimit)break;
      if(!pinned.has(id)){super.delete(id);this.terminals.delete(id);evictable--;this.version++;}}
    // Hidden windows may never ask for another ordered snapshot. Release evicted
    // bodies now instead of keeping the obsolete array alive until that happens.
    this.discardOrder();
  }
  ordered(readCreatedAt) {
    if(this.sortedVersion!==this.version){
      this.sorted=[...this.values()].sort((a,b)=>{
        const left=String(readCreatedAt(a)),right=String(readCreatedAt(b));
        return left<right?-1:left>right?1:a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0;
      });
      this.sortIndexes=new Map(this.sorted.map((task,index)=>[task.taskId,index]));
      this.sortedVersion=this.version;
    }
    return this.sorted;
  }
}
