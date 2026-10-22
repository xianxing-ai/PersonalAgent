// Synthetic DOM for the scoped authorization controllers. Real keyboard activation/layout
// is verified separately in Electron; this fixture observes identity, focus and IPC bodies.
export function authorizationDom() {
  let document;
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.attributes=new Map();this.listeners=new Map();
      this.dataset={};this.disabled=false;this.hidden=false;this.value='';this.textContent='';
      this.classList={add:name=>this.className=[this.className,name].filter(Boolean).join(' ')};}
    setAttribute(name,value){value=String(value);this.attributes.set(name,value);
      if(name==='class')this.className=value;if(name==='value')this.value=value;
      if(name==='disabled')this.disabled=true;
      if(name==='open')this.open=true;
      if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/gu,(_,letter)=>letter.toUpperCase())]=value;}
    hasAttribute(name){return this.attributes.has(name);}
    append(...nodes){for(let node of nodes){if(typeof node==='string'){const text=new Element('text');text.textContent=node;node=text;}
      node.parentElement=this;this.children.push(node);}}
    before(...nodes){const parent=this.parentElement;if(!parent)return;const index=parent.children.indexOf(this);
      for(const node of nodes)node.parentElement=parent;parent.children.splice(index,0,...nodes);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=undefined;}
    get elements(){return new Proxy({},{get:(_,name)=>this.querySelector(`[name="${String(name)}"]`)});}
    replaceChildren(...nodes){if(this.contains(document.activeElement))document.activeElement=document.body;
      for(const node of this.children)node.parentElement=undefined;this.children=[];this.append(...nodes);}
    set innerHTML(value){this.html=value;this.replaceChildren();const stack=[this];
      for(const token of value.match(/<[^>]+>|[^<]+/gu)??[]){
        if(token.startsWith('</')){stack.pop();continue;}
        if(!token.startsWith('<')){stack.at(-1).textContent+=token;continue;}
        const tag=token.match(/^<([\w-]+)/u)?.[1];if(!tag)continue;
        const node=new Element(tag);
        for(const attr of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/gu))node.setAttribute(attr[1],attr[2]??'');
        stack.at(-1).append(node);if(!['input','link','br','hr'].includes(tag))stack.push(node);
      }}
    matches(selector){return selector.split(',').some(part=>{part=part.trim();
      if(part.startsWith('.'))return (this.className??'').split(' ').includes(part.slice(1));
      const match=part.match(/^([\w-]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/u);
      return Boolean(match)&&(!match[1]||match[1]===this.tag)&&(!match[2]||this.hasAttribute(match[2])
        &&(match[3]===undefined||this.attributes.get(match[2])===match[3]));});}
    querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector);}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}
    focus(){document.activeElement=this;}
    addEventListener(name,listener){this.listeners.set(name,listener);}
    removeEventListener(name,listener){if(this.listeners.get(name)===listener)this.listeners.delete(name);}
    async fire(name,target){return this.listeners.get(name)?.({target});}
  }
  document={createElement:tag=>new Element(tag),head:new Element('head'),body:new Element('body'),activeElement:undefined,
    querySelector:selector=>document.head.querySelector(selector)};
  document.activeElement=document.body;
  const root=new Element('main');root.ownerDocument=document;document.body.append(root);
  return {document,root,button:decision=>root.querySelector(`[data-authorization-decision="${decision}"]`)};
}
