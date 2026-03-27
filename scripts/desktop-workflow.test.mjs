import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/desktop-build.yml", import.meta.url), "utf8");

test("workflow opts JavaScript actions into Node 24 runtime", () => {
  assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*true/);
});

test("workflow builds Linux packages in a Jammy-compatible container", () => {
  assert.match(workflow, /package_script:\s*package:linux:docker/);
});

test("workflow no longer requests the unsupported macOS Intel runner", () => {
  assert.doesNotMatch(workflow, /macos-13/);
  assert.match(workflow, /macos-14/);
});
