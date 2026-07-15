// Redis-backed CircuitBreakerStore: the real state store used in production, since circuit breaker state is ephemeral and fast-moving.
import type { RedisClientType } from "redis";
import type { CircuitBreakerStore } from "./store.js";

export class RedisCircuitBreakerStore implements CircuitBreakerStore {
  constructor(private client: RedisClientType) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (ttlMs) {
      await this.client.set(key, value, { PX: ttlMs });
    } else {
      await this.client.set(key, value);
    }
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    await this.client.pExpire(key, ttlMs);
  }

  async setNX(key: string, value: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(key, value, { NX: true, PX: ttlMs });
    return result === "OK";
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
