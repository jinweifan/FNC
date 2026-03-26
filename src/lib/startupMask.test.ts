import test from "node:test";
import assert from "node:assert/strict";

import { getStartupMaskConfig } from "./startupMask.ts";

test("getStartupMaskConfig keeps dark themes fully dark during startup handoff", () => {
  const dark = getStartupMaskConfig("dark");
  const navy = getStartupMaskConfig("navy");

  assert.equal(dark.visible, true);
  assert.equal(navy.visible, true);
  assert.equal(dark.background, "#000000");
  assert.equal(navy.background, "#020617");
  assert.ok(dark.fadeOutMs >= 200);
  assert.ok(dark.fadeOutMs <= 260);
  assert.ok(navy.fadeOutMs >= 200);
  assert.ok(navy.fadeOutMs <= 260);
});

test("getStartupMaskConfig keeps light theme aligned with app shell colors", () => {
  const light = getStartupMaskConfig("light");

  assert.equal(light.visible, true);
  assert.equal(light.background, "#eef2f7");
  assert.ok(light.fadeOutMs >= 140);
  assert.ok(light.fadeOutMs <= 220);
});
