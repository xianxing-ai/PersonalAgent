import {AutonomyPolicyConfig, createRiskAutonomyGate} from '@personal-agent/autonomy';

const NOTICE_PREFIX = 'risk-autonomy:';

/** 把自主档快照放进现有加密模块存储。缺记录时返回 undefined。 */
export function createEncryptedAutonomyStore(storage) {
  return {
    load() {
      const value = storage.get('risk-autonomy');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
    },
    save(snapshot) {
      storage.set('risk-autonomy', snapshot);
    },
  };
}

/**
 * 产品宿主：持久化档位，中风险做完后走桌面通知端口。
 * 用户点击该通知时，才执行已记下的补偿调用。
 */
export function createRiskAutonomyHost({store, channel, getApplication, onActivity}) {
  const config = new AutonomyPolicyConfig({store});
  const gate = createRiskAutonomyGate(config);
  const compensationTools = new Map();
  function emitActivity(runId) {
    if (typeof onActivity !== 'function') return;
    const audit = config.listAudits().find(item => item.runId === runId);
    if (!audit || (audit.executionState !== 'confirmed' && audit.executionState !== 'failed')) return;
    const compensationToolName = compensationTools.get(runId) ?? audit.compensation?.toolName;
    try {
      onActivity({
        at: audit.at,
        auditId: audit.auditId,
        toolName: audit.toolName,
        tier: audit.tier,
        disposition: audit.disposition,
        compensatable: Boolean(audit.compensatable),
        rollback: audit.rollback,
        reason: `档位 ${audit.stance} · 类别 ${audit.category}`,
        ...(typeof compensationToolName === 'string' && compensationToolName ? {compensationToolName} : {}),
        result: audit.executionState === 'failed' ? 'failed' : 'succeeded',
      });
    } catch { /* Activity recording never alters tool execution or notification outcomes. */ }
  }
  return {
    config,
    gate: {
      review: input => gate.review(input),
      recordGranted(input) {
        gate.recordGranted(input);
      },
      recordExecutionState(input) {
        gate.recordExecutionState?.(input);
        emitActivity(input.runId);
      },
      notifyGranted(input) {
        let audit = config.listAudits().find(item => item.runId === input.runId);
        if (!audit?.immediate) return;
        if (audit.executionState === 'authorized' || audit.executionState === 'executing') {
          audit = config.recordExecutionState(input.runId, 'confirmed') ?? audit;
        }
        if (audit.executionState !== 'confirmed') return;
        emitActivity(input.runId);
        if (!channel) {
          config.recordNotificationDelivery(input.runId, false);
          return;
        }
        const canUndo = config.hasStoredCompensation(input.runId) && audit.rollback === 'available';
        return Promise.resolve(
          channel.sendAdvisoryNotification({
            id: `${NOTICE_PREFIX}${audit.auditId}`,
            title: '已自动完成',
            body: canUndo ? `${audit.toolName} 已完成。点击此通知可撤销。` : `${audit.toolName} 已完成（未提供可撤销补偿）。`,
            source: 'risk-autonomy',
          }),
        ).then(
          receipt => {
            const delivered = receipt && typeof receipt === 'object' && 'delivered' in receipt ? Boolean(receipt.delivered) : true;
            config.recordNotificationDelivery(input.runId, delivered);
          },
          () => {
            config.recordNotificationDelivery(input.runId, false);
          },
        );
      },
      rememberCompensation(input) {
        if (typeof input?.runId === 'string' && typeof input?.toolName === 'string' && input.toolName) {
          compensationTools.set(input.runId, input.toolName);
        }
        config.rememberCompensation(input.runId, {
          toolName: input.toolName,
          toolVersion: input.toolVersion,
          arguments: input.arguments,
        });
      },
    },
    snapshot() {
      const settings = config.describeSettings();
      return {
        stance: settings.stance,
        revoked: settings.revoked,
        revision: settings.revision,
        categories: settings.categories
          .filter(item => item.category === 'read' || item.category === 'local_reversible_write')
          .map(item => ({category: item.category, ...(item.override === undefined ? {} : {override: item.override})})),
        audits: config.listAudits().slice(-8).map(item => ({
          auditId: item.auditId,
          toolName: item.toolName,
          at: item.at,
          disposition: item.disposition,
          executionState: item.executionState,
          notificationState: item.notificationState,
          compensationReady: item.compensationReady,
          rollback: item.rollback,
        })),
      };
    },
    setStance(stance) {
      config.setStance(stance);
      return this.snapshot();
    },
    setCategory(category, disposition) {
      if (!disposition) config.clearCategoryOverride(category);
      else config.setCategoryOverride(category, disposition);
      return this.snapshot();
    },
    toggleRevoked() {
      if (config.getSettings().revoked) config.restore();
      else config.revoke();
      return this.snapshot();
    },
    compensateAudit(auditId) {
      if (typeof auditId !== 'string' || !auditId) return {executed: false};
      return this.compensate(`${NOTICE_PREFIX}${auditId}`);
    },
    compensate(notificationId) {
      if (typeof notificationId !== 'string' || !notificationId.startsWith(NOTICE_PREFIX)) return {executed: false};
      const taken = config.consumeCompensation(notificationId.slice(NOTICE_PREFIX.length));
      const application = getApplication?.();
      if (!taken.call || !application) return {executed: false, state: taken.state};
      const deadline = new Date(Date.now() + 600_000).toISOString();
      const readback = application.submitHostToolTask({
        commandId: `risk-undo-${taken.auditId}`,
        toolName: taken.call.toolName,
        toolVersion: taken.call.toolVersion,
        arguments: taken.call.arguments,
        deadline,
      });
      if (readback.task?.state === 'waiting_approval' && readback.approval?.state === 'pending') {
        application.runtime.respondApproval(readback.approval.approvalId, 'allow_once', readback.approval.revision);
        application.resumeHostToolTask?.(readback.task.taskId);
      }
      return {executed: true, taskId: readback.task.taskId, state: taken.state};
    },
  };
}
