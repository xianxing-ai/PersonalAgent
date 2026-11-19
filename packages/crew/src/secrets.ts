import type {CrewDriverId} from './store.js';

/**
 * API key 密钥提供器（P4 Claude/Grok 驱动的合规边界）。
 *
 * Claude/Grok 驱动不走本机 CLI，而是直接调用各家 HTTP API；凭据只允许两种来源：
 * 1. 用户在本地配置的环境变量（`EnvCrewApiKeyProvider`，指导用户自行配置）；
 * 2. 调用方注入的 `CrewApiKeyProvider` 实现（受信宿主自己的密钥通道）。
 *
 * 实现契约（合规边界，实现者必须遵守）：
 * - key 只在内存中传递给驱动发请求用，绝不写日志、不落盘、不进回执、
 *   不进事件流、不进错误信息；
 * - 本接口不回读、不枚举、不持久化任何凭据；crew 存储（SQLite）不存 key；
 * - 本机存在环境变量不代表可以自动使用：驱动的 `start` 仍必须先过
 *   `CrewConsentProvider.requireGranted` 的用户同意门。
 */
export interface CrewApiKeyProvider {
  /** 返回指定驱动的 API key；未配置时返回 undefined（驱动据此明确 unavailable）。 */
  getApiKey(driverId: CrewDriverId): string | undefined;
}

/** Claude 驱动读取的候选环境变量（按顺序取第一个非空值）。 */
export const CLAUDE_API_KEY_ENV_NAMES: readonly string[] = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'];

/** Grok 驱动读取的候选环境变量（按顺序取第一个非空值）。 */
export const GROK_API_KEY_ENV_NAMES: readonly string[] = ['XAI_API_KEY', 'GROK_API_KEY'];

const ENV_NAMES_BY_DRIVER: Partial<Record<CrewDriverId, readonly string[]>> = {
  claude: CLAUDE_API_KEY_ENV_NAMES,
  grok: GROK_API_KEY_ENV_NAMES,
};

/**
 * 环境变量密钥提供器：从进程环境（或注入的环境对象）读取候选变量。
 * 只判断存在性并取值，不做任何记录；未配置返回 undefined，驱动据此
 * 明确 unavailable，不假装可用。
 */
export class EnvCrewApiKeyProvider implements CrewApiKeyProvider {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  getApiKey(driverId: CrewDriverId): string | undefined {
    for (const name of ENV_NAMES_BY_DRIVER[driverId] ?? []) {
      const value = this.env[name];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }
}

/** 供错误提示使用的候选变量名（只含变量名，不含任何值）。 */
export function apiKeyEnvNames(driverId: CrewDriverId): readonly string[] {
  return ENV_NAMES_BY_DRIVER[driverId] ?? [];
}
