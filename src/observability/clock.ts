/**
 * Clock abstraction.
 *
 * A single, injectable clock source keeps timestamps consistent and lets tests
 * make durations deterministic (aion-docs/engineering/observability-standards.md:
 * "Timestamps are consistent (single clock source / UTC) so traces order
 * correctly"). All times are emitted as UTC ISO-8601 strings.
 */
export interface Clock {
  /** Current time as a Date. */
  now(): Date;
  /** Current time as a UTC ISO-8601 string. */
  isoNow(): string;
}

/** The default clock, backed by the system time. */
export const systemClock: Clock = {
  now: () => new Date(),
  isoNow: () => new Date().toISOString(),
};

/**
 * A manually-advanced clock for tests. Starts at `start` and advances only when
 * `advance` is called, making elapsed durations exact and predictable.
 */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: Date | string | number = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  isoNow(): string {
    return new Date(this.current).toISOString();
  }

  /** Advance the clock by `ms` milliseconds. */
  advance(ms: number): void {
    this.current += ms;
  }
}
