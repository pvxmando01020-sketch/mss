interface Bucket {
  minute: number[];
  day: number[];
}

export type RateCheck = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Sliding-window rate limiter.
 * MVP: in-memory per user/IP. The Redis-backed implementation (INCR + EXPIRE)
 * plugs in behind the same interface in phase 2 for multi-instance deployments.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly perMinute: number,
    private readonly perDay: number,
  ) {}

  check(key: string): RateCheck {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { minute: [], day: [] };
      this.buckets.set(key, b);
    }
    const minuteCut = now - 60_000;
    const dayCut = now - 86_400_000;
    b.minute = b.minute.filter((t) => t > minuteCut);
    b.day = b.day.filter((t) => t > dayCut);

    if (b.minute.length >= this.perMinute) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.minute[0] + 60_000 - now) / 1000)) };
    }
    if (b.day.length >= this.perDay) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.day[0] + 86_400_000 - now) / 1000)) };
    }
    b.minute.push(now);
    b.day.push(now);
    return { ok: true };
  }

  /** Periodic housekeeping to keep memory bounded. */
  prune(now = Date.now()): void {
    const dayCut = now - 86_400_000;
    for (const [key, b] of this.buckets) {
      if (b.day.every((t) => t < dayCut)) this.buckets.delete(key);
    }
  }
}
