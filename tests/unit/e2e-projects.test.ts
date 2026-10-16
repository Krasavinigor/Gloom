import { describe, expect, it } from 'vitest';
import { isolatedProjectArguments } from '../../src/server/tools/e2e-projects';

describe('isolated browser project arguments', () => {
  it('runs default desktop and mobile suites separately while forwarding filters', () => {
    const arguments_ = ['tests/e2e/i18n.spec.ts', '--grep', 'English'];
    expect(isolatedProjectArguments(arguments_)).toEqual([
      [...arguments_, '--project=desktop'], [...arguments_, '--project=mobile'],
    ]);
    expect(arguments_).toEqual(['tests/e2e/i18n.spec.ts', '--grep', 'English']);
  });

  it.each([['--project=mobile'], ['--project', 'desktop']])('preserves an explicit project selection: %s', (...arguments_) => {
    expect(isolatedProjectArguments(arguments_)).toEqual([arguments_]);
  });
});
