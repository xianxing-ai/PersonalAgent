/** One last committed display snapshot. Successful ACK only follows rendering; applied:false
 * releases a failed delivery without committing it, so a later full projection can recover.
 * The host owns
 * generation/revision and all authorization. A missing baseline requests a scoped full resync. */
export function createSnapshotReceiver({render,ack=()=>{},resync=()=>{}}) {
  let current,generation=0,revision=0,sourceRevision=-1;
  return {
    receive(value) {
      const token=value?.delivery;
      if(token) {
        if(!Number.isSafeInteger(token.generation)||!Number.isSafeInteger(token.revision))throw Error('状态版本无效');
        if(token.generation<generation||token.generation===generation&&token.revision<=revision){ack(token);return false;}
        if(value.snapshotPatch&&(!current||token.generation!==generation||token.revision!==revision+1)){resync();return false;}
      } else if(value?.snapshotPatch){resync();return false;}
      if(Number.isSafeInteger(value.sourceRevision)&&value.sourceRevision<sourceRevision){if(token){generation=token.generation;revision=token.revision;ack(token);}return false;}
      const {snapshotPatch,delivery,...data}=value;
      const next=snapshotPatch?{...current,...data}:data;
      try {render(next);} catch(error) {
        // Keep the last committed baseline. A rejection is not a successful render ACK.
        // Reporting it must not replace the original render failure if the bridge also fails.
        if(token)try{ack({...token,applied:false});}catch{}
        throw error;
      }
      current=next;
      if(Number.isSafeInteger(value.sourceRevision))sourceRevision=value.sourceRevision;
      if(token){generation=token.generation;revision=token.revision;ack(token);}
      return true;
    },
    adopt(value){
      if(Number.isSafeInteger(value.sourceRevision)&&value.sourceRevision<sourceRevision)return current;
      current=value;if(Number.isSafeInteger(value.sourceRevision))sourceRevision=value.sourceRevision;return value;
    },
    clear(){current=undefined;generation=0;revision=0;sourceRevision=-1;},
  };
}
