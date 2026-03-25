import test from "node:test";
import assert from "node:assert/strict";
import { clampWorkspaceWindowState, sanitizeStoredWorkspaceWindowState } from "./workspaceState.ts";

test("sanitizeStoredWorkspaceWindowState accepts a complete saved snapshot", () => {
  assert.deepEqual(
    sanitizeStoredWorkspaceWindowState({
      x: 120,
      y: 80,
      width: 1440,
      height: 920,
      maximized: true,
    }),
    {
      x: 120,
      y: 80,
      width: 1440,
      height: 920,
      maximized: true,
    },
  );
});

test("sanitizeStoredWorkspaceWindowState rejects invalid values", () => {
  assert.equal(
    sanitizeStoredWorkspaceWindowState({
      x: "10",
      y: 0,
      width: 0,
      height: 720,
      maximized: false,
    }),
    null,
  );
});

test("clampWorkspaceWindowState keeps a visible window inside the chosen monitor work area", () => {
  const next = clampWorkspaceWindowState(
    {
      x: 1680,
      y: 120,
      width: 1800,
      height: 1300,
      maximized: false,
    },
    [
      { x: 0, y: 25, width: 1512, height: 945 },
      { x: 1512, y: 40, width: 1728, height: 1071 },
    ],
  );

  assert.deepEqual(next, {
    x: 1512,
    y: 40,
    width: 1728,
    height: 1071,
    maximized: false,
  });
});

test("clampWorkspaceWindowState falls back to the first monitor when saved position is off-screen", () => {
  const next = clampWorkspaceWindowState(
    {
      x: 5400,
      y: 2200,
      width: 900,
      height: 700,
      maximized: true,
    },
    [
      { x: 0, y: 25, width: 1512, height: 945 },
      { x: 1512, y: 40, width: 1728, height: 1071 },
    ],
  );

  assert.deepEqual(next, {
    x: 552,
    y: 270,
    width: 960,
    height: 700,
    maximized: true,
  });
});
