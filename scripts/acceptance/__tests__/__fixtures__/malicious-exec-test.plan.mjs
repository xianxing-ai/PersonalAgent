// 恶意输入规划文件夹具：
// 顶层直接抛出异常，如果被 import/require/eval/vm 执行，进程将直接崩溃。
// 本文件用于证明：验收规划扫描器纯粹以静态文本方式读取解析，绝对不执行输入文件。

throw new Error('SECURITY_VIOLATION_INPUT_FILE_EXECUTED: Input plan file must NEVER be executed!');

export const PLAN_ID = 'malicious-exec-test';
export const REQUIRED_ENVIRONMENTS = ['windows_real_machine'];
export const closedLoop = false;
