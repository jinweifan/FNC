import test from "node:test";
import assert from "node:assert/strict";

import { buildEnvForPlatform, resolveBuildPlan, resolveExecutionPlan } from "./package-platform.mjs";

test("mac default resolves to Apple Silicon app and dmg bundles", () => {
  const plan = resolveBuildPlan("mac");
  assert.deepEqual(plan, {
    target: "aarch64-apple-darwin",
    bundles: "app,dmg",
  });
});

test("mac:intel resolves to Intel app and dmg bundles", () => {
  const plan = resolveBuildPlan("mac:intel");
  assert.deepEqual(plan, {
    target: "x86_64-apple-darwin",
    bundles: "app,dmg",
  });
});

test("linux resolves to Ubuntu x64 AppImage and DEB bundles", () => {
  const plan = resolveBuildPlan("linux");
  assert.deepEqual(plan, {
    target: "x86_64-unknown-linux-gnu",
    bundles: "appimage,deb",
  });
});

test("win resolves to Windows x64 NSIS and MSI bundles", () => {
  const plan = resolveBuildPlan("win");
  assert.deepEqual(plan, {
    target: "x86_64-pc-windows-msvc",
    bundles: "nsis,msi",
  });
});

test("unknown package alias throws a clear error", () => {
  assert.throws(() => resolveBuildPlan("all-supported"), /Unsupported package target/);
});

test("mac uses app-only Tauri bundling and manual DMG creation", () => {
  const plan = resolveExecutionPlan("mac");
  assert.equal(plan.tauriBundles, "app");
  assert.equal(plan.createPlainDmg, true);
});

test("linux keeps Tauri-managed bundle generation", () => {
  const plan = resolveExecutionPlan("linux");
  assert.equal(plan.tauriBundles, "appimage,deb");
  assert.equal(plan.createPlainDmg, false);
});

test("linux packaging env enables extracted AppImage execution", () => {
  const env = buildEnvForPlatform({ PATH: "/usr/bin", HOME: "/tmp/home" }, "linux");
  assert.equal(env.APPIMAGE_EXTRACT_AND_RUN, "1");
});
