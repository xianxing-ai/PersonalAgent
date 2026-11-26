// This function runs on the observed DOM nodes. Its output is evidence about
// the page, never authority to operate on it.
export function readPreparationFields(nodes){
  const safeText=value=>typeof value==='string'?value.replace(/\s+/gu,' ').trim().slice(0,160):'';
  const heading=[...document.querySelectorAll('main h1,product-info h1,[role="main"] h1,h1')]
    .find(el=>!el.closest('header,nav,footer')&&el.getClientRects().length&&el.innerText?.trim());
  const title=safeText(heading?.innerText);
  const fieldOf=text=>/入住|到店|check[\s_-]?in|arrival|start[\s_-]?date/i.test(text)?'arrival':
    /退房|离店|check[\s_-]?out|departure|end[\s_-]?date/i.test(text)?'departure':
    /人数|成人|住客|guests?|adults?/i.test(text)?'guests':/间数|客房数|房间数|number of rooms|room count|^rooms?$/i.test(text)?'rooms':
    /规格|颜色|尺寸|容量|大小|型号|数量|套装|版本|size|colou?r|variant|capacity|pack|style|material|option/i.test(text)?'variant':undefined;
  function formEntries(form,button){
    const values=[];
    for(const entry of form.elements){
      if(!entry.name||entry.disabled||entry.matches(':disabled')||['reset','button'].includes(entry.type)||
        ['submit','image'].includes(entry.type)&&entry!==button||['radio','checkbox'].includes(entry.type)&&!entry.checked)continue;
      if(entry.type==='file'||entry.multiple||typeof entry.value!=='string')return;
      values.push([entry.name,entry.value]);
    }
    return new URLSearchParams(values);
  }
  function choices(element){
    const box=element.closest('product-info,[data-product-id],section')??element.form??element;
    const variantChoices=[],selectedChoices=[];
    for(const control of box.querySelectorAll('select[name^="options"],fieldset input[type="radio"]')){
      if(control.tagName==='SELECT'){
        for(const option of control.options){const choice=safeText(option.label);if(choice){variantChoices.push(choice);if(option.selected)selectedChoices.push(choice);}}
      }else{const choice=safeText(control.value);if(choice){variantChoices.push(choice);if(control.checked)selectedChoices.push(choice);}}
    }
    if(variantChoices.length<=80&&selectedChoices.length<=4)return {variantChoices,selectedChoices};
  }
  return nodes.map(original=>{
    const el=original.tagName==='LABEL'&&original.control?.type==='radio'?original.control:original;
    if(!el?.isConnected||el.ownerDocument!==document||el.disabled)return null;
    const tag=el.tagName.toLowerCase(),type=el.type;
    const label=safeText(el.labels?.[0]?.innerText||el.getAttribute('aria-label')||el.innerText||el.getAttribute('placeholder')||
      (tag==='input'&&type==='submit'?el.value:'')||el.name);
    const hint=[el.name,el.id,el.closest('fieldset')?.querySelector('legend')?.innerText,label].filter(Boolean).join(' ');
    const field=fieldOf(hint);
    const product=field==='variant'&&title?{productName:title,productUrl:location.origin+location.pathname,...choices(el)}:{};
    if(tag==='input'&&type==='date'&&['arrival','departure'].includes(field))
      return {action:'set_date',field,label,value:el.value,min:el.min,max:el.max};
    if(tag==='select'&&!el.multiple&&['guests','rooms','variant'].includes(field))
      return {action:'select_option',field,label,...product,value:el.value,options:Array.from(el.options).slice(0,40)
        .filter(o=>!o.disabled&&!o.closest('optgroup[disabled]')).map(o=>({value:o.value.slice(0,200),label:safeText(o.label)}))};
    if(tag==='input'&&type==='radio'&&field==='variant')
      return {action:'select_option',field,label,...product,value:el.value.slice(0,200),checked:el.checked,options:[{value:el.value.slice(0,200),label}]};
    const form=el.form,submit=(tag==='button'||tag==='input')&&type==='submit'&&form;
    if(submit&&/^(?:add to (?:shopping )?(?:cart|bag)(?:\s+added)?|加入(?:购物车|购物袋)(?:\s*已加入)?)$/iu.test(label)&&title){
      const doc=new URL(location.href),url=new URL(el.getAttribute('formaction')||form.action,doc);
      const path=/^(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?)products\/([a-z0-9-]+)\/?$/i.exec(doc.pathname);
      if(!path||doc.protocol!=='https:'||doc.port||!/^[-a-z0-9]+\.myshopify\.com$/i.test(doc.hostname)
        ||url.origin!==doc.origin||url.search||url.hash||url.pathname!==path[1]+'cart/add'
        ||(el.getAttribute('formmethod')||form.method).toLowerCase()!=='post')return null;
      const data=formEntries(form,el);if(!data)return null;
      const ids=data.getAll('id'),quantities=data.getAll('quantity');
      if(ids.length!==1||!/^\d{1,16}$/.test(String(ids[0]))||quantities.length>1||
        !/^[1-9]\d{0,4}$/.test(String(quantities[0]??1))||[...data].some(([k,v])=>
          !(k==='add'&&!v||['id','quantity','form_type','utf8','product-id','section-id','sections','sections_url'].includes(k))))return null;
      const variants=choices(form);if(!variants)return null;
      return {action:'add_to_cart',field:'cart',label,productName:title,productUrl:doc.origin+doc.pathname,...variants,
        variantId:String(ids[0]),quantity:Number(quantities[0]??1),cartBase:doc.origin+path[1]};
    }
    if(!/查看(?:可订|可预订|房价)|查询(?:房价|余房|空房|可订)|查房价|check (?:rates|availability)|view (?:availability|rates)|search (?:availability|rooms)/iu.test(label)||
      /支付|付款|结算|确认预订|下单|pay|checkout|confirm reservation|book now|purchase/iu.test(label))return null;
    let url;
    if(tag==='a'&&!el.hasAttribute('download'))url=new URL(el.href,location.href);
    else if(submit&&(el.getAttribute('formmethod')||form.method).toLowerCase()==='get'){
      url=new URL(el.getAttribute('formaction')||form.action,location.href);
      const fields=formEntries(form,el);if(!fields)return null;
      for(const [k,v] of fields)url.searchParams.append(k,v);
    }else return null;
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>4096||
      !/(?:availab|rates?|rooms?|search|booking\/select)/i.test(url.pathname)||/(?:checkout|payment|purchase|create|confirm|reserve|submit)/i.test(url.pathname))return null;
    url.hash='';return {action:'check_availability',field:'availability',label,href:url.href};
  });
}

function stayParameters(url){
  const stay={},parties=new Map(),keys=new Set();
  const ukHotel=url.hostname==='travelodge.co.uk'||url.hostname==='www.travelodge.co.uk';
  for(const [key,value] of url.searchParams){
    const raw=key.toLowerCase().replace(/[-_]/g,'');
    if(keys.has(raw))return;keys.add(raw);
    const room=/^rooms\[(\d{1,2})\]\[(adults|children)\]$/.exec(raw);
    if(room){
      if(!/^\d{1,2}$/.test(value)||room[2]==='adults'&&Number(value)<1)return;
      const group=parties.get(room[1])??{};group[room[2]]=Number(value);parties.set(room[1],group);continue;
    }
    const field=/^(?:arrival(?:date)?|checkin(?:date)?|startdate)$/.test(raw)?'arrival':
      /^(?:departure(?:date)?|checkout(?:date)?|enddate)$/.test(raw)?'departure':
      /^(?:guests?|adults?|numberofguests)$/.test(raw)?'guests':/^(?:rooms?|numberofrooms)$/.test(raw)?'rooms':undefined;
    if(!field){
      if(!/^(?:hotel|hotelcode|hotelid|property|propertyid|locale|lang|currency|brand|destination)$/.test(raw)||!/^[\p{L}\d -]{1,48}$/u.test(value))return;
      continue;
    }
    if(Object.hasOwn(stay,field))return;
    if(field==='arrival'||field==='departure'){
      const iso=ukHotel?value.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/,'$3-$2-$1'):value;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso)return;
      stay[field]=iso;
    }else {if(!/^[1-9]\d?$/.test(value))return;stay[field]=Number(value);}
  }
  if(parties.size){
    if(stay.guests||stay.rooms||[...parties.values()].some(p=>!p.adults))return;
    stay.rooms=parties.size;stay.guests=[...parties.values()].reduce((n,p)=>n+p.adults+(p.children??0),0);
  }
  if(stay.arrival&&stay.departure&&stay.arrival>=stay.departure)return;
  return stay;
}

export function observedAvailability(url,text,controls){
  const stay=stayParameters(url);
  if(!stay?.arrival||!stay.departure||!stay.guests||!stay.rooms)return;
  const visible=[text,...controls.map(c=>c.name)].join('\n');
  const hasDate=iso=>{
    const date=new Date(iso),day=date.getUTCDate(),month=date.toLocaleString('en-GB',{month:'short',timeZone:'UTC'});
    return visible.includes(iso)||new RegExp('\\b(?:'+day+'\\s+'+month+'[a-z]*|'+month+'[a-z]*\\s+'+day+')\\b','iu').test(visible);
  };
  const nights=(Date.parse(stay.departure)-Date.parse(stay.arrival))/86400000;
  if(!hasDate(stay.arrival)||!hasDate(stay.departure)&&!new RegExp('\\b'+nights+'\\s+nights?\\b','iu').test(visible)||
    !new RegExp('\\b'+stay.guests+'\\s+(?:adults?|guests?)\\b','iu').test(visible)||!new RegExp('\\b'+stay.rooms+'\\s+rooms?\\b','iu').test(visible))return;
  const price=/(?:[£$€¥￥]\s*\d[\d,.]*|\b(?:GBP|EUR|USD|CNY|RMB)\s*\d[\d,.]*)/iu;
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    if(!price.test(lines[i])||!/(?:room|per night|房型|每晚)/iu.test(lines.slice(Math.max(0,i-3),i+3).join(' ')))continue;
    return {stay,state:'rates_shown',evidence:lines[i].slice(0,180)};
  }
  const sold=lines.find(l=>/no rooms? available|no availability|没有可订客房|客房已售罄/iu.test(l));
  if(sold)return {stay,state:'sold_out',evidence:sold.slice(0,180)};
}

export function preparationPlan(meta,args,documentUrl){
  if(!meta||meta.action!==args.action)return;
  const {action,field,label}=meta,base={action,field,label,ref:args.ref};
  if(action==='set_date'){
    const v=args.value;
    if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||
      new Date(v).toISOString().slice(0,10)!==v||meta.min&&v<meta.min||meta.max&&v>meta.max)return;
    return {...base,value:v};
  }
  if(action==='select_option'){
    const matches=meta.options.filter(o=>o.value===args.value);
    if(!args.value||matches.length!==1||!matches[0].label)return;
    return {...base,value:args.value,choiceLabel:matches[0].label,...(meta.productName?{productName:meta.productName,productUrl:meta.productUrl}:{})};
  }
  if(args.value!==undefined)return;
  if(action==='check_availability'){
    let url;try{url=new URL(meta.href);}catch{return;}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||url.href.length>4096||
      !/(?:availab|rates?|rooms?|search|booking\/select)/i.test(url.pathname)||/(?:checkout|payment|purchase|create|confirm|reserve|submit)/i.test(url.pathname))return;
    const stay=stayParameters(url);
    return stay?{...base,stay}:undefined;
  }
  if(action==='add_to_cart'){
    let doc;try{doc=new URL(documentUrl);}catch{return;}
    const path=/^(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?)products\/([a-z0-9-]+)\/?$/i.exec(doc.pathname);
    if(!path||doc.protocol!=='https:'||doc.username||doc.password||doc.port||!/^[-a-z0-9]+\.myshopify\.com$/i.test(doc.hostname)||
      meta.cartBase!==doc.origin+path[1]||meta.productUrl!==doc.origin+doc.pathname||!/^\d{1,16}$/.test(meta.variantId)||
      !Number.isSafeInteger(meta.quantity)||meta.quantity<1||meta.quantity>99_999||!meta.productName)return;
    return {...base,productName:meta.productName,productUrl:meta.productUrl,variantId:meta.variantId,quantity:meta.quantity};
  }
}

// BrowserContext.request uses this same context's cookies and mandatory
// authenticated egress proxy. Redirects and retries are disabled on every call.
// Shopify's storefront Cart Ajax API accepts item variants; no checkout or
// payment API is exposed. Never project cart tokens, other lines or customer data.
export async function addShopifyItem({page,meta,check,timeout,validate,markDispatched,fail}){
  const read=async(url,body)=>{
    check();
    const response=await page.context().request.fetch(url,{method:body?'POST':'GET',...(body?{data:body}:{}),
      headers:{accept:'application/json'},maxRedirects:0,maxRetries:0,timeout:timeout()});
    try{
      check();
      if(response.url()!==url||!(response.status()===200||body&&response.status()===201)||!/^application\/json\b/i.test(response.headers()['content-type']??''))
        fail('EXTERNAL_FAILURE','商店未确认原商品或购物袋');
      const bytes=await response.body();if(bytes.length>2_097_152)fail('INVALID_ARGUMENT','商店数据超过读取上限');
      return JSON.parse(bytes.toString('utf8'));
    }finally{await response.dispose();}
  };
  const product=await read(meta.productUrl.replace(/\/$/,'')+'.js');
  const item=product.variants?.find(v=>String(v.id)===meta.variantId);
  const title=value=>typeof value==='string'?value.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase():undefined;
  if(!item||item.available!==true||title(product.title)!==title(meta.productName)||!Number.isSafeInteger(item.id)
    ||meta.selectedChoices.some(choice=>!item.options?.includes(choice)))
    fail('REVISION_CONFLICT','原商品、规格或可售状态已改变');
  const count=async()=>{
    const cart=await read(meta.cartBase+'cart.js');
    if(!Array.isArray(cart.items))fail('PROTOCOL_MISMATCH','商店未返回购物袋清单');
    return cart.items.reduce((sum,line)=>{
      if(String(line.variant_id)!==meta.variantId)return sum;
      if(!Number.isSafeInteger(line.quantity)||line.quantity<0)fail('PROTOCOL_MISMATCH','原规格的购物袋数量无效');
      return sum+line.quantity;
    },0);
  };
  const beforeQuantity=await count();await validate();markDispatched();
  const result=await read(meta.cartBase+'cart/add.js',{items:[{id:item.id,quantity:meta.quantity}]});
  if(result.items?.length!==1||String(result.items[0].variant_id)!==meta.variantId)fail('RESULT_UNKNOWN','原规格加入购物袋的结果待核实');
  const afterQuantity=await count();
  if(afterQuantity!==beforeQuantity+meta.quantity)fail('RESULT_UNKNOWN','购物袋数量变化未能与本次操作核对');
  return {beforeQuantity,afterQuantity};
}
