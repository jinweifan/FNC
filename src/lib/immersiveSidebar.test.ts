import test from "node:test";
import assert from "node:assert/strict";
import { resolveImmersiveSidebarLeft } from "./immersiveSidebar.ts";

test("resolveImmersiveSidebarLeft keeps default inset outside immersive mode", () => {
  assert.equal(resolveImmersiveSidebarLeft({
    immersiveViewer: false,
    showFiles: true,
    showEditor: false,
    filesWidth: 400,
    editorWidth: 520,
  }), 16);
});

test("resolveImmersiveSidebarLeft moves outside file drawer", () => {
  assert.equal(resolveImmersiveSidebarLeft({
    immersiveViewer: true,
    showFiles: true,
    showEditor: false,
    filesWidth: 320,
    editorWidth: 520,
  }), 350);
});

test("resolveImmersiveSidebarLeft moves outside editor drawer with clamped width", () => {
  assert.equal(resolveImmersiveSidebarLeft({
    immersiveViewer: true,
    showFiles: false,
    showEditor: true,
    filesWidth: 240,
    editorWidth: 900,
  }), 710);
});
