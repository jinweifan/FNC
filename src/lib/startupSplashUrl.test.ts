import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStartupSplashPath } from './startupSplashUrl.ts';

test('buildStartupSplashPath carries theme and transparent mode into splash url', () => {
  assert.equal(buildStartupSplashPath('light'), 'startup-splash.html?theme=light&transparent=1');
  assert.equal(buildStartupSplashPath('navy'), 'startup-splash.html?theme=navy&transparent=1');
  assert.equal(buildStartupSplashPath('dark'), 'startup-splash.html?theme=dark&transparent=1');
});
