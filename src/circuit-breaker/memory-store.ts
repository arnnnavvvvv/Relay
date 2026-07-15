// In-memory CircuitBreakerStore: a fake used only in tests so breaker logic can be verified without a live Redis instance.
import type { CircuitBreakerStore } from "./store.js";

interface Entry {
  value: string;
  expiresAt: number | null;
}

export class InMemoryCircuitBreakerStore implements CircuitBreakerStore {
  private entries = new Map<string, Entry>();
  constructor(private now: () => number = () => Date.now()) {}

  private read(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: ttlMs ? this.now() + ttlMs : null });
  }

  async incr(key: string): Promise<number> {
    const current = Number(this.read(key) ?? "0") + 1;
    const existing = this.entries.get(key);
    this.entries.set(key, { value: String(current), expiresAt: existing?.expiresAt ?? null });
    return current;
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    const existing = this.entries.get(key);
    if (existing) existing.expiresAt = this.now() + ttlMs;
  }

  async setNX(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.read(key) !== null) return false;
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    return true;
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
