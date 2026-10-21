import { addisDateString } from "@platform/shared";

/** All time-dependent code reads the time from a Clock, so tests can use a fake clock. */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export function todayInAddis(clock: Clock): string {
  return addisDateString(clock.now());
}
