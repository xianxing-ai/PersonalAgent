// 测试夹具：存在多个条件分支返回不同 closedLoop 值的 TS 规划函数
// 静态解析器无法确定运行时走向哪一个分支，必须明确报告 ambiguous_closedLoop 与行号，
// 绝不能从“出现 false”推断默认结果，更不能把 true 改为 false。

export interface AmbiguousEvidence {
  hasRealMachineEvidence: boolean;
}

export function planAmbiguousAcceptance(evidence?: AmbiguousEvidence) {
  if (!evidence || !evidence.hasRealMachineEvidence) {
    return {
      id: 'ambiguous-test-plan',
      title: '多分支歧义测试规划',
      closedLoop: false,
      status: 'unavailable',
      requiredEnvironments: ['windows_real_machine'],
      acceptanceSteps: ['步骤1'],
      evidenceRequirements: ['证据1'],
      reason: '待真实验收',
    };
  }

  return {
    id: 'ambiguous-test-plan',
    title: '多分支歧义测试规划',
    closedLoop: true,
    status: 'verified',
    requiredEnvironments: ['windows_real_machine'],
    acceptanceSteps: ['步骤1'],
    evidenceRequirements: ['证据1'],
  };
}
