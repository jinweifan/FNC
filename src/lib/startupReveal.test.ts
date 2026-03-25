import test from "node:test";
import assert from "node:assert/strict";
import { createStartupRevealController } from "./startupReveal.ts";

test("createStartupRevealController only requests one reveal in tauri runtime", () => {
  const controller = createStartupRevealController();

  assert.equal(controller.shouldReveal(true), true);
  assert.equal(controller.shouldReveal(true), false);
});

test("createStartupRevealController never requests reveal outside tauri runtime", () => {
  const controller = createStartupRevealController();

  assert.equal(controller.shouldReveal(false), false);
  assert.equal(controller.shouldReveal(false), false);
});
