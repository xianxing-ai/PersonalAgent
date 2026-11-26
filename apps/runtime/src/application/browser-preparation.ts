export type PreparationAction='select_option'|'set_date'|'check_availability'|'add_to_cart';
type Field='arrival'|'departure'|'guests'|'rooms'|'variant'|'availability'|'cart';
export type Stay={arrival?:string;departure?:string;guests?:number;rooms?:number};
export type PreparationControl={field:Field;label:string;choiceLabel?:string;value?:string;productName?:string;productUrl?:string;
  userBoundProduct?:boolean;variantChoices?:string[];selectedChoices?:string[];quantity?:number;variantId?:string;beforeQuantity?:number;afterQuantity?:number;stay?:Stay};
export type PreparationIntent={stage:'cart'|'variant'|'stay'|'availability';request:string;stay:Stay;quantity:number;ambiguous:boolean};

const cartAction=/(?:加(?:入|到|进)?|添加到?|放入|放到|放进)(?:我的|这个|该)?购物[车袋]|加购|\badd\b.{0,80}\bto (?:my |the )?(?:shopping )?(?:cart|bag)\b/iu;
const variantAction=/(?:选中?|选择|选用|设为|换成|切换到)[^，。；！？\n]{0,40}(?:规格|颜色|尺码|型号|容量|件装|色|码|GB|TB)|(?:规格|颜色|尺码|型号|容量)\s*(?:选(?:择)?|设为|换成)|\b(?:select|choose) (?:the )?(?:size|color|variant)\b/iu;
const available=/(?:查(?:一下|看|询)?|看看?|找|检查|告诉我|确认|获取)[^，。；！？\n]{0,50}(?:空房|可订|可用房|有(?:没有|无)?房|房价|可预订|还剩.*房)|(?:有没有|有无|还有|是否有)(?:空房|房间|可订客房)|\b(?:check|search) (?:room )?availability\b/iu;
const numberWords:Record<string,string>={'零':'0','一':'1','二':'2','两':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9'};
function normalize(text:string):string {
  return text.normalize('NFKC').toLowerCase().replace(/([一二两三四五六七八九]?)十([一二三四五六七八九]?)/gu,
    (_m,tens:string,units:string)=>String(Number(numberWords[tens]??1)*10+Number(numberWords[units]??0)))
    .replace(/[零一二两三四五六七八九]/gu,c=>numberWords[c]!).trim();
}
const negative=/(?:不(?:要|用|需(?:要)?|准|得)?|别|勿|禁止|无需|避免|取消|do not|don't|never|without)/iu;
function requested(clauses:string[],pattern:RegExp):boolean {
  const relevant=clauses.filter(clause=>pattern.test(clause));
  return relevant.length>0&&!relevant.some(clause=>negative.test(clause.slice(0,clause.search(pattern)))
    ||/(?:不允许|被禁止|就算了|先不要|取消)$/u.test(clause));
}
function isoDate(year:number,month:number,day:number):string|undefined {
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):undefined;
}
function offsetDay(day:string,offset:number):string {
  return new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
}
function requestedStay(text:string,day?:string):{stay:Stay;ambiguous:boolean} {
  const dates:string[]=[];
  const roles:('arrival'|'departure'|undefined)[]=[];
  let ambiguous=false;
  for(const match of text.matchAll(/(?:(20\d{2})[-/.年])?(\d{1,2})[-/.月](\d{1,2})(?:日|号)?|今天|今晚|明天|明晚|后天|后晚|(?:到|至|—)\s*(\d{1,2})[日号]/gu)){
    const last=dates.at(-1),anchor=last??day;
    if(!anchor&&!match[1]){ambiguous=true;continue;}
    let date:string|undefined;
    if(match[2]||match[4]){
      const year=Number(match[1]??anchor!.slice(0,4)),month=Number(match[2]??anchor?.slice(5,7));
      date=isoDate(year,month,Number(match[3]??match[4]));
      if(date&&!match[1]&&anchor&&date<anchor)date=match[4]?undefined:isoDate(year+1,month,Number(match[3]));
    }else if(day)date=offsetDay(day,/^明/u.test(match[0])?1:/^后/u.test(match[0])?2:0);
    if(date){
      dates.push(date);
      const before=text.slice(Math.max(0,match.index-12),match.index),after=text.slice(match.index+match[0].length,match.index+match[0].length+8);
      const role=/^(?:\s*)(入住|离店|退房)/u.exec(after)?.[1]??/(入住|离店|退房)(?:日期|时间)?\s*[:为]?\s*$/u.exec(before)?.[1];
      roles.push(role==='入住'?'arrival':role?'departure':undefined);
    }else ambiguous=true;
  }
  const nights=/(?:住|共|连住)\s*(\d+)\s*(?:晚|夜)/u.exec(text);
  if(dates.length===1&&roles[0]!=='departure'&&nights&&Number(nights[1])>0&&Number(nights[1])<=365)dates.push(offsetDay(dates[0]!,Number(nights[1])));
  if(dates.length===2&&(roles[0]==='departure'||roles[1]==='arrival'))ambiguous=true;
  if(dates.length>2||dates.length===2&&dates[0]!>=dates[1]!)ambiguous=true;
  const numbers=(re:RegExp)=>[...new Set([...text.matchAll(re)].map(m=>Number(m[1])))];
  const guests=numbers(/(\d+)\s*(?:(?:位|名|个)\s*(?:成人|大人|客人|住客)|成人|大人|人(?:入住|住|出行)?|位(?=\s*入住|[，。；\s]|$))/gu);
  const rooms=numbers(/(\d+)\s*间(?:客房|房间|房)?/gu);
  if(guests.length>1||rooms.length>1||guests.includes(0)||rooms.includes(0)||/儿童|小孩|婴儿|\d+大\d+小/u.test(text))ambiguous=true;
  const departureOnly=dates.length===1&&roles[0]==='departure';
  return {stay:{...(dates[0]&&!departureOnly?{arrival:dates[0]}:{}),...(departureOnly||dates[1]?{departure:departureOnly?dates[0]!:dates[1]!}:{}),
    ...(guests[0]?{guests:guests[0]}:{}),...(rooms[0]?{rooms:rooms[0]}:{})},ambiguous};
}

/** Select preparation from a human request; HTML, tool proposals and generated subtask text are never inputs. */
export function browserPreparationIntent(text:string,day?:string):PreparationIntent|undefined {
  const request=normalize(text.replace(/https?:\/\/[^\s，。；！？]+/giu,' '));
  const instruction=request.replace(/“[^”]*”|「[^」]*」|"[^"\n]*"/gu,'〈选项〉');
  if(!instruction||/^(?:(?:请|帮我)\s*)?(?:如何|怎么|解释|介绍|教我|能不能|可以吗|告诉我怎么)|(?:按照?|照着|依照)(?:这个)?(?:网页|页面)(?:的)?(?:提示|要求|指示|说明)/u.test(instruction))return;
  const clauses=instruction.split(/[，,。；;！!\n]|然后|接着|并且|并(?=加|把|选)|再(?=加|把|选)/u);
  const cartClauses=clauses.filter(clause=>{
    const before=clause.slice(0,clause.search(cartAction)).trim();
    return !/(?:提到|写着|显示|示例|演示|教程|什么|如何|怎么|解释|介绍|按钮|页面说|网页说)/u.test(clause)
      &&(!before||negative.test(before)||/^(?:(?:请你?|帮我|给我|替我|先|只|直接|现在|可以帮我|麻烦)\s*)*(?:(?:把|将|选中?|购买|买|请|想要|想)\s*[^，。；！？]*)?$/u.test(before));
  });
  const cart=requested(cartClauses,cartAction),variant=requested(clauses,variantAction);
  const lodging=/(?:酒店|宾馆|饭店|住宿|民宿|客房|入住|离店|退房|房间|房价|空房)/u.test(request);
  const {stay,ambiguous}=requestedStay(request,day);
  const availability=lodging&&requested(clauses,available)&&(Object.keys(stay).length>0||/空房|可订|有没有房|可预订|availability/iu.test(request));
  const setup=lodging&&Object.keys(stay).length>0&&/(?:入住|退房|离店|设置|选择|住(?:房|店|\d)|查房|查酒店|搜酒店|找酒店|预订|订酒店)/u.test(request);
  if(!cart&&!variant&&!availability&&!setup)return;
  const amount=/(?:数量(?:为|选|设为|是)?)\s*[:]?\s*(\d+)|(?:加购|买|将|把|加入购物[车袋])\s*(\d+)\s*(?:件|个|盒|套|份|组)(?!装)/u.exec(request);
  const quantity=Number(amount?.[1]??amount?.[2]??1);
  return {stage:cart?'cart':variant?'variant':availability?'availability':'stay',request,stay,quantity,
    ambiguous:(lodging&&ambiguous)||cart&&(!Number.isSafeInteger(quantity)||quantity<1)};
}

function sameProduct(text:string,control:PreparationControl):boolean {
  const name=normalize(control.productName??'');
  if(name&&normalize(text).includes(name))return true;
  if(control.userBoundProduct===true&&/(?:当前|这款|这[件个]|本页)(?:的)?(?:商品|产品|物品|款式)|(?:把|将)(?:这款|这[件个])(?:加|放|选)/u.test(text))return true;
  if(!control.productUrl)return false;
  const canonical=(value:string)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.origin+u.pathname.replace(/\/$/u,''):undefined;}catch{return undefined;}};
  const actual=canonical(control.productUrl);
  if(!actual)return false;
  return [...text.matchAll(/https?:\/\/[^\s，。；！？"」)]+/giu)].some(match=>canonical(match[0])===actual);
}

function mentionsChoice(request:string,choice:string):boolean {
  const option=normalize(choice).replace(/\s+/gu,'');
  if(!option)return false;
  return request.split(/[，,。；;！!\n]/u).some(clause=>{
    const clean=clause.replace(/\s+/gu,'');
    const offset=clean.indexOf(option);
    return offset>=0&&!negative.test(clean.slice(0,offset));
  });
}

export function requestedChoices(intent:PreparationIntent,choices:readonly string[]|undefined):string[] {
  return (choices??[]).filter(choice=>mentionsChoice(intent.request,choice));
}

export function preparationMatches(intent:PreparationIntent,text:string,action:unknown,value:unknown,control:PreparationControl):boolean {
  if(intent.ambiguous||!control||typeof control.label!=='string')return false;
  const {field}=control;
  if(field==='cart'){
    if(intent.stage!=='cart'||action!=='add_to_cart'||value!==undefined||control.quantity!==intent.quantity||!control.variantId||!sameProduct(text,control))return false;
    const requested=requestedChoices(intent,control.variantChoices);
    if(requestedVariant(intent)&&!requested?.length)return false;
    if(control.selectedChoices?.some(choice=>intent.request.split(/[，,。；;！!\n]/u).some(clause=>{
      const option=normalize(choice).replace(/\s+/gu,''),clean=clause.replace(/\s+/gu,''),index=clean.indexOf(option);
      return !!option&&index>=0&&negative.test(clean.slice(0,index));
    })))return false;
    return !requested?.length||requested.every(choice=>control.selectedChoices?.includes(choice));
  }
  if(field==='variant') {
    if(!['cart','variant'].includes(intent.stage)||action!=='select_option'||typeof value!=='string'||!value||!control.choiceLabel)return false;
    return mentionsChoice(intent.request,control.choiceLabel)&&sameProduct(text,control);
  }
  if(intent.stage!=='availability'&&intent.stage!=='stay')return false;
  if(field==='availability')return intent.stage==='availability'&&action==='check_availability'&&value===undefined
    &&!!intent.stay.arrival&&!!intent.stay.departure&&!!control.stay
    &&Object.entries(intent.stay).every(([key,v])=>control.stay?.[key as keyof Stay]===v);
  if(field==='arrival'||field==='departure')return action==='set_date'&&typeof value==='string'&&value===intent.stay[field];
  if(field==='guests'||field==='rooms'){
    const expected=intent.stay[field];
    if(action!=='select_option'||expected===undefined||typeof value!=='string'||!control.choiceLabel)return false;
    const label=normalize(control.choiceLabel);
    const count=/^(\d+)\s*(?:位|间|人|名|成人|位成人|rooms?|adults?|guests?)?$/iu.exec(label);
    return count!==null&&Number(count[1])===expected;
  }
  return false;
}

function requestedVariant(intent:PreparationIntent):boolean {
  return requested(intent.request.split(/[，,。；;！!\n]/u),variantAction);
}
