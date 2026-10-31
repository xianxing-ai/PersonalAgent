/** Test-only: never attach the synthetic dispatcher to a different URL. */
export function scopeSyntheticCa(target,dispatcher,originalFetch){
  const targets=new Set(Array.isArray(target)?target:[target]);
  return (url,init)=>targets.has(String(url)) ? originalFetch(url,{...init,dispatcher}) : originalFetch(url,init);
}
