const competitionFooter = /\n\[profile=huawei_ict_agentarts; verification=(mock|unverified)\]$/;

// The host supplies provenance from the original Runtime profile and loop.
// Without it, including for ordinary messages, all source text is preserved.
export function resultMetadata(value, provenance) {
  if (typeof value !== 'string' || provenance?.profile !== 'huawei_ict_agentarts') return undefined;
  const match = competitionFooter.exec(value);
  return match ? {profile: 'huawei_ict_agentarts', verification: match[1]} : undefined;
}

export function resultText(value, provenance) {
  if (typeof value !== 'string') return '';
  return resultMetadata(value, provenance) ? value.replace(competitionFooter, '') : value;
}

function friendlyChatFailure(error) {
  const raw = typeof error?.message === 'string' ? error.message.trim() : '';
  if (!raw) return '模型暂时不可用，请稍后重试。';
  const cleaned = raw
    .replace(/\s*\[(?:stage|errorId)=[^\]]+\]/g, '')
    .replace(/\s*\[cloud:[^\]]+\]/g, '')
    .replace(/^云端已返回明确失败：\s*/, '')
    .trim();
  return cleaned || '模型暂时不可用，请稍后重试。';
}

export function browserExcerptReply(task, children = []) {
  if (!task?.taskId || task.bodyWithheld || task.outputTruncated || task.cancelRequested || task.conflictOnly) return '';
  if (!['failed', 'waiting_reconciliation'].includes(task.state)) return '';
  const worker = children.find(child => child.parentTaskId === task.taskId && child.deviceReplyKind === 'browser-excerpt');
  return typeof worker?.finalReply === 'string' ? worker.finalReply : '';
}

// The main chat delivers the parent model's reply first; failed child worker errors stay in trace/worker status
// so the model can answer naturally, and chat only shows a fallback error when the model itself failed with no answer.
export function mainChatReplies(task, children = [], streamed = '') {
  if (task.bodyWithheld) return [];
  const ownAnswer = resultText(task.resultSummary, task.resultMetadata);
  if (task.outputTruncated) return children.length ? [] : ownAnswer ? [ownAnswer] : [];
  const excerpt = browserExcerptReply(task, children);
  if (excerpt) return [excerpt];
  const deviceReply=children.find(child=>child.replyForDeviceTask===true&&child.state==='succeeded'&&child.finalReply);
  if(task.state==='succeeded'&&deviceReply)return [deviceReply.finalReply];
  if (ownAnswer || streamed) return [ownAnswer || streamed];
  const replies = children
    .filter(child => child.state === 'succeeded' && child.finalReply)
    .map(child => child.finalReply);
  if (!replies.length && task.state === 'failed') {
    replies.push(friendlyChatFailure(task.error));
  }
  if (!replies.length) {
    if (task.state === 'cancelled') return ['已停止。'];
    if (task.state === 'waiting_reconciliation') return ['这次执行的结果还需要核实。'];
    if (task.state === 'succeeded' && children.length && children.every(child => child.state === 'succeeded'))
      return ['子助手已结束，未返回文字结论。'];
  }
  return replies;
}
