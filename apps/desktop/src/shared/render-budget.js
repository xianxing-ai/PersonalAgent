// Resource pressure does not change the saved motion preference. Reduced motion and hidden
// Canvas pause remain handled by the existing consumers. Background windows draw less often.
export function mountRenderBudget(apply,{window:win=window,document:doc=document}={}) {
  let budget={mode:'normal',fps:30,maxDpr:2},closed=false;
  const sync=()=>{
    if(closed)return;
    const focused=doc.hasFocus();
    doc.documentElement.dataset.resourceMode=budget.mode;
    doc.documentElement.dataset.renderActivity=doc.hidden?'hidden':focused?'foreground':'background';
    apply({...budget,fps:focused?budget.fps:Math.min(budget.fps,12),maxDpr:focused?budget.maxDpr:Math.min(budget.maxDpr,1.5)});
  };
  win.addEventListener('focus',sync);win.addEventListener('blur',sync);doc.addEventListener('visibilitychange',sync);
  return {update(value){
    if(value&&['normal','constrained','critical'].includes(value.mode)&&Number.isFinite(value.fps)&&Number.isFinite(value.maxDpr))budget=value;
    sync();
  },dispose(){closed=true;win.removeEventListener('focus',sync);win.removeEventListener('blur',sync);doc.removeEventListener('visibilitychange',sync);}};
}
