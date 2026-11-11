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
export function createRiskAutonomyHost({store, channel, getApplication}) {
  const config = new AutonomyPolicyConfig({store});
  const gate = createRiskAutonomyGate(config);
  return {
    config,
    gate: {
      review: input => gate.review(input),
      recordGranted(input) {
        gate.recordGranted(input);
      },
      notifyGranted(input) {
        const audit = config.listAudits().find(item => item.runId === input.runId);
        if (!audit?.immediate || !channel) return;
        void channel.sendAdvisoryNotification({
          id: `${NOTICE_PREFIX}${audit.auditId}`,
          title: '已自动完成',
          body: `${audit.toolName} 已完成。点击此通知可撤销。`,
          source: 'risk-autonomy',
        });
      },
      rememberCompensation(input) {
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
