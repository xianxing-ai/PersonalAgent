/** Pin once per focus/edit session. This never touches input, composition or selection. */
export function mountInputPin(input,invoke,isPinned,report){
  let attempted=false,pending=false;
  const ensure=()=>{
    if(attempted||pending||isPinned())return;
    attempted=true;pending=true;
    Promise.resolve().then(()=>invoke('panel.pin',true)).catch(report).finally(()=>{pending=false;});
  };
  input.addEventListener('focus',()=>{attempted=false;ensure();});
  input.addEventListener('input',ensure);
}
