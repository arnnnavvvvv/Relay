// Minimal key/value store interface the circuit breaker needs; lets Redis (prod) and an in-memory fake (tests) share one code path.
export interface CircuitBreakerStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlMs: number): Promise<void>;
  setNX(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<void>;
}
