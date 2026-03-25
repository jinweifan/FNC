import test from "node:test";
import assert from "node:assert/strict";
import {
  findShortcutConflicts,
  formatShortcutForDisplay,
  getDefaultShortcuts,
  isModifierOnlyShortcut,
  keyboardEventToShortcut,
  migrateLegacyShortcutMap,
  normalizeShortcut,
} from "./shortcuts.ts";

test("getDefaultShortcuts uses Meta digits on macOS only", () => {
  assert.equal(getDefaultShortcuts("MacIntel").toggleFiles, "Meta+1");
  assert.equal(getDefaultShortcuts("Win32").toggleFiles, "Alt+1");
  assert.equal(getDefaultShortcuts("MacIntel").toggleImmersiveViewer, "Meta+4");
  assert.equal(getDefaultShortcuts("Win32").toggleImmersiveViewer, "Alt+4");
});

test("formatShortcutForDisplay renders Meta as Cmd on macOS", () => {
  assert.equal(formatShortcutForDisplay("Meta+1", true), "Cmd+1");
  assert.equal(formatShortcutForDisplay("Meta+1", false), "Meta+1");
});

test("migrateLegacyShortcutMap upgrades stored macOS alt digit toggles", () => {
  const migrated = migrateLegacyShortcutMap({
    ...getDefaultShortcuts("MacIntel"),
    toggleFiles: "Alt+1",
    toggleEditor: "Alt+2",
    toggleViewer: "Alt+3",
    toggleImmersiveViewer: "Alt+4",
  }, "MacIntel");

  assert.equal(migrated.toggleFiles, "Meta+1");
  assert.equal(migrated.toggleEditor, "Meta+2");
  assert.equal(migrated.toggleViewer, "Meta+3");
  assert.equal(migrated.toggleImmersiveViewer, "Meta+4");
});

test("keyboardEventToShortcut normalizes primary combinations", () => {
  assert.equal(keyboardEventToShortcut({
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: true,
    key: "1",
  }), "Meta+1");
  assert.equal(keyboardEventToShortcut({
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    metaKey: true,
    key: "a",
  }), "Shift+Meta+A");
});

test("normalizeShortcut and modifier detection stay stable", () => {
  assert.equal(normalizeShortcut("cmd+1"), "Meta+1");
  assert.equal(isModifierOnlyShortcut("Meta"), true);
  assert.equal(isModifierOnlyShortcut("Meta+1"), false);
});

test("findShortcutConflicts returns both sides of duplicate bindings", () => {
  const conflicts = findShortcutConflicts({
    ...getDefaultShortcuts("MacIntel"),
    toggleFiles: "Meta+1",
    toggleEditor: "Meta+1",
  });

  assert.deepEqual(conflicts.toggleFiles, ["toggleEditor"]);
  assert.deepEqual(conflicts.toggleEditor, ["toggleFiles"]);
  assert.equal(conflicts.toggleViewer, undefined);
});
