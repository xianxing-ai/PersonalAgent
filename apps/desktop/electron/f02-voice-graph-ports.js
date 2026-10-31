/**
 * Trusted Desktop ports for F02 hosts (Owner/zemeng native voice surface).
 * Acoustic/device proof still requires physical evidence; these ports only expose
 * existing Live/authorization hosts. Lab injects createF02*Host when ports are complete.
 * Never treats text history as ASR proof; echo unknown / playback unverified stays fail-closed.
 */
export function createF02VoiceGraphPorts({
  getApplication,authorizationQuestions,voiceCommandHost,liveVoiceHost,authorizeExport,now=()=>new Date(),
}={}) {
  if(typeof getApplication!=='function'
    ||typeof authorizationQuestions?.snapshot!=='function'
    ||typeof authorizationQuestions?.refresh!=='function'
    ||typeof authorizeExport!=='function')
    return {unavailable:'f02_voice_desktop_ports_unavailable',ports:undefined};

  const assertCurrent=(scope)=>{
    const application=getApplication();
    if(!application?.runtime)throw Error('F02 Runtime unavailable');
    const task=application.runtime.getTask(scope.parentTaskId??scope.taskId);
    if(task.cancelRequested||!['running','waiting_approval'].includes(task.state))
      throw Error('F02 original task is no longer current');
  };

  const resolveOriginalQuestion=(scope,original)=>{
    assertCurrent(scope);
    const snap=authorizationQuestions.snapshot();
    const match=(snap?.pending??[]).find(item=>item.sourceTaskId===original.taskId);
    if(!match?.questionId||!match.runId)return undefined;
    return {questionId:match.questionId,sourceTaskId:match.sourceTaskId,runId:match.runId};
  };

  const readFinal=scope=>{
    assertCurrent(scope);
    if(typeof liveVoiceHost?.readFinalReceipt!=='function')return undefined;
    const receipt=liveVoiceHost.readFinalReceipt(scope);
    // Fail closed: unknown echo or unverified playback is not device evidence.
    if(!receipt||receipt.echo==='unknown'||receipt.questionPlaybackVerified!==true)return undefined;
    return receipt;
  };

  const resolveOriginalVoice=scope=>{
    assertCurrent(scope);
    if(typeof voiceCommandHost?.resolveBoundUtterance!=='function')return undefined;
    return voiceCommandHost.resolveBoundUtterance(scope);
  };

  const resolveOriginalConfirmation=scope=>{
    assertCurrent(scope);
    if(typeof authorizationQuestions.currentRequirement!=='function')return undefined;
    return authorizationQuestions.currentRequirement(scope,'f02-confirmation');
  };

  return {
    unavailable:null,
    ports:{
      questions:authorizationQuestions,
      resolveOriginalQuestion,
      resolveOriginalVoice,
      resolveOriginalConfirmation,
      readFinal,
      assertCurrent,
      authorizeExport:async(scope,result)=>{
        assertCurrent(scope);
        const allowed=await authorizeExport({scope,result,now:now()});
        assertCurrent(scope);
        return allowed===true;
      },
      now,
      // Device evidence still incomplete until physical mic/playback verification lands.
      deviceEvidenceReady:()=>false,
    },
  };
}
