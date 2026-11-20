import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw new ProtocolError('UNAUTHORIZED','原发布完整内容未确认或已改变');};
const key=scope=>JSON.stringify([scope.taskId,scope.runId]);
const metadata=preview=>({baseHeadSha:preview.baseHeadSha,headSha:preview.headSha,treeSha:preview.treeSha,fingerprint:preview.fingerprint});

/** Local preview only. The original question/Policy still authorizes the original arguments. */
export function createPublicationContentHost({readBinding,readPreview}) {
  const prepared=new Map();
  const current=(scope,binding)=>{try{return !scope.signal.aborted&&Date.parse(scope.deadline)>Date.now()&&isDeepStrictEqual(readBinding(scope),binding);}catch{return false;}};
  return {
    async prepare(scope,question){
      const binding=readBinding(scope);if(!binding)return;
      if(typeof readPreview!=='function')throw new ProtocolError('UNSUPPORTED_CAPABILITY','原发布完整差异读取尚未装配');
      const preview=await readPreview(binding.input,scope);
      if(!current(scope,binding)||!preview||preview.baseHeadSha!==binding.input.baseHeadSha||preview.headSha!==binding.input.expectedHeadSha
        ||typeof preview.diff!=='string'||!preview.diff||preview.diffDigest!==hash(preview.diff)
        ||!isDeepStrictEqual(preview.paths,[...binding.input.paths].sort()))fail();
      const text=JSON.stringify({operation:binding.operation,baseHeadSha:preview.baseHeadSha,headSha:preview.headSha,
        treeSha:preview.treeSha,paths:preview.paths},null,2)+'\n\n完整 Git 差异（未截断）：\n'+preview.diff;
      if(text.length>950_000)throw new ProtocolError('UNSUPPORTED_CAPABILITY','完整发布内容超过本机确认范围，未截断或批准');
      const entry={binding,metadata:metadata(preview),diffDigest:preview.diffDigest,question};
      const prior=prepared.get(key(scope));if(prior&&(!isDeepStrictEqual(prior.binding,binding)||!isDeepStrictEqual(prior.metadata,entry.metadata)||prior.diffDigest!==entry.diffDigest))fail();
      question.prepare(scope,{contentConfirmation:{digest:hash(text),text},assertCurrent:()=>current(scope,binding)});
      prepared.set(key(scope),entry);
    },
    async recheck(scope){
      const entry=prepared.get(key(scope));if(!entry||!current(scope,entry.binding))fail();
      const preview=await readPreview(entry.binding.input,scope);
      if(!current(scope,entry.binding)||!isDeepStrictEqual(metadata(preview),entry.metadata)||preview.diffDigest!==entry.diffDigest)fail();
    },
    assertContent(scope,content){
      const entry=prepared.get(key(scope));if(!entry||!current(scope,entry.binding)||!isDeepStrictEqual(content,entry.metadata))fail();
      entry.question.currentRequirement(scope,'tool');
    },
  };
}
