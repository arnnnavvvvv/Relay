// Pluggable routing policy: orders provider adapters by preference for a request. Currently config-based, not smart — a placeholder for a data-driven routing policy later.
import type { NormalizedRequest, ProviderAdapter } from "../types/index.js";

export interface RouterConfig {
  defaultProvider?: string;
}

// Orders providers with the configured default first (if present), then the rest in their original order.
export function orderProviders(
  providers: ProviderAdapter[],
  _request: NormalizedRequest,
  config: RouterConfig = {}
): ProviderAdapter[] {
  if (providers.length === 0) {
    throw new Error("no provider adapters configured");
  }
  const preferredIndex = providers.findIndex((p) => p.name === config.defaultProvider);
  if (preferredIndex <= 0) {
    return providers;
  }
  const preferred = providers[preferredIndex];
  return [preferred, ...providers.slice(0, preferredIndex), ...providers.slice(preferredIndex + 1)];
}
