import { describe, expect, it } from 'vitest';
import { describeSchedule, ENGLISH_SCHEDULE_STRINGS } from './cron';

describe('describeSchedule', () => {
  it('parses the fallback expression when no schedule object exists', () => {
    expect(describeSchedule(undefined, '0 3 * * *', ENGLISH_SCHEDULE_STRINGS)).toBe('Daily at 03:00');
    expect(describeSchedule(undefined, '0 4 * * 0', ENGLISH_SCHEDULE_STRINGS)).toBe('Weekly on Sun at 04:00');
  });

  it('describes minute and hour step expressions', () => {
    expect(describeSchedule(undefined, '*/15 * * * *', ENGLISH_SCHEDULE_STRINGS)).toBe('Every 15 minutes');
    expect(describeSchedule(undefined, '0 */6 * * *', ENGLISH_SCHEDULE_STRINGS)).toBe('Every 6 hours');
  });

  it('falls back to the raw expression for shapes it cannot describe', () => {
    expect(describeSchedule(undefined, '0 3 1 * *', ENGLISH_SCHEDULE_STRINGS)).toBe('Monthly on the 1st at 03:00');
    expect(describeSchedule(undefined, '5 4 * * 1-5', ENGLISH_SCHEDULE_STRINGS)).toBe('5 4 * * 1-5');
  });

  it('returns the none placeholder when nothing is available', () => {
    expect(describeSchedule(undefined, undefined, ENGLISH_SCHEDULE_STRINGS)).toBe('—');
  });
});
