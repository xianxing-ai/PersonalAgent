import {Ajv} from 'ajv';
import {ProtocolError} from './index.js';
import schema from './cloud-persistent.schema.js';
import type {CloudPersistentContracts} from './cloud-persistent.generated.js';

export type CloudPersistentCommand = CloudPersistentContracts['command'];
export type CloudPersistentReply = CloudPersistentContracts['reply'];
export type CloudPersistentOwner = CloudPersistentCommand['owner'];
const ajv = new Ajv({strict:false,allErrors:false});
ajv.addSchema(schema,'cloud-persistent-v1');
const command = ajv.compile({$ref:'cloud-persistent-v1#/properties/command'});
const reply = ajv.compile({$ref:'cloud-persistent-v1#/properties/reply'});
export function parseCloudPersistentCommand(value:unknown):CloudPersistentCommand {
  if(!command(value))throw new ProtocolError('INVALID_ARGUMENT','Invalid cloud persistent command');
  const result = value as CloudPersistentCommand;
  if(result.originCommandId!==undefined&&result.operation!=='readback')throw new ProtocolError('INVALID_ARGUMENT','Original command lookup is read-only');
  const times=[result.deadline,...(result.submit?[result.submit.taskDeadline]:[]),...(result.approval?[result.approval.expiresAt]:[])];
  if(times.some(time=>!Number.isFinite(Date.parse(time))))throw new ProtocolError('INVALID_ARGUMENT','Invalid cloud persistent deadline');
  if(/^(latest|default|current)$/iu.test(result.owner.deploymentVersion))throw new ProtocolError('INVALID_ARGUMENT','Fixed cloud deployment required');
  return structuredClone(result);
}
export function parseCloudPersistentReply(value:unknown):CloudPersistentReply {
  if(!reply(value))throw new ProtocolError('INVALID_ARGUMENT','Invalid cloud persistent reply');
  return structuredClone(value) as CloudPersistentReply;
}
