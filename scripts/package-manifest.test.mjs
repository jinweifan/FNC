import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package.json does not pin platform-specific Tauri CLI packages directly", () => {
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const optionalDeps = Object.keys(pkg.optionalDependencies ?? {});
  const platformSpecific = [...devDeps, ...optionalDeps].filter(
    (name) => name.startsWith("@tauri-apps/cli-") && name !== "@tauri-apps/cli",
  );

  assert.deepEqual(platformSpecific, []);
});
