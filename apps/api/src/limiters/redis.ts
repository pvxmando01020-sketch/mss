import type { Redis } from 'ioredis';
import type { RateCheck, RateLimiter } from './types';

/**
 * Redis fixed-window counters (INCR + EXPIRE), keyed by session id:
 *   rl:m:{session}:{minuteEpoch}   → per-minute budget
 *   rl:d:{session}:{yyyy-mm-dd}    → per-day budget
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly perMinute: number,
    private readonly perDay: number,
  ) {}

  async check(key: string): Promise<RateCheck> {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const day = new Date(now).toISOString().slice(0, 10);
    const mKey = `rl:m:${key}:${minute}`;
    const dKey = `rl:d:${key}:${day}`;

    const [m, d] = await Promise.all([this.redis.incr(mKey), this.redis.incr(dKey)]);
    if (m === 1) await this.redis.expire(mKey, 120);
    if (d === 1) await this.redis.expire(dKey, 172_800);

    if (m > this.perMinute) {
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((minute * 60_000 + 60_000 - now) / 1000)),
      };
    }
    if (d > this.perDay) {
      return { ok: false, retryAfterSec: Math.ceil((86_400_000 - (now % 86_400_000)) / 1000) };
    }
    return { ok: true };
  }
}
