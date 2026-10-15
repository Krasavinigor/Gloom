import { describe, expect, it } from 'vitest';
import { admissionSchema, budgetMonth, isTerminalStatus } from '../../src/server/operations/schema';

describe('AI operation boundary', () => {
  it('uses UTC admission month and terminal states', () => {
    expect(budgetMonth(new Date('2026-11-01T00:01:00+03:00'))).toBe('2026-10');
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('timed_out')).toBe(true);
  });
  it('rejects fractional money and malformed identities', () => {
    expect(admissionSchema.safeParse({ reserveMicroUsd: 1.5 }).success).toBe(false);
  });
});
