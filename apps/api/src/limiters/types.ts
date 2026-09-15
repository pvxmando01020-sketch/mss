export type RateCheck = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Rate limiting contract.
 * MemoryRateLimiter: sliding window in RAM (fallback / single instance).
 * RedisRateLimiter: fixed-window INCR + EXPIRE counters, key = session id
 * (works across instances; per-session, NOT per-IP).
 */
export interface RateLimiter {
  check(key: string): Promise<RateCheck>;
}
