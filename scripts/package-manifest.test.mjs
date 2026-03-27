import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

test("package.json does not pin platform-specific Tauri CLI packages directly", () => {
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const optionalDeps = Object.keys(pkg.optionalDependencies ?? {});
  const platformSpecific = [...devDeps, ...optionalDeps].filter(
    (name) => name.startsWith("@tauri-apps/cli-") && name !== "@tauri-apps/cli",
  );

  assert.deepEqual(platformSpecific, []);
});

test("platform-specific Tauri CLI entries remain optional in package-lock", () => {
  const entry = lock.packages["node_modules/@tauri-apps/cli-win32-x64-msvc"];
  assert.equal(entry.optional, true);
});
