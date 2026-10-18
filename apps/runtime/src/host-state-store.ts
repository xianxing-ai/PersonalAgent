import type {DatabaseSync} from 'node:sqlite';
import {ProtocolError} from '@personal-agent/contracts';
import {isDeepStrictEqual} from 'node:util';

export interface TrustedHostStateStore {
  get(key:string):unknown;
  set(key:string,value:unknown):void;
  delete(key:string):boolean;
  /** Host-only atomic complete-value CAS; absent values are represented by undefined. */
  compareAndSet?(key:string,expected:unknown,next:unknown):boolean;
}

/** Bound by trusted composition; SQL connection and namespace never reach a caller. */
export function bindHostStateStore(db:DatabaseSync,namespace:string):TrustedHostStateStore {
  if(typeof namespace!=='string' || namespace.length<1 || namespace.length>256 || namespace.includes('\0')) {
    throw new ProtocolError('INVALID_ARGUMENT','Invalid host state namespace');
  }
  const checked=(key:string)=>{
    if(typeof key!=='string' || key.length<1 || key.length>256 || key.includes('\0')) {
      throw new ProtocolError('INVALID_ARGUMENT','Invalid host state key');
    }
    return key;
  };
  return Object.freeze({
    get(key:string) {
      const row=db.prepare('SELECT value_json FROM trusted_host_state WHERE namespace = ? AND state_key = ?')
        .get(namespace,checked(key)) as {value_json:string}|undefined;
      return row?JSON.parse(row.value_json):undefined;
    },
    set(key:string,value:unknown) {
      checked(key);
      let encoded:string|undefined;
      try {encoded=JSON.stringify(value);} catch {throw new ProtocolError('INVALID_ARGUMENT','Host state must be JSON');}
      if(encoded===undefined || Buffer.byteLength(encoded)>1048576)throw new ProtocolError('INVALID_ARGUMENT','Invalid host state size');
      if(!isDeepStrictEqual(value,JSON.parse(encoded)))throw new ProtocolError('INVALID_ARGUMENT','Host state must be lossless JSON');
      db.prepare('INSERT INTO trusted_host_state (namespace,state_key,value_json) VALUES (?,?,?) ON CONFLICT(namespace,state_key) DO UPDATE SET value_json=excluded.value_json')
        .run(namespace,key,encoded);
    },
    compareAndSet(key:string,expected:unknown,next:unknown) {
      checked(key);
      const encode=(value:unknown)=>{
        let json:string|undefined;
        try {json=JSON.stringify(value);}catch {throw new ProtocolError('INVALID_ARGUMENT','Host state must be JSON');}
        if(json===undefined||Buffer.byteLength(json)>1048576||!isDeepStrictEqual(value,JSON.parse(json)))
          throw new ProtocolError('INVALID_ARGUMENT','Host state must be bounded lossless JSON');
        return json;
      };
      const encoded=encode(next);
      if(expected===undefined)return db.prepare('INSERT INTO trusted_host_state(namespace,state_key,value_json) VALUES (?,?,?) ON CONFLICT(namespace,state_key) DO NOTHING')
        .run(namespace,key,encoded).changes===1;
      const previous=encode(expected);
      return db.prepare('UPDATE trusted_host_state SET value_json = ? WHERE namespace = ? AND state_key = ? AND value_json = ?')
        .run(encoded,namespace,key,previous).changes===1;
    },
    delete(key:string) {return db.prepare('DELETE FROM trusted_host_state WHERE namespace = ? AND state_key = ?')
      .run(namespace,checked(key)).changes>0;},
  });
}
