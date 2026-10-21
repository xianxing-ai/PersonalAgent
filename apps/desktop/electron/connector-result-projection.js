// Fixed public protocol 1.0.0 metadata. These are not arbitrary provider bodies.
// ToolGateway still validates the original RegisteredTool result against the
// public contract; this independent projection whitelist cannot add fields.
const text={type:'string',minLength:1};
const instant={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$'};
const definitions={
  ConnectorItem:{type:'object',additionalProperties:false,
    required:['source','accountRef','externalId','occurredAt','fetchedAt','contentRef','sensitivity','dedupeKey'],
    properties:{source:text,accountRef:text,externalId:text,occurredAt:instant,fetchedAt:instant,contentRef:text,
      sensitivity:text,dedupeKey:text,validFor:text}},
  ConnectorAction:{type:'object',additionalProperties:false,required:['actionId','state','evidenceRefs'],
    properties:{actionId:text,state:{enum:['confirmed','pending','unknown']},externalId:text,
      evidenceRefs:{type:'array',items:text}}},
};
const prefix='https://personalagent.local/protocol/1.0.0#/definitions/';
export function connectorResultProjectionSchema(schema) {
  function copy(value) {
    if(Array.isArray(value))return value.map(copy);
    if(!value||typeof value!=='object')return value;
    if(Object.hasOwn(value,'$ref')) {
      if(typeof value.$ref!=='string'||!value.$ref.startsWith(prefix)||!Object.hasOwn(definitions,value.$ref.slice(prefix.length)))
        throw Error('连接器结果没有固定字段投影');
      const {$ref,...siblings}=value;return {...structuredClone(definitions[$ref.slice(prefix.length)]),...copy(siblings)};
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copy(item)]));
  }
  return copy(schema);
}
