import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {segmentConversationContext} from './context-compaction.js';
import type {CompactableContextMessage,ContextCompactionReceipt} from './context-compaction.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity=(message:CompactableContextMessage)=>hash([message.id,message.taskId??null]);
function reject():never {throw new ProtocolError('REVISION_CONFLICT','Original context source mapping changed');}

/** Hash-only provenance for the actual compiled history. Summaries remain derived
 * data; tool continuations still require their original Runtime Evidence guards. */
export function bindF27ContextSourceMap(input:{
  source:readonly CompactableContextMessage[];
  assembled:readonly CompactableContextMessage[];
  selected:readonly CompactableContextMessage[];
  receipt?:ContextCompactionReceipt;
}) {
  const {source,assembled,selected,receipt}=input;
  for(const messages of [source,assembled,selected]) {
    if(!Array.isArray(messages)||new Set(messages.map(message=>message.id)).size!==messages.length
      ||messages.some(message=>typeof message.id!=='string'||!message.id||!['user','assistant'].includes(message.role)
        ||typeof message.content!=='string'||message.withheld===true))reject();
  }
  const origins=source.map(message=>({identityDigest:identity(message),contentDigest:hash(message.content),role:message.role}));
  let mappings:{identityDigest:string;contentDigest:string;kind:'original'|'summary';sourceStart:number;sourceEnd:number}[];
  if(!receipt) {
    if(!isDeepStrictEqual(source,assembled))reject();
    mappings=origins.map((item,index)=>({...item,kind:'original',sourceStart:index,sourceEnd:index+1}));
  }else {
    if(receipt.version!==1||receipt.sourceCount!==source.length||receipt.sourceDigest!==hash(source)
      ||!Array.isArray(receipt.segments)||!receipt.segments.length)reject();
    const count=receipt.segments.length,boundary=source.length-(assembled.length-count);
    if(boundary<1||boundary>source.length||!isDeepStrictEqual(assembled.slice(count),source.slice(boundary))
      ||receipt.tailDigest!==hash(source.slice(boundary)))reject();
    const prefix=source.slice(0,boundary),segments=segmentConversationContext(prefix,receipt.policy.segmentCharacters);
    if(segments.length!==count)reject();
    const summaries:string[]=[];let offset=0;
    mappings=segments.map((segment,index)=>{
      const message=assembled[index]!,range=receipt.segments[index]!;
      let derived:{kind?:unknown;treatment?:unknown;text?:unknown};
      try{derived=JSON.parse(message.content);}catch{return reject();}
      if(!derived||derived.kind!=='derived_conversation_summary'||derived.treatment!=='untrusted_data'||typeof derived.text!=='string'
        ||Object.keys(derived).sort().join(',')!=='kind,text,treatment'||message.id!==`context-summary:${hash(prefix)}:${index}`
        ||message.role!=='assistant'||message.taskId!==undefined||range.index!==index||range.rangeDigest!==segment.rangeDigest
        ||range.firstIdentityDigest!==identity(segment.messages[0]!)||range.lastIdentityDigest!==identity(segment.messages.at(-1)!)
        ||range.sourceCharacters!==JSON.stringify(segment.messages).length||range.summaryDigest!==hash(derived.text)
        ||range.summaryCharacters!==derived.text.length)reject();
      summaries.push(derived.text);
      const start=offset;offset+=segment.messages.length;
      return {identityDigest:identity(message),contentDigest:hash(message.content),kind:'summary',sourceStart:start,sourceEnd:offset};
    });
    if(receipt.summaryDigest!==hash(summaries)||offset!==boundary)reject();
    mappings.push(...origins.slice(boundary).map((item,index)=>({...item,kind:'original' as const,sourceStart:boundary+index,sourceEnd:boundary+index+1})));
  }
  let last=-1;
  const selectedMappings=selected.map(message=>{
    const index=assembled.findIndex(item=>item.id===message.id);
    if(index<=last||!isDeepStrictEqual(assembled[index],message))reject();
    last=index;return mappings[index]!;
  });
  return {version:1 as const,sourceDigest:hash(source),assembledDigest:hash(assembled),selectedDigest:hash(selected),
    sources:origins,selected:selectedMappings,...(receipt?{compactionReceiptDigest:hash(receipt)}:{})};
}
