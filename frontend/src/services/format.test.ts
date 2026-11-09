import { describe, expect, it } from 'vitest';
import { formatCount, formatSize, formatDate, formatTimestamp } from './format';

describe('overview display formatting', () => {
  it('formats exact counts without rounding into growth or compact estimates', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('Not reported');
  });
  it('preserves the KB unit reported by GitHub', () => {
    expect(formatSize(2048)).toBe('2,048 KB');
    expect(formatSize(0)).toBe('0 KB');
    expect(formatSize(null)).toBe('Not reported');
  });
  it('uses UTC rather than shifting a creation date with the browser timezone', () => {
    expect(formatDate('2020-01-01T00:30:00Z')).toBe('Jan 1, 2020');
    expect(formatDate(null)).toBe('Not reported');
    expect(formatDate('invalid')).toBe('Not reported');
    expect(formatTimestamp('2020-01-01T00:30:00Z')).toContain('UTC');
  });
});
