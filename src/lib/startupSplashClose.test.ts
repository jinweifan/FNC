import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldCloseSplashFallback } from './startupSplashClose.ts';

test('fallback closes splash only when startup paint did not arrive', () => {
  assert.equal(shouldCloseSplashFallback(false), true);
  assert.equal(shouldCloseSplashFallback(true), false);
});
