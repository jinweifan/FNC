# Cross-Platform Packaging Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unified local packaging commands for Linux, macOS, and Windows, then align GitHub Actions and packaging docs to the same command contract.

**Architecture:** Introduce a single Node-based packaging dispatcher script that resolves the requested platform target and invokes the existing Tauri CLI with the correct `--target` and `--bundles` arguments. Keep GitHub Actions as an OS matrix, but make each runner call the same dispatcher entry so local and CI packaging behavior stay synchronized.

**Tech Stack:** Node.js, npm scripts, Tauri 2 CLI, GitHub Actions YAML, Markdown docs

---

### Task 1: Add regression coverage for packaging target resolution

**Files:**
- Create: `scripts/package-platform.test.mjs`
- Test: `scripts/package-platform.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolveBuildPlan } from "./package-platform.mjs";

test("mac default resolves to Apple Silicon bundles", () => {
  const plan = resolveBuildPlan("mac");
  assert.equal(plan.target, "aarch64-apple-darwin");
  assert.equal(plan.bundles, "app,dmg");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/package-platform.test.mjs`
Expected: FAIL because `scripts/package-platform.mjs` does not export `resolveBuildPlan` yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function resolveBuildPlan(name) {
  if (name === "mac") {
    return { target: "aarch64-apple-darwin", bundles: "app,dmg" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/package-platform.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/package-platform.test.mjs scripts/package-platform.mjs
git commit -m "feat: add unified packaging dispatcher"
```

### Task 2: Wire local npm packaging commands to the dispatcher

**Files:**
- Create: `scripts/package-platform.mjs`
- Modify: `package.json`
- Test: `scripts/package-platform.test.mjs`

- [ ] **Step 1: Extend failing tests for all supported package aliases**

```js
test("linux resolves to ubuntu x64 appimage and deb", () => {
  const plan = resolveBuildPlan("linux");
  assert.equal(plan.target, "x86_64-unknown-linux-gnu");
  assert.equal(plan.bundles, "appimage,deb");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/package-platform.test.mjs`
Expected: FAIL for unimplemented aliases.

- [ ] **Step 3: Implement dispatcher and npm entry points**

```js
const SUPPORTED = {
  linux: { target: "x86_64-unknown-linux-gnu", bundles: "appimage,deb" },
  mac: { target: "aarch64-apple-darwin", bundles: "app,dmg" },
  "mac:intel": { target: "x86_64-apple-darwin", bundles: "app,dmg" },
  win: { target: "x86_64-pc-windows-msvc", bundles: "nsis,msi" },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/package-platform.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/package-platform.mjs scripts/package-platform.test.mjs
git commit -m "feat: add local packaging commands"
```

### Task 3: Align GitHub Actions with the dispatcher

**Files:**
- Modify: `.github/workflows/desktop-build.yml`
- Test: `.github/workflows/desktop-build.yml`

- [ ] **Step 1: Add a failing validation expectation**

Check that workflow currently invokes `tauri-apps/tauri-action@v0` directly instead of the shared script.

- [ ] **Step 2: Replace direct Tauri build invocation with shared npm commands**

```yaml
- name: Build bundles
  run: npm run ${{ matrix.package_script }}
```

- [ ] **Step 3: Keep per-runner prerequisites explicit**

```yaml
matrix:
  include:
    - os: ubuntu-22.04
      package_script: package:linux
```

- [ ] **Step 4: Run workflow syntax verification**

Run: `python3 - <<'PY' ...`
Expected: YAML parses and command strings match package.json scripts.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/desktop-build.yml
git commit -m "ci: align desktop packaging workflow"
```

### Task 4: Rewrite packaging docs around local-vs-CI packaging flows

**Files:**
- Modify: `docs/packaging.md`
- Test: `docs/packaging.md`

- [ ] **Step 1: Document local commands and platform limits**

Include:
- `npm run package:linux`
- `npm run package:mac`
- `npm run package:mac:intel`
- `npm run package:win`

- [ ] **Step 2: Document GitHub Actions matrix packaging**

Include:
- workflow file path
- trigger behavior (`workflow_dispatch`, tag push)
- uploaded artifact names

- [ ] **Step 3: Verify docs against real scripts and workflow**

Run: `rg -n "package:linux|package:mac|package:win|desktop-build" docs/packaging.md package.json .github/workflows/desktop-build.yml`
Expected: matching command names and workflow path.

- [ ] **Step 4: Commit**

```bash
git add docs/packaging.md
git commit -m "docs: update packaging workflow guide"
```
