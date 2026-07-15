// Pluggable routing policy: picks which provider adapter serves a request. Currently config-based, not smart — a placeholder for pattern-mined routing later (AGENT.md §7).
import type { NormalizedRequest, ProviderAdapter } from "../types/index.js";

export interface RouterConfig {
  defaultProvider?: string;
}

// Selects a provider by configured name, falling back to the first available adapter.
export function selectProvider(
  providers: ProviderAdapter[],
  _request: NormalizedRequest,
  config: RouterConfig = {}
): ProviderAdapter {
  if (providers.length === 0) {
    throw new Error("no provider adapters configured");
  }
  const preferred = providers.find((p) => p.name === config.defaultProvider);
  return preferred ?? providers[0];
}
