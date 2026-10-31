import type {ToolHost} from '@personal-agent/contracts';
import type {MailProvider,MailArchiveInput} from './provider.js';
import {guardMailWrite} from './provider.js';
import type {MailService} from './service.js';
import {MAIL_CONNECTOR_VERSION} from './connector.js';

/** Real send and archive capabilities. Registration never invokes an account or grants permission. */
export function registerMailWriteTools(host:ToolHost,provider:MailProvider,service:MailService,
  resolveAccount:(input:{account?:string})=>string):()=>void {
  const outputSchema={$ref:'https://personalagent.local/protocol/1.0.0#/definitions/ConnectorAction'};
  const unregister=[host.register({descriptor:{name:'mail.send',version:MAIL_CONNECTOR_VERSION,
    inputSchema:{type:'object',additionalProperties:false,required:['to','subject','text'],properties:{
      account:{type:'string',minLength:1},to:{type:'string',minLength:3,maxLength:320},
      subject:{type:'string',minLength:1,maxLength:500},text:{type:'string',maxLength:100_000}}},
    outputSchema,sideEffect:'external_write',requiredScopes:['mail:send'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    async execute(raw,context){guardMailWrite(context);const input=raw as {account?:string;to:string;subject:string;text:string};
      return service.send(resolveAccount(input),{...input,idempotencyKey:context.runId},context);}})];
  if(provider.archive)unregister.push(host.register({descriptor:{name:'mail.archive',version:MAIL_CONNECTOR_VERSION,
    inputSchema:{type:'object',additionalProperties:false,required:['folder','uid','uidValidity','messageId'],properties:{
      account:{type:'string',minLength:1},folder:{type:'string',minLength:1,maxLength:512},uid:{type:'integer',minimum:1},
      uidValidity:{type:'integer',minimum:1},messageId:{type:'string',minLength:3,maxLength:1000,pattern:'^<[^<>\\s]+>$'}}},
    outputSchema,sideEffect:'external_write',requiredScopes:['mail:archive'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    async execute(raw,context){guardMailWrite(context);const input=raw as Omit<MailArchiveInput,'idempotencyKey'>&{account?:string};
      return provider.archive!(resolveAccount(input),{folder:input.folder,uid:input.uid,uidValidity:input.uidValidity,
        messageId:input.messageId,idempotencyKey:context.runId},context);}}));
  return ()=>unregister.forEach(release=>release());
}
