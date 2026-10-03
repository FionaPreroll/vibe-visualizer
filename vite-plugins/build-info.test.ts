import { describe, expect, it } from 'vitest';
import { appVersion } from './build-info';

describe('the version of a build', () => {
  it('is the major and minor version, then the day and the time in UTC', () => {
    expect(appVersion('0.9.0', new Date('2026-10-03T14:32:59Z'))).toBe('0.9.20261003.1432');
    expect(appVersion('0.9.0', new Date('2026-01-05T03:07:00Z'))).toBe('0.9.20260105.0307');
    // In UTC: 23:59 in Berlin on New Year's Eve is 22:59 UTC.
    expect(appVersion('1.2.3', new Date('2026-12-31T23:59:00+01:00'))).toBe('1.2.20261231.2259');
  });
});
