import test from "node:test";
import assert from "node:assert/strict";
import { getShortcutGroups } from "./shortcutGroups.ts";

test("getShortcutGroups returns compact grouped layout buckets", () => {
  const groups = getShortcutGroups();
  assert.deepEqual(groups.map((group) => group.id), ["panels", "viewer", "path"]);
  assert.deepEqual(groups[0].itemIds, ["toggleFiles", "toggleEditor", "toggleViewer"]);
  assert.equal(groups[1].itemIds.includes("toggleImmersiveViewer"), true);
  assert.deepEqual(groups[2].itemIds, ["pathPrev", "pathNext"]);
});
