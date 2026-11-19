import type {ModelGateway} from './index.js';

/**
 * 预算降模只在调用方同时提供备用网关时生效。
 * 未提供备用网关，或 downgrade 为 false 时，返回原来的网关。
 */
export function selectDeveloperModelGateway(options: {
  primary: ModelGateway;
  fallback?: ModelGateway;
  downgrade: boolean;
}): ModelGateway {
  if (options.downgrade && options.fallback) return options.fallback;
  return options.primary;
}
