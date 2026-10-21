import { Injectable } from "@nestjs/common";
import { AppError } from "./errors";

/**
 * In-memory sliding-window rate limiter.
 * Limits are per API process; with several API instances use a shared store (see docs/DECISIONS.md).
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Records an attempt and returns false if the key is now over the limit. */
  consume(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const list = this.recent(key, windowMs, now);
    list.push(now);
    this.hits.set(key, list);
    return list.length <= limit;
  }

  /** Counts attempts in the window without recording one. */
  count(key: string, windowMs: number, now = Date.now()): number {
    return this.recent(key, windowMs, now).length;
  }

  record(key: string, now = Date.now()): void {
    const list = this.hits.get(key) ?? [];
    list.push(now);
    this.hits.set(key, list);
  }

  /** Throws 429 when over the limit. */
  enforce(key: string, limit: number, windowMs: number): void {
    if (!this.consume(key, limit, windowMs)) throw new AppError(429, "TOO_MANY_REQUESTS", "Too many requests, try again in a minute");
  }

  reset(): void {
    this.hits.clear();
  }

  private recent(key: string, windowMs: number, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (this.hits.size > 50_000) this.prune(windowMs, now);
    return list;
  }

  private prune(windowMs: number, now: number): void {
    for (const [k, v] of this.hits) {
      const kept = v.filter((t) => now - t < windowMs);
      if (kept.length === 0) this.hits.delete(k);
      else this.hits.set(k, kept);
    }
  }
}
