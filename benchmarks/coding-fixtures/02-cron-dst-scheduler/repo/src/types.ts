export interface CronFieldSet {
  readonly values: ReadonlySet<number>;
  readonly isWildcard: boolean;
}

export interface ParsedCron {
  readonly expression: string;
  readonly minutes: CronFieldSet;
  readonly hours: CronFieldSet;
  readonly daysOfMonth: CronFieldSet;
  readonly months: CronFieldSet;
  readonly daysOfWeek: CronFieldSet;
}

export interface ZonedParts {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
  readonly hour: number; // 0-23
  readonly minute: number; // 0-59
  readonly weekday: number; // 0 (Sun) - 6 (Sat)
}
