import {resultMetadata,resultText} from '../src/features/conversation/result-text.js';

/** Host-owned bounded JSON projection; authorization remains in Runtime. */
export const projectSubagentResult = async ({result, signal, userRequest}) => {
  if (signal?.aborted) throw Error('次级智能体结果导出已取消');
  if (!result || typeof result !== 'object') throw Error('次级智能体结果无效');
  if (userRequest!==undefined && (typeof userRequest!=='string' || !userRequest.trim() || userRequest.length>16000)) throw Error('用户请求无效');
  const r = result;
  const structured=Array.isArray(r.subtasks)&&r.subtasks.length>0;
  if (!structured&&String(r.summary ?? r.aggregatedSummary ?? '').length>16384
    || (Array.isArray(r.subtasks)&&r.subtasks.some(s=>typeof s.result==='string'&&resultText(s.result,{profile:'huawei_ict_agentarts'}).length>16384
      ||typeof s.error==='string'&&s.error.length>1024))) throw Error('次级智能体结果过长，拒绝静默截断；原始结果保留在本地');
  const projected = {
    ...(userRequest===undefined?{}:{userRequest}),
    total: Number(r.total ?? 0),
    succeeded: Number(r.succeeded ?? 0),
    failed: Number(r.failed ?? 0),
    cancelled: Number(r.cancelled ?? 0),
    // The aggregate repeats child bodies; keep the original locally and export each body once.
    ...(structured?{summaryOmittedAsDuplicate:true}:{summary:String(r.summary ?? r.aggregatedSummary ?? '')}),
    subtasks: Array.isArray(r.subtasks) ? r.subtasks.map(s => ({
      subtaskId: String(s.subtaskId ?? ''),
      role: String(s.role ?? ''),
      roleLabel: String(s.roleLabel ?? ''),
      state: String(s.state ?? ''),
      ...(typeof s.result === 'string' ? {result:resultText(s.result,{profile:'huawei_ict_agentarts'}),
        ...(resultMetadata(s.result,{profile:'huawei_ict_agentarts'})?{resultMetadata:resultMetadata(s.result,{profile:'huawei_ict_agentarts'})}:{})} : {}),
      ...(typeof s.error === 'string' ? {error:s.error} : {}),
    })) : [],
  };
  if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > 64 * 1024) {
    throw Error('次级智能体汇总结果超出 64KB 上限');
  }
  return projected;
};
