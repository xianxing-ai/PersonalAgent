/**
 * 合法代码规划 fixture：导出 pure function
 */
export function planMockWindowsAcceptance(options = {}) {
  return {
    id: 'mock-windows-sandbox-acceptance',
    title: 'Windows 沙箱安全隔离执行离线验收规划',
    closedLoop: false,
    status: 'unavailable',
    requiredEnvironments: ['windows_real_machine'],
    acceptanceSteps: [
      '启动受控 Windows 沙箱子进程',
      '下发受控无破坏性执行指令',
      '核实沙箱退出码为 0 并产生隔离审计回执',
    ],
    evidenceRequirements: [
      '外部读回：tests/manual/windows/sandbox-audit.json 回执',
      '无沙箱外文件泄露或修改证据',
    ],
    reason: '待 Windows 真机沙箱环境验证',
    pendingItems: ['windows_sandbox_runtime_check'],
  };
}
