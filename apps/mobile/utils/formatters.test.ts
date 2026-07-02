import { formatDuration, formatFileSize } from './formatters';

describe('formatDuration', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(225)).toBe('3:45');
  });

  it('formats durations over an hour as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('is defensive against bad input', () => {
    expect(formatDuration(-10)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});

describe('formatFileSize', () => {
  it('scales through units', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(4_404_019)).toBe('4.2 MB');
  });

  it('is defensive against bad input', () => {
    expect(formatFileSize(-1)).toBe('0 B');
  });
});
