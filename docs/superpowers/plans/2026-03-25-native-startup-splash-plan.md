# Native Startup Splash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every visible startup white flash on macOS by replacing it with a theme-aware native splash that hands off cleanly to the main app window.

**Architecture:** Keep the real `main` window hidden until the React shell is actually ready to paint, and show a separate native splash window that matches the restored window size and position so the user never sees a smaller modal or a white intermediate frame. Use a Rust-controlled startup state machine plus one explicit frontend `startup-shell-ready` signal; do not rely on timers, delayed cleanup, or `on_page_load` alone.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, static HTML splash asset, localStorage-backed theme/lang persistence

---

### Task 1: Document and lock the startup contract

**Files:**
- Modify: `/Users/reddyfan/code/FNC/docs/superpowers/specs/2026-03-25-startup-no-flash-spec.md`
- Reference: `/Users/reddyfan/code/FNC/src-tauri/src/lib.rs`
- Reference: `/Users/reddyfan/code/FNC/src/App.tsx`
- Reference: `/Users/reddyfan/code/FNC/public/startup-splash.html`

- [ ] **Step 1: Write the startup phases into a spec**

Document the exact phases in `/Users/reddyfan/code/FNC/docs/superpowers/specs/2026-03-25-startup-no-flash-spec.md`:
- native splash visible first
- hidden main window loads webview
- React mounts lightweight shell
- frontend emits `startup-shell-ready`
- Rust reveals main window and closes splash
- heavy UI (`Viewer3D`, Monaco) mounts only after reveal-safe phase

- [ ] **Step 2: Record the failure modes from the previous attempts**

Add explicit notes for these regressions so implementation does not repeat them:
- `on_page_load` alone still allows a white visible frame
- timer-based splash closing can get cancelled by rerenders/effect cleanup
- mounting `react-three-fiber` while the hidden main window is not ready can trigger null-target errors
- centered modal splash creates a visible size jump versus the restored main window

- [ ] **Step 3: Define the single source of truth for startup state**

Specify that Rust owns the startup lifecycle and React only sends one explicit readiness event; React must not call `show()`/`hide()` on the main window directly.

### Task 2: Build a full-window native splash that matches the real window

**Files:**
- Modify: `/Users/reddyfan/code/FNC/src-tauri/src/lib.rs`
- Modify: `/Users/reddyfan/code/FNC/src-tauri/tauri.conf.json`
- Reference: `/Users/reddyfan/code/FNC/src/lib/workspaceState.ts`

- [ ] **Step 1: Keep the main window hidden at launch**

Leave `/Users/reddyfan/code/FNC/src-tauri/tauri.conf.json` with `visible: false` for the `main` window.

- [ ] **Step 2: Restore the saved window bounds before showing any visible content**

In `/Users/reddyfan/code/FNC/src-tauri/src/lib.rs`, read the saved workspace window state before creating visible startup content so the splash can mirror the expected app size/position.

- [ ] **Step 3: Create a dedicated `startup_splash` webview window**

Build a `startup_splash` window in Rust with these properties:
- same size and position as the restored main window (or the default main window size if none is stored)
- non-resizable
- not maximizable/fullscreen-toggleable
- hidden from task switching if supported by Tauri/macOS settings
- correct background/theme applied before show

- [ ] **Step 4: Make splash independent from main window resizing logic**

Do not reuse the old centered-small splash logic. The splash must be sized explicitly and must not affect `main` window geometry.

- [ ] **Step 5: Add a Rust command/event for frontend readiness**

Add a minimal command or event handler in `/Users/reddyfan/code/FNC/src-tauri/src/lib.rs` named along the lines of `notify_startup_shell_ready` that:
- confirms the `main` webview exists
- shows and focuses `main`
- closes `startup_splash`
- runs only once

### Task 3: Make the splash theme-aware and language-aware without looking like a modal

**Files:**
- Modify: `/Users/reddyfan/code/FNC/public/startup-splash.html`
- Use: `/Users/reddyfan/code/FNC/public/logo-fnc-art.png`
- Use: `/Users/reddyfan/code/FNC/public/logo-fnc-art-dark.png`
- Reference: `/Users/reddyfan/code/FNC/src/lib/themeBoot.ts`

- [ ] **Step 1: Redesign the splash to fill the full window**

Update `/Users/reddyfan/code/FNC/public/startup-splash.html` so it reads as the actual first app page rather than a centered dialog. Use a full-window layout, themed background, centered brand block, and no oversized modal shell.

- [ ] **Step 2: Use only the requested content**

Keep only:
- theme-matched logo (light vs dark)
- `First NC Viewer`
- localized `加载工作区` / `Loading workspace`
- animated progress bar

Do not include the previous gear image.

- [ ] **Step 3: Read persisted theme and language before DOMContentLoaded**

Keep startup theme/lang resolution inline in the splash HTML so the splash never shows the wrong theme or wrong copy first.

- [ ] **Step 4: Match visual polish to the main app**

Use the same background family and tone as the actual app theme palettes so the splash-to-main transition feels like a continuation, not a page swap.

### Task 4: Gate only the heavy startup work that causes visible flash risk

**Files:**
- Modify: `/Users/reddyfan/code/FNC/src/App.tsx`
- Modify: `/Users/reddyfan/code/FNC/src/main.tsx`
- Modify: `/Users/reddyfan/code/FNC/src/components/Viewer3D.tsx` (only if strictly needed)

- [ ] **Step 1: Add a lightweight startup phase in React**

Introduce a small startup phase in `/Users/reddyfan/code/FNC/src/App.tsx` with states like `booting` → `revealed`. This phase must be internal UI state only, not window-control logic.

- [ ] **Step 2: Mount a lightweight shell before heavy editors/viewers**

Ensure the first React paint contains only the chrome/layout shell needed to look correct. Delay `Viewer3D` and Monaco mounting until after the app has sent `startup-shell-ready` and the main window is visible.

- [ ] **Step 3: Emit exactly one readiness signal to Rust**

From `/Users/reddyfan/code/FNC/src/App.tsx` or `/Users/reddyfan/code/FNC/src/main.tsx`, send `notify_startup_shell_ready` exactly once after:
- theme has been applied to DOM
- app shell has mounted
- no startup error path is active

Do not use timers as the primary reveal trigger.

- [ ] **Step 4: Remove previous reveal experiments**

Delete or avoid any leftover `on_page_load` reveal path, `requestAnimationFrame`-based show logic, or timer-driven splash cleanup that can race with rerenders.

- [ ] **Step 5: Keep startup safe for `react-three-fiber`**

Do not mount `Viewer3D` during the hidden-window phase unless a concrete test proves it is safe. Prefer revealing the main window first, then mounting `Viewer3D` on the next React phase.

### Task 5: Preserve startup theme persistence across Rust and React

**Files:**
- Modify: `/Users/reddyfan/code/FNC/src/App.tsx`
- Modify: `/Users/reddyfan/code/FNC/src/lib/themeBoot.ts`
- Modify: `/Users/reddyfan/code/FNC/src-tauri/src/lib.rs`

- [ ] **Step 1: Keep the persisted startup theme write path**

Retain the existing `set_startup_appearance` bridge in `/Users/reddyfan/code/FNC/src/App.tsx` so Rust knows the last effective theme before the next launch.

- [ ] **Step 2: Use the same theme mapping in splash and main window setup**

Ensure `navy`, `light`, and `xdark/dark` are normalized consistently between:
- `/Users/reddyfan/code/FNC/src/lib/themeBoot.ts`
- `/Users/reddyfan/code/FNC/public/startup-splash.html`
- `/Users/reddyfan/code/FNC/src-tauri/src/lib.rs`

- [ ] **Step 3: Avoid theme pollution on live theme changes**

Verify that switching themes at runtime updates the app normally and does not leave stale outer-window colors behind when the app is already open.

### Task 6: Verification

**Files:**
- Test: `/Users/reddyfan/code/FNC/src/lib/themeBoot.test.ts`
- Test: `/Users/reddyfan/code/FNC/src/lib/workspaceState.test.ts`
- Test: Add a small startup state helper test if new helper is created

- [ ] **Step 1: Run startup theme tests**

Run: `node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/themeBoot.test.ts`
Expected: PASS

- [ ] **Step 2: Run workspace-state tests if splash sizing reuses restored bounds**

Run: `node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/workspaceState.test.ts`
Expected: PASS

- [ ] **Step 3: Run frontend build**

Run: `cd /Users/reddyfan/code/FNC && npm run build`
Expected: PASS

- [ ] **Step 4: Run Rust compile check**

Run: `cd /Users/reddyfan/code/FNC && cargo check --manifest-path /Users/reddyfan/code/FNC/src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 5: Manual cold-start verification on macOS**

Run: `cd /Users/reddyfan/code/FNC && npm run tauri:dev`
Verify manually:
- no first-frame native white flash
- no second-frame webview white flash
- splash appears immediately at the final app size
- splash closes automatically without sticking
- main window keeps its saved size/position
- no intermediate resize or centered-small modal effect
- startup copy respects saved language
- startup logo matches saved theme
