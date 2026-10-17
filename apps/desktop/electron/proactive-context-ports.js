import {ProtocolError} from '@personal-agent/contracts';

/** Reuse the current host-owned public Memory, Goal store and exact Knowledge lease. */
export function createDesktopProactiveContextPorts({readMemory,readGoals,readKnowledgeSource,limit}) {
  if(!Number.isSafeInteger(limit)||limit<1)throw Error('持续上下文需使用宿主现有查询上限');
  const memory=readMemory?.(),goals=readGoals?.(),source=readKnowledgeSource?.(),binding=source?.snapshot();
  const publicKnowledge=binding?.available&&binding.dataLevel==='public'&&binding.cloudExportAllowed===true?{
    async search(request) {
      const assertSource=()=>{
        const current=source.snapshot();
        if(current?.available!==true)
          throw new ProtocolError('SOURCE_UNAVAILABLE','原公开知识源当前不可用，需重新核实');
        if(current.dataLevel!=='public'||current.cloudExportAllowed!==true||!current.publicQueries?.includes(request.query))
          throw new ProtocolError('SCOPE_DENIED','当前知识查询未在原公开来源授权范围，需重新核实');
        if(current.sourceId!==binding.sourceId||current.configRevision!==binding.configRevision)
          throw new ProtocolError('SOURCE_CHANGED','原公开知识源版本已变化，需重新核实');
      };
      assertSource();
      let lease;
      try{
        lease=source.acquire(binding,request.signal);lease.assertCurrent();
        const result=await lease.read.search({...request,signal:lease.signal});
        assertSource();lease.assertCurrent();return result;
      }catch(error){
        // Reclassify only an observed source/permission change. Unrelated read failures keep their original identity.
        assertSource();throw error;
      }finally{lease?.release();}
    },
  }:undefined;
  return {limit,...(memory?{publicMemory:memory}:{}),...(goals?{goals}:{}),...(publicKnowledge?{publicKnowledge}:{})};
}
