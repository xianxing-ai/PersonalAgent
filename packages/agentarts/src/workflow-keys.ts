import {hkdfSync} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

/** Trusted-host configuration only. Returned keys never belong in prompts or Renderer state. */
export function deriveOwnedWorkflowKeys(options:{transportToken?:string;checkpointKey?:string;receiptSecret?:string}):
  {checkpointKey:string;receiptSecret?:string} {
  const valid=(value:string|undefined):boolean=>value===undefined
    ||typeof value==='string'&&Buffer.byteLength(value)>=32&&!/[\r\n]/.test(value);
  if(!options||![options.transportToken,options.checkpointKey,options.receiptSecret].every(valid)) {
    throw new ProtocolError('INVALID_ARGUMENT','Invalid trusted workflow key configuration');
  }
  const derive=(purpose:string):string|undefined=>options.transportToken===undefined?undefined:
    Buffer.from(hkdfSync('sha256',options.transportToken,'personal-agent-owned-workflow-v1',purpose,32)).toString('base64url');
  const checkpointKey=options.checkpointKey??derive('checkpoint-v1');
  const receiptSecret=options.receiptSecret??derive('host-receipt-v1');
  if(!checkpointKey)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Trusted workflow checkpoint key unavailable');
  return {checkpointKey,...(receiptSecret===undefined?{}:{receiptSecret})};
}
