import {createRemoteRunnerService as createService} from '@personal-agent/runtime/application';

/** Explicit Fake source and egress authority for transport/receipt fixtures only. */
export function createSyntheticRemoteRunnerService(options) {
  const service=createService({...options,prepareDispatch:async scope=>{
    scope.assertCurrent();
    return {assertBeforeSend(){scope.assertCurrent();}};
  }});
  const submit=service.submit;
  return {...service,submit:job=>submit({signal:new AbortController().signal,...job,assertCurrent(){}})};
}
