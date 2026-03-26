import test from 'node:test';
import assert from 'node:assert/strict';

import { createStartupPaintNotifier } from './startupReveal.ts';

test('startup paint notifier only fires once after a shown event', async () => {
  const events: string[] = [];
  const notifier = createStartupPaintNotifier(() => {
    events.push('painted');
  });

  assert.equal(notifier.hasPainted(), false);
  notifier.onWindowShown();
  notifier.onWindowShown();

  await notifier.flush();

  assert.deepEqual(events, ['painted']);
  assert.equal(notifier.hasPainted(), true);
});

test('startup paint notifier does nothing until the window is shown', async () => {
  const events: string[] = [];
  const notifier = createStartupPaintNotifier(() => {
    events.push('painted');
  });

  await notifier.flush();

  assert.deepEqual(events, []);
  assert.equal(notifier.hasPainted(), false);
});
