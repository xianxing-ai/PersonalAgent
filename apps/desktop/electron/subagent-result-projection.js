/** Host-owned bounded JSON projection; authorization remains in Runtime. */
export const projectSubagentResult = async ({result, signal}) => {
  if (signal?.aborted) throw Error('次级智能体结果导出已取消');
  if (!result || typeof result !== 'object') throw Error('次级智能体结果无效');
  const r = result;
  const projected = {
    total: Number(r.total ?? 0),
    succeeded: Number(r.succeeded ?? 0),
    failed: Number(r.failed ?? 0),
    cancelled: Number(r.cancelled ?? 0),
    summary: String(r.summary ?? r.aggregatedSummary ?? '').slice(0, 16384),
    subtasks: Array.isArray(r.subtasks) ? r.subtasks.map(s => ({
      subtaskId: String(s.subtaskId ?? ''),
      role: String(s.role ?? ''),
      roleLabel: String(s.roleLabel ?? ''),
      state: String(s.state ?? ''),
      ...(typeof s.result === 'string' ? {result:s.result.slice(0, 4096)} : {}),
      ...(typeof s.error === 'string' ? {error:s.error.slice(0, 1024)} : {}),
    })) : [],
  };
  if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > 64 * 1024) {
    throw Error('次级智能体汇总结果超出 64KB 上限');
  }
  return projected;
};
