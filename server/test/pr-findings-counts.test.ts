import { describe, it, expect } from 'vitest';
import { countBySeverity } from '../src/modules/pulls/routes.js';

describe('countBySeverity (PR list FINDINGS column)', () => {
  it('tallies findings per severity', () => {
    const rows = [
      { severity: 'CRITICAL' },
      { severity: 'CRITICAL' },
      { severity: 'WARNING' },
      { severity: 'SUGGESTION' },
    ];
    expect(countBySeverity(rows)).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it('no findings → null (rendered as "—", never "0")', () => {
    expect(countBySeverity([])).toBeNull();
  });

  it('ignores unknown severities', () => {
    expect(countBySeverity([{ severity: 'INFO' }, { severity: 'WARNING' }])).toEqual({
      CRITICAL: 0,
      WARNING: 1,
      SUGGESTION: 0,
    });
  });
});
